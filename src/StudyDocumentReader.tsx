import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowSquareOut, DownloadSimple, FilePdf, FileDoc, WarningCircle } from "@phosphor-icons/react";
import { LoadingMark } from "./ui/controls";
import PdfDocumentView from "./PdfDocumentView";
import "./study-document-reader.css";

type Props = { title: string; endpoint: string; onClose: () => void; onRevise?: () => void; onPractice?: () => void; previewTimeoutMs?: number };
const fileName = (title: string, format: string) => `${title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").slice(0, 100) || "考谱学习讲义"}.${format}`;

export default function StudyDocumentReader({ title, endpoint, onClose, onRevise, onPractice, previewTimeoutMs = 45000 }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLElement | null>(null);
  const [pdf, setPdf] = useState(""), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [downloadError, setDownloadError] = useState(""), [downloading, setDownloading] = useState(false), [retry, setRetry] = useState(0);
  const requests = useRef(new Set<AbortController>());
  const urlFor = (format: string) => `${endpoint}${endpoint.includes('?') ? '&' : '?'}format=${format}${format === 'pdf' ? '&inline=1' : ''}`;
  useEffect(() => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = dialog.current; node?.showModal();
    return () => { node?.close(); requests.current.forEach(request => request.abort()); trigger.current?.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = "";
    const deadline = window.setTimeout(() => {
      controller.abort();
      setError("PDF 排版等待时间较长，请重试，或先下载 Word 继续复习。"); setLoading(false);
    }, previewTimeoutMs);
    setLoading(true); setError(""); setPdf(""); requests.current.add(controller);
    void fetch(`${endpoint}${endpoint.includes('?') ? '&' : '?'}format=pdf&inline=1`, { signal: controller.signal, credentials: "include" }).then(async response => {
      if (response.status === 401) window.dispatchEvent(new Event("shifen:session-expired"));
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "PDF 暂未生成，请重试或下载 Word。"); }
      if (!response.headers.get('content-type')?.includes('application/pdf')) throw new Error("没有收到有效的 PDF，请重新打开讲义。");
      const blob = await response.blob(); if (controller.signal.aborted) return;
      if (!blob.size) throw new Error("PDF 文件为空，请重新生成讲义。");
      objectUrl = URL.createObjectURL(blob); setPdf(objectUrl);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "PDF 读取失败，请重试。"); })
      .finally(() => { window.clearTimeout(deadline); requests.current.delete(controller); if (!controller.signal.aborted) setLoading(false); });
    return () => { window.clearTimeout(deadline); controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [endpoint, retry, previewTimeoutMs]);
  async function download(format: "pdf" | "docx") {
    if (downloading) return;
    if (format === "pdf" && pdf) { const link = document.createElement('a'); link.href = pdf; link.download = fileName(title, format); link.click(); return; }
    const controller = new AbortController(); requests.current.add(controller); setDownloading(true); setDownloadError("");
    const deadline = window.setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(urlFor(format), { credentials: "include", signal: controller.signal });
      if (response.status === 401) window.dispatchEvent(new Event("shifen:session-expired"));
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "文件未能下载，请重试。"); }
      const mime = response.headers.get("content-type") || "";
      if (!(format === "pdf" ? mime.includes("application/pdf") : mime.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document"))) throw new Error("没有收到有效的文档文件，请稍后重试。");
      const blob = await response.blob(); if (controller.signal.aborted) return;
      if (!blob.size) throw new Error("文件为空，请重新生成文档。");
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = fileName(title, format); link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setDownloadError(controller.signal.aborted ? "文档准备超时，请稍后重新下载。" : cause instanceof Error ? cause.message : "下载未完成。"); }
    finally { window.clearTimeout(deadline); requests.current.delete(controller); setDownloading(false); }
  }
  return <dialog className="study-document-reader" ref={dialog} aria-label={`文档阅读：${title}`} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="sdr-toolbar"><button type="button" className="sdr-back" aria-label="关闭文档阅读" onClick={onClose}><ArrowLeft size={18} />返回</button><div className="sdr-title"><FilePdf size={18} /><h2>{title}</h2></div><div className="sdr-downloads"><button type="button" disabled={downloading || loading || !pdf} onClick={() => void download("pdf")}><DownloadSimple size={17} />PDF</button><button type="button" disabled={downloading} onClick={() => void download("docx")}><FileDoc size={17} />{downloading ? "准备中…" : "下载 Word"}</button></div></header>
    {downloadError && <p className="sdr-error" role="alert">{downloadError}</p>}
    <div className="sdr-viewer">{loading ? <div className="sdr-loading" role="status"><LoadingMark size={24} /><strong>正在排版讲义…</strong><p>通常需要几秒，稍长的讲义可以先下载 Word。</p></div> : error ? <div className="sdr-failure" role="alert"><WarningCircle size={32} /><h3>讲义暂未打开</h3><p>{error}</p><div><button type="button" onClick={() => setRetry(value => value + 1)}>重新加载 PDF</button><button type="button" disabled={downloading} onClick={() => void download("docx")}>先下载 Word</button></div></div> : <PdfDocumentView url={pdf} title={title} onError={setError} />}</div>
    <footer className="sdr-footer"><span>PDF 阅读 · Word 可下载后编辑</span><div>{pdf && <a href={pdf} target="_blank" rel="noreferrer"><ArrowSquareOut size={15} />新窗口阅读</a>}{onRevise && <button type="button" onClick={onRevise}>修订笔记</button>}{onPractice && <button type="button" onClick={onPractice}>据此练习<ArrowSquareOut size={15} /></button>}</div></footer>
  </dialog>;
}
