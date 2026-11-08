import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowClockwise, ArrowSquareOut, ImageSquare, MagnifyingGlassPlus, WarningCircle, X } from "@phosphor-icons/react";
import { forgetLessonImage, lessonFrameTime, loadLessonImage } from "./lesson-assets";
import "./lesson-evidence-image.css";

type Frame = { id: string; time: number; imageUrl: string; width?: number; height?: number };
type AssetProps = { src: string; alt: string; width?: number; height?: number; eager?: boolean; thumbnail?: boolean; onReady?: (url: string) => void };

export function AuthenticatedLessonImage({ src, alt, width = 1920, height = 1080, eager = false, thumbnail = false, onReady }: AssetProps) {
  const holder = useRef<HTMLSpanElement | null>(null);
  const callback = useRef(onReady); callback.current = onReady;
  const [visible, setVisible] = useState(eager);
  const [attempt, setAttempt] = useState(0);
  const [image, setImage] = useState<{ src: string; url: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (eager || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(item => item.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "300px" });
    if (holder.current) observer.observe(holder.current);
    return () => observer.disconnect();
  }, [eager, src]);
  useEffect(() => {
    if (!visible) return;
    let alive = true, localUrl = "";
    setImage(null); setError("");
    void loadLessonImage(src, attempt > 0).then(blob => {
      if (!alive) return;
      localUrl = URL.createObjectURL(blob); setImage({ src, url: localUrl }); callback.current?.(localUrl);
    }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "图片暂未加载，请重试。" ); });
    return () => { alive = false; if (localUrl) URL.revokeObjectURL(localUrl); };
  }, [src, visible, attempt]);
  useEffect(() => {
    if (!error) return;
    const retry = () => setAttempt(value => value + 1);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [error]);
  const current = image?.src === src ? image.url : "";
  return <span className={`lesson-asset ${thumbnail ? "is-thumbnail" : ""}`} ref={holder} style={{ aspectRatio: `${width} / ${height}` }}>
    {current && !error ? <img src={current} alt={alt} width={width} height={height} decoding="async" onError={() => { forgetLessonImage(src); setError("图片无法显示，请重新加载。" ); }} />
      : error ? <span className="lesson-asset-error" role={thumbnail ? undefined : "status"}><WarningCircle size={thumbnail ? 20 : 25} aria-hidden="true" />{!thumbnail && <><span>{error}</span><button type="button" onClick={() => setAttempt(value => value + 1)}><ArrowClockwise size={16} />重新加载图片</button></>}</span>
      : <span className="lesson-asset-loading" aria-label={thumbnail ? undefined : "正在加载课程画面"}><ImageSquare size={thumbnail ? 20 : 28} aria-hidden="true" />{!thumbnail && <span>正在加载原始画面</span>}</span>}
  </span>;
}

export default function LessonEvidenceImage({ frame, caption, onOpenSource, eager = false }: { frame: Frame; caption?: string; onOpenSource?: () => void; eager?: boolean }) {
  const [zoom, setZoom] = useState(false);
  const zoomButton = useRef<HTMLButtonElement | null>(null);
  const label = `课程 ${lessonFrameTime(frame.time)} 的原始画面`;
  return <figure className="lesson-evidence-image">
    <AuthenticatedLessonImage src={frame.imageUrl} alt={label} width={frame.width} height={frame.height} eager={eager} />
    <figcaption><span><time>{lessonFrameTime(frame.time)}</time>{caption || "原课截图"}</span><span className="lesson-evidence-actions"><button type="button" ref={zoomButton} onClick={() => setZoom(true)}><MagnifyingGlassPlus size={16} />放大图片</button>{onOpenSource && <button type="button" onClick={onOpenSource}><ArrowSquareOut size={16} />回看原课</button>}</span></figcaption>
    <Dialog.Root open={zoom} onOpenChange={setZoom}><Dialog.Portal><Dialog.Overlay className="lesson-image-overlay" /><Dialog.Content className="lesson-image-dialog" onCloseAutoFocus={event => { event.preventDefault(); zoomButton.current?.focus(); }}>
      <header><Dialog.Title>{label}</Dialog.Title><Dialog.Close aria-label="关闭图片" className="lesson-image-close"><X size={22} /></Dialog.Close></header>
      <Dialog.Description className="sr-only">原始课程截图，可滚动查看细节。关闭后返回讲义。</Dialog.Description>
      <p className="lesson-image-zoom-hint">左右滑动查看图片细节</p>
      <div className="lesson-image-zoom"><AuthenticatedLessonImage src={frame.imageUrl} alt={label} width={frame.width} height={frame.height} eager /></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </figure>;
}
