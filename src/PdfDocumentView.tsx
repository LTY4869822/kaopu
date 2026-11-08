import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type RenderTask, type PageViewport } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { LoadingMark } from "./ui/controls";
import "./pdf-document-view.css";

GlobalWorkerOptions.workerSrc = workerUrl;
type Destination = string | unknown[];
type Outline = { title: string; dest: Destination };
type Link = { id: string; label: string; dest?: Destination; url?: string; left: number; top: number; width: number; height: number };
export default function PdfDocumentView({ url, title, onError }: { url: string; title: string; onError: (message: string) => void }) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), text = useRef<HTMLDivElement>(null);
  const renderTask = useRef<RenderTask | null>(null), errorHandler = useRef(onError); errorHandler.current = onError;
  const destination = useRef<{ page: number; top: number | null } | null>(null), rendered = useRef<{ page: number; viewport: PageViewport } | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null), [page, setPage] = useState(1), [pageInput, setPageInput] = useState("1");
  const [width, setWidth] = useState(0), [zoom, setZoom] = useState("fit"), [busy, setBusy] = useState(true);
  const [outline, setOutline] = useState<Outline[]>([]), [links, setLinks] = useState<Link[]>([]);
  useEffect(() => {
    const element = host.current; if (!element) return;
    const resize = new ResizeObserver(entries => setWidth(entries[0].contentRect.width)); resize.observe(element);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    let alive = true; setPdf(null); setPage(1); setOutline([]); setBusy(true);
    const loading = getDocument({ url, isEvalSupported: false, useSystemFonts: true });
    void loading.promise.then(async document => {
      if (!alive) return;
      setPdf(document);
      const items = await document.getOutline().catch(() => []);
      const result: Outline[] = [];
      const flatten = (nodes: typeof items, depth = 0) => { for (const node of nodes || []) { if (result.length >= 160) break; if (node.dest) result.push({ title: `${"　".repeat(Math.min(depth, 3))}${node.title}`, dest: node.dest }); flatten(node.items, depth + 1); } };
      flatten(items); if (alive) setOutline(result);
    }).catch(() => { if (alive) errorHandler.current("PDF 画面未能打开，请重新加载，或先下载 Word。"); });
    return () => { alive = false; renderTask.current?.cancel(); void loading.destroy().catch(() => {}); };
  }, [url]);
  useEffect(() => { setPageInput(String(page)); host.current?.scrollTo({ top: 0, left: 0 }); }, [page]);
  useEffect(() => {
    if (!pdf || !width || !canvas.current || !text.current) return;
    let alive = true, drawing: RenderTask | undefined, layer: TextLayer | undefined;
    const previous = renderTask.current; previous?.cancel(); setBusy(true); setLinks([]);
    void (async () => {
      await previous?.promise.catch(() => {}); if (!alive) return;
      const source = await pdf.getPage(page); if (!alive) return;
      const natural = source.getViewport({ scale: 1 }), scale = zoom === "fit" ? Math.max(.25, Math.min(1.8, (width - 32) / natural.width)) : Number(zoom);
      const viewport = source.getViewport({ scale }), pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const node = canvas.current!, container = text.current!, context = node.getContext("2d"); if (!context) throw new Error("Canvas unavailable");
      node.width = Math.ceil(viewport.width * pixelRatio); node.height = Math.ceil(viewport.height * pixelRatio);
      node.style.width = `${viewport.width}px`; node.style.height = `${viewport.height}px`;
      container.replaceChildren(); container.style.setProperty("--scale-factor", String(scale)); container.style.setProperty("--total-scale-factor", String(scale)); container.style.setProperty("--user-unit", "1");
      drawing = source.render({ canvas: node, canvasContext: context, viewport, transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0] }); renderTask.current = drawing;
      await drawing.promise; if (!alive) return;
      layer = new TextLayer({ textContentSource: source.streamTextContent(), container, viewport }); await layer.render(); if (!alive) return;
      const annotations = await source.getAnnotations({ intent: "display" }); if (!alive) return;
      setLinks(annotations.filter(item => item.subtype === "Link" && (item.dest || /^https?:\/\//i.test(item.url || ""))).slice(0, 200).map(item => {
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(item.rect);
        return { id: item.id, label: item.title || "跳到章节或引用出处", dest: item.dest, url: /^https?:\/\//i.test(item.url || "") ? item.url : undefined,
          left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
      }));
      rendered.current = { page, viewport };
      if (destination.current?.page === page) { const top = destination.current.top; host.current?.scrollTo({ top: top === null ? 0 : Math.max(0, viewport.convertToViewportPoint(0, top)[1] - 12) }); destination.current = null; }
      setBusy(false);
    })().catch(cause => { if (alive && cause?.name !== "RenderingCancelledException") errorHandler.current("这一页暂未显示，请重新加载 PDF，或下载 Word 继续阅读。"); });
    return () => { alive = false; drawing?.cancel(); layer?.cancel(); };
  }, [pdf, page, width, zoom]);
  async function goTo(targetDestination?: Destination) {
    if (!pdf || !targetDestination) return;
    try { const resolved = typeof targetDestination === "string" ? await pdf.getDestination(targetDestination) : targetDestination;
      if (!resolved?.length) return; const first = resolved[0]; const index = typeof first === "number" ? first : await pdf.getPageIndex(first as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
      if (index >= 0 && index < pdf.numPages) {
        const mode = (resolved[1] as { name?: string })?.name;
        const top = resolved[mode === "XYZ" ? 3 : 2];
        destination.current = { page: index + 1, top: ["XYZ", "FitH", "FitBH"].includes(mode || "") && typeof top === "number" ? top : null };
        if (rendered.current?.page === index + 1 && page === index + 1) { const target = destination.current.top; host.current?.scrollTo({ top: target === null ? 0 : Math.max(0, rendered.current.viewport.convertToViewportPoint(0, target)[1] - 12) }); destination.current = null; }
        setPage(index + 1);
      }
    } catch { /* A malformed PDF destination never runs code or leaves the app. */ }
  }
  function changePage(value: number) { if (pdf) setPage(Math.max(1, Math.min(pdf.numPages, value))); }
  return <section className="sdr-pdf" aria-label={`PDF正文：${title}`}>
    <div className="sdr-pdf-controls">
      <button type="button" aria-label="上一页" disabled={!pdf || page <= 1} onClick={() => changePage(page - 1)}><CaretLeft size={18} /></button>
      <form onSubmit={event => { event.preventDefault(); changePage(Number(pageInput) || page); setPageInput(String(Math.max(1, Math.min(pdf?.numPages || 1, Number(pageInput) || page)))); }}><input aria-label="阅读页码" type="number" min={1} max={pdf?.numPages || 1} value={pageInput} disabled={!pdf} onChange={event => setPageInput(event.target.value)} onBlur={() => changePage(Number(pageInput) || page)} /><span>/ {pdf?.numPages || "—"} 页</span></form>
      <button type="button" aria-label="下一页" disabled={!pdf || page >= pdf.numPages} onClick={() => changePage(page + 1)}><CaretRight size={18} /></button>
      <select aria-label="PDF缩放" value={zoom} onChange={event => setZoom(event.target.value)}><option value="fit">适合宽度</option>{[.75, 1, 1.25, 1.5, 2].map(value => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}</select>
      {outline.length > 0 && <select aria-label="讲义章节" defaultValue="" onChange={event => void goTo(outline[Number(event.target.value)]?.dest)}><option value="" disabled>跳转章节</option>{outline.map((item, index) => <option key={index} value={index}>{item.title}</option>)}</select>}
      <span className="sdr-pdf-status" role="status">{busy ? <><LoadingMark size={16} />正在显示…</> : `第 ${page} 页已显示`}</span>
    </div>
    <div className="sdr-pdf-scroll" ref={host} tabIndex={0} aria-label="讲义阅读区域" onKeyDown={event => { if (event.key === "PageDown" || event.key === "PageUp") { event.preventDefault(); changePage(page + (event.key === "PageDown" ? 1 : -1)); } }}>
      <div className="sdr-pdf-page" style={{ visibility: pdf ? "visible" : "hidden" }}>
        <canvas ref={canvas} aria-hidden="true" />
        <div className="sdr-pdf-text" ref={text} role="document" aria-label={`第 ${page} 页文字`} />
        {links.map(link => { const style = { left: link.left, top: link.top, width: link.width, height: link.height }; return link.url ? <a key={link.id} className="sdr-pdf-link" style={style} href={link.url} target="_blank" rel="noopener noreferrer" aria-label="打开文档链接" /> : <button type="button" key={link.id} className="sdr-pdf-link" style={style} aria-label={link.label} onClick={() => void goTo(link.dest)} />; })}
      </div>
    </div>
  </section>;
}
