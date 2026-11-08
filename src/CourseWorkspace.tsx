import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, BookOpen, CaretDown, CheckCircle, FilePdf, FilePpt, FileText, FolderOpen, ImageSquare, MagnifyingGlass, PencilSimple, Plus, Sparkle, SpinnerGap, SquaresFour, Trash, WarningCircle, X } from "@phosphor-icons/react";
import { api } from "./api";
import type { Answer, Course, Doc } from "./types";
import { surfaceMove, surfaceReset } from "./ui/motion";
import "./course-workspace.css";
const LessonText = lazy(() => import("./LessonText"));

export type CourseWorkspaceProps = {
  course?: Course;
  courses: Course[];
  documents: Doc[];
  selectedDoc: Doc | null;
  onSelectDocument: (doc: Doc | null) => void;
  busy: boolean;
  providerConfigured: boolean;
  onAssign: (doc: Doc, courseId: string) => Promise<void>;
  onDelete: (doc: Doc) => void;
  onAdd: () => void;
  onPractice: () => void;
  onNotify: (message: string) => void;
  onRefresh?: () => Promise<unknown>;
};

function isImageDocument(doc: Doc) {
  return ["PNG", "JPG", "JPEG", "WEBP"].includes(doc.type.toUpperCase());
}

function fileKind(doc: Doc) {
  const type = doc.type.toLowerCase();
  if (isImageDocument(doc)) return { label: "笔记照片", className: "image", icon: ImageSquare };
  if (type.includes("pdf")) return { label: "PDF", className: "pdf", icon: FilePdf };
  if (type.includes("ppt")) return { label: "PPT", className: "ppt", icon: FilePpt };
  if (type.includes("doc")) return { label: "WORD", className: "word", icon: FileText };
  return { label: type.includes("md") ? "MD" : "TXT", className: "text", icon: FileText };
}

function fileSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

function locationName(doc: Doc) {
  return doc.locationKind === "section" ? "段" : doc.type.toLowerCase().includes("ppt") ? "张" : "页";
}

function RecognizedText({ text }: { text: string }) {
  return <Suspense fallback={<p className="cw-recognized-text">{text}</p>}><LessonText text={text} className="cw-recognized-text" /></Suspense>;
}

function recognizedPageText(document: Doc, page: number) {
  const blocks = document.structure?.blocks.filter(block => block.page === page && block.text.trim());
  if (blocks?.length) return blocks.map(block => block.text).join("\n\n");
  return document.chunks.filter(chunk => chunk.page === page).map(chunk => chunk.text).join("\n\n");
}

function canonicalReadingChunks(document: Doc): Doc["chunks"] {
  if (document.origin?.kind !== "ai-notes" || !document.structure?.blocks.length) return document.chunks;
  return document.structure.blocks.map(block => ({
    id: document.chunks.find(chunk => chunk.blockId === block.id)?.id || block.id,
    page: block.page || 1, text: block.text, blockId: block.id,
  }));
}

