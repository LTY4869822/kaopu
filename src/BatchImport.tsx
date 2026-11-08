import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { ArrowRight, CheckCircle, FilePdf, FilePpt, FileText, FolderOpen, ImageSquare, SpinnerGap, UploadSimple, WarningCircle, X } from "@phosphor-icons/react";
import { api } from "./api";
import type { Course, Doc } from "./types";
import "./batch-import.css";
import { ActionButton } from "./ui/controls";

type Classification = { status: "classified" | "needs-review"; subject: string | null; confidence: number; reason: string; engine?: "ai" | "rules" };
type ImportedDocument = Doc & { classification?: Classification };
type ImportResult = { document: ImportedDocument; course: Course | null; createdCourse: boolean; duplicate: boolean; classification: Classification };
type FileState = "queued" | "uploading" | "success" | "needs-review" | "failed" | "duplicate";
type QueueItem = { id: string; file: File; status: FileState; result?: ImportResult; error?: string };
type ImportSnapshot = { documents: ImportedDocument[]; courses: Course[] };
type Props = { onRefresh: () => Promise<unknown>; onOpenCourse: (id: string) => void; onOpenCourses?: () => void; courses: Course[] };
const MAX_FILES = 100;
const MAX_BYTES = 20 * 1024 * 1024;
const NEW_COURSE = "__new_course__";
const labels: Record<FileState, string> = { queued: "等待处理", uploading: "读取与分类中", success: "已归档", "needs-review": "等你确认科目", failed: "未能导入", duplicate: "已在资料库中" };

