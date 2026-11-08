import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent, ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp, BookOpen, ChatCircle, Check, CheckCircle, CircleNotch, ClipboardText, FilePdf, FilePpt, FileText, FolderSimple, ImageSquare, MagnifyingGlass, NotePencil, Paperclip, Plus, Stop, DotsThree, Trash, X } from "@phosphor-icons/react";
import { api } from "./api";
import CourseWorkspace from "./CourseWorkspace";
import type { CourseWorkspaceProps } from "./CourseWorkspace";
import type { Doc } from "./types";
import type { StudioArtifact, StudioJob, StudioMessage, StudioPaper, StudioSource, StudioState } from "./course-studio-types";
import "./course-studio.css";
import StudyDocumentReader from "./StudyDocumentReader";
import DiscoveryPanel from "./DiscoveryPanel";
import "./course-studio-orbit.css";

const LessonText = lazy(() => import("./LessonText"));
const DRAG_TYPE = "application/x-shifen-documents";
const NOTE_PROMPT = "请把所选资料整理为一份详细、完整的期末复习笔记：合并重复知识点，保留定义、适用条件、公式、推导和例题，按知识结构组织，标出来源。不同资料有冲突或疑似错误时单独指出，不要直接删去。";
const REVIEW_PROMPT = "请复用所选资料生成一份可直接执行的复习资料，按知识依赖组织概念、公式条件、典型方法、易错点和回忆自测，保留真实来源。";
const CHECKLIST_PROMPT = "请把所选资料整理成可逐项勾选的考点清单，覆盖定义、适用条件、公式、解题方法和易错点，不断言必考，保留真实来源。";
type Mode = "notes" | "review" | "exam-checklist" | "chat" | "practice" | "revise";
type RetryMode = Exclude<Mode, "practice" | "revise">;
type Pane = "sources" | "chat" | "artifacts";
type Props = CourseWorkspaceProps & { onPracticeSources?: (documentIds: string[]) => void; onOpenPaper?: (paperId: string) => void; refreshKey?: number; onOpenModelSettings?: () => void; onAddHandwriting?: () => void };
const liveJob = (job: StudioJob | null | undefined) => !!job && ["queued", "running"].includes(job.status);
const isNote = (doc: Doc) => doc.origin?.kind === "ai-notes" || !!doc.origin?.kind.includes("lecture") || !!doc.sourceLessonId;
const day = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : `${date.getMonth() + 1}月${date.getDate()}日`; };
const sourceLocation = (source: StudioSource) => source.locationKind === "section" ? "段" : source.locationKind === "slide" || /\.pptx?$/i.test(source.documentName) ? "张" : "页";
const displayName = (doc: Doc) => isNote(doc) ? doc.name.replace(/\.md$/i, "") : doc.name;
function iconFor(doc: Doc) { if (isNote(doc)) return FilePdf; return /PNG|JPG|JPEG|WEBP/i.test(doc.type) ? ImageSquare : /PDF/i.test(doc.type) ? FilePdf : /PPT/i.test(doc.type) ? FilePpt : FileText; }
function originLabel(doc: Doc) { return doc.origin?.kind === "ai-notes" ? "复习讲义 · PDF / Word" : doc.origin?.kind === "discovered" ? "自动检索资料" : doc.origin?.kind.includes("lecture") || doc.sourceLessonId ? "网课讲义 · PDF / Word" : doc.isDemo ? `${doc.type} · 示例` : doc.type; }