function HandwritingPages({ document, onSaved, onRefresh, onNotify }: { document: Doc; onSaved: (document: Doc) => void; onRefresh?: () => Promise<unknown>; onNotify: (message: string) => void }) {
  const [draft, setDraft] = useState<{ page: number; text: string; revision: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [imageFailed, setImageFailed] = useState(false);
  const request = useRef(0);
  const inFlight = useRef(false);
  const editorId = useId();
  useEffect(() => () => { request.current++; inFlight.current = false; }, []);
  const pages = [...new Set([...document.chunks.map(chunk => chunk.page), ...(document.recognition?.pages.map(page => page.page) || [])])].sort((a, b) => a - b);
  const originalUrl = `/api/documents/${encodeURIComponent(document.id)}/original`;
  function edit(page: number) {
    if (inFlight.current) return;
    request.current++;
    setDraft({ page, text: recognizedPageText(document, page), revision: document.recognition?.revision ?? 0 });
    setError("");
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || inFlight.current) return;
    if (!draft.text.trim()) { setError("请保留这一页的笔记文字，不能保存空内容。"); return; }
    const version = ++request.current;
    inFlight.current = true; setSaving(true); setError("");
    try {
      const saved = await api<Doc>(`/documents/${encodeURIComponent(document.id)}/recognition`, "PUT", { page: draft.page, text: draft.text, revision: draft.revision });
      if (request.current !== version) return;
      onSaved(saved);
      setDraft(null);
      onNotify(`第 ${draft.page} 页已保存校对，原图和最初识别稿均保留。`);
      try { await onRefresh?.(); }
      catch { if (request.current === version) onNotify("校对已保存，资料列表暂未刷新；重新进入课程即可查看。"); }
    } catch (cause) {
      if (request.current === version) setError(cause instanceof Error ? cause.message : "校对还没有保存，请保留文字后重试。");
    } finally {
      if (request.current === version) { inFlight.current = false; setSaving(false); }
    }
  }
  return <>
    {document.hasOriginal && isImageDocument(document) && <figure className="cw-note-original">
      {!imageFailed ? <a href={originalUrl} target="_blank" rel="noreferrer" aria-label={`放大${document.name}的原始笔记`}><img src={originalUrl} alt={`${document.name}的原始笔记照片`} loading="lazy" decoding="async" onError={() => setImageFailed(true)} /></a> : <p>原图暂未加载成功，请点击下方链接查看。</p>}
      <figcaption><span>原始笔记</span><a className="text-button" href={originalUrl} target="_blank" rel="noreferrer">放大核对原图 <ArrowRight size={15} /></a></figcaption>
    </figure>}
    {pages.map(page => {
      const metadata = document.recognition?.pages.find(item => item.page === page);
      const pageChunks = document.chunks.filter(chunk => chunk.page === page);
      const pageText = recognizedPageText(document, page);
      const editing = draft?.page === page;
      return <article key={page} className="cw-handwriting-page" data-source-page={page} tabIndex={-1}>
        <div className="cw-note-page-heading"><span className="cw-location">第 {page} 页 <small>{metadata?.reviewed ? "已校对" : "识别稿 · 待核对"}</small></span>{metadata && !editing && <button type="button" className="text-button" disabled={saving || draft !== null} onClick={() => edit(page)}><PencilSimple size={16} />校对这一页</button>}</div>
        {metadata?.warnings.length ? <details className="cw-recognition-hints"><summary><WarningCircle size={16} />{metadata.warnings.length} 条原识别提示{metadata.reviewed ? " · 已校对" : ""}<CaretDown size={15} /></summary><ul>{metadata.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details> : null}
        {editing ? <form className="cw-note-editor" onSubmit={event => void save(event)} aria-busy={saving}><label htmlFor={`${editorId}-page-${page}`}>对照原件，校对第 {page} 页</label><textarea id={`${editorId}-page-${page}`} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} rows={10} maxLength={16000} required disabled={saving} aria-describedby={`${editorId}-hint-${page}`} /><p id={`${editorId}-hint-${page}`}>看不清的地方保留“[无法辨认]”；公式可用 $…$ 或 $$…$$ 排版。原图与最初识别稿不会被覆盖。</p>{error && <div className="cw-note-save-error" role="alert"><WarningCircle size={17} />{error}</div>}<div className="cw-note-editor-actions"><span>{draft.text.length.toLocaleString()} / 16,000 字符</span><button type="button" className="text-button" disabled={saving} onClick={() => { request.current++; setDraft(null); setError(""); }}>取消</button><button type="submit" className="primary" disabled={saving || !draft.text.trim()}>{saving ? <SpinnerGap size={17} className="cw-spinning" /> : <CheckCircle size={17} />}{saving ? "正在保存…" : "保存校对"}</button></div></form> : <div className="cw-note-chunk">{pageChunks.map(chunk => <span key={chunk.id} className="cw-note-source-anchor" data-chunk-id={chunk.id} tabIndex={-1} aria-label={`识别来源，第 ${page} 页`} />)}<RecognizedText text={pageText} /></div>}
        {document.hasOriginal && document.type.toUpperCase() === "PDF" && <a className="text-button cw-page-link" href={`${originalUrl}#page=${page}`} target="_blank" rel="noreferrer">在 PDF 中核对第 {page} 页 <ArrowRight size={15} /></a>}
        {metadata?.originalText && metadata.reviewed && <details className="cw-initial-recognition"><summary>查看最初识别稿<CaretDown size={15} /></summary><RecognizedText text={metadata.originalText} /></details>}
      </article>;
    })}
    {!!document.recognition?.archives?.length && <p className="cw-reader-note">来源修订前的练习与作答已保留，旧题不再参与当前练习。<a className="text-button" href={`/api/documents/${encodeURIComponent(document.id)}/recognition-history`} download>下载旧版学习记录 <ArrowRight size={15} /></a></p>}
  </>;
}

