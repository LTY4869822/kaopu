import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight, CaretDown, CheckCircle, Clock, DownloadSimple, FileText, Flag, Lightbulb, Plus, Sparkle, UploadSimple, WarningCircle, X } from "@phosphor-icons/react";
import type { State } from "./types";
import type { AssessmentSource } from "./assessment-types";
import type { ExamAnswer, ExamAttempt, ExamDifficulty, ExamGoal, ExamGradingJob, ExamHint, ExamJob, ExamLibrary, ExamPaper, ExamPaperRequest, ExamQuestion, ExamQuestionResult, ExamQuestionType, ExamReview, ExamSection, ExamTemplate } from "./exam-types";
import MockExamHome from "./MockExamHome";
import ExamSubmission from "./ExamSubmission";
import ExamAssessment, { uniqueSourceLocations } from "./ExamAssessment";
import ModelSettings from "./ModelSettings";
import LessonText from "./LessonText";
import "./exam-studio.css";
import "./study-flow.css";

type Props = { state: State; courseId: string; onCourseChange: (id: string) => void; onRefresh: () => Promise<unknown>; onNotify: (text: string) => void; onOpenSource: (source: AssessmentSource) => void; initialDocumentIds?: string[]; initialPaperId?: string; initialAttemptId?: string; onOpenPlan?: (courseId: string) => void };
type Draft = Omit<ExamPaperRequest, "courseId">;
const questionTypes: [ExamQuestionType, string][] = [["single-choice", "单选题"], ["multiple-choice", "多选题"], ["true-false", "判断题"], ["fill-blank", "填空题"], ["short-answer", "简答题"], ["calculation", "计算 / 证明题"]];
const difficulties: [ExamDifficulty, string][] = [["easy", "基础"], ["medium", "应用"], ["hard", "进阶"]];
const goals: [ExamGoal, string, string][] = [["pass", "基础巩固", "先覆盖基础题型"], ["balanced", "稳妥提分", "基础与应用兼顾"], ["excellent", "挑战高分", "增加综合与条件辨析"]];
const reasons: [NonNullable<ExamReview["reason"]>, string][] = [["concept", "概念不清"], ["condition", "条件遗漏"], ["method", "方法没想到"], ["calculation", "计算失误"], ["memory", "记不住"], ["time", "时间不够"]];
const typeName = (type: ExamQuestionType) => questionTypes.find(item => item[0] === type)?.[1] || type;
const difficultyName = (value: ExamDifficulty) => difficulties.find(item => item[0] === value)?.[1] || value;
const answered = (value?: ExamAnswer) => Array.isArray(value) ? value.length > 0 : !!value?.trim();
const readableAnswer = (value?: ExamAnswer) => Array.isArray(value) ? value.join("、") : value || "未作答";
const sourcePlace = (source: AssessmentSource) => `第 ${source.page} ${source.locationKind === "section" ? "段" : source.locationKind === "slide" ? "张" : "页"}`;
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : "操作未完成，请稍后重试。";
const draftKey = (course: string) => `shifen:exam-builder:${course}`;
const answerKey = (id: string) => `shifen:exam-draft:${id}`;
const activeKey = (course: string) => `shifen:exam-active:${course}`;
function initialDraft(course: State["courses"][number] | undefined, documents: State["documents"]): Draft {
  return { title: course ? `${course.name} · 期末模拟卷` : "期末模拟卷", durationMinutes: 30, goal: course && course.target >= 90 ? "excellent" : course && course.target <= 65 ? "pass" : "balanced", focus: "", sourcePolicy: "materials", documentIds: documents.slice(0, 40).map(doc => doc.id),
    sections: questionTypes.map(([type]) => ({ type, count: type === "single-choice" ? 4 : type === "fill-blank" ? 2 : type === "short-answer" ? 1 : 0, points: type === "short-answer" || type === "calculation" ? 10 : 5, difficulty: type === "single-choice" ? "easy" : "medium", topics: [] })) };
}
function saveLocal(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* The page keeps the current draft in memory. */ } }
function readLocal<T>(key: string): T | null { try { return JSON.parse(localStorage.getItem(key) || "null") as T | null; } catch { return null; } }
function restoredDraft(courseId: string, course: State["courses"][number] | undefined, documents: State["documents"]): Draft {
  const fallback = initialDraft(course, documents), value = readLocal<Partial<Draft>>(draftKey(courseId));
  if (!value || typeof value.title !== "string" || value.title.length > 120 || typeof value.focus !== "string" || value.focus.length > 1200
    || !["pass", "balanced", "excellent"].includes(value.goal || "") || !["materials", "extended"].includes(value.sourcePolicy || "")
    || typeof value.durationMinutes !== "number" || !Number.isFinite(value.durationMinutes)
    || !Array.isArray(value.documentIds) || value.documentIds.some(id => typeof id !== "string")
    || !Array.isArray(value.sections) || !value.sections.length || value.sections.length > 12
    || value.sections.some(section => !section || !questionTypes.some(([type]) => type === section.type)
      || !Number.isFinite(section.count) || !Number.isFinite(section.points) || !["easy", "medium", "hard"].includes(section.difficulty)
      || !Array.isArray(section.topics) || section.topics.some(topic => typeof topic !== "string"))) return fallback;
  return { ...fallback, ...value, documentIds: value.documentIds.filter(id => documents.some(doc => doc.id === id)), sections: value.sections } as Draft;
}
async function request<T>(route: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  if (body !== undefined && !(body instanceof FormData) && new TextEncoder().encode(JSON.stringify(body)).length > 3_900_000) throw new Error("本次答案内容超过保存上限，请缩短长篇推导或分卷练习；本机草稿仍保留。");
  const response = await fetch(`/api${route}`, { method, signal, headers: body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  let value; try { value = await response.json(); } catch { throw new Error(response.status === 413 ? "答案内容超过服务器保存上限，请缩短长篇回答；本机草稿仍保留。" : "暂时无法读取试卷记录，请稍后重试。"); }
  if (!response.ok) { if (response.status === 401) window.dispatchEvent(new Event("shifen:session-expired")); throw Object.assign(new Error(value.error || "操作未完成，请稍后重试。"), { status: response.status }); }
  return value as T;
}
function exportText(title: string, content: string) { const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = `${title.replace(/[<>:"/\\|?*]/g, "_")}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function SectionEditor({ sections, disabled, onChange }: { sections: ExamSection[]; disabled: boolean; onChange: (sections: ExamSection[]) => void }) {
  const [expanded, setExpanded] = useState<number[]>([]);
  const [showUnused, setShowUnused] = useState(false);
  const [shown, setShown] = useState(() => sections.flatMap((section, index) => section.count ? [index] : []));
  const patch = (index: number, values: Partial<ExamSection>) => onChange(sections.map((section, i) => i === index ? { ...section, ...values } : section));
  return <div className="es-section-editor"><div className="es-section-columns" aria-hidden="true"><span>题型</span><span>题数</span><span>每题分</span><span>难度</span><span>考察范围</span></div>{sections.map((section, index) => <div className={`es-section-row ${section.count ? "is-enabled" : ""} ${expanded.includes(index) ? "is-expanded" : ""}`} key={`${section.id || section.type}-${index}`} hidden={!showUnused && !section.count && !shown.includes(index)} onFocus={() => setShown(previous => previous.includes(index) ? previous : [...previous, index])}>
    <div className="es-section-name"><strong>{typeName(section.type)}</strong></div>
    <button className="es-section-adjust" type="button" aria-label={`调整${typeName(section.type)}分值与难度${index + 1}`} aria-expanded={expanded.includes(index)} disabled={disabled} onClick={() => setExpanded(previous => previous.includes(index) ? previous.filter(item => item !== index) : [...previous, index])}>调整<CaretDown size={14} /></button>
    <label className="es-section-quantity"><span>题数</span><input aria-label={`${typeName(section.type)}数量${index + 1}`} type="number" min={0} max={100} step={1} value={section.count} disabled={disabled} onChange={event => patch(index, { count: event.target.value === "" ? 0 : Number(event.target.value) })} /></label>
    <label className="es-section-setting es-section-points"><span>每题分</span><input aria-label={`${typeName(section.type)}每题分${index + 1}`} type="number" min={0.5} max={100} step={0.5} value={section.points} disabled={disabled} onChange={event => patch(index, { points: Number(event.target.value) })} /></label>
    <label className="es-section-setting es-section-difficulty"><span>难度</span><select aria-label={`${typeName(section.type)}难度${index + 1}`} value={section.difficulty} disabled={disabled} onChange={event => patch(index, { difficulty: event.target.value as ExamDifficulty })}>{difficulties.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    <details className="es-section-topics"><summary>指定知识点{section.topics.length ? ` · ${section.topics.length}` : ""}</summary><input key={section.topics.join("，")} aria-label={`${typeName(section.type)}知识点${index + 1}`} defaultValue={section.topics.join("，")} maxLength={600} disabled={disabled} placeholder="逗号分隔；留空按范围安排" onBlur={event => patch(index, { topics: event.target.value.split(/[,，、;；\n]/).map(value => value.trim()).filter(Boolean) })} /></details>
  </div>)}<button type="button" className="text-button es-more-types" aria-expanded={showUnused} onClick={() => setShowUnused(value => !value)}>{showUnused ? "收起其他题型" : "添加其他题型"}<CaretDown size={15} /></button></div>;
}

export default function ExamStudio({ state, courseId, onCourseChange, onRefresh, onNotify, onOpenSource, initialDocumentIds, initialPaperId, initialAttemptId, onOpenPlan }: Props) {
  const course = state.courses.find(item => item.id === courseId);
  const materials = useMemo(() => state.documents.filter(doc => doc.courseId === courseId && doc.status === "ready"), [state.documents, courseId]);
  const materialSignature = useMemo(() => JSON.stringify(materials.map(doc => [doc.id, doc.name, doc.chunks])), [materials]);
  const [library, setLibrary] = useState<ExamLibrary>({ configured: state.providerConfigured, templates: [], papers: [], attempts: [] });
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "neutral">("success");
  const [screen, setScreen] = useState<"home" | "builder" | "paper" | "attempt">("home");
  const [builderMode, setBuilderMode] = useState<"custom" | "template">("custom");
  // Hydrate before any persistence effect can run, including StrictMode's replay.
  const [draft, setDraft] = useState<Draft>(() => restoredDraft(courseId, course, materials));
  const [draftCourse, setDraftCourse] = useState(courseId);
  const [template, setTemplate] = useState<ExamTemplate | null>(null), [templateDirty, setTemplateDirty] = useState(false), [pastIds, setPastIds] = useState<string[]>([]);
  const [job, setJob] = useState<ExamJob | null>(null), [paper, setPaper] = useState<ExamPaper | null>(null), [attempt, setAttempt] = useState<ExamAttempt | null>(null);
  const [gradingJob, setGradingJob] = useState<ExamGradingJob | null>(null);
  const initialIntent = useRef("");
  const [answers, setAnswers] = useState<Record<string, ExamAnswer>>({}), [flagged, setFlagged] = useState<string[]>([]), [position, setPosition] = useState(0);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved"), [saveError, setSaveError] = useState("");
  const [conflictDraft, setConflictDraft] = useState<{ id: string; answers: Record<string, ExamAnswer>; flagged: string[] } | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false), [hint, setHint] = useState<ExamHint | null>(null), [reportFilter, setReportFilter] = useState<"all" | "wrong" | "pending">("all");
  const [selectedRetry, setSelectedRetry] = useState<string[]>([]), [savedCards, setSavedCards] = useState<string[]>([]), [modelOpen, setModelOpen] = useState(false), [now, setNow] = useState(Date.now());
  const [answerSheetOpen, setAnswerSheetOpen] = useState(() => window.matchMedia("(min-width: 901px)").matches);
  const submitTriggerRef = useRef<HTMLButtonElement | null>(null);
  const jobRef = useRef<ExamJob | null>(null), screenRef = useRef(screen), seenTerminals = useRef(new Set<string>());
  jobRef.current = job; screenRef.current = screen;
  const scope = useRef(0), libraryVersion = useRef(0), alive = useRef(true), lock = useRef(""), controllers = useRef(new Set<AbortController>()), uploadRef = useRef<HTMLInputElement>(null), questionRef = useRef<HTMLElement>(null);
  const attemptRef = useRef<ExamAttempt | null>(null), answerRef = useRef<Record<string, ExamAnswer>>({}), flagRef = useRef<string[]>([]), dirty = useRef(0), saved = useRef(0), saving = useRef<{ id: string; version: number; promise: Promise<boolean> } | null>(null), saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const callbacks = useRef({ onRefresh, onNotify, onOpenSource }); callbacks.current = { onRefresh, onNotify, onOpenSource };
  const courseRef = useRef(courseId); courseRef.current = courseId;
  const valid = (version: number) => alive.current && scope.current === version;
  const scopedRequest = async <T,>(route: string, method = "GET", body?: unknown) => { const controller = new AbortController(); controllers.current.add(controller); try { return await request<T>(route, method, body, controller.signal); } finally { controllers.current.delete(controller); } };
  function adoptAttempt(value: ExamAttempt, restore = false) {
    setNow(Date.now());
    attemptRef.current = value; setAttempt(value); setPaper(value.paper); setScreen("attempt"); setPosition(0); setHint(null); setConfirmSubmit(false);
    setReportFilter("all");
    setSelectedRetry(value.status === "submitted" ? (value.results || []).filter(result => result.status === "incorrect" || result.status === "unanswered"
      || ["incorrect", "partial"].includes(result.review?.selfAssessment || "")).map(result => result.questionId) : []);
    setGradingJob(value.gradingJob || null);
    const local = restore && value.status === "in-progress" ? readLocal<{ revision: number; answers: Record<string, ExamAnswer>; flagged: string[]; dirty: boolean }>(answerKey(value.id)) : null;
    const hasDraft = !!local?.dirty && local.revision === value.revision;
    setConflictDraft(local?.dirty && !hasDraft ? { id: value.id, answers: local.answers, flagged: local.flagged } : null);
    answerRef.current = hasDraft ? local.answers : value.answers; flagRef.current = hasDraft ? local.flagged : value.flaggedQuestionIds;
    setAnswers(answerRef.current); setFlagged(flagRef.current); dirty.current = hasDraft ? 1 : 0; saved.current = 0; setSaveState(hasDraft ? "dirty" : "saved"); setSaveError("");
    clearTimeout(saveTimer.current); if (hasDraft) saveTimer.current = setTimeout(() => { void flushSave(); }, 650);
    if (value.status === "in-progress") { saveLocal(activeKey(value.courseId), value.id); if (local?.dirty && !hasDraft) setNotice("发现其他版本的本机草稿，已保留本机备份；当前展示服务端最新记录。"); }
    else { try { localStorage.removeItem(activeKey(value.courseId)); localStorage.removeItem(answerKey(value.id)); } catch { /* Nothing to clear. */ } }
  }
  async function loadLibrary(version = scope.current) {
    const load = ++libraryVersion.current;
    if (!courseRef.current || courseRef.current === "all") { setLoading(false); setLibrary({ configured: state.providerConfigured, templates: [], papers: [], attempts: [] }); return; }
    setLoading(true);
    try { const value = await scopedRequest<ExamLibrary>(`/exams?courseId=${encodeURIComponent(courseRef.current)}`); if (valid(version) && load === libraryVersion.current) {
      setLibrary(value); setError("");
      const jobs = (value as ExamLibrary & { jobs?: ExamJob[] }).jobs || [], active = jobs.find(item => item.status === "queued" || item.status === "generating"), tracked = jobRef.current;
      if (active) void observeJob(active, version);
      else if (tracked && ["queued", "generating"].includes(tracked.status)) { const terminal = jobs.find(item => item.id === tracked.id); if (terminal) void observeJob(terminal, version); }
      else if (screenRef.current === "builder" && jobs[0]?.status === "failed" && !seenTerminals.current.has(`${jobs[0].id}:failed`)) void observeJob(jobs[0], version);
    } }
    catch (cause) { if (valid(version) && load === libraryVersion.current && !(cause instanceof DOMException && cause.name === "AbortError")) setError(errorMessage(cause)); }
    finally { if (valid(version) && load === libraryVersion.current) setLoading(false); }
  }
  async function observeJob(value: ExamJob, version = scope.current) {
    if (!valid(version)) return;
    jobRef.current = value; setJob(value);
    if (!["completed", "failed", "cancelled"].includes(value.status)) return;
    try { localStorage.removeItem(`shifen:exam-job:${value.courseId}`); } catch { /* Builder and answer drafts remain intact. */ }
    setBusy(""); lock.current = "";
    const terminalKey = `${value.id}:${value.status}`; if (seenTerminals.current.has(terminalKey)) return; seenTerminals.current.add(terminalKey);
    if (value.status === "failed") { setError(value.message || "本次组卷未完成，配置已保留，请调整后重新生成。"); setNotice(""); return; }
    if (value.status === "cancelled") { setNoticeTone("neutral"); setNotice(value.message || "组卷已取消，配置已保留。"); return; }
    if (value.paperId) {
      try { const next = await scopedRequest<ExamPaper>(`/exams/papers/${value.paperId}`); if (valid(version)) { setPaper(next); setScreen("paper"); void loadLibrary(version); } }
      catch (cause) { if (valid(version)) setError(errorMessage(cause)); }
    }
  }
  async function flushSave(): Promise<boolean> {
    const current = attemptRef.current; if (!current || current.status !== "in-progress") return true;
    const version = scope.current, id = current.id;
    if (saving.current) {
      const pending = saving.current, okay = await pending.promise;
      if (saving.current === pending) saving.current = null;
      if (!valid(version) || attemptRef.current?.id !== id) return false;
      if (!okay && pending.id === id && pending.version === version) return false;
      return flushSave();
    }
    if (dirty.current === saved.current) return true;
    const work = async () => {
      while (attemptRef.current?.id === id && dirty.current !== saved.current) {
        const stamp = dirty.current, snapshot = { ...answerRef.current }, flags = [...flagRef.current], revision = attemptRef.current.revision;
        if (valid(version)) { setSaveState("saving"); setSaveError(""); }
        try {
          const value = await request<ExamAttempt>(`/exams/attempts/${id}`, "PATCH", { revision, answers: snapshot, flaggedQuestionIds: flags });
          const backup = readLocal<{ revision: number; answers: Record<string, ExamAnswer>; flagged: string[]; dirty: boolean }>(answerKey(id));
          if (backup && backup.revision === revision) saveLocal(answerKey(id), { ...backup, revision: value.revision, dirty: JSON.stringify(backup.answers) !== JSON.stringify(snapshot) || JSON.stringify(backup.flagged) !== JSON.stringify(flags) });
          if (attemptRef.current?.id !== id || !valid(version)) return true;
          attemptRef.current = value; setAttempt(value); saved.current = stamp;
          saveLocal(answerKey(id), { revision: value.revision, answers: answerRef.current, flagged: flagRef.current, dirty: dirty.current !== saved.current });
          if (dirty.current === saved.current) setSaveState("saved");
        } catch (cause) {
          if (valid(version)) { setSaveState("error"); setSaveError(errorMessage(cause)); }
          return false;
        }
      }
      return true;
    };
    const pending = { id, version, promise: work() }; saving.current = pending;
    try { return await pending.promise; } finally { if (saving.current === pending) saving.current = null; }
  }
  function changeAnswer(questionId: string, value: ExamAnswer) {
    if (!attemptRef.current || attemptRef.current.status !== "in-progress" || lock.current || (attemptRef.current.deadlineAt && Date.now() >= Date.parse(attemptRef.current.deadlineAt))) return;
    answerRef.current = { ...answerRef.current, [questionId]: value }; setAnswers(answerRef.current); queueSave();
  }
  function queueSave() {
    const current = attemptRef.current; if (!current) return;
    dirty.current++; setSaveState("dirty"); saveLocal(answerKey(current.id), { revision: current.revision, answers: answerRef.current, flagged: flagRef.current, dirty: true });
    clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => { void flushSave(); }, 650);
  }
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; scope.current++; controllers.current.forEach(controller => controller.abort()); clearTimeout(saveTimer.current); void flushSave(); };
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 901px)");
    const syncLayout = () => setAnswerSheetOpen(media.matches);
    media.addEventListener("change", syncLayout);
    return () => media.removeEventListener("change", syncLayout);
  }, []);
  useEffect(() => {
    const version = ++scope.current; controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); lock.current = ""; setBusy(""); setError(""); setNotice("");
    initialIntent.current = "";
    // Reapply entry intent after this course reset, including StrictMode's
    // setup/cleanup replay. Ordinary builder edits do not run this reset.
    initialIntent.current = "";
    attemptRef.current = null; setAttempt(null); setPaper(null); setJob(null); setGradingJob(null); jobRef.current = null; setScreen("home"); setTemplate(null); setTemplateDirty(false); setPastIds([]); setHint(null); setSavedCards([]); setSelectedRetry([]); setConfirmSubmit(false); setConflictDraft(null);
    setDraft(restoredDraft(courseId, course, materials));
    setDraftCourse(courseId);
    void loadLibrary(version);
    const active = readLocal<string>(activeKey(courseId));
    if (active && course && !initialDocumentIds?.length && !initialPaperId && !initialAttemptId) void scopedRequest<ExamAttempt>(`/exams/attempts/${encodeURIComponent(active)}`).then(value => { if (valid(version) && value.courseId === courseId && value.status === "in-progress") adoptAttempt(value, true); }).catch(() => { /* The library remains available for an explicit retry. */ });
    const jobId = readLocal<string>(`shifen:exam-job:${courseId}`);
    if (jobId && course) void scopedRequest<ExamJob>(`/exams/jobs/${encodeURIComponent(jobId)}`).then(value => observeJob(value, version)).catch(() => { if (valid(version)) { try { localStorage.removeItem(`shifen:exam-job:${courseId}`); } catch { /* Nothing to clear. */ } setNoticeTone("neutral"); setNotice("上次组卷任务已不可用，已保存的试卷仍在卷库，可重新组卷。"); } });
    // A course switch fences every asynchronous view update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);
  const initialDocumentSignature = JSON.stringify(initialDocumentIds || []);
  useEffect(() => {
    if (!course || !initialAttemptId && !initialPaperId && !initialDocumentIds?.length) return;
    const key = `${courseId}:${initialAttemptId || ""}:${initialPaperId || ""}:${initialDocumentSignature}`;
    if (initialIntent.current === key) return;
    initialIntent.current = key;
    if (initialAttemptId) { void openAttempt(initialAttemptId); return; }
    if (initialPaperId) { void openPaper(initialPaperId); return; }
    const ids = (initialDocumentIds || []).filter(id => materials.some(doc => doc.id === id));
    setDraft(previous => ({ ...previous, documentIds: ids, templateId: undefined, retryFrom: undefined }));
    setBuilderMode("custom"); setScreen("builder"); setTemplate(null); setTemplateDirty(false);
    setNotice(`已选用 ${ids.length} 份资料，可调整题型、数量和难度。`);
    // Entry intent is consumed once, leaving later builder edits untouched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, initialAttemptId, initialPaperId, initialDocumentSignature]);
  useEffect(() => {
    setDraft(previous => ({ ...previous, documentIds: previous.documentIds.filter(id => materials.some(doc => doc.id === id)) }));
    setPastIds(previous => previous.filter(id => materials.some(doc => doc.id === id)));
    // Reload available records when source contents change; the backend validates source versions.
    if (course) void loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialSignature]);
  useEffect(() => { if (course && draftCourse === courseId) saveLocal(draftKey(courseId), draft); }, [draft, courseId, course, draftCourse]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (attemptRef.current?.status === "in-progress" && dirty.current !== saved.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, []);
  useEffect(() => { if (!attempt?.deadlineAt || attempt.status !== "in-progress") return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [attempt?.id, attempt?.deadlineAt, attempt?.status]);
  useEffect(() => {
    if (!job || !["queued", "generating"].includes(job.status)) return;
    const version = scope.current, id = job.id; let cancelled = false, polling = false;
    const timer = setInterval(() => { if (polling) return; polling = true; void scopedRequest<ExamJob>(`/exams/jobs/${id}`).then(value => {
      if (!valid(version) || cancelled) return;
      void observeJob(value, version);
    }).catch(cause => { if (valid(version) && !cancelled) { setError(errorMessage(cause)); if ((cause as { status?: number }).status === 404) void observeJob({ ...job, status: "failed", message: "组卷任务已中断，配置已保留，可以重新生成。" }, version); } }).finally(() => { polling = false; }); }, 1600);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status]);
  useEffect(() => { setHint(null); setConfirmSubmit(false); }, [position, attempt?.id]);
  useEffect(() => {
    if (!gradingJob || !["queued", "generating"].includes(gradingJob.status)) return;
    const version = scope.current, id = gradingJob.id; let cancelled = false, polling = false;
    const poll = async () => {
      if (polling) return; polling = true;
      try {
        const value = await scopedRequest<ExamGradingJob>(`/exams/grading-jobs/${id}`);
        if (!valid(version) || cancelled) return;
        const latest = await scopedRequest<ExamAttempt>(`/exams/attempts/${value.attemptId}`);
        if (!valid(version) || cancelled || attemptRef.current?.id !== value.attemptId) return;
        attemptRef.current = latest; setAttempt(latest);
        setGradingJob(value);
        if (value.status === "failed") setError(value.message);
        if (value.status === "completed") { setNotice(value.message); void loadLibrary(version); }
      } catch (cause) {
        if (valid(version) && !cancelled) {
          setError(errorMessage(cause));
          if ((cause as { status?: number }).status === 404) setGradingJob({ ...gradingJob, status: "failed", message: "批改任务已中断，已保存的作答和反馈仍保留，可以重新批改。" });
        }
      } finally { polling = false; }
    };
    void poll(); const timer = setInterval(() => { void poll(); }, 1200);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradingJob?.id, gradingJob?.status]);

  function openBuilder(mode: "custom" | "template") { setBuilderMode(mode); setScreen("builder"); const recent = (library as ExamLibrary & { jobs?: ExamJob[] }).jobs?.[0]; setError(recent?.status === "failed" ? `上次组卷未完成：${recent.message}。原配置已保留，可调整后重试。` : ""); setNotice(""); setTemplate(null); setTemplateDirty(false); setDraft(previous => ({ ...previous, templateId: undefined, retryFrom: undefined })); }
  function updateDraft(values: Partial<Draft>) { setDraft(previous => ({ ...previous, ...values })); if (template) setTemplateDirty(true); }
  async function run(action: string, operation: (version: number) => Promise<void>) {
    if (lock.current) return; const version = scope.current; lock.current = action; setBusy(action); setError(""); setNoticeTone("success");
    try { await operation(version); } catch (cause) { if (valid(version) && !(cause instanceof DOMException && cause.name === "AbortError")) setError(errorMessage(cause)); }
    finally { if (valid(version) && lock.current === action) { lock.current = ""; setBusy(""); } }
  }
  async function upload(files: FileList | null) {
    if (!files?.length || !course) return;
    const selected = Array.from(files); if (selected.length > 3) { setError("每次最多添加 3 份历年卷，请分批上传。"); return; }
    await run("upload", async version => {
      const added: string[] = [];
      for (const file of selected) {
        if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} 超过 20 MB，请拆分后上传。`);
        const body = new FormData(); body.append("file", file); body.append("courseId", courseId); body.append("parseMode", "auto");
        const doc = await scopedRequest<{ id: string }>("/documents", "POST", body); added.push(doc.id);
      }
      await callbacks.current.onRefresh(); if (!valid(version)) return;
      setPastIds(previous => [...new Set([...previous, ...added])]); setDraft(previous => ({ ...previous, documentIds: [...new Set([...previous.documentIds, ...added])] })); setNotice(`已添加 ${added.length} 份资料，可开始分析试卷结构。`);
    });
    if (uploadRef.current) uploadRef.current.value = "";
  }
  async function analyzeTemplate() { await run("analyze", async version => { const value = await scopedRequest<ExamTemplate>("/exams/templates/analyze", "POST", { courseId, documentIds: pastIds }); if (!valid(version)) return; setTemplate(value); setTemplateDirty(true); setDraft(previous => ({ ...previous, title: `${course?.name || "课程"} · 仿真模拟卷`, sections: value.sections, durationMinutes: value.durationMinutes, focus: value.focus, templateId: value.id })); setNotice("已识别卷面结构。请核对题数、每题分、考察方向与估计难度，再确认模板。"); void loadLibrary(version); }); }
  async function confirmTemplate() { if (!template) return; await run("confirm-template", async version => { const value = await scopedRequest<ExamTemplate>(`/exams/templates/${template.id}/confirm`, "POST", { title: template.title, sections: draft.sections.filter(section => section.count > 0), durationMinutes: draft.durationMinutes, focus: draft.focus }); if (!valid(version)) return; setTemplate(value); setTemplateDirty(false); setDraft(previous => ({ ...previous, sections: value.sections, durationMinutes: value.durationMinutes, focus: value.focus, templateId: value.id })); setNotice("模板已确认，将按照当前结构生成新题。"); void loadLibrary(version); }); }
  const enabledSections = draft.sections.filter(section => section.count > 0), totalQuestions = enabledSections.reduce((sum, section) => sum + section.count, 0), totalPoints = enabledSections.reduce((sum, section) => sum + section.count * section.points, 0);
  const draftError = !course ? "先选择一门课程" : !draft.title.trim() ? "请填写试卷名称" : totalQuestions < 1 || totalQuestions > 100 ? "每卷安排 1–100 道题" : draft.sections.some(section => !Number.isInteger(section.count) || section.count < 0 || section.count > 100 || !Number.isFinite(section.points) || !Number.isInteger(section.points * 2) || section.points < 0.5 || section.points > 100) ? "请检查每题数量与分值" : totalPoints > 2000 ? "每卷总分最多 2000 分" : enabledSections.some(section => section.topics.length > 12 || section.topics.some(topic => topic.length > 100)) ? "每组最多指定 12 个知识点，每个不超过 100 字" : draft.documentIds.length > 40 ? "每轮最多选择 40 份课程资料" : !Number.isInteger(draft.durationMinutes) || draft.durationMinutes < 5 || draft.durationMinutes > 360 ? "练习时长应为 5–360 分钟" : draft.sourcePolicy === "materials" && !draft.documentIds.length ? "请选择至少一份课程资料" : builderMode === "template" && (!template || !template.confirmed || templateDirty) ? "请先分析并确认真题模板" : "";
  async function generate(override?: ExamPaperRequest) {
    await run("generate", async version => {
      const payload: ExamPaperRequest = override || { ...draft, courseId, sections: enabledSections, ...(builderMode !== "template" ? { templateId: undefined } : {}) };
      const value = await scopedRequest<{ jobId: string }>("/exams/papers", "POST", payload); if (!valid(version)) return;
      saveLocal(`shifen:exam-job:${courseId}`, value.jobId); void observeJob({ id: value.jobId, courseId, status: "queued", completed: 0, total: payload.sections.reduce((sum, item) => sum + item.count, 0), message: "正在安排知识点与题型…" }, version); setNotice("");
    });
  }
  async function openPaper(id: string) { await run("open-paper", async version => { const value = await scopedRequest<ExamPaper>(`/exams/papers/${id}`); if (valid(version)) { if (value.courseId !== courseRef.current) throw new Error("这份试卷不属于当前课程，请回到对应课程打开。"); setPaper(value); setAttempt(null); attemptRef.current = null; setScreen("paper"); } }); }
  async function openAttempt(id: string) { await run("open-attempt", async version => { const value = await scopedRequest<ExamAttempt>(`/exams/attempts/${id}`); if (valid(version)) { if (value.courseId !== courseRef.current) throw new Error("这份答卷属于另一门课程，请切换课程后打开。"); adoptAttempt(value, true); } }); }
  async function start(mode: "exam" | "practice") { if (!paper) return; await run("start", async version => { const value = await scopedRequest<ExamAttempt>(`/exams/papers/${paper.id}/start`, "POST", { mode }); if (valid(version)) { adoptAttempt(value); void loadLibrary(version); } }); }
  async function leaveAttempt() { const version = scope.current, id = attemptRef.current?.id; if (!await flushSave() || !valid(version) || attemptRef.current?.id !== id) return; attemptRef.current = null; setAttempt(null); setScreen("home"); void loadLibrary(); }
  async function openHintSource(source: AssessmentSource) { const version = scope.current, id = attemptRef.current?.id; if (await flushSave() && valid(version) && attemptRef.current?.id === id) callbacks.current.onOpenSource(source); }
  function restoreConflict() {
    if (!conflictDraft || attemptRef.current?.id !== conflictDraft.id || attemptRef.current.status !== "in-progress" || attemptRef.current.deadlineAt && Date.now() >= Date.parse(attemptRef.current.deadlineAt)) return;
    answerRef.current = conflictDraft.answers; flagRef.current = conflictDraft.flagged; setAnswers(answerRef.current); setFlagged(flagRef.current); setConflictDraft(null); queueSave(); setNotice("已载入本机草稿，将按当前服务端版本保存。");
  }
  async function submit() { if (!attemptRef.current) return; const id = attemptRef.current.id; await run("submit", async version => { const before = attemptRef.current; const alreadyExpired = !!before?.deadlineAt && Date.now() >= Date.parse(before.deadlineAt); const savedOk = alreadyExpired ? saving.current?.id === id ? await saving.current.promise : true : await flushSave(); if (!valid(version) || attemptRef.current?.id !== id) return; const current = attemptRef.current; const timedOut = !!current.deadlineAt && Date.now() >= Date.parse(current.deadlineAt); if (!timedOut && !savedOk) throw new Error("答案尚未保存，请先重试保存后交卷。为避免丢失，本机草稿已保留。"); if (timedOut && JSON.stringify(answerRef.current) !== JSON.stringify(current.answers)) saveLocal(`shifen:exam-unsaved:${id}`, answerRef.current); const value = await scopedRequest<ExamAttempt>(`/exams/attempts/${id}/submit`, "POST", { revision: current.revision, answers: timedOut ? current.answers : answerRef.current, flaggedQuestionIds: timedOut ? current.flaggedQuestionIds : flagRef.current }); if (valid(version) && attemptRef.current?.id === id) { adoptAttempt(value); setReportFilter("all"); setSelectedRetry(value.results?.filter(result => result.status === "incorrect" || result.status === "unanswered").map(result => result.questionId) || []); if (timedOut) setNotice("已按限时内保存的答案交卷；到期后的修改不计入本轮。"); void loadLibrary(version); } }); }
  async function showHint(level: number) { if (!attemptRef.current || !currentQuestion) return; const id = attemptRef.current.id, questionId = currentQuestion.id; await run("hint", async version => { if (!await flushSave()) throw new Error("请先保存答案后再查看提示。"); if (!valid(version) || attemptRef.current?.id !== id) return; const value = await scopedRequest<ExamHint>(`/exams/attempts/${id}/hints`, "POST", { questionId, level }); if (valid(version) && attemptRef.current?.id === id) { attemptRef.current = value.attempt; setAttempt(value.attempt); setHint(value); saveLocal(answerKey(value.attempt.id), { revision: value.attempt.revision, answers: answerRef.current, flagged: flagRef.current, dirty: false }); } }); }
  async function grade(questionIds?: string[]) {
    if (!attemptRef.current || attemptRef.current.status !== "submitted" || gradingJob && ["queued", "generating"].includes(gradingJob.status)) return;
    const current = attemptRef.current;
    await run("grade", async version => {
      const value = await scopedRequest<{ jobId: string }>(`/exams/attempts/${current.id}/grade`, "POST", { revision: current.revision, ...(questionIds ? { questionIds } : {}) });
      if (valid(version) && attemptRef.current?.id === current.id) { setGradingJob({ id: value.jobId, kind: "grading", attemptId: current.id, courseId: current.courseId, status: "queued", completed: 0, total: questionIds?.length || Math.min(10, current.results?.filter(r => r.earned === null && answered(r.answer) && !r.aiAssessment).length || 0), message: "正在按评分要点核对作答…" }); setError(""); }
    });
  }
  async function cancelGrading() { if (!gradingJob) return; await run("cancel-grade", async version => { const value = await scopedRequest<ExamGradingJob>(`/exams/grading-jobs/${gradingJob.id}/cancel`, "POST", {}); if (valid(version)) { setGradingJob(value); const latest = await scopedRequest<ExamAttempt>(`/exams/attempts/${value.attemptId}`); if (valid(version) && attemptRef.current?.id === latest.id) { attemptRef.current = latest; setAttempt(latest); } } }); }
  async function review(questionId: string, values: ExamReview) { if (!attempt || gradingJob && ["queued", "generating"].includes(gradingJob.status)) return; await run(`review-${questionId}`, async version => { const value = await scopedRequest<ExamAttempt>(`/exams/attempts/${attempt.id}/review`, "PATCH", { questionId, ...values }); if (valid(version)) { attemptRef.current = value; setAttempt(value); } }); }
  const cardBack = (result: ExamQuestionResult) => `${result.expectedAnswer}\n\n${result.explanation}`;
  const cardTooLong = (question: ExamQuestion, result: ExamQuestionResult) => question.prompt.length > 1000 || cardBack(result).length > 5000;
  const existingCard = (question: ExamQuestion, result: ExamQuestionResult, id: string) => state.cards.some(card => card.courseId === id && card.front === question.prompt && card.back === cardBack(result));
  async function saveCard(question: ExamQuestion, result: ExamQuestionResult) { if (cardTooLong(question, result)) { setError("题面或解析较长，请在练习页的回忆复习中分段整理，避免截断关键内容。"); return; } await run(`card-${question.id}`, async version => { await scopedRequest("/cards", "POST", { courseId: paper!.courseId, front: question.prompt, back: cardBack(result), source: `${paper!.title} · 第 ${question.number} 题`.slice(0, 200) }); if (valid(version)) { setSavedCards(previous => [...previous, question.id]); callbacks.current.onNotify("已收进记忆卡片。"); await callbacks.current.onRefresh(); } }); }
  async function retryMistakes() {
    if (!attempt || !selectedRetry.length) return;
    const selectedQuestions = attempt.paper.questions.filter(question => selectedRetry.includes(question.id));
    const sections = questionTypes.map(([type]) => { const found = selectedQuestions.filter(question => question.type === type); return { type, count: found.length, points: found[0]?.points || 5, difficulty: "medium" as const, topics: [...new Set(found.map(question => question.topic))] }; }).filter(section => section.count);
    await generate({ courseId: attempt.courseId, title: `${attempt.paper.title.slice(0, 60)} · 错因复练`, sections, durationMinutes: Math.max(5, Math.min(60, selectedQuestions.length * 4)), goal: attempt.paper.goal, focus: selectedQuestions.map(question => question.topic).join("、").slice(0, 500), sourcePolicy: attempt.paper.sourcePolicy, documentIds: attempt.paper.documentIds, retryFrom: { attemptId: attempt.id, questionIds: selectedRetry } });
  }
  function downloadPaper(includeAnswers = false) {
    if (!paper) return;
    const content = [`# ${paper.title}${includeAnswers ? " · 参考解析" : ""}`, "", `${paper.totalQuestions} 题 · ${paper.totalPoints} 分 · ${paper.durationMinutes} 分钟`, "", paper.warning, "", ...paper.questions.flatMap(question => {
      const result = includeAnswers && attempt?.status === "submitted" ? attempt.results?.find(item => item.questionId === question.id) : null;
      return [`## ${question.number}. ${typeName(question.type)}（${question.points} 分）`, question.prompt, ...question.options.map(option => question.type === "true-false" ? option.id === "true" ? "正确" : "错误" : `${option.id}. ${option.text}`), "", ...(result ? [`参考答案：${result.expectedAnswer}`, result.explanation, ...result.steps.map((step, i) => `${i + 1}. ${step}`), ...result.sources.map(source => `来源：${source.documentName} · ${sourcePlace(source)}\n${source.text}`), ""] : [])];
    })].join("\n"); exportText(paper.title + (includeAnswers ? "-参考解析" : "-试卷"), content);
  }
  const currentQuestion = attempt?.paper.questions[Math.min(position, Math.max(0, attempt.paper.questions.length - 1))];
  const isGenerating = !!job && ["queued", "generating"].includes(job.status);
  const isGrading = !!gradingJob && ["queued", "generating"].includes(gradingJob.status);
  const pendingAssessment = attempt?.results?.filter(result => result.earned === null && answered(result.answer) && !result.aiAssessment) || [];
  const recentJob = (library as ExamLibrary & { jobs?: ExamJob[] }).jobs?.[0];
  const remaining = attempt?.deadlineAt ? Math.max(0, Math.ceil((Date.parse(attempt.deadlineAt) - now) / 1000)) : null;
  const expired = remaining === 0 && attempt?.status === "in-progress";
  const autoSubmitted = useRef("");
  useEffect(() => {
    if (!expired || !attempt || autoSubmitted.current === attempt.id || busy) return;
    autoSubmitted.current = attempt.id;
    void submit();
    // The server deadline decides which saved answers count. Failed submission remains retryable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired, attempt?.id, busy]);
  const answeredCount = attempt ? attempt.paper.questions.filter(question => answered(answers[question.id])).length : 0;
  const examDate = course?.examDate ? new Date(`${course.examDate}T00:00:00+08:00`) : null;
  const daysLeft = examDate ? Math.ceil((examDate.getTime() - Date.now()) / 86400000) : null;
  const results = attempt?.results || [];
  const unsavedBackup = attempt?.status === "submitted" ? readLocal<Record<string, ExamAnswer>>(`shifen:exam-unsaved:${attempt.id}`) : null;
  const filteredQuestions = attempt?.paper.questions.filter(question => { const result = results.find(item => item.questionId === question.id); return reportFilter === "all" || reportFilter === "wrong" && (result?.status === "incorrect" || result?.status === "unanswered" || result?.review?.selfAssessment === "incorrect" || result?.review?.selfAssessment === "partial" || result?.aiAssessment?.status === "partial" || result?.aiAssessment?.status === "incorrect") || reportFilter === "pending" && result?.status === "ungraded" && (!result.aiAssessment || result.aiAssessment.status === "ungraded"); }) || [];
  function goToQuestion(index: number) {
    const version = scope.current;
    setPosition(index);
    if (!window.matchMedia("(min-width: 901px)").matches) setAnswerSheetOpen(false);
    requestAnimationFrame(() => {
      if (!valid(version)) return;
      questionRef.current?.focus({ preventScroll: true });
      questionRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  }
  return <section className="exam-studio exam-studio-quiet" aria-label="期末模拟考工作台">
    <header className="es-context"><label><span>当前课程</span><select aria-label="组卷课程" value={courseId} disabled={!!attempt && attempt.status === "in-progress" || !!busy} onChange={event => onCourseChange(event.target.value)}><option value="all">选择一门课程</option>{state.courses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="es-course-context">{course ? <><span>{daysLeft !== null ? daysLeft >= 0 ? `距考试 ${daysLeft} 天` : "考试日期已过，可继续复习" : "考试日期待补充"}</span><span>课程目标 {course.target} 分</span><span>{materials.length} 份资料</span></> : <span>选择课程后，把资料变成一轮可完成的训练。</span>}</div><button className="text-button es-model-button" type="button" onClick={() => setModelOpen(true)}><Sparkle size={17} />{library.configured ? "模型设置" : "连接文字模型"}</button></header>
    {error && <div className="es-feedback is-error" role="alert"><WarningCircle size={20} /><span>{error}</span><button type="button" aria-label="关闭错误提示" onClick={() => setError("")}><X size={18} /></button></div>}
    {notice && <div className={`es-feedback ${noticeTone === "neutral" ? "is-neutral" : ""}`} role="status">{noticeTone === "neutral" ? <FileText size={19} /> : <CheckCircle size={19} />}<span>{notice}</span><button type="button" aria-label="关闭操作提示" onClick={() => setNotice("")}><X size={18} /></button></div>}
    {isGenerating && <section className="es-job" aria-label="试卷生成进度"><div><Sparkle size={24} /><div><strong>正在为这门课组卷</strong><p>{job.message}</p></div><span>{job.completed} / {job.total} 题</span></div><progress max={Math.max(job.total, 1)} value={job.completed} /><footer><span>分批生成并核对来源，完成后自动保存。可以离开页面，稍后继续查看。</span><button className="text-button" type="button" disabled={!!busy} onClick={() => void run("cancel", async version => { const value = await scopedRequest<ExamJob>(`/exams/jobs/${job.id}/cancel`, "POST", {}); if (valid(version)) await observeJob(value, version); })}>取消组卷</button></footer></section>}
    {screen === "home" && <>
      {recentJob && !isGenerating && recentJob.status === "failed" && <div className="es-feedback is-error" role="alert"><WarningCircle size={19} /><span>上次组卷未完成：{recentJob.message}</span><button type="button" className="text-button" onClick={() => openBuilder("custom")}>调整配置重试</button></div>}
      <MockExamHome course={course} library={library} loading={loading} busy={!!busy || isGenerating} materialCount={materials.length} onBuild={openBuilder} onOpenPaper={id => void openPaper(id)} onOpenAttempt={id => void openAttempt(id)} onRefresh={() => void loadLibrary()} />
    </>}
    {screen === "builder" && <div className="es-builder">
      <button className="text-button es-back" type="button" disabled={!!busy} onClick={() => setScreen("home")}><ArrowLeft size={18} />返回我的试卷</button>
      <div className="es-builder-heading"><h2>{builderMode === "template" ? "参照历年真题组卷" : "自定义组卷"}</h2><p>{builderMode === "template" ? "分析原卷，核对结构，再生成仿真新题。" : "确定范围与卷面结构，生成后开始练习。"}</p></div>
      <div className="es-builder-grid"><div className="es-builder-main">
        {builderMode === "template" && <section className="es-panel"><div className="es-panel-heading"><span className="es-step">01</span><div><h3>添加历年真题</h3><p>只选择这门课的试卷，最多 3 份。扫描件将尝试本机 OCR。</p></div></div><input ref={uploadRef} type="file" multiple accept=".pdf,.docx,.pptx" className="es-hidden-input" tabIndex={-1} aria-label="上传历年真题文件" onChange={event => void upload(event.target.files)} /><button className="es-upload secondary" type="button" disabled={!!busy || isGenerating} onClick={() => uploadRef.current?.click()}><UploadSimple size={20} />{busy === "upload" ? "正在读取文件…" : "添加 PDF / Word / PPTX"}</button><div className="es-document-list">{materials.map(doc => <label key={doc.id}><input type="checkbox" checked={pastIds.includes(doc.id)} disabled={!!busy || isGenerating} onChange={event => setPastIds(previous => event.target.checked ? [...previous, doc.id] : previous.filter(id => id !== doc.id))} /><FileText size={18} /><span>{doc.name}</span></label>)}</div><button type="button" className="primary" disabled={!!busy || isGenerating || !library.configured || !pastIds.length || pastIds.length > 3} onClick={() => void analyzeTemplate()}>{busy === "analyze" ? "正在分析题型与方向…" : "分析真题结构"}<ArrowRight size={17} /></button>{library.templates.length > 0 && <details className="es-saved-templates"><summary>使用已保存的模板 · {library.templates.length}</summary>{[...library.templates].reverse().map(item => <button key={item.id} type="button" className="text-button" disabled={!!busy} onClick={() => { setTemplate(item); setTemplateDirty(!item.confirmed); setPastIds(item.documentIds); setDraft(previous => ({ ...previous, sections: item.sections, durationMinutes: item.durationMinutes, focus: item.focus, templateId: item.id })); }}><FileText size={17} />{item.title}<span>{item.confirmed ? "已确认" : "待确认"}</span></button>)}</details>}{template && <div className="es-template-receipt"><CheckCircle size={19} /><div><strong>{template.title}</strong><p>{template.warning || "题型与题量来自已选真题；难度与方向由模型估计，请逐项核对。"}</p>{template.sourceCoverage?.truncated && <p>本次分析抽取 {template.sourceCoverage.sampledChunks} / {template.sourceCoverage.totalChunks} 个资料片段；未完整覆盖原卷，请对照原件确认结构。</p>}<span>{template.confirmed && !templateDirty ? "当前结构已确认" : "当前结构待你确认"}</span></div></div>}</section>}
        <section className="es-panel"><div className="es-panel-heading"><span className="es-step">{builderMode === "template" ? "02" : "01"}</span><div><h3>确定这轮练什么</h3><p>优先使用课程资料；需要补充时，可明确允许 AI 扩展。</p></div></div><div className="es-goal-options" role="group" aria-label="本卷训练目标">{goals.map(([value, label, description]) => <button type="button" aria-pressed={draft.goal === value} disabled={!!busy || isGenerating} className={draft.goal === value ? "is-selected" : ""} key={value} onClick={() => updateDraft({ goal: value, sections: draft.sections.map(section => ({ ...section, difficulty: value === "pass" ? "easy" : value === "excellent" ? section.type === "calculation" || section.type === "short-answer" ? "hard" : "medium" : section.type === "single-choice" ? "easy" : "medium" })) })}><strong>{label}</strong><span>{description}</span></button>)}</div><details className="es-topic-focus"><summary>指定知识点或考察方向（可选）<CaretDown size={16} /></summary><label className="es-field">知识点 / 考察方向<textarea aria-label="组卷知识点" rows={2} maxLength={500} value={draft.focus} disabled={!!busy || isGenerating} placeholder="例如：链式法则、换元积分；重点练公式适用条件" onChange={event => updateDraft({ focus: event.target.value })} /></label></details><div className="es-source-policy"><label><input type="radio" name={`exam-source-${courseId}`} value="materials" checked={draft.sourcePolicy === "materials"} disabled={!!busy || isGenerating} onChange={() => updateDraft({ sourcePolicy: "materials" })} /><span><strong>只依据课程资料</strong><small>每道题保留可核对的原文依据</small></span></label><label><input type="radio" name={`exam-source-${courseId}`} value="extended" checked={draft.sourcePolicy === "extended"} disabled={!!busy || isGenerating} onChange={() => updateDraft({ sourcePolicy: "extended" })} /><span><strong>允许 AI 补充与迁移</strong><small>扩展题单独标记，可能超出老师范围，答案需核对</small></span></label></div><details className="es-material-selector"><summary>选用课程资料 · 已选 {draft.documentIds.length} / {materials.length}</summary><div className="es-document-list">{materials.map(doc => <label key={doc.id}><input type="checkbox" checked={draft.documentIds.includes(doc.id)} disabled={!!busy || isGenerating} onChange={event => updateDraft({ documentIds: event.target.checked ? [...draft.documentIds, doc.id] : draft.documentIds.filter(id => id !== doc.id) })} /><span>{doc.name}</span></label>)}{!materials.length && <p className="es-muted">这门课还没有可读取的资料，可以先在首页导入。</p>}</div></details></section>
        <section className="es-panel"><div className="es-panel-heading"><span className="es-step">{builderMode === "template" ? "03" : "02"}</span><div><h3>安排卷面结构</h3><p>不需要的题型设为 0；每卷 1–100 题。每种题型可以分别设置难度。</p></div></div><SectionEditor sections={draft.sections} disabled={!!busy || isGenerating} onChange={sections => updateDraft({ sections })} />{builderMode === "template" && template && <button type="button" className="secondary es-confirm-template" disabled={!!busy || isGenerating || totalQuestions < 1 || totalQuestions > 100} onClick={() => void confirmTemplate()}><CheckCircle size={19} />{busy === "confirm-template" ? "正在保存模板…" : template.confirmed && !templateDirty ? "模板已确认，可再次保存修改" : "确认当前题型与考察方向"}</button>}</section>
      </div><aside className="es-build-summary"><h3>{builderMode === "template" ? "仿真模拟卷" : "自定义练习卷"}</h3><label className="es-field">试卷名称<input aria-label="试卷名称" maxLength={100} value={draft.title} disabled={!!busy || isGenerating} onChange={event => updateDraft({ title: event.target.value })} /></label><label className="es-field">预计用时<span className="es-time-input"><input type="number" aria-label="练习时长" min={5} max={360} value={draft.durationMinutes} disabled={!!busy || isGenerating} onChange={event => updateDraft({ durationMinutes: Number(event.target.value) })} /><span>分钟</span></span></label><div className="es-total"><div><b>{totalQuestions}</b><span>道题</span></div><div><b>{totalPoints}</b><span>卷面分</span></div></div><ul>{enabledSections.map((section, index) => <li key={index}><span>{typeName(section.type)}</span><strong>{section.count} × {section.points} 分</strong><small>{difficultyName(section.difficulty)}</small></li>)}</ul>{!library.configured && <p className="es-warning-text">先连接文字模型，才能分析真题和生成试卷。</p>}{draftError && <p className="es-validation">{draftError}</p>}<button type="button" className="primary es-generate" disabled={!!busy || isGenerating || !!draftError || !library.configured} onClick={() => void generate()}><Sparkle size={20} />{busy === "generate" || isGenerating ? "组卷处理中…" : "生成这套试卷"}</button><p className="es-disclaimer">试卷生成后先保存，再选择训练或限时模考。仿真题不代表考试预测，难度为估计值。</p></aside></div>
    </div>}
    {screen === "paper" && paper && <div className="es-paper-preview">
      <button type="button" className="text-button es-back" onClick={() => setScreen("home")}><ArrowLeft size={18} />返回我的试卷</button>
      <section className="es-ready">
        <div className="es-ready-heading"><span className="es-ready-icon"><FileText size={25} /></span><div><span className="es-document-state"><CheckCircle size={16} />试卷已保存</span><h2>{paper.title}</h2><p className="es-ready-meta">{paper.totalQuestions} 道题<span>·</span>{paper.totalPoints} 分<span>·</span>{paper.durationMinutes} 分钟</p></div></div>
        <div className="es-ready-sections">{paper.sections.map((section, index) => <span key={index}>{typeName(section.type)} {section.count} 题</span>)}</div>
        <section className="mock-exam-rules" aria-label="开考前说明"><h3>开考前，确认这几件事</h3><ul><li>点击开始后计时，离开或刷新页面不会暂停。</li><li>答案自动保存；网络异常时会保留本机草稿并提示重试。</li><li>模考中隐藏提示，交卷后查看答案与讲评；到时按已保存答案交卷。</li></ul></section>
        <div className="es-start-options"><button className="primary" type="button" disabled={!!busy} onClick={() => void start("exam")}><Clock size={21} /><span>限时模考<small>{paper.durationMinutes} 分钟，交卷后统一复盘</small></span><ArrowRight size={19} /></button><button className="secondary" type="button" disabled={!!busy} onClick={() => void start("practice")}><Lightbulb size={21} /><span>边练边学<small>不计时，需要时展开提示</small></span><ArrowRight size={19} /></button></div>
        <div className="es-ready-tools"><p className="es-disclaimer">{paper.warning}</p><button type="button" className="text-button" onClick={() => downloadPaper()}><DownloadSimple size={18} />下载试卷 · Markdown</button></div>
      </section>
      <details className="es-panel es-question-preview"><summary>预览题面 · 不含答案</summary>{paper.questions.map(question => <article key={question.id}><span>{question.number}. {typeName(question.type)} · {question.points} 分{question.origin === "ai-extension" ? " · AI 扩展" : ""}</span><LessonText text={question.prompt} />{question.options.map(option => <p key={option.id}>{question.type === "true-false" ? option.id === "true" ? "正确" : "错误" : option.id + ". " + option.text}</p>)}</article>)}</details>
    </div>}
    {screen === "attempt" && attempt && paper && attempt.status === "in-progress" && currentQuestion && <div className="es-taking"><div className="es-taking-top"><button type="button" className="text-button" disabled={!!busy || saveState === "saving"} onClick={() => void leaveAttempt()}><ArrowLeft size={18} />保存并返回</button><span className={`es-save-status ${saveState === "error" ? "has-error" : ""}`}>{saveState === "saving" ? "正在保存…" : saveState === "dirty" ? "答案待保存" : saveState === "error" ? "保存未完成" : "答案已保存"}</span>{remaining !== null ? <span className={`es-timer ${remaining < 300 ? "is-urgent" : ""}`}><Clock size={18} />{Math.floor(remaining / 60).toString().padStart(2, "0")}:{(remaining % 60).toString().padStart(2, "0")}</span> : <span className="es-mode-label">边练边学 · 不计时</span>}</div>
      {conflictDraft && <div className="es-feedback is-error" role="alert"><span>本机另有未保存草稿，当前为服务端记录。请核对后决定是否恢复。</span><button type="button" className="text-button" disabled={expired} onClick={restoreConflict}>使用本机草稿继续</button><button type="button" className="text-button" onClick={() => exportText("未保存答卷草稿", JSON.stringify(conflictDraft.answers, null, 2))}>下载草稿备份</button></div>}{saveError && <div className="es-feedback is-error" role="alert"><span>{saveError} 本机草稿仍保留。</span><button className="text-button" type="button" onClick={() => void flushSave()}>重试保存</button><button className="text-button" type="button" onClick={() => void openAttempt(attempt.id)}>读取服务端记录</button></div>}{expired && <div className="es-feedback is-error" role="alert"><Clock size={19} /><span>本轮限时已结束，答案已锁定。正在按限时内保存的答案交卷；若网络异常，可重试交卷。</span></div>}
      <div className="es-taking-grid"><article className="es-question-card" ref={questionRef} tabIndex={-1}><div className="es-question-meta"><span>{typeName(currentQuestion.type)}</span><span>{difficultyName(currentQuestion.difficulty)}</span><span>{currentQuestion.points} 分</span>{currentQuestion.origin === "ai-extension" && <span className="es-ai-label">AI 扩展题</span>}<button type="button" className={flagged.includes(currentQuestion.id) ? "es-flag is-flagged" : "es-flag"} disabled={!!busy || expired} aria-pressed={flagged.includes(currentQuestion.id)} onClick={() => { flagRef.current = flagged.includes(currentQuestion.id) ? flagRef.current.filter(id => id !== currentQuestion.id) : [...flagRef.current, currentQuestion.id]; setFlagged(flagRef.current); queueSave(); }}><Flag size={18} />{flagged.includes(currentQuestion.id) ? "已标记" : "稍后检查"}</button></div><span className="es-question-progress">第 {currentQuestion.number} 题 / 共 {paper.totalQuestions} 题</span><h3><LessonText text={currentQuestion.prompt} inline /></h3>
        {currentQuestion.options.length > 0 ? <div className="es-answer-options" role="group" aria-label="试卷答案选项">{currentQuestion.options.map(option => { const value = answers[currentQuestion.id], selected = Array.isArray(value) ? value.includes(option.id) : value === option.id; return <button key={option.id} type="button" className={selected ? "is-selected" : ""} aria-pressed={selected} disabled={!!busy || expired} onClick={() => changeAnswer(currentQuestion.id, currentQuestion.type === "multiple-choice" ? selected ? (Array.isArray(value) ? value : []).filter(id => id !== option.id) : [...(Array.isArray(value) ? value : []), option.id].sort() : option.id)}><span>{currentQuestion.type === "true-false" ? option.id === "true" ? "✓" : "✗" : option.id}</span><LessonText text={option.text} inline />{selected && <CheckCircle size={20} />}</button>; })}</div> : <label className="es-written-answer">{currentQuestion.type === "fill-blank" ? "填写本题答案" : "写下你的答案与关键步骤"}<textarea aria-label="本题作答" rows={currentQuestion.type === "fill-blank" ? 3 : 7} maxLength={10000} value={typeof answers[currentQuestion.id] === "string" ? answers[currentQuestion.id] as string : ""} disabled={!!busy || expired} onChange={event => changeAnswer(currentQuestion.id, event.target.value)} placeholder={currentQuestion.type === "calculation" ? "可以先在纸上推导，再填写结果、适用条件和关键过程。" : "先独立回想，再提交核对。"} /><span>自动保存 · 交卷后可按评分要点获取AI建议反馈</span></label>}
        {!currentQuestion.options.length && <ExamSubmission key={`${attempt.id}:${currentQuestion.id}`} attemptId={attempt.id} questionId={currentQuestion.id} disabled={!!busy || expired} hasAnswer={answered(answers[currentQuestion.id])} onUse={(text, append) => { const previous = answerRef.current[currentQuestion.id]; const combined = append && typeof previous === "string" && previous.trim() ? `${previous}\n\n${text}` : text; if (combined.length > 10000 || expired || lock.current || attemptRef.current?.status !== "in-progress") return false; changeAnswer(currentQuestion.id, combined); return true; }} />}
        {attempt.mode === "practice" && <div className="es-hint-area"><div><Lightbulb size={19} /><span>卡住了，可以只看一点提示。</span></div><div className="es-hint-buttons">{["给我方向", "提示下一步", "看完整讲解"].map((label, index) => <button className="text-button" type="button" disabled={!!busy || expired} key={label} onClick={() => void showHint(index + 1)}>{busy === "hint" ? "正在读取…" : label}</button>)}</div>{attempt.helpedQuestionIds.includes(currentQuestion.id) && <p className="es-help-note">本题已使用帮助，按辅助练习记录。</p>}{hint?.questionId === currentQuestion.id && <div className="es-hint-content"><LessonText text={hint.text} />{hint.sources.map((source, index) => <div className="es-hint-source" key={index}><span>{source.documentName} · {sourcePlace(source)}</span><blockquote>{source.text}</blockquote><button type="button" className="text-button" onClick={() => void openHintSource(source)}>查看原文<ArrowRight size={15} /></button></div>)}</div>}</div>}
        <div className="es-question-navigation"><button className="secondary" type="button" disabled={position === 0 || !!busy} onClick={() => goToQuestion(position - 1)}><ArrowLeft size={17} />上一题</button>{position < paper.questions.length - 1 ? <button className="primary" type="button" disabled={!!busy} onClick={() => goToQuestion(position + 1)}>下一题<ArrowRight size={17} /></button> : <button className="primary" type="button" disabled={!!busy} onClick={event => { submitTriggerRef.current = event.currentTarget; setConfirmSubmit(true); }}>检查并交卷<CheckCircle size={18} /></button>}</div>
      </article><aside className="es-answer-sheet">
        <button type="button" className="es-sheet-toggle" aria-expanded={answerSheetOpen} aria-controls={"exam-answer-card-" + attempt.id} onClick={() => setAnswerSheetOpen(value => !value)}><span><strong>答题卡</strong><small>{answeredCount} / {paper.totalQuestions} 已答</small></span><CaretDown size={19} /></button>
        <div className="es-answer-body" id={"exam-answer-card-" + attempt.id} hidden={!answerSheetOpen}><div className="es-answer-grid">{paper.questions.map((question, index) => <button key={question.id} type="button" aria-label={"跳到第" + question.number + "题" + (answered(answers[question.id]) ? "，已答" : "，未答")} aria-current={index === position ? "step" : undefined} className={(answered(answers[question.id]) ? "is-answered " : "") + (flagged.includes(question.id) ? "is-flagged" : "")} onClick={() => goToQuestion(index)}>{question.number}{flagged.includes(question.id) && <Flag size={10} weight="fill" />}</button>)}</div><p><span className="es-legend-dot" />已作答 <Flag size={13} />已标记</p></div>
        <button className="primary" type="button" disabled={!!busy} onClick={event => { submitTriggerRef.current = event.currentTarget; setConfirmSubmit(true); }}>交卷并复盘<ArrowRight size={17} /></button><small>{attempt.mode === "exam" ? "限时模考中不展示提示或原文，交卷后再集中核对。" : "先尝试，再按需看提示。辅助完成不视为独立掌握。"}</small></aside></div>
      <Dialog.Root open={confirmSubmit} onOpenChange={value => { if (!busy) setConfirmSubmit(value); }}><Dialog.Portal><Dialog.Overlay className="es-submit-confirm"><Dialog.Content aria-describedby="exam-submit-description" onCloseAutoFocus={event => { event.preventDefault(); if (submitTriggerRef.current?.isConnected) submitTriggerRef.current.focus({ preventScroll: true }); }}><CheckCircle size={30} /><Dialog.Title asChild><h3 id="exam-submit-title">结束这一轮，开始复盘？</h3></Dialog.Title><Dialog.Description asChild><p id="exam-submit-description">已答 {answeredCount} / {paper.totalQuestions} 题{paper.totalQuestions - answeredCount > 0 ? `，还有 ${paper.totalQuestions - answeredCount} 题未答` : ""}{flagged.length ? `，${flagged.length} 题已标记` : ""}。交卷后本轮答案不可修改。</p></Dialog.Description><div><button type="button" className="secondary" disabled={!!busy} onClick={() => setConfirmSubmit(false)}>继续检查</button><button type="button" className="primary" disabled={!!busy} onClick={() => void submit()}>{busy === "submit" ? "正在保存并交卷…" : "确认交卷"}<ArrowRight size={17} /></button></div></Dialog.Content></Dialog.Overlay></Dialog.Portal></Dialog.Root>
    </div>}
    {screen === "attempt" && attempt?.status === "submitted" && paper && <div className="es-report"><div className="es-report-heading"><button className="text-button" type="button" onClick={() => { setScreen("home"); void loadLibrary(); }}><ArrowLeft size={18} />返回我的试卷</button><button className="text-button" type="button" onClick={() => downloadPaper(true)}><DownloadSimple size={18} />下载参考解析</button></div><section className="es-report-summary"><div className="es-report-title"><div><h2>{paper.title}</h2><p>{attempt.summary?.independent ? "本轮独立作答" : "本轮包含辅助或重复练习"} · 作答记录已保存</p></div><span className="es-document-state"><CheckCircle size={16} />已交卷</span></div><div className="es-report-metrics"><div className="es-score"><span>可自动核对的参考得分</span><b>{attempt.summary?.objectiveEarned ?? 0}<small> / {attempt.summary?.objectiveTotal ?? 0}</small></b></div><div className="es-pending-score"><span>待核对分值</span><b>{attempt.summary?.pendingPoints ?? 0}<small> 分</small></b></div><div><span>已作答</span><b>{attempt.summary?.answered ?? 0}<small> / {paper.totalQuestions} 题</small></b></div></div></section>{unsavedBackup && <div className="es-feedback"><span>这轮另有未在限时内保存的本机草稿，未计入成绩。</span><button type="button" className="text-button" onClick={() => exportText("限时未保存草稿", JSON.stringify(unsavedBackup, null, 2))}>下载草稿备份</button></div>}<p className="es-score-note">选择题按已保存答案核对；填空仅在明确匹配时计参考分。简答、计算及未能可靠判定的题保留待核对，AI建议分单独展示，所有结果均不直接更新课程掌握度。</p><section className="es-grading-panel" aria-label="主观作答批改"><div><span className="es-grading-label"><Sparkle size={19} />主观作答反馈</span><h3>{isGrading ? "正在逐题核对" : attempt.summary?.aiAssessedQuestions ? "从错因，回到笔记" : "这次，哪里还没掌握？"}</h3><p>{isGrading ? gradingJob.message : "按固定评分要点核对作答，把遗漏与错误连回对应知识点。"}</p>{!!attempt.summary?.aiAssessedQuestions && <strong className="es-ai-score">AI建议 {attempt.summary.aiSuggestedEarned} / {attempt.summary.aiSuggestedTotal} 分<small> · {attempt.summary.aiAssessedQuestions} 题，需核对</small></strong>}</div><div className="es-grading-actions">{isGrading ? <><progress aria-label="主观批改进度" max={Math.max(gradingJob.total,1)} value={gradingJob.completed} /><span>{gradingJob.completed} / {gradingJob.total} 题</span><button type="button" className="text-button" disabled={!!busy} onClick={() => void cancelGrading()}>取消批改</button></> : <><button type="button" className="primary" disabled={!!busy || !library.configured || !pendingAssessment.length} onClick={() => void grade()}><Sparkle size={18} />{busy === "grade" ? "正在开始…" : pendingAssessment.length ? `批改主观题 · ${Math.min(10,pendingAssessment.length)} 题` : attempt.results?.some(result => result.aiAssessment) ? "本轮反馈已保存" : "暂无待批改作答"}</button><small>建议分独立显示，不改变客观参考分</small></>}</div></section>{!!attempt.summary?.weakTopics?.length && <section className="es-weak-topics" aria-label="本轮薄弱知识点"><h3>建议回看</h3>{attempt.summary.weakTopics.map(topic => <div key={topic.topic}><span><strong>{topic.topic}</strong><small>关联 {topic.questionIds.length} 道题</small></span>{uniqueSourceLocations(topic.sourceRefs).slice(0,2).map((source,index) => <button type="button" className="text-button" key={index} onClick={() => callbacks.current.onOpenSource(source)}>{source.documentName} · {sourcePlace(source)}<ArrowRight size={15} /></button>)}</div>)}</section>}{onOpenPlan && attempt.mode === "exam" && <section className="mock-review-next"><div><h3>把这次发现的薄弱点，放回复习安排</h3><p>规划会参考最近一轮模考的错题与自评，按考试日期和可用时间安排订正。建议分不直接改变课程掌握度。</p></div><button type="button" className="primary" disabled={!!busy || isGrading} onClick={() => onOpenPlan(attempt.courseId)}>查看复习安排<ArrowRight size={17} /></button></section>}<div className="es-report-toolbar"><div role="group" aria-label="复盘筛选">{[["all", "全部题目"], ["wrong", "错题与未答"], ["pending", "待核对"]].map(([value, label]) => <button type="button" aria-pressed={reportFilter === value} className={reportFilter === value ? "is-selected" : ""} key={value} onClick={() => setReportFilter(value as typeof reportFilter)}>{label}</button>)}</div><button type="button" className="primary" disabled={!!busy || isGenerating || !selectedRetry.length || !library.configured} onClick={() => void retryMistakes()}><Sparkle size={17} />生成复练卷{selectedRetry.length ? ` · ${selectedRetry.length} 题` : ""}</button></div><div className="es-review-list">{filteredQuestions.map(question => { const result = results.find(item => item.questionId === question.id); if (!result) return null; const status = result.status === "correct" ? "符合参考答案" : result.status === "incorrect" ? "需要订正" : result.status === "unanswered" ? "未作答" : "待核对"; return <article className={`es-review-question is-${result.status}`} key={question.id}><div className="es-review-meta"><label><input type="checkbox" checked={selectedRetry.includes(question.id)} onChange={event => setSelectedRetry(previous => event.target.checked ? [...previous, question.id] : previous.filter(id => id !== question.id))} />加入复练</label><span>第 {question.number} 题 · {typeName(question.type)}</span><strong>{status}</strong>{result.helpUsed && <span>已用帮助</span>}</div><h3><LessonText text={question.prompt} inline /></h3><div className="es-answer-comparison"><div><span>你的答案</span><LessonText text={readableAnswer(question.type === "true-false" ? result.answer === "true" ? "正确" : result.answer === "false" ? "错误" : result.answer : result.answer)} /></div><div><span>参考答案</span><LessonText text={result.expectedAnswer} /></div></div><p>{result.feedback}</p><ExamAssessment result={result} onOpenSource={source => callbacks.current.onOpenSource(source)} />{result.earned === null && answered(result.answer) && <button type="button" className="text-button es-grade-one" disabled={!!busy || isGrading || !library.configured} onClick={() => void grade([question.id])}><Sparkle size={17} />{result.aiAssessment ? "重新核对本题作答" : "批改本题作答"}</button>}<details className="es-review-explanation" open={result.status === "incorrect"}><summary>查看讲解与得分要点</summary><LessonText text={result.explanation} />{result.steps.length > 0 && <ol>{result.steps.map((step, index) => <li key={index}><LessonText text={step} inline /></li>)}</ol>}<div className="es-rubric"><strong>核对要点</strong><LessonText text={result.rubric} /></div></details><div className="es-review-controls">{(question.type === "short-answer" || question.type === "calculation" || result.status === "ungraded") && <label>对照要点自评<select aria-label={`第${question.number}题自评`} value={result.review?.selfAssessment || ""} disabled={!!busy || isGrading} onChange={event => { if (event.target.value) void review(question.id, { selfAssessment: event.target.value as ExamReview["selfAssessment"] }); }}><option value="">尚未确认</option><option value="correct">关键点已答出</option><option value="partial">部分答出，仍有遗漏</option><option value="incorrect">需要重新学习</option></select></label>}<label>主要卡点<select aria-label={`第${question.number}题错因`} value={result.review?.reason || ""} disabled={!!busy || isGrading} onChange={event => { if (event.target.value) void review(question.id, { reason: event.target.value as ExamReview["reason"] }); }}><option value="">选择一个错因</option>{reasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button type="button" className="text-button" disabled={!!busy || savedCards.includes(question.id) || existingCard(question, result, paper.courseId) || cardTooLong(question, result)} onClick={() => void saveCard(question, result)}><Plus size={17} />{savedCards.includes(question.id) || existingCard(question, result, paper.courseId) ? "已收进记忆卡" : cardTooLong(question, result) ? "内容较长，请分段制作记忆卡" : "收进记忆卡"}</button></div>{result.sources.length > 0 && <details className="es-review-sources"><summary>核对原文依据 · {result.sources.length} 处</summary>{result.sources.map((source, index) => <article key={index}><strong>{source.documentName}</strong><span>{sourcePlace(source)}</span><blockquote>{source.text}</blockquote><button type="button" className="text-button" onClick={() => callbacks.current.onOpenSource(source)}>查看原文<ArrowRight size={15} /></button></article>)}</details>}{question.origin === "ai-extension" && <p className="es-warning-text">AI 扩展题，请自行核对是否属于本课考试范围。</p>}</article>; })}{!filteredQuestions.length && <div className="es-empty"><CheckCircle size={29} /><h3>当前筛选下没有题目</h3><p>可切回全部题目，继续核对答案与思路。</p></div>}</div></div>}
    <ModelSettings open={modelOpen} onOpenChange={setModelOpen} onConnected={async () => { await loadLibrary(); await callbacks.current.onRefresh(); }} />
  </section>;
}