export default function BatchImport({ onRefresh, onOpenCourse, onOpenCourses, courses }: Props) {
  const headingId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const cancelled = useRef(false);
  const processing = useRef(false);
  const pendingVersion = useRef(0);
  const stagedRef = useRef<QueueItem[]>([]);
  const dragDepth = useRef(0);
  const [staged, setStaged] = useState<QueueItem[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeBatchIds, setActiveBatchIds] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [parseMode, setParseMode] = useState("auto");
  const [showFiles, setShowFiles] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pendingDocuments, setPendingDocuments] = useState<ImportedDocument[]>([]);
  const [newCourses, setNewCourses] = useState<Course[]>([]);
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [courseNames, setCourseNames] = useState<Record<string, string>>({});
  const [assignmentErrors, setAssignmentErrors] = useState<Record<string, string>>({});
  const [assigning, setAssigning] = useState<string | null>(null);

  function applySnapshot(state: ImportSnapshot) {
    setPendingDocuments(state.documents.filter(doc => !doc.courseId));
    // Reconcile old batch rows when another view moves/deletes a document.
    if (!processing.current) setQueue(current => current.flatMap(item => {
      if (!item.result) return [item];
      const document = state.documents.find(doc => doc.id === item.result!.document.id);
      if (!document) return [];
      const course = state.courses.find(value => value.id === document.courseId) || null;
      const classification = document.classification || item.result.classification;
      const status: FileState = item.result.duplicate ? "duplicate" : document.courseId ? "success" : "needs-review";
      return [{ ...item, status, result: { ...item.result, document, course, classification } }];
    }));
  }

  async function loadPending() {
    const version = ++pendingVersion.current;
    try {
      const state = await api<ImportSnapshot>("/state");
      if (mounted.current && version === pendingVersion.current) applySnapshot(state);
    } catch {
      if (mounted.current && version === pendingVersion.current) setError("暂时没有读取到待确认资料。可以重新打开这个页面再试，已保存的文件不会丢失。");
    }
  }

  useEffect(() => {
    mounted.current = true;
    cancelled.current = false;
    // Stop synchronously on a 401, before React has unmounted the workspace.
    const cancel = () => { cancelled.current = true; };
    window.addEventListener("shifen:session-expired", cancel);
    return () => {
      mounted.current = false;
      cancelled.current = true;
      pendingVersion.current++;
      window.removeEventListener("shifen:session-expired", cancel);
    };
  }, []);

  useEffect(() => {
    // Parent refreshes produce a fresh course collection even for document-only
    // changes. This performs one read, never another parent refresh, so no loop.
    setNewCourses([]);
    void loadPending();
  }, [courses]);

  const knownCourses = useMemo(() => [...new Map([...newCourses, ...courses].map(course => [course.id, course])).values()], [courses, newCourses]);
  const reviewDocuments = useMemo(() => {
    const documents = new Map(pendingDocuments.map(doc => [doc.id, doc]));
    for (const item of queue) {
      if (item.result?.document && !item.result.document.courseId) documents.set(item.result.document.id, { ...item.result.document, classification: item.result.classification });
    }
    return [...documents.values()];
  }, [queue, pendingDocuments]);
  const groups = useMemo(() => {
    const grouped = new Map<string, { id: string; name: string; documents: Set<string>; duplicates: Set<string> }>();
    for (const item of queue) {
      const result = item.result;
      if (!result?.document.courseId || item.status === "failed") continue;
      const id = result.document.courseId;
      if (!knownCourses.some(course => course.id === id)) continue;
      const group = grouped.get(id) ?? { id, name: result.course?.name || knownCourses.find(course => course.id === id)?.name || "课程资料", documents: new Set<string>(), duplicates: new Set<string>() };
      (result.duplicate ? group.duplicates : group.documents).add(result.document.id);
      grouped.set(id, group);
    }
    return [...grouped.values()];
  }, [queue, knownCourses]);
  const finished = queue.filter(item => item.status !== "queued" && item.status !== "uploading").length;
  const failures = queue.filter(item => item.status === "failed").length;
  const allReady = queue.length > 0 && !running && !failures && !reviewDocuments.length;
  const activeFile = queue.find(item => item.status === "uploading");
  const activeBatch = queue.filter(item => activeBatchIds.includes(item.id));
  const activeFinished = activeBatch.filter(item => item.status !== "queued" && item.status !== "uploading").length;
  const currentStage = staged.length ? 0 : running ? 1 : queue.length ? allReady && groups.length ? 2 : 1 : 0;
  const importStages = [
    { label: "添加资料", detail: staged.length ? `${staged.length} 份待分析` : currentStage > 0 ? "已添加到本批次" : "选择或拖拽文件" },
    { label: "分析归类", detail: running ? `${activeFinished} / ${activeBatchIds.length} 份已完成` : queue.length ? `${finished} 份已处理` : "点开始后再分析" },
    { label: "进入课程", detail: groups.length ? `${groups.length} 门课程已整理` : "等待归类结果" },
  ];

  const updateItem = (id: string, update: Partial<QueueItem>) => {
    if (mounted.current) setQueue(items => items.map(item => item.id === id ? { ...item, ...update } : item));
  };

  async function refreshParent() {
    if (!mounted.current || cancelled.current) return;
    try {
      const updated = await onRefresh();
      if (mounted.current && updated && typeof updated === "object" && "documents" in updated && "courses" in updated && Array.isArray(updated.documents) && Array.isArray(updated.courses)) {
        pendingVersion.current++;
        applySnapshot(updated as ImportSnapshot);
      }
    }
    catch { if (mounted.current) setError("资料已保存，但课程列表暂时没有刷新。重新进入页面即可查看。"); }
  }

  async function runBatch(items: QueueItem[]) {
    if (processing.current || !items.length) return;
    processing.current = true;
    setActiveBatchIds(items.map(item => item.id));
    setRunning(true);
    setNotice("");
    setError("");
    let savedSinceRefresh = 0;
    try {
      for (const item of items) {
        // Page switches keep this component mounted. Logout must end the queue.
        if (!mounted.current || cancelled.current) break;
        updateItem(item.id, { status: "uploading", error: undefined });
        try {
          if (item.file.size > MAX_BYTES) throw new Error("超过 20 MB。请拆分或压缩这份文件后重新选择。");
          if (!item.file.size) throw new Error("文件没有内容，请检查后重新选择。");
          const extension = item.file.name.split(".").at(-1)?.toLowerCase();
          if (extension === "doc" || extension === "ppt") throw new Error(`这是旧版 Office 文件，请另存为 ${extension === "doc" ? ".docx" : ".pptx"} 后再导入。`);
          if (!["pdf", "docx", "pptx", "txt", "md", "jpg", "jpeg", "png", "webp"].includes(extension || "")) throw new Error("暂不支持这个格式。请选择 PDF、Word、PPTX、TXT、MD 或 JPG / PNG / WebP 照片。");
          if (parseMode === "handwriting" && !["pdf", "jpg", "jpeg", "png", "webp"].includes(extension || "")) throw new Error("手写识别适合照片或扫描 PDF；这份文档请改用自动读取。");
          if (parseMode === "basic" && ["jpg", "jpeg", "png", "webp"].includes(extension || "")) throw new Error("照片没有可直接提取的文字，请改用自动读取或手写识别后重试。");
          const body = new FormData();
          body.append("file", item.file);
          body.append("parseMode", parseMode);
          const result = await api<ImportResult>("/documents/auto", "POST", body);
          const status = result.duplicate ? "duplicate" : result.classification.status === "needs-review" || !result.document.courseId ? "needs-review" : "success";
          updateItem(item.id, { status, result });
          if (mounted.current && result.course) setNewCourses(current => [...current.filter(course => course.id !== result.course!.id), result.course!]);
          savedSinceRefresh++;
        } catch (cause) {
          updateItem(item.id, { status: "failed", error: cause instanceof Error ? cause.message : "这份文件没有导入成功，请重试。" });
        }
        if (savedSinceRefresh >= 3 && mounted.current && !cancelled.current) {
          await refreshParent();
          savedSinceRefresh = 0;
        }
      }
      await refreshParent();
    } finally {
      processing.current = false;
      if (mounted.current && !cancelled.current) {
        setRunning(false);
        await loadPending();
      }
    }
  }

  function receiveFiles(files: FileList | File[]) {
    if (processing.current || assigning || !files.length) return;
    if (stagedRef.current.length + files.length > MAX_FILES) {
      setError(`同一批最多 ${MAX_FILES} 份文件。已有 ${stagedRef.current.length} 份待分析，本次又选择了 ${files.length} 份，请分批处理。`);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    const items = Array.from(files).map(file => ({ id: crypto.randomUUID(), file, status: "queued" as const }));
    stagedRef.current = [...stagedRef.current, ...items];
    setStaged(stagedRef.current);
    setError("");
    setDragging(false);
    if (inputRef.current) inputRef.current.value = "";
    // Selection is local only. Uploading, parsing and course creation require
    // the separate, explicit Start analysis action below.
  }

  function removeStaged(id?: string) {
    if (processing.current || assigning) return;
    stagedRef.current = id ? stagedRef.current.filter(item => item.id !== id) : [];
    setStaged(stagedRef.current);
    setError("");
  }

  function startAnalysis() {
    if (processing.current || assigning || !stagedRef.current.length) return;
    const items = stagedRef.current;
    stagedRef.current = [];
    setStaged([]);
    setQueue(current => [...current, ...items]);
    setShowFiles(false);
    void runBatch(items);
  }

  function dropFiles(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!processing.current && !assigning) receiveFiles(event.dataTransfer.files);
  }

  function enterDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (processing.current || assigning || !event.dataTransfer.types.includes("Files")) return;
    dragDepth.current++;
    setDragging(true);
  }

  function leaveDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragging(false);
  }

  async function assignDocument(document: ImportedDocument) {
    if (assigning || processing.current) return;
    let courseId = destinations[document.id];
    if (!courseId) return;
    const name = courseNames[document.id]?.trim();
    if (courseId === NEW_COURSE && !name) return;
    setAssigning(document.id);
    setAssignmentErrors(current => ({ ...current, [document.id]: "" }));
    pendingVersion.current++;
    try {
      let destination = knownCourses.find(course => course.id === courseId);
      if (courseId === NEW_COURSE) {
        destination = knownCourses.find(course => course.name.trim() === name);
        if (!destination) {
          destination = await api<Course>("/courses", "POST", { name, target: 80 });
          if (mounted.current) setNewCourses(current => [...current, destination!]);
        }
        courseId = destination.id;
        if (mounted.current) setDestinations(current => ({ ...current, [document.id]: courseId }));
      }
      const saved = await api<ImportedDocument>(`/documents/${encodeURIComponent(document.id)}`, "PATCH", { courseId });
      if (mounted.current) {
        setPendingDocuments(current => current.filter(item => item.id !== document.id));
        setQueue(current => current.map(item => item.result?.document.id === document.id ? { ...item, status: item.result.duplicate ? "duplicate" : "success", result: { ...item.result, document: saved, course: destination || null, classification: { ...item.result.classification, status: "classified", subject: destination?.name || null, reason: "已按你的选择归档。" } } } : item));
        setNotice(`已归入「${destination?.name || "所选课程"}」，可以进入课程工作台继续复习。`);
        await refreshParent();
        await loadPending();
      }
    } catch (cause) {
      if (mounted.current) setAssignmentErrors(current => ({ ...current, [document.id]: cause instanceof Error ? cause.message : "还没有归档成功，请重试。" }));
    } finally {
      if (mounted.current) setAssigning(null);
    }
  }

  return <section className="batch-import" aria-labelledby={headingId}>
    <div className={`batch-upload-panel ${staged.length ? "has-staged" : ""}`}>
      <div className="batch-reading-mode"><label htmlFor={`${headingId}-reading`}>读取方式</label><select id={`${headingId}-reading`} aria-label="资料读取方式" value={parseMode} disabled={running || !!assigning} onChange={event => setParseMode(event.target.value)}><option value="auto">自动读取</option><option value="handwriting">手写笔记 / 看图识别</option><option value="structured">版式增强 / OCR</option><option value="basic">仅提取文字</option></select><span>{parseMode === "handwriting" ? "照片或最多8页扫描PDF交给视觉模型；识别后可核对原图，再分析课程归属。" : parseMode === "structured" ? "本机识别版面与扫描文字；课程归类使用AI，照片交给视觉模型。" : parseMode === "basic" ? "只提取已有文字，不做OCR；提取后仍会分析归科。" : "本机提取文字，AI分析文件名和正文样本归科；照片使用视觉模型。"}</span></div>
      <ol className="batch-steps" aria-label="资料导入步骤">{importStages.map((stage, index) => <li className={index === currentStage ? "is-current" : index < currentStage ? "is-complete" : ""} aria-current={index === currentStage ? "step" : undefined} key={stage.label}><span className="batch-step-number" aria-hidden="true">{index < currentStage ? <CheckCircle size={18} weight="fill"/> : index + 1}</span><span className="batch-step-copy"><strong>{stage.label}</strong><span>{stage.detail}</span></span>{index < importStages.length - 1 && <ArrowRight className="batch-step-arrow" size={17} aria-hidden="true"/>}</li>)}</ol>
      <div className={`batch-drop ${dragging ? "is-dragging" : ""} ${running ? "is-running" : ""}`} onDragEnter={enterDrop} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = processing.current || assigning ? "none" : "copy"; }} onDragLeave={leaveDrop} onDrop={dropFiles}>
        <div className="batch-drop-copy">
          <div className="sf-drop-symbol" aria-hidden="true"><UploadSimple size={32} weight="regular" /></div>
          <h2 id={headingId}>{dragging ? "松开，添加这些资料" : "拖拽文件到这里"}</h2>
          <p>讲义、课件、手写笔记照片，一次放进来。</p>
          <button className="batch-secondary batch-choose" type="button" disabled={running || !!assigning} onClick={() => inputRef.current?.click()}><UploadSimple size={19}/>选择文件</button>
          <input ref={inputRef} className="batch-file-input" type="file" multiple accept=".pdf,.docx,.pptx,.txt,.md,.doc,.ppt,.jpg,.jpeg,.png,.webp" aria-label="批量导入学习资料" disabled={running || !!assigning} onChange={event => { if (event.target.files) receiveFiles(event.target.files); }}/>
          <div className="batch-formats" aria-label="支持 PDF、Word、PPT、TXT、Markdown 和笔记照片"><span>PDF</span><span>Word / PPT</span><span>TXT / MD</span><span>JPG / PNG / WebP</span></div>
          <span className="batch-limit">单份 20 MB 以内，每批最多 100 份</span>
        </div>
      </div>

      {staged.length > 0 && <div className="batch-staged"><div className="batch-staged-heading"><h3>待分析文件 <span>{staged.length}</span></h3><button className="batch-text-button" type="button" disabled={running || !!assigning} onClick={() => removeStaged()}>清空待分析</button></div><ul className="batch-staged-list" aria-label="待分析文件">{staged.map(item => {
        const extension = item.file.name.split(".").at(-1)?.toLowerCase();
        const fileKind = extension === "pdf" ? "pdf" : extension === "ppt" || extension === "pptx" ? "ppt" : extension === "doc" || extension === "docx" ? "doc" : ["jpg", "jpeg", "png", "webp"].includes(extension || "") ? "image" : "text";
        return <li className="batch-staged-row" key={item.id}><span className={`batch-staged-icon file-kind-${fileKind}`} aria-hidden="true">{fileKind === "pdf" ? <FilePdf size={23}/> : fileKind === "ppt" ? <FilePpt size={23}/> : fileKind === "image" ? <ImageSquare size={23}/> : <FileText size={23}/>}</span><div className="batch-staged-copy"><strong>{item.file.name}</strong><span>{extension?.toUpperCase() || "文件"} · {item.file.size >= 1024 * 1024 ? `${(item.file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(item.file.size / 1024))} KB`}</span></div><button type="button" aria-label={`移除${item.file.name}`} disabled={running || !!assigning} onClick={() => removeStaged(item.id)}><X size={20}/></button></li>;
      })}</ul></div>}
      <div className="batch-start-row"><p aria-live="polite">{running ? "正在分析，完成后会按科目归好类。" : staged.length ? <><strong>{staged.length} 份文件</strong>已就绪，开始整理到课程。</> : "选好文件后，再开始分析。"}</p><ActionButton className="batch-primary" busy={running} disabled={running || !!assigning || !staged.length} onClick={startAnalysis}>开始分析</ActionButton></div>
    </div>

    {error && <div className="batch-message batch-error" role="alert"><WarningCircle size={20}/><span>{error}</span></div>}
    {notice && <div className="batch-message batch-notice" role="status"><CheckCircle size={20}/><span>{notice}</span></div>}

    {!!queue.length && <div className={`batch-results ${allReady ? "is-complete" : ""}`}>
      <div className="batch-result-heading" aria-live="polite"><div><h3>{running ? `正在分析 ${activeFinished + (activeFile ? 1 : 0)} / ${activeBatchIds.length} 份` : allReady ? "资料分析完成" : "分析已结束，请查看结果"}</h3><p>{running ? activeFile?.file.name || "正在更新课程列表…" : `${finished} 份已处理${failures ? `，${failures} 份需要重试` : ""}${reviewDocuments.length ? `，${reviewDocuments.length} 份待确认科目` : ""}。`}</p></div>{!running && <button type="button" className="batch-text-button" onClick={() => setShowFiles(value => !value)} aria-expanded={allReady ? showFiles : !showFiles}>{allReady ? showFiles ? "收起文件明细" : "查看文件明细" : showFiles ? "展开状态" : "收起状态"}</button>}</div>
      {running && <div className="batch-progress"><progress max={activeBatchIds.length} value={activeFinished} aria-label={`文件处理进度：已完成 ${activeFinished} 份，共 ${activeBatchIds.length} 份`}/><span>{activeFinished} / {activeBatchIds.length} 份已完成 · 大文件需要多一点时间</span></div>}
      {(running || (allReady ? showFiles : !showFiles)) && <ul className="batch-file-list" aria-label="导入文件处理状态">{queue.map(item => <li className={`batch-file-row status-${item.status}`} key={item.id}><span className="batch-file-icon" aria-hidden="true">{item.status === "uploading" ? <SpinnerGap className="batch-spinning" size={22}/> : item.status === "failed" || item.status === "needs-review" ? <WarningCircle size={22}/> : item.status === "success" || item.status === "duplicate" ? <CheckCircle size={22}/> : <FileText size={22}/>}</span><div className="batch-file-copy"><strong>{item.file.name}</strong><span>{item.error || (item.result?.document.courseId ? `${item.result.course?.name || knownCourses.find(course => course.id === item.result?.document.courseId)?.name || "已归入课程"} · ${item.result.duplicate ? "内容已存在，没有重复保存" : item.result.classification.reason}` : item.result?.classification.reason) || `${(item.file.size / 1024 / 1024).toFixed(1)} MB`}</span></div><span className="batch-file-status">{labels[item.status]}</span>{item.status === "failed" && <button type="button" className="batch-text-button" disabled={running || !!assigning} onClick={() => { updateItem(item.id, { status: "queued", error: undefined }); void runBatch([item]); }}>重试<span className="batch-sr-only">{item.file.name}</span></button>}</li>)}</ul>}
      {groups.length > 0 && <div className="batch-course-groups" aria-label="已整理的课程">{groups.map(group => <div className="batch-course-group" key={group.id}><FolderOpen size={23} aria-hidden="true"/><div><strong>{group.name}</strong><p>{group.documents.size ? `${group.documents.size} 份资料已整理` : "资料已在课程中"}{group.duplicates.size ? ` · ${group.duplicates.size} 份重复内容已跳过` : ""}</p></div><button type="button" className="batch-text-button" disabled={running || !!assigning} onClick={() => onOpenCourse(group.id)}>进入工作台<ArrowRight size={17}/></button></div>)}</div>}
      {!running && finished > 0 && onOpenCourses && <div className="batch-complete-actions"><button className="batch-secondary" type="button" disabled={!!assigning} onClick={onOpenCourses}>查看我的课程<ArrowRight size={18}/></button></div>}
    </div>}

    {reviewDocuments.length > 0 && <section className="batch-review" aria-labelledby={`${headingId}-review`}><div className="batch-review-heading"><h3 id={`${headingId}-review`}>这 {reviewDocuments.length} 份，帮我确认一下科目</h3><p>文件已经保存好了。选一个已有科目，或者直接新建一门。</p></div><div className="batch-review-list">{reviewDocuments.map(document => <div className="batch-review-row" key={document.id}><div className="batch-review-file"><FileText size={23} aria-hidden="true"/><div><strong>{document.name}</strong><p>{document.classification?.reason || "内容暂时不足以确定所属科目，请你确认一下。"}</p></div></div><div className="batch-assignment-controls"><label><span className="batch-sr-only">为{document.name}选择科目</span><select aria-label={`为${document.name}选择科目`} value={destinations[document.id] || ""} disabled={running || !!assigning} onChange={event => setDestinations(current => ({ ...current, [document.id]: event.target.value }))}><option value="">选择所属科目</option>{knownCourses.map(course => <option value={course.id} key={course.id}>{course.name}</option>)}<option value={NEW_COURSE}>＋ 新建一门课程</option></select></label>{destinations[document.id] === NEW_COURSE && <label className="batch-new-course"><span className="batch-sr-only">为{document.name}新建的课程名称</span><input aria-label={`为${document.name}新建的课程名称`} placeholder="输入科目名称" maxLength={50} value={courseNames[document.id] || ""} disabled={running || !!assigning} onChange={event => setCourseNames(current => ({ ...current, [document.id]: event.target.value }))}/></label>}<button type="button" className="batch-secondary" disabled={running || !!assigning || !destinations[document.id] || destinations[document.id] === NEW_COURSE && !courseNames[document.id]?.trim()} onClick={() => void assignDocument(document)}>{assigning === document.id ? "正在归档…" : "确认归档"}</button></div>{destinations[document.id] === NEW_COURSE && <p className="batch-no-date">先建课程，考试日期可以稍后在工作台补充。</p>}{assignmentErrors[document.id] && <p className="batch-assignment-error" role="alert">{assignmentErrors[document.id]}</p>}</div>)}</div></section>}
  </section>;
}