export default function CourseWorkspace({ course, courses, documents, selectedDoc, onSelectDocument, busy, providerConfigured, onAssign, onDelete, onAdd, onPractice, onNotify, onRefresh }: CourseWorkspaceProps) {
  const [filter, setFilter] = useState("");
  const [directoryOpen, setDirectoryOpen] = useState(() => typeof window === "undefined" || !window.matchMedia("(max-width: 900px)").matches);
  const [readerTab, setReaderTab] = useState<"source" | "summary">("source");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState("");
  const [savedRecognition, setSavedRecognition] = useState<Doc | null>(null);
  const readerId = useId();
  const requestVersion = useRef(0);
  const submitting = useRef(false);
  const latestDocument = documents.find(doc => doc.id === selectedDoc?.id) || null;
  const activeDocument = latestDocument && savedRecognition?.id === latestDocument.id && (savedRecognition.recognition?.revision ?? 0) > (latestDocument.recognition?.revision ?? 0) ? { ...latestDocument, chunks: savedRecognition.chunks, structure: savedRecognition.structure, summary: savedRecognition.summary, recognition: savedRecognition.recognition, warning: savedRecognition.warning } : latestDocument;
  const documentVersion = documents.map(doc => `${doc.id}:${doc.courseId}:${doc.recognition?.revision ?? 0}`).sort().join("|");
  const matches = documents.filter(doc => !filter.trim() || doc.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));

  useEffect(() => {
    const breakpoint = window.matchMedia("(max-width: 900px)");
    const sync = () => setDirectoryOpen(!breakpoint.matches);
    breakpoint.addEventListener("change", sync);
    return () => breakpoint.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    requestVersion.current++;
    submitting.current = false;
    setAsking(false);
    setAnswer(null);
    setAskError("");
    setQuestion("");
    setReaderTab("source");
    setSavedRecognition(null);
    return () => { requestVersion.current++; submitting.current = false; };
  }, [course?.id, activeDocument?.id]);

  useEffect(() => {
    requestVersion.current++;
    submitting.current = false;
    setAsking(false);
    setAnswer(null);
    setAskError("");
    return () => { requestVersion.current++; };
  }, [documentVersion, activeDocument?.recognition?.revision]);

  // Use the latest document collection after reassignment or deletion.
  useEffect(() => {
    if (selectedDoc && !activeDocument) onSelectDocument(null);
  }, [selectedDoc, activeDocument, onSelectDocument]);

  function openDocument(doc: Doc) {
    onSelectDocument(doc);
    setReaderTab("source");
    if (window.matchMedia("(max-width: 900px)").matches) setDirectoryOpen(false);
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!course || !question.trim() || submitting.current || !documents.length) return;
    const version = ++requestVersion.current;
    submitting.current = true;
    setAsking(true);
    setAskError("");
    setAnswer(null);
    try {
      const result = await api<Answer>("/ask", "POST", { question: question.trim(), courseId: course.id });
      if (requestVersion.current === version) setAnswer(result);
    } catch (cause) {
      if (requestVersion.current === version) setAskError(cause instanceof Error ? cause.message : "暂时没有找到回答，请重试。");
    } finally {
      if (requestVersion.current === version) { submitting.current = false; setAsking(false); }
    }
  }

  function switchReaderTab(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "source" : event.key === "End" ? "summary" : readerTab === "source" ? "summary" : "source";
    setReaderTab(next);
    document.getElementById(`${readerId}-${next}-tab`)?.focus();
  }

  return <section className="course-workspace" aria-label="课程资料工作台">
    <details className="cw-directory" open={directoryOpen} onToggle={event => setDirectoryOpen(event.currentTarget.open)}>
      <summary><span><FolderOpen size={20} />资料目录 <b>{documents.length}</b></span><CaretDown size={18} className="cw-directory-caret" /></summary>
      <div className="cw-directory-content">
        <label className="cw-file-search"><MagnifyingGlass size={17} /><input aria-label="搜索本课程资料" placeholder="搜索这门课的资料" value={filter} onChange={event => setFilter(event.target.value)} />{filter && <button type="button" aria-label="清空资料搜索" onClick={() => setFilter("")}><X size={16} /></button>}</label>
        <button type="button" className={`cw-directory-all ${!activeDocument ? "is-selected" : ""}`} onClick={() => onSelectDocument(null)}><SquaresFour size={19} /><span>全部资料</span><b>{documents.length}</b></button>
        <div className="cw-directory-items">
          {matches.map(doc => {
            const kind = fileKind(doc);
            return <button type="button" className={`cw-directory-file ${activeDocument?.id === doc.id ? "is-selected" : ""}`} key={doc.id} onClick={() => openDocument(doc)} aria-current={activeDocument?.id === doc.id ? "true" : undefined} aria-label={`阅读${doc.name}`}><span className={`cw-kind-icon ${kind.className}`} aria-hidden="true"><kind.icon size={23} /></span><span><strong>{doc.name}</strong><small>{kind.label} · {doc.chunks.length} 个片段</small></span></button>;
          })}
          {!matches.length && <p className="cw-directory-empty">{filter ? "没有匹配的资料" : "上传资料后，会整理在这里。"}</p>}
        </div>
        <div className="cw-directory-foot"><CheckCircle size={16} /><span>已解析资料，可查看原文出处</span></div>
      </div>
    </details>

    <div className="cw-main">
      {!activeDocument ? <section className="cw-library" aria-label="资料列表">
        <div className="cw-library-heading"><div><span className="cw-eyebrow">YOUR MATERIALS</span><h2>{filter ? "搜索结果" : "从一份资料开始"}</h2><p>{filter ? `找到 ${matches.length} 份资料` : documents.length ? "课件、讲义和笔记，已经各就各位。" : "把这一门课的资料，收拢到同一个地方。"}</p></div><span className="cw-count">{matches.length} 份资料</span></div>
        <div className="document-list cw-document-grid">
          {matches.map(doc => {
            const kind = fileKind(doc);
            return <article className="document-row cw-document-card" key={doc.id} onPointerMove={surfaceMove} onPointerLeave={surfaceReset}>
              <button type="button" className={`cw-file-preview ${kind.className}`} onClick={() => openDocument(doc)} aria-label={`打开${doc.name}`}><span className="cw-file-stack" aria-hidden="true"><span className="cw-file-layer cw-file-layer-back" /><span className="cw-file-layer cw-file-layer-middle" /><span className="cw-file-sheet"><kind.icon size={38} weight="duotone" /><span /><span /><span /></span></span><strong>{kind.label}</strong>{doc.isDemo ? <span className="cw-demo-label">示例</span> : doc.recognition && <span className="cw-note-status">{doc.recognition.needsReview ? "待校对" : "已校对"}</span>}</button>
              <button type="button" className="document-name" onClick={() => openDocument(doc)}><strong>{doc.name}</strong><span>{doc.chunks.length} 个片段 <i aria-hidden="true">·</i> {fileSize(doc.size)}</span></button>
              <div className="cw-file-actions"><select className="document-assignment" aria-label={`调整${doc.name}的学科`} value={doc.courseId || ""} disabled={busy} onChange={event => { void onAssign(doc, event.target.value).catch(error => onNotify(error instanceof Error ? error.message : "归档未完成，请重试。")); }}><option value="" disabled>选择课程归属</option>{courses.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}<option value="__new__">新建学科…</option></select><button type="button" className="icon-button cw-delete" aria-label={`删除${doc.name}`} disabled={busy} onClick={() => onDelete(doc)}><Trash size={18} /></button></div>
              <button type="button" className="text-button cw-read-button" onClick={() => openDocument(doc)}>开始阅读<ArrowRight size={17} /></button>
            </article>;
          })}
        </div>
        {!matches.length && <div className="cw-empty"><FolderOpen size={38} weight="light" /><h3>{filter ? "没有找到这份资料" : "这门课，等你放入第一份资料"}</h3><p>{filter ? "换一个资料名称试试。" : "添加课件、讲义或笔记，开始整理你的复习内容。"}</p>{filter ? <button className="secondary" type="button" onClick={() => setFilter("")}>查看全部资料</button> : <button className="primary" type="button" onClick={onAdd}><Plus size={18} />添加资料</button>}</div>}
      </section> : <section className="document-reader cw-reader" aria-label="文档阅读">
        <div className="cw-reader-top"><button type="button" className="text-button" onClick={() => onSelectDocument(null)}><ArrowLeft size={16} />返回资料列表</button><span className="cw-reader-status"><CheckCircle size={15} />{activeDocument.isDemo ? "示例资料" : activeDocument.recognition ? activeDocument.recognition.needsReview ? "手写识别稿 · 待校对" : "已校对" : "已解析"}</span></div>
        <div className="cw-reader-heading"><h2>{activeDocument.name}</h2><p>{fileKind(activeDocument).label} <span>·</span> {activeDocument.chunks.length} 个片段 <span>·</span> {fileSize(activeDocument.size)}{activeDocument.parser?.engine === "docling" && <><span>·</span>版式增强{activeDocument.parser.ocr ? " / OCR" : ""}</>}{activeDocument.parser?.engine === "vision" && <><span>·</span>手写 / 看图识别</>}{activeDocument.recognition && <><span>·</span>{activeDocument.recognition.pages.filter(page => page.reviewed).length} / {activeDocument.recognition.pages.length} 页已校对</>}</p>{activeDocument.hasOriginal && <a className="text-button cw-original-link" href={`/api/documents/${encodeURIComponent(activeDocument.id)}/original`} target="_blank" rel="noreferrer">查看原文件 <ArrowRight size={16} /></a>}</div>
        {activeDocument.warning && <div className="cw-warning"><WarningCircle size={19} /><p>{activeDocument.warning}</p></div>}
        <div className="cw-reader-tabs" data-reader-tab={readerTab} role="tablist" aria-label="阅读方式"><span className="cw-reader-tab-indicator" aria-hidden="true" /><button type="button" id={`${readerId}-source-tab`} role="tab" aria-controls={`${readerId}-source`} aria-selected={readerTab === "source"} tabIndex={readerTab === "source" ? 0 : -1} onKeyDown={switchReaderTab} onClick={() => setReaderTab("source")}><BookOpen size={18} />阅读原文</button><button type="button" id={`${readerId}-summary-tab`} role="tab" aria-controls={`${readerId}-summary`} aria-selected={readerTab === "summary"} tabIndex={readerTab === "summary" ? 0 : -1} onKeyDown={switchReaderTab} onClick={() => setReaderTab("summary")}><Sparkle size={18} />重点摘录</button></div>
        <div className="source-pages cw-source" id={`${readerId}-source`} role="tabpanel" aria-labelledby={`${readerId}-source-tab`} hidden={readerTab !== "source"} tabIndex={0}><h3>{activeDocument.recognition ? "原件与识别文字" : "原文与出处"}</h3><p className="cw-reader-note">{activeDocument.recognition ? "对照原件逐页核对，模糊的字迹与公式可在这里修正。" : "以下为提取的文字内容，页码或段落编号用于核对来源。"}</p>{activeDocument.recognition || activeDocument.parser?.engine === "vision" ? <HandwritingPages key={activeDocument.id} document={activeDocument} onSaved={setSavedRecognition} onRefresh={onRefresh} onNotify={onNotify} /> : canonicalReadingChunks(activeDocument).map((chunk, index) => <article key={chunk.id || index} data-chunk-id={chunk.id} data-source-page={chunk.page} tabIndex={-1}><span className="cw-location">第 {chunk.page} {locationName(activeDocument)}{chunk.bbox && <small> · 已保留原文位置</small>}</span>{activeDocument.origin?.kind === "ai-notes" || activeDocument.origin?.kind === "lecture-notes" ? <RecognizedText text={chunk.text} /> : <p>{chunk.text}</p>}{activeDocument.hasOriginal && activeDocument.type === "PDF" && <a className="text-button cw-page-link" href={`/api/documents/${encodeURIComponent(activeDocument.id)}/original#page=${chunk.page}`} target="_blank" rel="noreferrer">在 PDF 中核对第 {chunk.page} 页 <ArrowRight size={15} /></a>}</article>)}{!activeDocument.chunks.length && <p className="cw-reader-note">这份资料暂无可展示的文字片段。</p>}</div>
        <div className="extracted cw-extracted" id={`${readerId}-summary`} role="tabpanel" aria-labelledby={`${readerId}-summary-tab`} hidden={readerTab !== "summary"} tabIndex={0}><h3>资料要点 · 原文抽取</h3><p className="cw-reader-note">来自文档中的主要段落，不代表考试命中率。</p>{activeDocument.summary.length ? <ol>{activeDocument.summary.map((summary, index) => <li key={index}>{activeDocument.recognition ? <RecognizedText text={summary} /> : activeDocument.locationKind === "section" ? summary.replace(/第 (\d+) 页/g, "第 $1 段") : summary}</li>)}</ol> : <p className="cw-reader-note">还没有可提取的重点，请先阅读原文。</p>}<button className="secondary" type="button" disabled={!course} onClick={onPractice}>查找与解释知识点<ArrowRight size={16} /></button></div>
      </section>}

      {course && <details className="cw-assistant"><summary><span className="cw-assistant-icon"><Sparkle size={21} /></span><span><strong>哪里还没弄懂？</strong><small>{providerConfigured ? "结合这门课的资料，展开讲解" : "在这门课的资料里，找一找答案"}</small></span><CaretDown size={18} /></summary><div className="cw-assistant-body"><p className="cw-reader-note">{providerConfigured ? "回答基于本课程资料，查看出处核对细节。" : "当前使用原文检索，返回相关资料片段。"}</p><form onSubmit={ask}><label htmlFor={`${readerId}-question`}>问一个知识点</label><textarea id={`${readerId}-question`} aria-label="询问本课程知识点" value={question} onChange={event => setQuestion(event.target.value)} placeholder="例如：这个概念是什么意思，和前一章有什么关系？" rows={3} maxLength={2000} required disabled={asking || !documents.length} /><div className="cw-question-actions"><span>只查找当前课程的资料</span><button type="submit" className="primary" disabled={asking || !question.trim() || !documents.length}>{asking ? <SpinnerGap className="cw-spinning" size={18} /> : <ArrowRight size={18} />}{asking ? "正在查找…" : providerConfigured ? "获取讲解" : "查找相关资料"}</button></div></form>{askError && <p className="cw-ask-error" role="alert"><WarningCircle size={18} />{askError}</p>}{answer && <div className="cw-answer retrieval-result" aria-live="polite"><span className="cw-answer-mode">{answer.mode === "ai" ? "资料辅助讲解" : "原文检索结果"}</span><p>{answer.answer}</p>{answer.sources.map((source, index) => <details key={`${source.documentName}-${source.page}-${index}`}><summary><FileText size={16} /><span>{source.documentName} · 第 {source.page} {source.locationKind === "section" ? "段" : /\.pptx?$/i.test(source.documentName) ? "张" : "页"}</span><CaretDown size={16} /></summary><p>{source.text}</p></details>)}</div>}</div></details>}
    </div>
  </section>;
}
