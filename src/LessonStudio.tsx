import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowClockwise, ArrowRight, ArrowSquareOut, ArrowUp, BookOpen, CaretDown, ChatCircleText,
  Clock, DownloadSimple, FileText, FolderOpen, LinkSimple, List, MagnifyingGlass,
  NotePencil, Plus, QrCode, Sparkle, Stop, UploadSimple, VideoCamera,
  WarningCircle, X,
} from "@phosphor-icons/react";
import { api } from "./api";
import type { Course } from "./types";
import type { BilibiliCatalog, Lesson, LessonChatCitation, LessonChatContext, LessonList, LessonNotes, LocalTranscriptionEnvironment } from "./lesson-types";
import LessonText from "./LessonText";
import LessonCorrections from "./LessonCorrections";
import ModelSettings from "./ModelSettings";
import LessonVisualPanel from "./LessonVisualPanel";
import LectureDocument, { lectureAnchor, readingExamplesFor, readingSectionsFor } from "./LectureDocument";
import LessonChat from "./LessonChat";
import LessonStudyPanel from "./LessonStudyPanel";
import useLessonStudy from "./useLessonStudy";
import StudyDocumentReader from "./StudyDocumentReader";
import BilibiliLoginDialog from "./BilibiliLoginDialog";
import NewbieGuide from "./NewbieGuide";
import type { GuideStep } from "./NewbieGuide";
import ModelSetupNotice from "./ModelSetupNotice";
import "./lesson-studio.css";

type Props = {
  courses: Course[];
  providerConfigured: boolean;
  onRefresh: () => Promise<unknown>;
  onNotify: (message: string) => void;
  onOpenCourse: (id: string) => void;
  onAddCourse?: () => void;
  savedCardKeys?: string[];
  onPractice?: (courseId: string, documentId: string) => void;
  initialTarget?: { lessonId: string; kind: "section" | "example"; id: string; sequence: number };
};
type ReaderTab = "notes" | "examples" | "transcript" | "visual";
type SourceFormat = "auto" | "srt" | "vtt" | "json" | "txt" | "md";
type Draft = { courseId: string; title: string; url: string; part: string; scope: string; text: string; format: SourceFormat; sourceName: string };
const ACTIVE = new Set<Lesson["status"]>(["queued", "analyzing"]);
const STATUS: Record<Lesson["status"], string> = {
  waiting_source: "等字幕", ready: "待生成笔记", queued: "排队中", analyzing: "正在整理",
  completed: "已完成", failed: "整理未完成", cancelled: "已取消",
};
const TABS: { value: ReaderTab; label: string }[] = [{ value: "notes", label: "重点笔记" }, { value: "examples", label: "课堂例题" }, { value: "transcript", label: "字幕原文" }, { value: "visual", label: "板书截图" }];
const MAX_TEXT = 250000;
const MAX_BATCH = 20;
// 完整 BV 号或 B 站分享短链才触发自动读目录，避免边输入边请求。
const looksLikeVideoLink = (value: string) => /BV[1-9A-HJ-NP-Za-km-z]{10}/.test(value) || /^https?:\/\/b23\.tv\/[A-Za-z0-9_-]+/.test(value.trim());
const suspiciousTranscript = (text: string) => /(?:\b[A-Za-z]\s*[,，]\s*){5,}|(.)\1{9}/.test(text);
function sectionCardKey(lesson: Lesson, section: LessonNotes["sections"][number]) {
  let fingerprint = 2166136261;
  for (const character of section.text) fingerprint = Math.imul(fingerprint ^ character.codePointAt(0)!, 16777619);
  return `${lesson.id}:${section.id}:${section.text.length}-${(fingerprint >>> 0).toString(16)}`;
}
const message = (cause: unknown) => cause instanceof Error ? cause.message : "操作未完成，请稍后重试。";
const formatTime = (seconds: number | null) => {
  if (seconds == null || !Number.isFinite(seconds)) return "无时间戳";
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600), minutes = Math.floor(whole % 3600 / 60), rest = whole % 60;
  return `${hours ? `${hours}:` : ""}${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
};
const formatDuration = (seconds: number) => seconds > 0 ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "时长未知";
const CN_DIGITS = "零一二三四五六七八九";
function chineseNumber(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 9999) return String(value);
  const units = ["", "十", "百", "千"];
  const digits = String(value).split("").map(Number);
  let result = "", pendingZero = false;
  digits.forEach((digit, index) => {
    const unit = units[digits.length - index - 1];
    if (digit === 0) { pendingZero = true; return; }
    if (pendingZero && result) result += "零";
    pendingZero = false;
    result += CN_DIGITS[digit] + unit;
  });
  return result.replace(/^一十/, "十");
}
const partLabel = (part: number) => `第${chineseNumber(part)}集`;

function sourceLink(lesson: Lesson, seconds: number | null = null) {
  const bvid = lesson.url?.match(/(?:^|\/)(BV[0-9A-Za-z]{10})(?:[/?#]|$)/)?.[1];
  if (!bvid) return null;
  const url = new URL(`https://www.bilibili.com/video/${bvid}/`);
  url.searchParams.set("p", String(lesson.part || 1));
  if (seconds != null && Number.isFinite(seconds)) url.searchParams.set("t", String(Math.max(0, Math.floor(seconds))));
  return url.toString();
}