function MathContent({ text, inline = false }: { text: string; inline?: boolean }) {
  // In study notes, a closed numeric math token is a formula rather than money.
  // Keep inline code literal and leave the shared renderer's currency rules alone.
  const mathText = text.split(/(`[^`]*`)/g).map(part => part.startsWith("`") ? part : part.replace(/(?<![\\$])\$([+-]?(?:\d+(?:\.\d+)?|\.\d+))\$(?!\$)/g, (_token, number: string) => `\\(${number}\\)`)).join("");
  return <Suspense fallback={<span className="cs-text-fallback">{text}</span>}><LessonText text={mathText} inline={inline} /></Suspense>;
}

/** Small escaped Markdown subset: model prose never becomes HTML or remote media. */
function NoteBody({ body, sources = [], onSource }: { body: string; sources?: StudioSource[]; onSource?: (source: StudioSource) => void }) {
  function prose(text: string): ReactNode {
    const parts = text.split(/(\[来源\s*[^\]]+\])/g);
    return parts.map((part, index) => {
      if (!part.startsWith("[来源")) return <span key={index}>{part.split(/(\*\*[^*\n]+\*\*)/g).map((piece, i) => piece.startsWith("**") && piece.endsWith("**") ? <strong key={i}><MathContent text={piece.slice(2, -2)} inline /></strong> : <MathContent key={i} text={piece} inline />)}</span>;
      const ids = part.match(/s\d+/g) || [];
      const resolved = ids.map(id => sources.find(source => source.id === id)).filter((source): source is StudioSource => !!source);
      return resolved.length && onSource ? <span className="cs-inline-citations" key={index}>{resolved.map(source => <button type="button" key={source.id} title={`${source.documentName} · 第${source.page}${sourceLocation(source)}`} aria-label={`查看来源：${source.documentName}，第${source.page}${sourceLocation(source)}`} onClick={() => onSource(source)}>{source.id.replace(/^s/, "")}</button>)}</span> : <span className="cs-unlinked-citation" key={index}>{part}</span>;
    });
  }
  const lines = body.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [], bullet: string[] = [], number: string[] = [], code: string[] | null = null, displayMath: string[] | null = null;
  function flush() {
    if (paragraph.length) { blocks.push(<p key={`p-${blocks.length}`}>{prose(paragraph.join("\n"))}</p>); paragraph = []; }
    if (bullet.length) { blocks.push(<ul key={`ul-${blocks.length}`}>{bullet.map((line, i) => <li key={i}>{prose(line)}</li>)}</ul>); bullet = []; }
    if (number.length) { blocks.push(<ol key={`ol-${blocks.length}`}>{number.map((line, i) => <li key={i}>{prose(line)}</li>)}</ol>); number = []; }
  }
  for (const line of lines) {
    if (code !== null) { if (/^\s*```/.test(line)) { blocks.push(<pre key={`code-${blocks.length}`}><code>{code.join("\n")}</code></pre>); code = null; } else code.push(line); continue; }
    if (displayMath !== null) { displayMath.push(line); if (/\$\$|\\\]/.test(line)) { blocks.push(<MathContent key={`math-${blocks.length}`} text={displayMath.join("\n")} />); displayMath = null; } continue; }
    if (/^\s*```/.test(line)) { flush(); code = []; continue; }
    if (/^\s*(\$\$|\\\[)\s*$/.test(line)) { flush(); displayMath = [line]; continue; }
    if (!line.trim()) { flush(); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { flush(); const Tag = heading[1].length <= 2 ? "h3" : "h4"; blocks.push(<Tag key={`h-${blocks.length}`}>{prose(heading[2])}</Tag>); continue; }
    if (/^\s*[-*_]{3,}\s*$/.test(line)) { flush(); blocks.push(<hr key={`hr-${blocks.length}`} />); continue; }
    const ul = line.match(/^\s*[-*+]\s+(.+)$/);
    if (ul) { if (paragraph.length || number.length) flush(); bullet.push(ul[1]); continue; }
    const ol = line.match(/^\s*\d+[.)、]\s+(.+)$/);
    if (ol) { if (paragraph.length || bullet.length) flush(); number.push(ol[1]); continue; }
    if (bullet.length || number.length) flush();
    paragraph.push(line.replace(/^>\s?/, ""));
  }
  flush();
  if (code) blocks.push(<pre key="unfinished-code"><code>{code.join("\n")}</code></pre>);
  if (displayMath) blocks.push(<MathContent key="unfinished-math" text={displayMath.join("\n")} />);
  return <div className="cs-note-body">{blocks}</div>;
}

function SourceDialog({ props, source }: { props: Props; source: StudioSource | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => props.onSelectDocument(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element || !props.selectedDoc) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => { element.close(); previous?.focus(); };
  }, [props.selectedDoc?.id]);
  useEffect(() => {
    if (!source || source.documentId !== props.selectedDoc?.id) return;
    const timer = window.setTimeout(() => {
      const anchors = dialog.current?.querySelectorAll<HTMLElement>("[data-chunk-id],[data-source-page]");
      const target = [...anchors || []].find(node => node.dataset.chunkId === source.chunkId) || [...anchors || []].find(node => node.dataset.sourcePage === String(source.page));
      target?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      target?.focus({ preventScroll: true });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [source, props.selectedDoc?.id]);
  if (!props.selectedDoc) return null;
  return <dialog ref={dialog} className="cs-source-dialog" aria-label={`阅读原文：${props.selectedDoc.name}`} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="cs-source-dialog-head"><span><BookOpen size={18} />资料原文</span><button type="button" className="cs-icon-button" aria-label="关闭原文" onClick={close}><X size={22} /></button></div>
    <CourseWorkspace {...props} />
  </dialog>;
}

export default function CourseStudio(props: Props) {
  if (!props.course) return <CourseWorkspace {...props} />;
  return <Studio key={props.course.id} {...props} />;
}

function Studio(props: Props) {
  const { course, documents, onNotify, onRefresh, onPracticeSources, onOpenPaper } = props;
  const courseId = course!.id;
  const [studio, setStudio] = useState<StudioState>({ messages: [], artifacts: [], configured: props.providerConfigured, jobs: [] });
  const [papers, setPapers] = useState<StudioPaper[]>([]);
  const [paperError, setPaperError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "notes">("all");
  const [mode, setMode] = useState<Mode>("notes");
  const [prompt, setPrompt] = useState("");
  const [revisionTarget, setRevisionTarget] = useState<StudioArtifact | null>(null);
  const [pane, setPane] = useState<Pane>("chat");
  const [artifactTab, setArtifactTab] = useState<"notes" | "papers">("notes");
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [lectureReader, setLectureReader] = useState<{ id: string; title: string } | null>(null);
  const [job, setJob] = useState<StudioJob | null>(null);
  const retryMessage = job && ["failed", "cancelled"].includes(job.status)
    ? studio.messages.filter(message => message.role === "user" && message.jobId === job.id).at(-1) || studio.messages.filter(message => message.role === "user").at(-1)
    : undefined;
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [pollRun, setPollRun] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [readerSource, setReaderSource] = useState<StudioSource | null>(null);
  const [newMessages, setNewMessages] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const chat = useRef<HTMLDivElement>(null);
  const [sourcesOpen, setSourcesOpen] = useState(() => window.matchMedia("(min-width: 1250px)").matches);
  const [outputsOpen, setOutputsOpen] = useState(false);
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 951px)").matches);
  const outputShelf = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const lastRequest = useRef(0);
  const chatNearEnd = useRef(true);
  const previousRefresh = useRef(props.refreshKey);
  const tabsId = useId();
  const sourceKey = documents.map(doc => `${doc.id}:${doc.recognition?.revision ?? 0}`).join("|");
  const currentDocuments = useMemo(() => new Map(documents.map(doc => [doc.id, doc])), [documents]);
  const selectedDocs = selected.map(id => currentDocuments.get(id)).filter((doc): doc is Doc => !!doc);
  const matches = documents.filter(doc => (!query.trim() || doc.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && (sourceFilter === "all" || isNote(doc)));
  const artifact = studio.artifacts.find(item => item.id === artifactId) || studio.artifacts.at(-1) || null;
  const active = liveJob(job);
  const working = active || posting;
  const allSelected = matches.length > 0 && matches.every(doc => selected.includes(doc.id));


  useEffect(() => { const media = window.matchMedia("(min-width: 951px)"); const update = () => setWide(media.matches); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  useEffect(() => {
    if (!outputsOpen || !wide) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = outputShelf.current;
    node?.querySelector<HTMLElement>("button")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") { event.preventDefault(); setOutputsOpen(false); }
      if (event.key !== "Tab" || !node) return;
      const targets = [...node.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(item => item.getClientRects().length);
      const first = targets[0], last = targets.at(-1);
      if (event.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { document.removeEventListener("keydown", trap); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [outputsOpen, wide]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; lastRequest.current++; }; }, []);
  const reload = useCallback(async (restoreJob = false) => {
    const token = ++lastRequest.current;
    const result = await api<StudioState>(`/course-studio?courseId=${encodeURIComponent(courseId)}`);
    if (!mounted.current || token !== lastRequest.current) return;
    setStudio(result); setError(""); setLoadFailed(false);
    if (restoreJob) {
      const latest = result.jobs.at(-1);
      setJob(result.jobs.find(item => liveJob(item)) || (latest && ["failed", "cancelled"].includes(latest.status) ? latest : null));
    }
    try { const exams = await api<{ papers: StudioPaper[] }>(`/exams?courseId=${encodeURIComponent(courseId)}`); if (mounted.current && token === lastRequest.current) { setPapers(exams.papers); setPaperError(""); } }
    catch (cause) { if (mounted.current && token === lastRequest.current) setPaperError(cause instanceof Error ? cause.message : "练习卷暂未加载。"); }
  }, [courseId]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    void reload(true).catch(cause => { if (current) { setLoadFailed(true); setError(cause instanceof Error ? cause.message : "工作台暂未加载，请重试。"); } }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [reload]);
  useEffect(() => {
    if (previousRefresh.current === props.refreshKey) return;
    previousRefresh.current = props.refreshKey;
    void reload().then(() => { if (mounted.current) { setArtifactTab("papers"); setPane("artifacts"); } }).catch(cause => { if (mounted.current) setError(cause instanceof Error ? cause.message : "产物列表暂未刷新。"); });
  }, [props.refreshKey, reload]);
  useEffect(() => { setSelected(ids => ids.filter(id => currentDocuments.has(id))); }, [sourceKey, currentDocuments]);
  useEffect(() => { setStudio(previous => ({ ...previous, configured: props.providerConfigured })); }, [props.providerConfigured]);
  useEffect(() => {
    if (!liveJob(job)) return;
    let cancelled = false, timer = 0, failures = 0;
    const id = job!.id;
    async function poll() {
      try {
        const result = await api<StudioJob>(`/course-studio/jobs/${encodeURIComponent(id)}`);
        if (cancelled || !mounted.current) return;
        failures = 0; setPollError("");
        if (liveJob(result)) { setJob(result); timer = window.setTimeout(() => void poll(), 1400); return; }
        await reload();
        if (cancelled || !mounted.current) return;
        if (result.status === "completed") {
          if (result.artifactId) { setArtifactId(result.artifactId); setArtifactTab("notes"); onNotify("学习产物已保存到 Output 和右侧成稿架，也可以继续拿来练习。"); }
          try { await onRefresh?.(); } catch { if (mounted.current) onNotify("内容已保存，课程资料暂未刷新，请重新进入课程查看。"); }
        }
        if (!cancelled && mounted.current) setJob(result);
      } catch (cause) {
        if (cancelled || !mounted.current) return;
        failures++;
        if (failures < 3) timer = window.setTimeout(() => void poll(), 1800);
        else setPollError(cause instanceof Error ? cause.message : "任务状态暂未连上，请重新检查。");
      }
    }
    timer = window.setTimeout(() => void poll(), 500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [job?.id, job?.status, pollRun, reload]);
  useEffect(() => {
    if (loading || !chat.current) return;
    if (!studio.messages.length) { chat.current.scrollTop = 0; setNewMessages(false); return; }
    if (chatNearEnd.current) chat.current.scrollTop = chat.current.scrollHeight;
    else setNewMessages(true);
  }, [studio.messages.length, loading]);


  function addSources(ids: string[], focus = false) {
    const valid = ids.filter(id => currentDocuments.has(id));
    const next = [...new Set([...selected, ...valid])];
    if (next.length > 20) { onNotify("一次最多使用20份资料，请分批整理。"); return; }
    setSelected(next);
    if (focus) { setPane("chat"); textArea.current?.focus(); }
  }
  function toggleSource(id: string) { if (selected.includes(id)) setSelected(ids => ids.filter(item => item !== id)); else addSources([id]); }
  function selectAll() {
    if (allSelected) setSelected(ids => ids.filter(id => !matches.some(doc => doc.id === id)));
    else addSources(matches.map(doc => doc.id));
  }
  function startDrag(event: DragEvent<HTMLElement>, doc: Doc) {
    if (working || (event.target instanceof Element && event.target.closest("input,select,summary,details"))) { event.preventDefault(); return; }
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ courseId, documentIds: selected.includes(doc.id) ? selected : [doc.id] }));
    event.dataTransfer.effectAllowed = "copy";
  }
  function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault(); setDragging(false);
    if (working) return;
    try {
      const payload = JSON.parse(event.dataTransfer.getData(DRAG_TYPE));
      if (payload.courseId !== courseId || !Array.isArray(payload.documentIds) || !payload.documentIds.every((id: unknown) => typeof id === "string")) throw new Error();
      addSources(payload.documentIds, true);
      onNotify(`已将资料加入本次对话。`);
    } catch { onNotify("请先把文件加入左侧资料，再选择或拖到对话里。"); }
  }
  function prepare(next: Mode) {
    setMode(next); setRevisionTarget(null); setError(""); setPane("chat");
    if (next === "notes") setPrompt(NOTE_PROMPT);
    if (next === "review") setPrompt(REVIEW_PROMPT);
    if (next === "exam-checklist") setPrompt(CHECKLIST_PROMPT);
    if (next === "practice" || next === "chat") setPrompt("");
    window.requestAnimationFrame(() => textArea.current?.focus());
  }
  function openPractice(ids: string[]) {
    setArtifactTab("papers");
    (onPracticeSources || (() => props.onPractice()))(ids);
  }
  function revise(item: StudioArtifact) {
    setRevisionTarget(item); setMode("revise"); setPrompt(""); setPane("chat"); setOutputsOpen(false);
    setSelected(item.sourceDocumentIds.filter(id => currentDocuments.has(id)));
    window.requestAnimationFrame(() => textArea.current?.focus());
  }
  async function submit(event: FormEvent, retry?: { action: RetryMode; prompt: string; documentIds: string[] }) {
    event.preventDefault();
    if (submitting.current || working) return;
    const action = retry?.action || mode;
    const documentIds = retry ? retry.documentIds.filter(id => currentDocuments.has(id)) : selectedDocs.map(doc => doc.id);
    if (retry && documentIds.length !== retry.documentIds.length) { setError("上次使用的资料已变化，请重新选择后发送。"); setPane("sources"); return; }
    if (!documentIds.length && action !== "revise") { setError("先从资料区选择本次要用的资料。"); setPane("sources"); return; }
    if (action === "practice") { openPractice(documentIds); return; }
    if (!studio.configured) { setError("请先在模型设置中连接文字模型。"); return; }
    const instruction = retry?.prompt || prompt.trim() || (action === "notes" ? NOTE_PROMPT : action === "review" ? REVIEW_PROMPT : action === "exam-checklist" ? CHECKLIST_PROMPT : "");
    if (!instruction) { setError(action === "revise" ? "写下你想修正或补充的内容。" : "写下你想问的问题。"); textArea.current?.focus(); return; }
    submitting.current = true; setPosting(true); setError(""); setPollError("");
    try {
      const result = await api<StudioJob>("/course-studio/jobs", "POST", { courseId, documentIds, prompt: instruction, action, ...(!retry && revisionTarget ? { artifactId: revisionTarget.id } : {}) });
      if (!mounted.current) return;
      setJob(result); setPrompt(""); setRevisionTarget(null); if (retry) { setMode(retry.action); setSelected(documentIds); } else if (mode === "revise") setMode("notes");
      await reload();
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "本次没有开始，请重试。"); }
    finally { if (mounted.current) { setPosting(false); submitting.current = false; } }
  }
  async function cancelJob() {
    if (!job || !active) return;
    try { const result = await api<StudioJob>(`/course-studio/jobs/${encodeURIComponent(job.id)}`, "DELETE"); if (mounted.current) { setJob(result); await reload(); } }
    catch (cause) { if (mounted.current) setPollError(cause instanceof Error ? cause.message : "取消暂未完成，请重试。"); }
  }
  function openSource(source: StudioSource) {
    const doc = currentDocuments.get(source.documentId);
    if (!doc) { onNotify("这份来源已移走或删除，请回到资料列表核对。"); return; }
    setExpanded(false); setReaderSource(source); props.onSelectDocument(doc);
  }
  function previewDoc(doc: Doc) {
    const generated = studio.artifacts.find(item => item.documentId === doc.id);
    if (generated) { setArtifactId(generated.id); setArtifactTab("notes"); setExpanded(true); }
    else if (doc.sourceLessonId || doc.origin?.lessonId) { setLectureReader({ id: doc.sourceLessonId || doc.origin!.lessonId!, title: displayName(doc) }); }
    else { setReaderSource(null); props.onSelectDocument(doc); }
  }
  function latest() { if (chat.current) chat.current.scrollTop = chat.current.scrollHeight; chatNearEnd.current = true; setNewMessages(false); }
  async function importedDiscovery(doc: Doc) {
    setDiscoveryOpen(false);
    setSelected([doc.id]);
    try { await onRefresh?.(); } catch { onNotify("起步资料已保存，课程资料列表暂未刷新。"); }
    props.onSelectDocument(doc);
    setPane("chat");
  }
  function messageView(message: StudioMessage) {
    const result = studio.artifacts.find(item => item.id === message.artifactId);
    return <article key={message.id} className={`cs-message cs-message-${message.role}`}><div className="cs-message-meta"><span className={`cs-avatar ${message.role === "assistant" ? "cs-avatar-tutor" : ""}`}>{message.role === "assistant" ? <span aria-hidden="true">考</span> : "我"}</span><strong>{message.role === "assistant" ? "考谱" : "你"}</strong><time dateTime={message.createdAt}>{day(message.createdAt)}</time></div><div className="cs-message-content">{!message.artifactId && <NoteBody body={message.content} sources={message.sourceRefs} onSource={openSource} />}{message.documentIds?.length && !message.artifactId ? <div className="cs-message-sources">{message.documentIds.map(id => <span key={id}><Paperclip size={12} />{currentDocuments.get(id)?.name || "原资料已移走"}</span>)}</div> : null}{message.artifactId && <button type="button" className="cs-message-artifact" onClick={() => { setArtifactId(message.artifactId!); setArtifactTab("notes"); setExpanded(true); }}><span className="cs-result-cover" aria-hidden="true"><span>KAOPU<br />STUDY NOTES</span><BookOpen size={27} weight="light" /><i /></span><span className="cs-result-info"><span className="cs-result-status"><CheckCircle size={14} weight="fill" />讲义已就绪</span><strong>{result?.title || "复习讲义"}</strong><small>{result ? `${result.sourceDocumentIds.length} 份来源 · 第 ${result.revision} 版 · ` : ""}PDF / Word</small><span className="cs-result-read">打开复习讲义 <ArrowRight size={16} /></span></span></button>}</div></article>;
  }


  return <section className="course-studio course-studio-orbit" aria-label={`${course!.name}学习工作台`}>
    <div className="cs-workbench-bar"><span className="cs-workbench-label"><span className="cs-workbench-emblem" aria-hidden="true"><i /><i /><i /></span>课程工作台</span><span className="cs-workbench-flow"><span>资料</span><ArrowRight size={12} /><span>对话</span><ArrowRight size={12} /><span>产物</span></span><div className="cs-layout-toggles" role="group" aria-label="工作台布局"><button type="button" aria-expanded={sourcesOpen} onClick={() => setSourcesOpen(value => !value)}><FolderSimple size={16} />资料</button><button type="button" aria-expanded={outputsOpen} onClick={() => setOutputsOpen(value => !value)}><NotePencil size={16} />产物</button></div></div>
    <div className="cs-mobile-tabs" role="tablist" aria-label="工作台区域">{([{id:"sources",label:"资料",icon:FolderSimple,count:documents.length},{id:"chat",label:"对话",icon:ChatCircle},{id:"artifacts",label:"产物",icon:NotePencil,count:studio.artifacts.length+papers.length}] as const).map(tab => <button type="button" key={tab.id} role="tab" id={`${tabsId}-${tab.id}-tab`} aria-controls={`${tabsId}-${tab.id}`} aria-selected={pane === tab.id} onClick={() => setPane(tab.id)}><tab.icon size={18} />{tab.label}{"count" in tab && <small>{tab.count}</small>}</button>)}</div>
    <div className="cs-columns" data-pane={pane} data-sources={sourcesOpen} data-outputs={outputsOpen}>
      <aside className="cs-sources cs-pane" id={`${tabsId}-sources`} aria-label="课程资料">
        <div className="cs-pane-heading"><h2><FolderSimple size={18} />资料<span>{documents.length}</span></h2><div className="cs-source-add-actions">{props.onAddHandwriting && <button type="button" className="cs-icon-button" aria-label="上传手写笔记" title="上传手写笔记照片或扫描PDF" onClick={props.onAddHandwriting}><ImageSquare size={18} /></button>}<button type="button" className="cs-icon-button cs-add" aria-label="添加课程资料" onClick={props.onAdd}><Plus size={19} /></button></div></div>
        <label className="cs-search"><MagnifyingGlass size={16} /><input aria-label="搜索工作台资料" placeholder="搜索资料" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="清空资料搜索" onClick={() => setQuery("")}><X size={14} /></button>}</label>
        <div className="cs-source-toolbar"><div className="cs-source-filters"><button type="button" aria-pressed={sourceFilter === "all"} onClick={() => setSourceFilter("all")}>全部</button><button type="button" aria-pressed={sourceFilter === "notes"} onClick={() => setSourceFilter("notes")}>笔记<span>{documents.filter(isNote).length}</span></button></div><button type="button" className="cs-select-all" disabled={!matches.length || working} onClick={selectAll}>{allSelected ? "取消全选" : "全选"}</button></div>
        <div className="cs-file-list">{matches.map(doc => { const Icon = iconFor(doc); return <article className={`cs-source-row ${selected.includes(doc.id) ? "is-selected" : ""}`} key={doc.id} draggable={!working} onDragStart={event => startDrag(event, doc)} title="勾选或拖到中间对话"><label className="cs-source-checkbox"><input type="checkbox" aria-label={`选择${doc.name}`} checked={selected.includes(doc.id)} disabled={working} onChange={() => toggleSource(doc.id)} /><span><Check size={12} weight="bold" /></span></label><button type="button" className="cs-source-preview" aria-label={`预览${doc.name}`} onClick={() => previewDoc(doc)}><span className={`cs-file-icon ${isNote(doc) ? "is-note" : doc.type.toLowerCase()}`}><Icon size={20} weight="duotone" /></span><span><strong>{displayName(doc)}</strong><small>{originLabel(doc)}{doc.recognition?.needsReview ? " · 待校对" : ""}</small></span></button><details className="cs-source-more"><summary aria-label={`管理${doc.name}`}><DotsThree size={19} /></summary><div><label>课程归属<select aria-label={`调整${doc.name}的学科`} value={doc.courseId} disabled={props.busy} onChange={event => { void props.onAssign(doc,event.target.value).catch(cause => onNotify(cause instanceof Error ? cause.message : "课程归属未保存。")); }}>{props.courses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="__new__">新建学科…</option></select></label><button type="button" disabled={props.busy} onClick={() => props.onDelete(doc)}><Trash size={14} />删除资料</button></div></details></article>; })}{!matches.length && <div className="cs-source-empty"><FolderSimple size={30} weight="light" /><p>{query ? "没找到这份资料" : sourceFilter === "notes" ? "整理好的笔记会出现在这里" : "先放入这门课的资料"}</p>{!documents.length && <div className="cs-source-empty-actions"><button type="button" onClick={props.onAdd}><Plus size={15} />添加资料</button><button type="button" className="cs-discovery-entry" onClick={() => setDiscoveryOpen(true)}><MagnifyingGlass size={15} />没有资料？自动找起步资料</button></div>}</div>}</div>
        <div className="cs-sources-foot"><span>{selectedDocs.length ? <><CheckCircle size={15} />已选 {selectedDocs.length} 份</> : <><Paperclip size={15} />勾选或拖入对话</>}</span>{selectedDocs.length > 0 && <button type="button" onClick={() => { setPane("chat"); textArea.current?.focus(); }}>去对话 <ArrowRight size={14} /></button>}</div>
      </aside>

      <section className={`cs-conversation cs-pane ${dragging ? "is-dragging" : ""}`} id={`${tabsId}-chat`} aria-label="课程AI对话" onDragOver={event => { event.preventDefault(); if (event.dataTransfer.types.includes(DRAG_TYPE) && !working) { event.dataTransfer.dropEffect = "copy"; setDragging(true); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={drop}>
        <div className="cs-pane-heading"><h2><ChatCircle size={19} />对话</h2><span className="cs-assistant-status"><span className={studio.configured ? "is-ready" : ""} />{studio.configured ? "基于本课资料" : "尚未连接模型"}</span></div>
        <div ref={chat} className="cs-chat-scroll" onScroll={() => { if (chat.current) { chatNearEnd.current = chat.current.scrollHeight - chat.current.scrollTop - chat.current.clientHeight < 90; if (chatNearEnd.current) setNewMessages(false); } }}>
          {loading ? <div className="cs-loading"><CircleNotch size={21} className="cs-spin" />正在打开工作台</div> : !studio.messages.length ? <div className="cs-chat-empty"><div className="cs-paper-illustration" aria-hidden="true"><span className="cs-sketch-sheet cs-sketch-back"><i /><i /><i /></span><span className="cs-sketch-sheet cs-sketch-front"><span>考谱 · NOTES</span><i /><i /><i /><i /><b><Check size={17} weight="bold" /></b></span><span className="cs-sketch-cross">+</span></div><h2>把知识收拢，<br />把重点留下。</h2><p>选好课程资料，告诉我你想做什么。</p><div className="cs-start-actions"><button type="button" onClick={() => prepare("notes")}><NotePencil size={19} /><span>合并成复习笔记</span><ArrowRight size={16} /></button><button type="button" onClick={() => prepare("practice")}><ClipboardText size={19} /><span>出一组题，练练手</span><ArrowRight size={16} /></button><button type="button" onClick={() => prepare("chat")}><ChatCircle size={19} /><span>问问没弄懂的地方</span><ArrowRight size={16} /></button></div><button type="button" className="cs-chat-discovery" onClick={() => setDiscoveryOpen(true)}><MagnifyingGlass size={16} /><span>还没有资料？先找一份起步资料</span><ArrowRight size={15} /></button></div> : <div className="cs-messages">{studio.messages.map(messageView)}</div>}
          {job && job.status !== "completed" && <div className={`cs-job cs-job-${job.status}`} role="status" aria-live="polite"><span className="cs-job-icon">{active ? <CircleNotch size={18} className="cs-spin" /> : <Stop size={17} />}</span><div><strong>{job.status === "cancelled" ? "已停止本次任务" : job.status === "failed" ? "本次还没完成" : job.message || "正在读取所选资料"}</strong>{job.status === "failed" ? <p>{job.error || job.message || "请检查连接后重新发送，已发送的指令仍会保留。"}</p> : active && (job.total || 0) > 0 ? <small>{job.completed || 0} / {job.total} 个处理阶段</small> : null}</div>{!active && job.action !== "revise" && retryMessage && <button type="button" className="secondary" disabled={working} onClick={event => void submit(event, { action: (job.action || "notes") as RetryMode, prompt: retryMessage.content, documentIds: job.documentIds || retryMessage.documentIds || [] })}>{job.action === "chat" ? "重新提问" : "重新整理"}</button>}{active && <button type="button" className="cs-icon-button" aria-label="停止当前任务" onClick={() => void cancelJob()}><Stop size={16} /></button>}</div>}
        </div>
        {newMessages && <button type="button" className="cs-jump-latest" onClick={latest}><ArrowDown size={14} />查看最新消息</button>}
        {dragging && <div className="cs-drop-overlay"><div><Paperclip size={25} /><strong>松开，加入本次对话</strong><span>会保留在原来的资料列表</span></div></div>}
        <div className="cs-compose-area">{!studio.configured && !loading && <div className="cs-model-required"><span>连接模型后，开始整理和答疑。</span>{props.onOpenModelSettings && <button type="button" onClick={props.onOpenModelSettings}>连接模型 <ArrowRight size={13} /></button>}</div>}{error && <div className="cs-error" role="alert"><span>{error}</span>{loadFailed && <button type="button" onClick={() => void reload(true).catch(cause => setError(cause.message))}>重新连接</button>}<button type="button" className="cs-icon-button" aria-label="关闭提示" onClick={() => setError("")}><X size={15} /></button></div>}{pollError && <div className="cs-error" role="alert"><span>{pollError}</span><button type="button" onClick={() => { setPollError(""); setPollRun(value => value + 1); }}>检查任务状态</button></div>}
          <form className={`cs-composer ${working ? "is-working" : ""}`} onSubmit={event => void submit(event)}>
            {revisionTarget && <div className="cs-revision-target"><NotePencil size={14} /><span>修订：{revisionTarget.title}</span><button type="button" aria-label="取消修订模式" onClick={() => { setRevisionTarget(null); setMode("notes"); }}><X size={14} /></button></div>}
            <div className="cs-context-chips" aria-label="本次使用的资料">{selectedDocs.length ? selectedDocs.map(doc => <span className="cs-context-chip" key={doc.id}><FileText size={13} /><span title={doc.name}>{doc.name}</span><button type="button" aria-label={`移除对话资料${doc.name}`} disabled={working} onClick={() => toggleSource(doc.id)}><X size={12} /></button></span>) : <button type="button" className="cs-attach-source" onClick={() => { setPane("sources"); setSourcesOpen(true); }}><Paperclip size={15} />选择课程资料</button>}</div>
            {mode !== "practice" ? <textarea ref={textArea} aria-label="给课程AI下达指令" placeholder={mode === "revise" ? "指出需要纠正或补充的内容…" : mode === "notes" ? "把这些资料整理成一份详细的复习笔记…" : mode === "review" ? "生成一份可直接执行的复习资料…" : mode === "exam-checklist" ? "生成可逐项勾选的考点清单…" : "关于这些资料，你想问什么？"} value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={4000} rows={2} disabled={working || loading} onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /> : <div className="cs-practice-compose"><ClipboardText size={23} /><div><strong>用所选资料出一套题</strong><p>下一步设置题型、数量和难度。</p></div></div>}
            <div className="cs-composer-bottom"><div className="cs-mode-picker" aria-label="对话任务"><button type="button" aria-pressed={mode === "notes" || mode === "revise"} disabled={working} onClick={() => prepare("notes")} title="整理复习笔记"><NotePencil size={15} /><span>笔记</span></button><button type="button" aria-pressed={mode === "review"} disabled={working} onClick={() => prepare("review")} title="生成复习资料"><BookOpen size={15} /><span>复习</span></button><button type="button" aria-pressed={mode === "exam-checklist"} disabled={working} onClick={() => prepare("exam-checklist")} title="生成考点清单"><CheckCircle size={15} /><span>考点</span></button><button type="button" aria-pressed={mode === "chat"} disabled={working} onClick={() => prepare("chat")} title="基于所选资料答疑"><ChatCircle size={15} /><span>答疑</span></button><button type="button" aria-pressed={mode === "practice"} disabled={working} onClick={() => prepare("practice")} title="设置练习题"><ClipboardText size={15} /><span>出题</span></button></div><button type="submit" className="cs-send" aria-label={mode === "practice" ? "设置所选资料练习" : mode === "revise" ? "发送笔记修订指令" : "发送课程指令"} disabled={working || loading || (!selectedDocs.length && mode !== "revise") || (mode !== "practice" && !studio.configured)}>{working ? <CircleNotch size={17} className="cs-spin" /> : mode === "practice" ? <ArrowRight size={17} /> : <ArrowUp size={18} weight="bold" />}</button></div>
          </form><div className="cs-composer-foot"><span><BookOpen size={12} />保留出处，便于核对</span><span>{mode === "practice" ? "按资料与知识点出题" : "Ctrl / ⌘ + Enter 发送"}</span></div>
        </div>
      </section>

      <button className="cs-shelf-backdrop" type="button" tabIndex={-1} aria-hidden="true" onClick={() => setOutputsOpen(false)} />
      <aside ref={outputShelf} className="cs-artifacts cs-pane" id={`${tabsId}-artifacts`} aria-label="课程产物" role={wide && outputsOpen ? "dialog" : undefined} aria-modal={wide && outputsOpen ? true : undefined} aria-hidden={wide && !outputsOpen ? true : undefined}>
        <div className="cs-pane-heading"><h2><NotePencil size={18} />成稿架<span>{studio.artifacts.length + papers.length}</span></h2><button type="button" className="cs-icon-button cs-close-shelf" aria-label="关闭成稿架" onClick={() => setOutputsOpen(false)}><X size={20} /></button></div>
        <div className="cs-output-tabs" role="tablist" aria-label="产物类型"><button type="button" role="tab" aria-selected={artifactTab === "notes"} onClick={() => setArtifactTab("notes")}><BookOpen size={15} />笔记<span>{studio.artifacts.length}</span></button><button type="button" role="tab" aria-selected={artifactTab === "papers"} onClick={() => setArtifactTab("papers")}><ClipboardText size={15} />练习卷<span>{papers.length}</span></button></div>
        {artifactTab === "papers" ? <div className="cs-paper-list">{paperError && <div className="cs-error" role="alert"><span>{paperError}</span><button type="button" onClick={() => void reload().catch(cause => setError(cause.message))}>重试加载</button></div>}{papers.map(paper => <button type="button" key={paper.id} className="cs-paper-item" disabled={!paper.available} onClick={() => onOpenPaper ? onOpenPaper(paper.id) : props.onPractice()}><span className="cs-paper-item-icon"><ClipboardText size={24} weight="duotone" /></span><span><strong>{paper.title}</strong><small>{paper.available ? `${paper.totalQuestions} 题 · ${paper.durationMinutes} 分钟` : "来源已变化，需重新组卷"}</small></span><ArrowRight size={16} /></button>)}{!papers.length && !paperError && <div className="cs-artifact-empty"><ClipboardText size={34} weight="light" /><strong>把“看懂了”变成“做对了”</strong><p>选好资料出题，练习卷会保存在这里。</p><button type="button" onClick={() => prepare("practice")}>设置一组练习 <ArrowRight size={15} /></button></div>}</div> : !artifact ? <div className="cs-artifact-empty"><div className="cs-shelf-illustration" aria-hidden="true"><i /><i /><i /><span /></div><strong>给复习，留一份成稿。</strong><p>整理好的笔记会出现在这里，<br />随时修订、导出，或拿来出题。</p><span className="cs-artifact-empty-tag"><CheckCircle size={13} />自动保存在本课程</span></div> : <>
          <div className="cs-note-list">{studio.artifacts.slice().reverse().map(item => <article className="cs-note-file" key={item.id}>
            <button type="button" className="cs-note-open" aria-label={`阅读PDF：${item.title}`} onClick={() => { setArtifactId(item.id); setExpanded(true); }}><span className="cs-note-file-icon"><FilePdf size={28} weight="duotone" /></span><span><strong>{item.title}</strong><small>{day(item.createdAt)} · {item.kind === "review" ? "复习资料" : item.kind === "exam-checklist" ? "考点清单" : "复习笔记"} · PDF / Word{item.revision > 1 ? ` · 第${item.revision}版` : ""}</small></span><ArrowRight size={17} /></button>
            {item.status === "stale" && <p className="cs-note-stale">来源已变化，请核对后使用。</p>}
            <div className="cs-note-file-actions"><button type="button" onClick={() => { setArtifactId(item.id); setExpanded(true); }}>阅读讲义</button><button type="button" disabled={working} onClick={() => revise(item)}>修订</button><button type="button" onClick={() => openPractice([item.documentId])}>据此出题</button><button type="button" aria-label={`将笔记加入对话：${item.title}`} onClick={() => { addSources([item.documentId], true); setMode("chat"); }}><Paperclip size={15} /></button></div>
          </article>)}</div>

        </>}
      </aside>
    </div>
    <SourceDialog props={props} source={readerSource} />
    <DiscoveryPanel open={discoveryOpen} courseId={courseId} courseName={course!.name} configured={studio.configured} onClose={() => setDiscoveryOpen(false)} onImported={doc => void importedDiscovery(doc)} onNotify={onNotify} />
    {lectureReader && <StudyDocumentReader title={lectureReader.title} endpoint={`/api/lessons/${encodeURIComponent(lectureReader.id)}/document`} onClose={() => setLectureReader(null)} />}
    {expanded && artifact && <StudyDocumentReader key={artifact.id} title={artifact.title} endpoint={`/api/course-studio/artifacts/${encodeURIComponent(artifact.id)}/export`} onClose={() => setExpanded(false)} onRevise={() => { setExpanded(false); revise(artifact); }} onPractice={() => { setExpanded(false); openPractice([artifact.documentId]); }} />}

  </section>;
}