function inferFormat(text: string, requested: SourceFormat) {
  if (requested !== "auto") return requested;
  const value = text.trimStart();
  if (value.startsWith("WEBVTT")) return "vtt";
  if (value.startsWith("{") || /^\[\s*\{/.test(value)) return "json";
  if (/^#{1,6}\s|^\[\d{1,3}:\d{2}/m.test(value)) return "md";
  return /\d{1,2}:\d{2}:\d{2}[,.]\d+\s*-->/.test(value) ? "srt" : "txt";
}

async function readList(signal: AbortSignal): Promise<LessonList> {
  const response = await fetch("/api/lessons", { signal });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("shifen:session-expired"));
    throw new Error(data.error || "暂时无法读取讲次，请重试。");
  }
  return data;
}

function refsFor(lesson: Lesson, cueIds: string[]) {
  const ids = new Set(cueIds);
  return [...lesson.cues, ...(lesson.visualCues || [])].filter(cue => ids.has(cue.id));
}

function editableSource(lesson: Lesson): { text: string; format: SourceFormat } {
  if (lesson.cues.every(cue => cue.start != null && cue.end != null && !cue.sourceTrack)) {
    const clock = (seconds: number) => {
      const milliseconds = Math.round(seconds * 1000);
      return `${String(Math.floor(milliseconds / 3600000)).padStart(2, "0")}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, "0")}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, "0")},${String(milliseconds % 1000).padStart(3, "0")}`;
    };
    return { format: "srt", text: lesson.cues.map((cue, index) => `${index + 1}\n${clock(cue.start!)} --> ${clock(cue.end!)}\n${cue.text}`).join("\n\n") };
  }
  return { text: lesson.cues.map(cue => cue.text).join("\n\n"), format: ["md", "markdown"].includes(lesson.sourceFormat) ? "md" : "txt" };
}

function markdownFor(lesson: Lesson) {
  const notes = lesson.notes;
  const lines = [`# ${lesson.title}`, "", `课程来源：${sourceLink(lesson) || "用户导入文字"}`, `集数：${partLabel(lesson.part)}`, `来源文件：${lesson.sourceName || "未命名"}`, `考试范围：${lesson.scope || "未填写"}`, ""];
  if (notes) {
    lines.push(`整理方式：${notes.mode === "ai" ? "AI 辅助整理，内容需核对" : "原文分段整理，未使用生成模型"}`, `处理覆盖：${notes.coverage.processedCueCount}/${notes.coverage.cueCount} 段`, notes.coverage.visual ? "包含画面证据，仍需核对公式与题干。" : "未识别板书和画面，字幕可能不包含完整公式及题干。", "", "## 考前速览", "", ...(notes.readingOverview || notes.overview).map(item => `- ${item}`), "");
    for (const section of readingSectionsFor(lesson)) {
      lines.push(`## ${section.title}`, "", section.text, "");
      const cues = refsFor(lesson, section.cueIds);
      lines.push(...cues.map(cue => `来源 ${formatTime(cue.start)}${sourceLink(lesson, cue.start) ? `：${sourceLink(lesson, cue.start)}` : ""} [${cue.id}]`), "");
      for (const frameId of section.frameIds || []) {
        const frame = lesson.visual?.frames.find(item => item.id === frameId);
        if (frame) lines.push(`板书 ${formatTime(frame.time)} [${frame.id}]：${sourceLink(lesson, frame.time) || "本机课程画面"}`);
      }
    }
    if (notes.examples.length) lines.push("## 原课例题（请核对原课）", "");
    for (const example of readingExamplesFor(lesson)) {
      lines.push(`### ${example.title}`, "", example.prompt, "", example.solution || "未自动拆分解法，请对照讲解原文与原课。", "", ...refsFor(lesson, example.cueIds).map(cue => `来源 ${formatTime(cue.start)} [${cue.id}]：${sourceLink(lesson, cue.start) || "导入原文"}`), "");
    }
    if (notes.warnings.length) lines.push("## 核对提示", "", ...notes.warnings.map(item => `- ${item}`), "");
    if (notes.corrections?.length) {
      lines.push("## 术语与公式校对（原始转写保留）", "");
      for (const item of notes.corrections) lines.push(`原转写：${item.original}`, `校对建议：${item.corrected || "未能确定，保留原文"}`, `依据：${item.reason}`, `来源：${item.cueIds.join("、")}；板书：${item.frameIds.join("、") || "无画面证据"}`, "");
    }
  }
  if (lesson.visual?.observations.length) {
    lines.push("## 抽样板书识别", "", `识别 ${lesson.visual.observations.length}/${lesson.visual.frames.length} 帧，不代表全课板书完整。`, "");
    for (const observation of lesson.visual.observations) lines.push(`### ${formatTime(observation.time)} [${observation.frameId}]`, "", observation.visibleText, ...observation.latex.map(formula => `$$${formula}$$`), ...observation.uncertainties.map(item => `待核对：${item}`), "");
  }
  lines.push("## 完整导入原文", "");
  let sourceTrack: string | undefined;
  for (const cue of lesson.cues) {
    if (cue.sourceTrack && cue.sourceTrack !== sourceTrack) lines.push(cue.sourceTrack === "speech" ? "## 口播与对白" : "## 视觉时间线", "");
    sourceTrack = cue.sourceTrack;
    lines.push(`### ${formatTime(cue.start)}${cue.end == null ? "" : `–${formatTime(cue.end)}`} [${cue.id}]`, "", cue.text, "");
  }
  return lines.join("\n");
}

export default function LessonStudio({ courses, providerConfigured, onRefresh, onNotify, onOpenCourse, onAddCourse, savedCardKeys = [], onPractice, initialTarget }: Props) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [capabilities, setCapabilities] = useState<LessonList["capabilities"]>({ model: providerConfigured, bilinote: false });
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [courseFilter, setCourseFilter] = useState("all"), [query, setQuery] = useState("");
  const [tab, setTab] = useState<ReaderTab>("notes"), [transcriptQuery, setTranscriptQuery] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false), [focusedFrameId, setFocusedFrameId] = useState("");
  const [modelSettingsOpen, setModelSettingsOpen] = useState(() => new URLSearchParams(window.location.search).get("models") === "1");
  const [modelSettingsKind, setModelSettingsKind] = useState<"text" | "vision">("text");
  const [bilibiliLoginOpen, setBilibiliLoginOpen] = useState(false);
  const [withVisual, setWithVisual] = useState(true);
  const [autoArchive, setAutoArchive] = useState(true);
  const [autoOutput, setAutoOutput] = useState<"review" | "exam-checklist">("review");
  const [catalog, setCatalog] = useState<BilibiliCatalog | null>(null), [parts, setParts] = useState<Set<number>>(() => new Set());
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [visibleCues, setVisibleCues] = useState(150), [locatedCue, setLocatedCue] = useState("");
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const [transcriptScrolled, setTranscriptScrolled] = useState(false);
  const readerScrollRef = useRef<HTMLDivElement | null>(null);
  const subtitleFileInputRef = useRef<HTMLInputElement | null>(null);
  const [readerScrolled, setReaderScrolled] = useState(false);
  const [pending, setPending] = useState(""), [actionError, setActionError] = useState("");
  const [localEnvironment, setLocalEnvironment] = useState<{ lessonId: string; checking: boolean; result?: LocalTranscriptionEnvironment; error?: string } | null>(null);
  const [savedCards, setSavedCards] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<"create" | "source" | null>(null), [sourceLessonId, setSourceLessonId] = useState("");
  const [inputMode, setInputMode] = useState<"text" | "link">("text");
  const [draft, setDraft] = useState<Draft>({ courseId: "", title: "", url: "", part: "1", scope: "", text: "", format: "auto", sourceName: "" });
  const [formError, setFormError] = useState(""), [fileReading, setFileReading] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false), [searchTerm, setSearchTerm] = useState("");
  const [chatOpen, setChatOpen] = useState(false), [chatContext, setChatContext] = useState<LessonChatContext>({});
  const [documentTarget, setDocumentTarget] = useState("");
  const [documentJump, setDocumentJump] = useState(0);
  const chatTrigger = useRef<HTMLElement | null>(null);
  const alive = useRef(true), locked = useRef(false), listVersion = useRef(0);
  const partEdited = useRef(false);
  const catalogTimer = useRef<number | undefined>(undefined);
  const controllers = useRef<Set<AbortController>>(new Set()), blobUrls = useRef<Set<string>>(new Set());
  const callbacks = useRef({ onRefresh, onNotify });
  callbacks.current = { onRefresh, onNotify };
  const instanceId = useId();
  const courseVersion = courses.map(course => course.id).sort().join("|");
  useEffect(() => {
    if (dialog !== "create" || inputMode !== "link") window.clearTimeout(catalogTimer.current);
    return () => window.clearTimeout(catalogTimer.current);
  }, [dialog, inputMode]);
  const persistedCardKeys = useMemo(() => new Set(savedCardKeys), [savedCardKeys]);
  const selected = lessons.find(lesson => lesson.id === selectedId) || null;
  const study = useLessonStudy(selected);
  const [readingPdf, setReadingPdf] = useState(false);
  const [weakOnly, setWeakOnly] = useState(false);
  const consumedTarget = useRef<number | undefined>(undefined);
  const active = lessons.some(lesson => ACTIVE.has(lesson.status));
  const currentCourse = courses.find(course => course.id === selected?.courseId);
  const filtered = useMemo(() => lessons.filter(lesson =>
    (courseFilter === "all" || lesson.courseId === courseFilter) && (!query.trim() || `${lesson.title} ${courses.find(course => course.id === lesson.courseId)?.name || ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
  ), [lessons, courseFilter, query, courses]);

  const load = useCallback(async (initial = false) => {
    if (!alive.current) return;
    const version = ++listVersion.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    if (initial) setLoading(true);
    try {
      const result = await readList(controller.signal);
      if (!alive.current || version !== listVersion.current) return;
      setLessons(result.lessons);
      setCapabilities(result.capabilities);
      setLoadError("");
    } catch (cause) {
      if (alive.current && version === listVersion.current && !controller.signal.aborted) setLoadError(message(cause));
    } finally {
      controllers.current.delete(controller);
      if (alive.current && version === listVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load(true);
    const stop = () => { alive.current = false; listVersion.current++; controllers.current.forEach(controller => controller.abort()); };
    window.addEventListener("shifen:session-expired", stop);
    return () => {
      stop(); window.removeEventListener("shifen:session-expired", stop);
      blobUrls.current.forEach(url => URL.revokeObjectURL(url)); blobUrls.current.clear();
    };
  }, [load]);

  useEffect(() => { if (alive.current) void load(); }, [courseVersion, load]);
  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => { if (!document.hidden && !locked.current) void load(); }, 1600);
    const resume = () => { if (!document.hidden && !locked.current) void load(); };
    document.addEventListener("visibilitychange", resume);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", resume); };
  }, [active, load]);
  useEffect(() => {
    if (!filtered.some(lesson => lesson.id === selectedId)) setSelectedId(filtered[0]?.id || "");
  }, [filtered, selectedId]);
  useEffect(() => {
    setReadingPdf(false); setWeakOnly(false); setTab("notes"); setTranscriptQuery(""); setReviewOnly(false); setFocusedFrameId(""); setVisibleCues(150); setLocatedCue(""); setActionError("");
    setChatOpen(false); setChatContext({}); setDocumentTarget("");
  }, [selectedId]);
  useEffect(() => {
    if (!initialTarget || consumedTarget.current === initialTarget.sequence || !lessons.some(lesson => lesson.id === initialTarget.lessonId)) return;
    setCourseFilter("all"); setQuery("");
    if (selectedId !== initialTarget.lessonId) { setSelectedId(initialTarget.lessonId); return; }
    consumedTarget.current = initialTarget.sequence;
    const mapped = initialTarget.kind === "section" ? readingSectionsFor(selected!).find(section => section.id === initialTarget.id || section.sourceSectionIds?.includes(initialTarget.id))?.id : initialTarget.id;
    setTab("notes"); setDocumentTarget(lectureAnchor(initialTarget.lessonId, initialTarget.kind, mapped || readingSectionsFor(selected!)[0]?.id || initialTarget.id)); setDocumentJump(value => value + 1);
  }, [initialTarget, lessons, selectedId, selected]);
  useEffect(() => {
    if (!documentTarget || !["notes", "examples"].includes(tab)) return;
    const timer = window.setTimeout(() => { const target = document.getElementById(documentTarget); let parent = target?.parentElement; while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; } target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }, 50);
    return () => clearTimeout(timer);
  }, [tab, documentTarget, documentJump]);
  useEffect(() => {
    transcriptScrollRef.current?.scrollTo({ top: 0 });
    setTranscriptScrolled(false);
  }, [tab, selectedId]);
  function backToTranscriptTop() {
    transcriptScrollRef.current?.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  useEffect(() => {
    readerScrollRef.current?.scrollTo({ top: 0 });
    setReaderScrolled(false);
  }, [selectedId, tab]);
  function backToReaderTop() {
    const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    readerScrollRef.current?.scrollTo({ top: 0, behavior });
    window.scrollTo({ top: 0, behavior });
  }
  useEffect(() => {
    if (tab !== "transcript" || !locatedCue) return;
    const timer = window.setTimeout(() => document.getElementById(`${instanceId}-${locatedCue}`)?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }), 50);
    return () => clearTimeout(timer);
  }, [tab, locatedCue, instanceId, visibleCues]);

  function applyLesson(lesson: Lesson) {
    listVersion.current++;
    setLessons(current => [lesson, ...current.filter(item => item.id !== lesson.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }
  async function act(key: string, action: () => Promise<void>) {
    if (locked.current || !alive.current) return;
    locked.current = true; setPending(key); setActionError("");
    try { await action(); }
    catch (cause) { if (alive.current) setActionError(message(cause)); }
    finally { locked.current = false; if (alive.current) { setPending(""); void load(); } }
  }
  async function refreshParent(success: string) {
    try { await callbacks.current.onRefresh(); if (alive.current) callbacks.current.onNotify(success); }
    catch { if (alive.current) callbacks.current.onNotify(`${success}，课程列表暂未刷新，请稍后重新进入。`); }
  }
  function openCreate() {
    partEdited.current = false;
    setWithVisual(true);
    setAutoArchive(true);
    setCatalog(null); setParts(new Set()); setCatalogLoading(false);
    setInputMode(capabilities.bilinote ? "link" : "text");
    setDraft({ courseId: courseFilter !== "all" && courses.some(course => course.id === courseFilter) ? courseFilter : courses[0]?.id || "", title: "", url: "", part: "1", scope: "", text: "", format: "auto", sourceName: "" });
    setFormError(""); setDialog("create");
  }
  function openModelSettings(kind: "text" | "vision" = "text") {
    setModelSettingsKind(kind);
    setModelSettingsOpen(true);
  }
  function openSource(lesson: Lesson) {
    partEdited.current = false;
    setInputMode("text");
    setSourceLessonId(lesson.id);
    setDraft({ courseId: lesson.courseId, title: lesson.title, url: lesson.url, part: String(lesson.part), scope: lesson.scope, ...editableSource(lesson), sourceName: lesson.sourceName });
    setFormError(""); setDialog("source");
  }
  function chooseSubtitleFile(lesson: Lesson) {
    openSource(lesson);
    subtitleFileInputRef.current?.click();
  }
  async function importFile(file?: File) {
    if (!file) return;
    setFormError("");
    if (file.size > 1024 * 1024) { setFormError("字幕文件超过 1 MB，请按讲次或分集拆分后导入。"); return; }
    if (!/\.(srt|vtt|json|txt|md|markdown)$/i.test(file.name)) { setFormError("请选择字幕、TXT 或 Markdown 文件。"); return; }
    setFileReading(true);
    try {
      const text = await file.text();
      if (!alive.current) return;
      if (text.length > MAX_TEXT) { setFormError("单次最多导入 25 万字，请按讲次拆分文件。"); return; }
      const suffix = file.name.split(".").pop()?.toLowerCase();
      const extension = (suffix === "markdown" ? "md" : suffix) as SourceFormat;
      setDraft(current => ({ ...current, text, sourceName: file.name, format: extension, title: current.title || file.name.replace(/\.[^.]+$/, "").slice(0, 120) }));
    } catch { if (alive.current) setFormError("文件未能读取，请检查编码或重新选择。"); }
    finally { if (alive.current) setFileReading(false); }
  }
  async function submitSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || fileReading || !alive.current) return;
    if (!courses.some(course => course.id === draft.courseId)) { setFormError("请先选择一个仍然存在的课程。"); return; }
    if (draft.text.length > MAX_TEXT) { setFormError("单次最多导入 25 万字，请按讲次拆分。"); return; }
    if (dialog === "create" && !draft.text.trim() && !draft.url.trim()) { setFormError("请先粘贴讲解文字、选择文件，或填写 B 站链接。"); return; }
    if (dialog === "source" && !draft.text.trim()) { setFormError("请粘贴字幕内容或导入字幕文件。"); return; }
    if (dialog === "create" && inputMode === "link" && catalog && !draft.text.trim() && !parts.size) { setFormError("请至少选择一个分集。"); return; }
    locked.current = true; setPending("source"); setFormError("");
    try {
      if (batchImport) {
        const result = await api<{ created: Lesson[]; skipped: { part: number; title: string; reason: string }[] }>("/lessons/import", "POST", {
          courseId: draft.courseId, url: draft.url.trim(), scope: draft.scope.trim(),
          items: selectedParts.map(page => ({ part: page.part, title: page.title })),
          analyzeMode: capabilities.model ? "ai" : "extractive", withVisual: !!capabilities.vision && withVisual, autoPublish: autoArchive,
          autoOutput: autoArchive && capabilities.model ? autoOutput : "none",
        });
        if (!alive.current) return;
        setCourseFilter("all"); setQuery(""); setDirectoryOpen(false); setDialog(null);
        if (result.created.length) { applyLesson(result.created[0]); setSelectedId(result.created[0].id); setTab("notes"); }
        callbacks.current.onNotify(`已导入 ${result.created.length} 集${result.skipped.length ? `，跳过 ${result.skipped.length} 个已在课程中的分集` : ""}${autoArchive && result.created.length ? "，整理完成后自动加入课程资料" : ""}${autoArchive && capabilities.model && result.created.length ? `，整批完成后生成${autoOutput === "review" ? "复习资料" : "考点清单"}` : ""}。`);
        return;
      }
      const data = dialog === "source"
        ? await api<Lesson>(`/lessons/${encodeURIComponent(sourceLessonId)}/source`, "PUT", { text: draft.text, format: inferFormat(draft.text, draft.format), sourceName: draft.sourceName || "粘贴的字幕" })
        : await api<Lesson>("/lessons", "POST", { courseId: draft.courseId, title: draft.title.trim() || `${courses.find(course => course.id === draft.courseId)?.name || "课程"} · 第 ${lessons.filter(lesson => lesson.courseId === draft.courseId).length + 1} 讲`, url: draft.url.trim(), part: Number(draft.part), scope: draft.scope.trim(), ...(draft.text.trim() ? { transcript: draft.text, format: inferFormat(draft.text, draft.format), sourceName: draft.sourceName || "粘贴的讲解文字" } : {}) });
      if (!alive.current) return;
      applyLesson(data); setCourseFilter("all"); setQuery(""); setSelectedId(data.id); setDialog(null); setDirectoryOpen(false);
      if (data.cues.length) {
        try {
          const next = dialog === "create" && data.url && capabilities.vision && withVisual
            ? await api<Lesson>(`/lessons/${encodeURIComponent(data.id)}/visual`, "POST", { mode: "analyze", analyzeMode: capabilities.model ? "ai" : "extractive", autoPublish: dialog === "create" && autoArchive, autoOutput: dialog === "create" && autoArchive && capabilities.model ? autoOutput : "none" })
            : await api<Lesson>(`/lessons/${encodeURIComponent(data.id)}/analyze`, "POST", { mode: capabilities.model ? "ai" : "extractive", autoPublish: dialog === "create" && autoArchive, autoOutput: dialog === "create" && autoArchive && capabilities.model ? autoOutput : "none" });
          if (alive.current) { applyLesson(next); setTab("notes"); }
        } catch (cause) { if (alive.current) setActionError(`原文已保存。${message(cause)}`); }
      } else if (capabilities.bilinote) {
        try {
          const next = await api<Lesson>(`/lessons/${encodeURIComponent(data.id)}/fetch`, "POST", { analyzeMode: capabilities.model ? "ai" : "extractive", withVisual: !!capabilities.vision && withVisual, autoPublish: dialog === "create" && autoArchive, autoOutput: dialog === "create" && autoArchive && capabilities.model ? autoOutput : "none" });
          if (alive.current) applyLesson(next);
        } catch (cause) { if (alive.current) setActionError(`链接已保存。${message(cause)}`); }
      } else callbacks.current.onNotify("链接已保存，导入字幕后即可整理。");
    } catch (cause) { if (alive.current) setFormError(message(cause)); }
    finally { locked.current = false; if (alive.current) setPending(""); }
  }
  function locateCue(cueId: string) {
    const index = timelineCues.findIndex(cue => cue.id === cueId);
    setTranscriptQuery(""); setReviewOnly(false); setVisibleCues(Math.max(150, index + 1)); setLocatedCue(cueId); setTab("transcript");
  }
  function openFrame(frameId: string) { setFocusedFrameId(frameId); setTab("visual"); }
  function openChat(context: LessonChatContext = {}, trigger?: HTMLElement) {
    chatTrigger.current = trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setChatContext(context); setChatOpen(true);
  }
  function closeChat() { setChatOpen(false); window.requestAnimationFrame(() => { if (chatTrigger.current?.isConnected) chatTrigger.current.focus({ preventScroll: true }); }); }
  function locateDocument(kind: "section" | "example", id: string) {
    if (!selected) return;
    setWeakOnly(false);
    const actualId = kind === "section" ? readingSectionsFor(selected).find(section => section.id === id || section.sourceSectionIds?.includes(id))?.id || id : id;
    setTab("notes"); setDocumentTarget(lectureAnchor(selected.id, kind, actualId)); setDocumentJump(value => value + 1); setDirectoryOpen(false);
  }
  function locateChatSource(citation: LessonChatCitation) {
    if (!selected || citation.lessonId !== selected.id) return;
    if (citation.kind === "section" || citation.kind === "example") locateDocument(citation.kind, citation.id);
    else if (citation.kind === "frame" && selected.visual?.frames.some(frame => frame.id === citation.id)) openFrame(citation.id);
    else if (citation.kind === "cue" && [...selected.cues, ...(selected.visualCues || [])].some(cue => cue.id === citation.id)) locateCue(citation.id);
  }
  function analyzeVisual(mode: "capture" | "read" | "analyze") {
    if (!selected) return;
    const lesson = selected;
    void act("visual", async () => {
      const next = await api<Lesson>(`/lessons/${encodeURIComponent(lesson.id)}/visual`, "POST", { mode, ...(mode !== "capture" ? { analyzeMode: capabilities.model ? "ai" : "extractive" } : {}) });
      if (alive.current) { applyLesson(next); setTab("visual"); }
    });
  }
  function uploadVisual(kind: "video" | "images", files: File[], times?: string) {
    if (!selected) return;
    const lesson = selected;
    const body = new FormData();
    for (const file of files) body.append("files", file, file.name);
    if (kind === "images" && times?.trim()) body.append("times", times.trim());
    void act("visual-upload", async () => {
      const next = await api<Lesson>(`/lessons/${encodeURIComponent(lesson.id)}/visual-upload`, "POST", body);
      if (alive.current) { applyLesson(next); setTab("visual"); callbacks.current.onNotify(kind === "video" ? "视频已上传，正在本机采集关键帧。" : "截图已上传，正在整理画面证据。"); }
    });
  }
  function analyze(mode: "extractive" | "ai") {
    if (!selected) return;
    const lesson = selected;
    void act(`analyze-${mode}`, async () => {
      const next = await api<Lesson>(`/lessons/${encodeURIComponent(lesson.id)}/analyze`, "POST", { mode });
      if (alive.current) { applyLesson(next); setTab("notes"); callbacks.current.onNotify(mode === "ai" ? "已开始重新 AI 精读。完成前保留旧版讲义，成功后会自动替换。" : "已开始重新整理原文。完成前保留旧版讲义，成功后会自动替换。"); }
    });
  }
  function supplementVisual(range: { start: number; end: number }) {
    if (!selected) return;
    const lesson = selected;
    void act("supplement", async () => {
      const next = await api<Lesson>(`/lessons/${encodeURIComponent(lesson.id)}/visual`, "POST", { mode: "supplement", range });
      if (alive.current) { applyLesson(next); callbacks.current.onNotify("已开始补采指定时段，原讲义和原图保留。"); }
    });
  }
  function retryEvidence() {
    if (!selected) return;
    const lesson = selected;
    void act("retry-evidence", async () => {
      const next = await api<Lesson>(`/lessons/${encodeURIComponent(lesson.id)}/retry-evidence`, "POST", {});
      if (alive.current) applyLesson(next);
    });
  }
  function resolveIssue(issue: import("./lesson-types").LessonStudy["issues"][number]) {
    if (issue.kind === "notes") analyze(capabilities.model ? "ai" : "extractive");
    else if (issue.action === "read") analyzeVisual("read");
    else if (issue.action === "enrich") enrichExamples(issue.id);
    else if (issue.kind === "frame") openFrame(issue.id);
    else if (issue.kind === "cue") locateCue(issue.id);
    else if (issue.kind === "example") locateDocument("example", issue.id);
  }
  function practiceLesson(lesson: Lesson) {
    void act("practice", async () => {
      const result = await api<{ documentId: string }>(`/lessons/${encodeURIComponent(lesson.id)}/publish`, "POST", {});
      await callbacks.current.onRefresh();
      if (alive.current) { applyLesson({ ...lesson, documentId: result.documentId, archiveError: undefined }); onPractice?.(lesson.courseId, result.documentId); }
    });
  }
  function enrichExamples(targetId?: string) {
    if (!selected) return;
    const lesson = selected;
    void act("enrich-examples", async () => {
      const rawIds = targetId ? (lesson.notes?.examples.some(item => item.id === targetId) ? [targetId] : readingExamplesFor(lesson).find(item => item.id === targetId)?.sourceExampleIds?.slice(0, 8)) : undefined;
      const next = await api<Lesson>(`/lessons/${encodeURIComponent(lesson.id)}/enrich-examples`, "POST", rawIds?.length ? { exampleIds: rawIds } : {});
      if (!alive.current) return;
      applyLesson(next); setTab("examples");
      await refreshParent(ACTIVE.has(next.status) ? "题解补充已排队，完成后会自动显示。" : "当前可补的题解已经齐全。");
    });
  }
  function fetchLesson(lesson: Lesson) {
    void act("fetch", async () => {
      const next = await api<Lesson>(`/lessons/${encodeURIComponent(lesson.id)}/fetch`, "POST", { analyzeMode: capabilities.model ? "ai" : "extractive", withVisual: !!capabilities.vision });
      if (alive.current) applyLesson(next);
    });
  }
  async function checkLocalEnvironment(lessonId: string) {
    setLocalEnvironment({ lessonId, checking: true });
    try {
      const result = await api<LocalTranscriptionEnvironment>("/lessons/local-transcription/check");
      if (alive.current) setLocalEnvironment({ lessonId, checking: false, result });
    } catch (cause) {
      if (alive.current) setLocalEnvironment({ lessonId, checking: false, error: message(cause) });
    }
  }
  function exportLesson(lesson: Lesson) {
    const blob = new Blob([markdownFor(lesson)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob); blobUrls.current.add(url);
    const anchor = document.createElement("a"); anchor.href = url;
    anchor.download = `${lesson.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 100) || "网课讲义"}.md`;
    anchor.click();
    window.setTimeout(() => { URL.revokeObjectURL(url); blobUrls.current.delete(url); }, 1000);
  }
  function downloadDocument(lesson: Lesson) {
    void act("export-document", async () => {
      const controller = new AbortController(); controllers.current.add(controller);
      try {
        const response = await fetch(`/api/lessons/${encodeURIComponent(lesson.id)}/document`, { credentials: "include", signal: controller.signal });
        if (!response.ok) { const body = await response.json().catch(() => ({})); if (response.status === 401) window.dispatchEvent(new Event("shifen:session-expired")); throw new Error(body.error || "图文讲义下载未完成，请稍后重试。"); }
        const blob = await response.blob(); if (!alive.current) return;
        const disposition = response.headers.get("content-disposition") || "";
        let filename = `${lesson.title}.html`;
        try { filename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ? decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/i)![1]) : disposition.match(/filename="([^"]+)"/i)?.[1] || filename; } catch { /* Keep the readable course filename. */ }
        const url = URL.createObjectURL(blob); blobUrls.current.add(url);
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 180); anchor.click();
        window.setTimeout(() => { URL.revokeObjectURL(url); blobUrls.current.delete(url); }, 1000);
        callbacks.current.onNotify("图文讲义已下载，可离线阅读，也可以用浏览器打印。");
      } finally { controllers.current.delete(controller); }
    });
  }
  function publish(lesson: Lesson) {
    void act("publish", async () => {
      const result = await api<{ documentId: string; created: boolean }>(`/lessons/${encodeURIComponent(lesson.id)}/publish`, "POST", {});
      if (!alive.current) return;
      applyLesson({ ...lesson, documentId: result.documentId, archiveError: undefined });
      await refreshParent(result.created ? "讲义已加入课程资料，可继续生成练习或加入复习。" : "这份讲义已在课程资料中，无需重复归档。");
    });
  }
  function stopAnalyze(lesson: Lesson) {
    void act("cancel", async () => {
      const next = await api<Lesson>(`/lessons/${encodeURIComponent(lesson.id)}/cancel`, "POST", {});
      if (alive.current) applyLesson(next);
    });
  }
  function removeLesson(lesson: Lesson) {
    if (!window.confirm(`只删除「${lesson.title}」这节课、导入的字幕和整理结果？已经存入课程资料的讲义和记忆卡会保留。`)) return;
    void act("delete", async () => {
      await api(`/lessons/${encodeURIComponent(lesson.id)}`, "DELETE");
      if (alive.current) { listVersion.current++; setLessons(current => current.filter(item => item.id !== lesson.id)); callbacks.current.onNotify("这节课已删除。"); }
    });
  }
  function saveCard(lesson: Lesson, section: LessonNotes["sections"][number]) {
    const key = sectionCardKey(lesson, section);
    if (isCardSaved(lesson, section)) return;
    void act(`card-${key}`, async () => {
      const first = refsFor(lesson, section.cueIds)[0];
      await api("/cards", "POST", { courseId: lesson.courseId, front: `${section.title}：回忆本节要点`.slice(0, 1000), back: section.text.slice(0, 5000), source: `网课：${lesson.title}${first?.start != null ? ` · ${formatTime(first.start)}` : ""}`.slice(0, 200), sourceKey: `lesson:${key}` });
      if (!alive.current) return;
      setSavedCards(current => new Set(current).add(key));
      await refreshParent(section.text.length > 5000 ? "本段前 5000 字已保存为记忆卡，请在记忆卡中调整重点。" : "已加入记忆卡，按你的回忆反馈安排后续复习。");
    });
  }
  function isCardSaved(lesson: Lesson, section: LessonNotes["sections"][number]) {
    const key = sectionCardKey(lesson, section);
    return savedCards.has(key) || persistedCardKeys.has(`lesson:${key}`);
  }
  function inferPartFromUrl(value: string) {
    if (partEdited.current) return;
    try {
      const part = Number(new URL(value).searchParams.get("p"));
      if (Number.isInteger(part) && part >= 1 && part <= 1000) setDraft(current => ({ ...current, part: String(part) }));
    } catch { /* A bare BV identifier contains no query to import. */ }
  }
  function updateUrl(value: string) {
    setDraft(current => ({ ...current, url: value }));
    setCatalog(null); setParts(new Set()); setFormError("");
    inferPartFromUrl(value);
    window.clearTimeout(catalogTimer.current);
    if (capabilities.bilinote && looksLikeVideoLink(value)) {
      catalogTimer.current = window.setTimeout(() => { void readCatalog(value); }, 800);
    }
  }
  async function readCatalog(value = draft.url) {
    const input = value.trim();
    if (catalogLoading || !input) return;
    setFormError(""); setCatalogLoading(true);
    try {
      const data = await api<BilibiliCatalog>(`/lessons/bilibili?url=${encodeURIComponent(input)}`);
      if (!alive.current) return;
      setCatalog(data);
      setParts(new Set(data.pages.slice(0, MAX_BATCH).map(page => page.part)));
      if (data.pages[0] && !partEdited.current) setDraft(current => ({ ...current, part: String(data.pages[0].part) }));
      if (data.truncated) setFormError(`这门课分集较多，只显示前 ${data.pages.length} 个，请分批导入。`);
    } catch (cause) { if (alive.current) setFormError(message(cause)); }
    finally { if (alive.current) setCatalogLoading(false); }
  }
  function togglePart(part: number) {
    const next = new Set(parts);
    if (next.has(part)) next.delete(part);
    else if (next.size >= MAX_BATCH) { setFormError(`一次最多导入 ${MAX_BATCH} 集。`); return; }
    else next.add(part);
    setFormError(""); setParts(next);
  }
  function selectAllParts() {
    if (!catalog) return;
    setFormError(""); setParts(new Set(catalog.pages.slice(0, MAX_BATCH).map(page => page.part)));
  }
  const notes = selected?.notes;
  const isRunning = selected ? ACTIVE.has(selected.status) : false;
  const needsSubtitleFile = selected?.errorCode === "NO_PUBLIC_SUBTITLES" || !!selected?.error?.includes("没有公开字幕");
  const environmentForSelected = localEnvironment?.lessonId === selected?.id ? localEnvironment : null;
  const readerSections = selected ? readingSectionsFor(selected) : [];
  const readerExamples = selected ? readingExamplesFor(selected) : [];
  const sourceExamples = notes?.examples.length ? notes.examples : readerExamples;
  const pendingExampleCount = sourceExamples.filter(example => !example.detailedSolution?.trim() && !example.solutionSteps?.some(step => step.trim()) && example.explanationStatus !== "needs-confirmation").length;
  const unclearExampleCount = sourceExamples.filter(example => example.explanationStatus === "needs-confirmation").length;
  const timelineCues = [...(selected?.cues || []), ...(selected?.visualCues || [])].sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
  const reviewCueIds = new Set(selected?.sourceDiagnostics?.reviewCueIds || []);
  const displayedCues = timelineCues.filter(cue => (!reviewOnly || reviewCueIds.has(cue.id)) && (!transcriptQuery.trim() || cue.text.toLocaleLowerCase().includes(transcriptQuery.trim().toLocaleLowerCase())));
  const hasSources = !!timelineCues.length;
  const original = selected ? sourceLink(selected) : null;
  const selectedParts = catalog ? catalog.pages.filter(page => parts.has(page.part)) : [];
  // 让滚动区之外的选中项也可见，避免计数和眼前看到的勾选对不上。
  const selectedSummary = selectedParts.length === 0 ? ""
    : selectedParts.length <= 8 ? selectedParts.map(page => partLabel(page.part)).join("、")
    : `${selectedParts.slice(0, 8).map(page => partLabel(page.part)).join("、")} 等 ${selectedParts.length} 集`;
  const linkOnly = dialog === "create" && inputMode === "link" && !draft.text.trim();
  const batchImport = linkOnly && capabilities.bilinote && selectedParts.length > 0;

  const sourceFields = <>
<div className="lesson-source-label"><label htmlFor={`${instanceId}-source`}>讲解原文{inputMode === "link" && <span className="lesson-optional">（可稍后补充）</span>}</label><label className="lesson-file-pick"><UploadSimple size={16} />{fileReading ? "读取中…" : "选择文件"}<input type="file" aria-label="导入字幕文件" accept=".srt,.vtt,.json,.txt,.md,.markdown" disabled={!!pending || fileReading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void importFile(file); }} /></label></div>
        <textarea id={`${instanceId}-source`} rows={6} value={draft.text} onChange={event => setDraft(current => ({ ...current, text: event.target.value }))} placeholder="粘贴字幕、讲解文字，或选择文件。" disabled={!!pending || fileReading} required={dialog === "source" || inputMode === "text"} maxLength={MAX_TEXT + 1} />
        <div className="lesson-source-meta"><span>{draft.sourceName || "字幕 / TXT / Markdown"}</span><span>{draft.text.length.toLocaleString()} 字 · 上限 1 MB</span></div>
  </>;

  const guideSteps: GuideStep[] = [
    { title: "先选一门课", body: "左边是已经导入的课。第一次使用，先点右上角「导入网课」，把 B 站链接或字幕放进来。", target: ".lesson-directory" },
    { title: "确认 AI 连好了", body: "这里会一直显示 AI 是否可用。没连接时只能整理字幕，生成不了重点笔记和例题答案，点它就能马上配置。", target: ".lesson-model-status" },
    { title: "一键生成笔记", body: "选好一节课后，点「生成重点笔记」。AI 会把长视频整理成好读的重点，并标出对应的视频位置。", target: ".lesson-analysis-actions" },
    { title: "读完马上练", body: "在「重点笔记」里阅读，随时点「问 AI 助教」提问；读完后点「做本课练习」检查有没有真的掌握。", target: ".lesson-tabs" },
  ];
  return <section className="lesson-studio" aria-label="网课精读工作台">
    <div className="lesson-tools">
      <form className="lesson-find-course" onSubmit={event => { event.preventDefault(); if (searchTerm.trim()) window.open(`https://search.bilibili.com/all?keyword=${encodeURIComponent(searchTerm.trim())}`, "_blank", "noopener,noreferrer"); }}>
        <MagnifyingGlass size={18} /><input aria-label="去 B 站搜索课程" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="找课程，例如：高数 极限" maxLength={200} />
        <button type="submit" disabled={!searchTerm.trim()}>去 B 站 <ArrowSquareOut size={14} /></button>
      </form>
      <div className="lesson-tool-actions">
        <button type="button" className={`lesson-model-status ${capabilities.model ? "is-ready" : ""}`} aria-label="查看 AI 模型连接状态" title="点击查看或修改 AI 模型配置" onClick={() => openModelSettings(capabilities.model && !capabilities.vision ? "vision" : "text")}>
          <span className="lesson-model-dot" aria-hidden="true" />
          {!capabilities.model ? "AI 未连接" : capabilities.vision ? "AI 与看图已就绪" : "AI 已连接 · 看图未开启"}
        </button>
        <button type="button" className="primary" disabled={!courses.length || !!pending} onClick={openCreate}><Plus size={18} />导入网课</button>
      </div>
    </div>
    {capabilities.model && !capabilities.vision && <ModelSetupNotice id="lesson-vision" tone="info" title="看图识别还没开启" description="板书截图和公式识别需要「视觉模型」。如果文字模型本身支持看图，可以在设置里勾选「复用文字模型」，不用再填一遍密钥。" actionLabel="去开启看图" onConfigure={() => openModelSettings("vision")} />}
    {!courses.length && <div className="lesson-notice"><FolderOpen size={19} /><span>先建一个课程，再导入网课。</span>{onAddCourse && <button type="button" className="lesson-notice-action" onClick={onAddCourse}><Plus size={15} />新建课程</button>}</div>}
    {loadError && <div className="lesson-alert" role="alert"><WarningCircle size={19} /><span>{loadError}</span><button type="button" onClick={() => void load(true)}>重新读取</button></div>}
    <div className={`lesson-workspace ${notes ? "has-document" : ""} ${chatOpen ? "has-chat" : ""}`}>
      <aside className={`lesson-directory ${directoryOpen ? "is-open" : ""}`} aria-label="讲次目录">
        <button type="button" className="lesson-directory-toggle" onClick={() => setDirectoryOpen(!directoryOpen)} aria-expanded={directoryOpen}><List size={18} />讲次目录 <span>{filtered.length}</span><CaretDown size={17} /></button>
        <div className="lesson-directory-content">
          <div className="lesson-directory-heading"><h2>我的讲次</h2><span>{lessons.length}</span><button type="button" className="icon-button" aria-label="刷新讲次" onClick={() => void load()} disabled={!!pending}><ArrowClockwise size={17} /></button></div>
          <label className="lesson-list-search"><MagnifyingGlass size={16} /><input aria-label="搜索已保存的讲次" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索讲次或课程" /></label>
          <select aria-label="按所属课程筛选讲次" value={courseFilter} onChange={event => setCourseFilter(event.target.value)}><option value="all">全部课程</option>{courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}</select>
          {loading && !lessons.length ? <div className="lesson-list-loading" role="status"><span /><span /><span /><p>正在读取讲次…</p></div> : <div className="lesson-list">{filtered.map(lesson => <button type="button" key={lesson.id} className={`lesson-list-item ${selectedId === lesson.id ? "is-active" : ""}`} aria-current={selectedId === lesson.id ? "true" : undefined} onClick={() => { setSelectedId(lesson.id); setDirectoryOpen(false); }}><span className="lesson-item-icon"><VideoCamera size={19} weight={selectedId === lesson.id ? "fill" : "regular"} /></span><span className="lesson-item-copy"><strong>{lesson.title}</strong><span>{courses.find(course => course.id === lesson.courseId)?.name || "原课程已移除"} · {partLabel(lesson.part)}</span><small className={ACTIVE.has(lesson.status) ? "is-running" : ""}>{STATUS[lesson.status]}</small></span></button>)}</div>}
          {!loading && !filtered.length && <p className="lesson-directory-empty">{lessons.length ? "没有找到这节课" : "还没有导入网课"}</p>}
          {selected && notes && <details className="lesson-outline" open><summary><BookOpen size={17} />本讲内容<CaretDown size={16} /></summary><nav aria-label="全课内容目录">{readerSections.map(section => <button type="button" key={section.id} className={documentTarget === lectureAnchor(selected.id, "section", section.id) ? "is-current" : ""} onClick={() => locateDocument("section", section.id)}><span>{section.title}</span></button>)}{!!readerExamples.length && <h3>课堂例题</h3>}{readerExamples.map((example, index) => <button type="button" key={example.id} onClick={() => locateDocument("example", example.id)}><span>例 {index + 1} · {example.title}</span></button>)}</nav></details>}
        </div>
      </aside>
      <div className="lesson-reader-shell">
      <div className="lesson-reader" ref={readerScrollRef} onScroll={event => setReaderScrolled(event.currentTarget.scrollTop > 240)}>
        {!selected ? <div className="lesson-empty-reader"><FileText size={40} weight="duotone" aria-hidden="true" /><h2>长网课，直接读。</h2><p>导入字幕，读讲义、看例题。</p><button type="button" className="primary" disabled={!courses.length || !!pending} onClick={openCreate}><Plus size={18} />导入第一节课</button><div className="lesson-entry-hint">字幕 / TXT / Markdown</div></div> : <>
          <header className="lesson-reader-heading">
            <div><button type="button" className="lesson-belonging" onClick={() => currentCourse && onOpenCourse(currentCourse.id)} disabled={!currentCourse}><FolderOpen size={14} />{currentCourse?.name || "原课程已移除"}<ArrowRight size={13} /></button><h2>{selected.title}</h2><p>{partLabel(selected.part)}<span>·</span>{selected.cues.length} 段原文{(/自动|本地/.test(selected.sourceName) || isRunning) && <><span>·</span>{isRunning ? selected.cues.length ? "正在整理" : "正在获取原文" : notes?.mode === "ai" ? "AI 精读" : "自动转写原文"}</>}{notes && <><span>·</span>{readerSections.length} 个知识点 · {readerExamples.length} 道课堂题{selected.visual ? ` · ${selected.visual.frames.length} 张截图` : ""}{selected.documentId ? " · 已归档" : ""}</>}</p></div>
            <div className="lesson-reader-actions">{original && <a className="icon-button" href={original} target="_blank" rel="noreferrer" title="打开 B 站原课" aria-label="打开 B 站原课"><ArrowSquareOut size={19} /></a>}</div>
          </header>
          {actionError && <div className="lesson-alert" role="alert"><WarningCircle size={19} /><span>{actionError}</span><button type="button" aria-label="关闭操作提示" onClick={() => setActionError("")}><X size={16} /></button></div>}
          {selected.scope && <details className="lesson-scope"><summary><NotePencil size={16} />本次考试范围<CaretDown size={14} /></summary><p>{selected.scope}</p><small>内容匹配仅供参考，以任课老师要求为准。</small></details>}
          <div className="lesson-analysis-bar">
            <div className="lesson-bar-status">
              {(!notes || isRunning) && <span className={`lesson-status ${isRunning ? "is-running" : ""}`}>{isRunning && <span />}{STATUS[selected.status]}</span>}
              {notes && <small>{readerSections.length} 个知识点 · {readerExamples.length} 道例题</small>}
            </div>
            <div className="lesson-analysis-actions">
              {isRunning
                ? <button type="button" className="lesson-light-button" disabled={!!pending} onClick={() => stopAnalyze(selected)}><Stop size={15} />停止整理</button>
                : hasSources && <>
                    <button type="button" className="lesson-ai-button" disabled={!!pending || !currentCourse} title={capabilities.model ? "用原文和截图重新整理这一节的重点笔记" : "还没有连接 AI 模型，点击去连接"} onClick={() => capabilities.model ? analyze("ai") : openModelSettings("text")}>{capabilities.model ? <Sparkle size={16} /> : <WarningCircle size={16} />}{pending === "analyze-ai" ? "正在整理…" : notes ? "重新生成笔记" : "生成重点笔记"}</button>
                    <button type="button" className={`lesson-chat-launch ${chatOpen ? "is-open" : ""}`} aria-label="打开 AI 助教" aria-expanded={chatOpen} onClick={event => chatOpen ? closeChat() : openChat({}, event.currentTarget)}><ChatCircleText size={18} />问 AI 助教</button>
                    {notes && onPractice && <button type="button" className="lesson-ai-button" disabled={!!pending || isRunning || selected.status !== "completed" || notes.evidenceOutdated} onClick={() => practiceLesson(selected)}><NotePencil size={17} />做本课练习<ArrowRight size={15} /></button>}
                  </>}
              <details className="lesson-more">
                <summary aria-label="更多操作"><CaretDown size={15} />更多</summary>
                <div className="lesson-more-menu" onClick={event => { const menu = (event.target as HTMLElement).closest("details"); if (menu instanceof HTMLDetailsElement) menu.open = false; }}>
                  {hasSources && <button type="button" disabled={!!pending || !currentCourse} onClick={() => analyze("extractive")}>{capabilities.model ? "只按字幕重新分段" : "重新整理字幕"}</button>}
                  {selected.cues.length > 0 && <button type="button" disabled={!!pending || isRunning} onClick={() => openSource(selected)}>替换字幕文件</button>}
                  {capabilities.visionCapture && selected.url && !selected.visual && <button type="button" disabled={!!pending} onClick={() => { if (capabilities.vision) analyzeVisual("analyze"); else { setTab("visual"); openModelSettings("vision"); } }}>识别板书截图</button>}
                  {!!selected.visual?.frames?.length && notes?.editorial && notes.editorial.alignment?.version !== 2 && <button type="button" disabled={!!pending || isRunning || !capabilities.vision} onClick={retryEvidence}>重新检查配图</button>}
                  {hasSources && <button type="button" disabled={!!pending || notes?.evidenceOutdated} onClick={() => exportLesson(selected)}>导出笔记文件</button>}
                  <button type="button" className="is-danger" disabled={!!pending} onClick={() => removeLesson(selected)}>删除这节课</button>
                </div>
              </details>
            </div>
          </div>
          {notes && <LessonStudyPanel key={selected.id} study={study.study} error={study.error} onRetry={study.retry} busy={isRunning || !!pending} canCapture={!!capabilities.visionCapture && !!selected.url} canRead={!!capabilities.vision} canEnrich={!!capabilities.model} duration={selected.visual?.coverage.durationSeconds} outdated={!!notes.evidenceOutdated} weakOnly={weakOnly} onWeakOnly={value => { setWeakOnly(value); setTab("notes"); }} onContinue={locateDocument} onResolve={resolveIssue} onSupplement={supplementVisual} onUpdate={() => analyze(capabilities.model ? "ai" : "extractive")} />}
          {selected.error && (needsSubtitleFile ? <div className="lesson-alert lesson-subtitle-alert" role="alert">
            <WarningCircle size={18} />
            <div className="lesson-subtitle-error">
              <span>{notes ? `新版讲义生成未完成，当前仍显示旧版${notes.mode === "ai" ? " AI 精读" : "原文整理"}。` : ""}这个视频没有公开字幕。导入字幕文件后即可继续整理。</span>
              <div className="lesson-subtitle-actions"><button type="button" className="primary" onClick={() => chooseSubtitleFile(selected)} disabled={!!pending || isRunning || fileReading}><UploadSimple size={17} />导入字幕文件</button></div>
              <details className="lesson-transcription-help">
                <summary>本机转写（高级设置）<CaretDown size={15} /></summary>
                <p>需要管理员预先安装 Python 依赖并准备语音模型；应用不会自动安装或下载。</p>
                <button type="button" className="lesson-light-button" onClick={() => void checkLocalEnvironment(selected.id)} disabled={!!pending || isRunning || !!environmentForSelected?.checking}>{environmentForSelected?.checking ? "正在检测…" : "检测本机环境"}</button>
                {(environmentForSelected?.result || environmentForSelected?.error) && <p className="lesson-transcription-result" role="status">{environmentForSelected.result?.message || environmentForSelected.error}</p>}
              </details>
            </div>
          </div> : <div className="lesson-alert" role="alert"><WarningCircle size={18} /><span>{notes ? `新版讲义生成未完成，当前仍显示旧版${notes.mode === "ai" ? " AI 精读" : "原文整理"}。` : ""}{selected.error}</span>{selected.errorCode === "BILIBILI_LOGIN_REQUIRED" && <button type="button" onClick={() => setBilibiliLoginOpen(true)} disabled={!!pending || isRunning}><QrCode size={16} />扫码登录 B 站</button>}</div>)}
          {selected.archiveError && <div className="lesson-alert" role="alert"><WarningCircle size={18} /><span>自动加入课程资料未完成：{selected.archiveError}</span><button type="button" onClick={() => publish(selected)} disabled={!!pending || isRunning}>重试加入</button></div>}
          {selected.outputError && <div className="lesson-alert" role="alert"><WarningCircle size={18} /><span>自动生成 Output 未完成：{selected.outputError}</span></div>}
          {isRunning && <p className="lesson-progress" role="status">{selected.status === "queued" ? "已排队，完成后自动显示。" : selected.stage === "editing" ? `${selected.editorialProgress?.phase === "completeness" ? "正在逐项核对原课内容并补回遗漏" : selected.editorialProgress?.phase === "evidence" ? "正在逐项筛选清晰配图" : selected.editorialProgress?.phase === "alignment" ? "正在核对讲义与配图的一致性" : selected.editorialProgress?.phase === "review" ? "正在校对全课概念与适用条件" : selected.editorialProgress?.phase === "exercises" ? "正在整理课堂例题与题解" : "正在按知识点重写整课讲义"}${selected.editorialProgress ? ` · ${selected.editorialProgress.done} / ${selected.editorialProgress.total}` : ""}。原始资料保留，可随时停止。` : selected.stage === "capturing" ? "正在采集关键帧。" : selected.stage === "recognizing" ? "正在识别板书与公式。" : selected.stage === "summarizing" ? "正在生成精读讲义与校对建议。" : capabilities.sourceKind === "local" ? "正在获取课程原文，无字幕时在本机转写。" : "正在获取课程原文，完成后自动整理。"}</p>}
          <div className="lesson-tabs" role="tablist" aria-label="切换讲次阅读内容">{TABS.map((item, index) => <button type="button" key={item.value} role="tab" id={`${instanceId}-tab-${item.value}`} aria-selected={tab === item.value} aria-controls={`${instanceId}-panel`} tabIndex={tab === item.value ? 0 : -1} className={tab === item.value ? "is-active" : ""} onClick={() => setTab(item.value)} onKeyDown={event => { const nextIndex = event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : -1; if (nextIndex >= 0) { event.preventDefault(); setTab(TABS[nextIndex].value); document.getElementById(`${instanceId}-tab-${TABS[nextIndex].value}`)?.focus(); } }}>{item.label}{item.value === "examples" && !!readerExamples.length && <span>{readerExamples.length}</span>}</button>)}</div>
          <div className="lesson-tab-content" role="tabpanel" id={`${instanceId}-panel`} aria-labelledby={`${instanceId}-tab-${tab}`}>
            {tab === "notes" && (notes ? <>
              <div className="lesson-tab-tools">
                <span>共 {readerSections.length} 个知识点 · {readerExamples.length} 道例题</span>
                <div>
                  <button type="button" className="lesson-light-button" disabled={!!pending || isRunning || notes.evidenceOutdated} onClick={() => setReadingPdf(true)}><BookOpen size={16} />沉浸阅读</button>
                  <button type="button" className="lesson-light-button" disabled={!!pending || isRunning || notes.evidenceOutdated} onClick={() => downloadDocument(selected)}><DownloadSimple size={16} />{pending === "export-document" ? "正在准备…" : "下载讲义"}</button>
                  <button type="button" className="lesson-light-button" disabled={!!pending || !currentCourse || isRunning || selected.status !== "completed" || notes.evidenceOutdated} onClick={() => selected.documentId && currentCourse ? onOpenCourse(currentCourse.id) : publish(selected)}><FolderOpen size={16} />{selected.documentId ? "去复习" : "存入课程资料"}</button>
                </div>
              </div>
              {isRunning && <div className="lesson-stale-notes" role="status"><WarningCircle size={18} /><div><strong>新版讲义尚未生成完成</strong><p>当前显示的是上一版{notes.mode === "ai" ? " AI 精读" : "原文整理"}，不是本次任务的生成结果。新版成功后会自动替换；如果失败，会在上方显示具体原因。</p></div></div>}
              {!notes.evidenceOutdated && <LessonCorrections corrections={notes.corrections} onLocate={locateCue} onOpenFrame={openFrame} />}
              <LectureDocument weakOnly={weakOnly} study={study.study} onStudy={study.mark} studyBusy={study.saving || isRunning || !!notes?.evidenceOutdated} lesson={selected} busy={!!pending || !currentCourse || !!notes?.evidenceOutdated} onAsk={openChat} onLocate={locateCue} onOpenFrame={openFrame} onSaveCard={section => saveCard(selected, section)} isCardSaved={section => isCardSaved(selected, section)} />
            </> : isRunning ? <div className="lesson-reader-loading" aria-hidden="true"><span /><span /><span /><span /></div> : <div className="lesson-source-empty"><BookOpen size={32} /><h3>{hasSources ? "字幕已就绪" : "还缺字幕"}</h3><p>{hasSources ? "点「生成重点笔记」，就能分段阅读并回看原课。" : "已保存链接。导入字幕后，就能读笔记、看例题。"}</p><div className="lesson-empty-actions">{!selected.cues.length && <button type="button" className="primary" onClick={() => openSource(selected)} disabled={!!pending}><UploadSimple size={17} />导入字幕</button>}{hasSources && !isRunning && <button type="button" className="primary" onClick={() => analyze(capabilities.model ? "ai" : "extractive")} disabled={!!pending || !currentCourse}>{capabilities.model ? <Sparkle size={17} /> : <FileText size={17} />}{capabilities.model ? "生成重点笔记" : "整理字幕"}</button>}{capabilities.bilinote && original && !isRunning && <button type="button" className="secondary" disabled={!!pending || !currentCourse} onClick={() => fetchLesson(selected)}><LinkSimple size={17} />自动读取课程内容</button>}</div>{!capabilities.bilinote && !selected.cues.length && <small>当前无法直接解析链接。支持字幕、TXT 和 Markdown。</small>}{!capabilities.model && selected.cues.length > 0 && <small>还没连接 AI，只能按字幕分段整理。</small>}</div>)}
            {tab === "examples" && (notes ? <>
              <div className="lesson-tab-tools">
                <span>{readerExamples.length} 道例题{pendingExampleCount > 0 ? ` · ${pendingExampleCount} 道缺答案` : ""}{unclearExampleCount > 0 ? ` · ${unclearExampleCount} 道题干不全` : ""}</span>
                <div>{pendingExampleCount > 0 && <button type="button" className="lesson-light-button" disabled={!!pending || isRunning || !currentCourse || !capabilities.model} title={capabilities.model ? "复用已有字幕与截图，每次最多补全 8 道" : "请先连接 AI 模型"} onClick={() => enrichExamples()}><NotePencil size={16} />{pending === "enrich-examples" ? "正在补全…" : "补全例题答案"}</button>}</div>
              </div>
              {unclearExampleCount > 0 && <p className="lesson-enrich-note">有 {unclearExampleCount} 道例题缺条件，可切换到「字幕原文」核对后再补全。</p>}
              <LectureDocument weakOnly={weakOnly} study={study.study} onStudy={study.mark} studyBusy={study.saving || isRunning || !!notes?.evidenceOutdated} lesson={selected} examplesOnly busy={!!pending || !currentCourse || !!notes?.evidenceOutdated} onAsk={openChat} onLocate={locateCue} onOpenFrame={openFrame} onSaveCard={section => saveCard(selected, section)} isCardSaved={section => isCardSaved(selected, section)} />
            </> : <div className="lesson-source-empty"><NotePencil size={30} /><h3>生成笔记后，这里会出现课堂例题</h3><p>会保留原课题干、截图与解题过程；缺条件时会明确提示。</p></div>)}
            {tab === "transcript" && <div className="lesson-transcript-shell"><div className="lesson-transcript-scroll" ref={transcriptScrollRef} onScroll={event => setTranscriptScrolled(event.currentTarget.scrollTop > 240)}><div className="lesson-transcript-tools"><label><MagnifyingGlass size={17} /><input aria-label="在时间轴原文中搜索" value={transcriptQuery} onChange={event => { setTranscriptQuery(event.target.value); setVisibleCues(150); setLocatedCue(""); }} placeholder="查找关键词、公式或题目" /></label><span>{displayedCues.length} 段</span>{selected.cues.length > 0 && <button type="button" className="lesson-light-button" disabled={!!pending || isRunning} onClick={() => openSource(selected)}><UploadSimple size={15} />替换字幕</button>}{reviewCueIds.size > 0 && <button type="button" className="lesson-review-filter" aria-pressed={reviewOnly} onClick={() => { setReviewOnly(!reviewOnly); setVisibleCues(150); }}>待核对 {reviewCueIds.size}</button>}</div>{displayedCues.length ? <div className="lesson-transcript">{displayedCues.slice(0, visibleCues).map(cue => <article key={cue.id} id={`${instanceId}-${cue.id}`} className={locatedCue === cue.id ? "is-located" : ""}><div>{sourceLink(selected, cue.start) ? <a href={sourceLink(selected, cue.start)!} target="_blank" rel="noreferrer" title="回看原课对应位置"><Clock size={13} />{formatTime(cue.start)}<ArrowSquareOut size={12} /></a> : <span>{formatTime(cue.start)}</span>}</div><div><LessonText className="lesson-body-text" text={cue.text} />{(suspiciousTranscript(cue.text) || reviewCueIds.has(cue.id)) && <small className="lesson-cue-warning"><WarningCircle size={14} />自动转写建议核对，可回看原课或板书</small>}</div></article>)}</div> : <p className="lesson-transcript-empty">{selected.cues.length ? "没有找到匹配的原文。" : "尚未导入字幕，请先补充来源。"}</p>}{displayedCues.length > visibleCues && <button type="button" className="lesson-load-more" onClick={() => setVisibleCues(value => value + 150)}>继续显示原文（已显示 {Math.min(visibleCues, displayedCues.length)} / {displayedCues.length} 段）<CaretDown size={15} /></button>}<p className="lesson-transcript-footnote">保留原始转写；校对建议不会覆盖原文。</p></div>{transcriptScrolled && <button type="button" className="lesson-back-top" onClick={backToTranscriptTop} aria-label="回到原文顶部"><ArrowUp size={16} />回顶部</button>}</div>}
            {tab === "visual" && <LessonVisualPanel visual={selected.visual} busy={isRunning || !!pending} configured={!!capabilities.vision} canCapture={!!selected.url || !!selected.mediaRawRef} focusedFrameId={focusedFrameId} onAnalyze={analyzeVisual} onUpload={uploadVisual} onConnect={() => openModelSettings("vision")} />}
          </div>
        </>}
      </div>
      {selected && readerScrolled && <button type="button" className="lesson-reader-top" onClick={backToReaderTop} aria-label="回到这节课顶部"><ArrowUp size={16} />回到顶部</button>}
      </div>
      {selected && <LessonChat lesson={selected} open={chatOpen} context={chatContext} returnFocusRef={chatTrigger} onClose={closeChat} onContextChange={setChatContext} onLocate={locateChatSource} onSettings={() => { setChatOpen(false); openModelSettings("text"); }} />}
    </div>
    <details className="lesson-method"><summary>处理说明<CaretDown size={15} /></summary><p>AI 精读会将原文和选中的关键帧发送至已配置的模型服务。原始转写保留，校对建议可回到对应图片核查。抽样画面可能遗漏遮挡、细小文字或快速擦写的板书。</p>{selected?.sourceName && <p>来源：{selected.sourceName}</p>}</details>
    <input ref={subtitleFileInputRef} hidden type="file" aria-label="选择要导入的字幕文件" accept=".srt,.vtt,.json,.txt,.md,.markdown" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void importFile(file); }} />
    <Dialog.Root open={dialog !== null} onOpenChange={open => { if (!open && !pending && !fileReading) setDialog(null); }}><Dialog.Portal><Dialog.Overlay className="modal-overlay lesson-modal-overlay" /><Dialog.Content className="modal lesson-source-dialog" onEscapeKeyDown={event => { if (pending || fileReading) event.preventDefault(); }} onInteractOutside={event => { if (pending || fileReading) event.preventDefault(); }}>
      <div className="modal-heading"><Dialog.Title>{dialog === "source" ? "替换字幕" : "导入网课"}</Dialog.Title><Dialog.Close className="icon-button" aria-label="关闭导入窗口" disabled={!!pending || fileReading}><X size={21} /></Dialog.Close></div>
      <Dialog.Description>{dialog === "source" ? "替换后会重新整理，已存入课程资料的内容会保留。" : "把字幕或讲解文字，变成好读的重点笔记。"}</Dialog.Description>
      <form onSubmit={submitSource} className="lesson-source-form">
        {dialog === "create" && <div className="lesson-input-modes" role="group" aria-label="选择导入方式"><button type="button" aria-pressed={inputMode === "text"} onClick={() => setInputMode("text")} disabled={!!pending}><FileText size={17} />文字 / 文件</button><button type="button" aria-pressed={inputMode === "link"} onClick={() => setInputMode("link")} disabled={!!pending}><LinkSimple size={17} />B 站链接</button></div>}
        {dialog === "create" && <label>放入课程<select required value={draft.courseId} onChange={event => setDraft(current => ({ ...current, courseId: event.target.value }))} disabled={!!pending}>{courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>}
        {dialog === "create" && inputMode === "link" && !capabilities.model && <div className="lesson-model-warning" role="status"><WarningCircle size={19} /><span><strong>还没有连接 AI 模型</strong>这次导入只会按字幕分段整理，不会生成重点笔记、摘要或例题答案。</span><button type="button" onClick={() => openModelSettings("text")} disabled={!!pending}>去连接模型</button></div>}
        {dialog === "create" && inputMode === "link" && <><label>B 站链接或 BV 号<input value={draft.url} onChange={event => updateUrl(event.target.value)} placeholder="粘贴视频链接，自动读取集数" maxLength={1000} disabled={!!pending || catalogLoading} /></label><p className="lesson-import-availability">{capabilities.sourceKind === "local" ? "优先读取字幕，无字幕时在本机转写。" : capabilities.sourceKind === "platform-subtitles" ? "粘贴链接后自动读取分集，并优先导入 B 站公开字幕。" : capabilities.bilinote ? "读取整门课目录后，可一次导入多个分集，整理完成后自动归档。" : "当前无法直接解析链接。请在下面同时导入字幕，或先保存链接。"}</p>
          {capabilities.bilinote && <div className="lesson-catalog-bar"><button type="button" className="lesson-light-button" onClick={() => void readCatalog()} disabled={!!pending || catalogLoading || !draft.url.trim()}>{catalogLoading ? "正在读取目录…" : catalog ? "重新读取目录" : "读取整门课"}</button>{catalog && <span>{catalog.title}{catalog.owner ? ` · ${catalog.owner}` : ""} · 共 {catalog.pages.length} 集{catalog.truncated ? "（仅显示前 100 集）" : ""}</span>}</div>}
          {catalog && <div className="lesson-part-picker"><div className="lesson-part-head"><span>已选 {selectedParts.length} / {Math.min(catalog.pages.length, MAX_BATCH)} 集</span><div><button type="button" onClick={selectAllParts} disabled={!!pending}>全选</button><button type="button" onClick={() => { setFormError(""); setParts(new Set()); }} disabled={!!pending}>清空</button></div></div>{selectedSummary && <p className="lesson-part-selected">已选：{selectedSummary}</p>}<div className="lesson-part-list">{catalog.pages.map(page => <label key={page.part} className="lesson-part-item"><input type="checkbox" checked={parts.has(page.part)} onChange={() => togglePart(page.part)} disabled={!!pending} /><span><strong>{partLabel(page.part)} · {page.title}</strong><small>{formatDuration(page.duration)}</small></span></label>)}</div>{catalog.pages.length > MAX_BATCH && <small className="lesson-part-hint">一次最多导入 {MAX_BATCH} 集，可分批继续导入。</small>}</div>}
        </>}
        {dialog === "create" && capabilities.vision && (inputMode === "link" || draft.url.trim()) && <label className="lesson-vision-option"><input type="checkbox" checked={withVisual} onChange={event => setWithVisual(event.target.checked)} disabled={!!pending} />同时识别板书</label>}
        {dialog === "create" && inputMode === "link" && capabilities.bilinote && <label className="lesson-vision-option"><input type="checkbox" checked={autoArchive} onChange={event => setAutoArchive(event.target.checked)} disabled={!!pending} />整理完成后自动加入课程资料</label>}
        {dialog === "create" && inputMode === "link" && capabilities.bilinote && autoArchive && capabilities.model && <label className="lesson-vision-option">整批完成后生成<select value={autoOutput} onChange={event => setAutoOutput(event.target.value as "review" | "exam-checklist")} disabled={!!pending}><option value="review">复习资料</option><option value="exam-checklist">考点清单</option></select></label>}
        {dialog === "create" && inputMode === "link" ? <details className="lesson-link-source"><summary>已有字幕？直接导入<CaretDown size={15} /></summary>{sourceFields}</details> : sourceFields}
        {dialog === "create" && <details className="lesson-import-options"><summary>名称、集数与考试范围<CaretDown size={15} /></summary><label>这节课叫什么<input maxLength={120} value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} placeholder="自动命名，也可以自己改" disabled={!!pending} /></label>{inputMode === "text" && <label>B 站链接或 BV 号<input value={draft.url} onChange={event => { setDraft(current => ({ ...current, url: event.target.value })); inferPartFromUrl(event.target.value); }} placeholder="选填，用于回看原课" maxLength={1000} disabled={!!pending} /></label>}<label>第几集<input type="number" min={1} max={1000} step={1} value={draft.part} onChange={event => { partEdited.current = true; setDraft(current => ({ ...current, part: event.target.value })); }} required disabled={!!pending} /></label><label>考试范围<input value={draft.scope} onChange={event => setDraft(current => ({ ...current, scope: event.target.value }))} placeholder="选填，例如：极限、连续性" maxLength={2000} disabled={!!pending} /></label></details>}
        {formError && <p className="lesson-alert" role="alert"><WarningCircle size={18} />{formError}</p>}
        <p className="lesson-source-help">{capabilities.model ? "字幕和勾选的黑板截图会发送给已连接的 AI。" : "还没连接 AI，只会按字幕分段整理。"}</p>
        <div className="lesson-form-actions"><Dialog.Close className="secondary" disabled={!!pending || fileReading}>取消</Dialog.Close><button type="submit" className="primary" disabled={!!pending || fileReading || !courses.length || (!draft.text.trim() && (inputMode === "text" || !draft.url.trim()))}>{pending === "source" ? "正在处理…" : batchImport ? `导入 ${selectedParts.length} 集` : draft.text.trim() || inputMode === "text" ? capabilities.model ? "生成重点笔记" : "整理字幕" : capabilities.bilinote ? capabilities.model ? "导入并生成笔记" : "导入并整理字幕" : "保存链接"}<ArrowRight size={17} /></button></div>
      </form>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
    {readingPdf && selected?.notes && <StudyDocumentReader title={selected.title} endpoint={`/api/lessons/${encodeURIComponent(selected.id)}/document`} onClose={() => setReadingPdf(false)} onPractice={onPractice ? () => { setReadingPdf(false); practiceLesson(selected); } : undefined} />}
    <ModelSettings initialKind={modelSettingsKind} open={modelSettingsOpen} onOpenChange={open => { setModelSettingsOpen(open); if (!open) { const url = new URL(window.location.href); url.searchParams.delete("models"); window.history.replaceState(null, "", url); } }} onConnected={async () => { await load(); await callbacks.current.onRefresh(); callbacks.current.onNotify("模型已连接，可以开始整理笔记和识别板书了。"); }} />
    <NewbieGuide id="lessons" steps={guideSteps} />
    <BilibiliLoginDialog open={bilibiliLoginOpen} onOpenChange={setBilibiliLoginOpen} onSuccess={uname => {
      setBilibiliLoginOpen(false);
      callbacks.current.onNotify(`已登录 B 站${uname ? `（${uname}）` : ""}，正在继续读取字幕。`);
      if (selected) fetchLesson(selected);
    }} />
  </section>;
}

