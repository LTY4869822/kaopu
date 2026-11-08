import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowClockwise, Camera, CaretDown, Check, Image, Plug, Sparkle, UploadSimple, WarningCircle } from "@phosphor-icons/react";
import LessonText from "./LessonText";
import LessonEvidenceImage, { AuthenticatedLessonImage } from "./LessonEvidenceImage";
export { lessonVisualImageUrl } from "./lesson-assets";
import type { LessonVisual } from "./lesson-types";
import "./lesson-visual.css";

type Props = {
  visual?: LessonVisual;
  busy: boolean;
  configured: boolean;
  canCapture: boolean;
  focusedFrameId?: string;
  onAnalyze: (mode: "capture" | "read" | "analyze") => void;
  onUpload: (kind: "video" | "images", files: File[], times?: string) => void;
  onConnect: () => void;
};

const timeLabel = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const whole = Math.floor(seconds), hours = Math.floor(whole / 3600), minutes = Math.floor(whole / 60) % 60;
  return `${hours ? `${hours}:` : ""}${String(minutes).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
};

const formulaText = (value: string) => {
  const text = value.trim();
  if (text.startsWith("$$") || text.startsWith("\\[")) return text;
  const expression = text.startsWith("$") && text.endsWith("$") ? text.slice(1, -1) : text.startsWith("\\(") && text.endsWith("\\)") ? text.slice(2, -2) : text;
  return `$$${expression}$$`;
};
const noticeText = (value: string) => value
  .replace(/\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{10,}/gi, "[已省略]")
  .replace(/\bhttps?:\/\/\S+|[A-Za-z]:[\\/]\S+|\/(?:Users|home|tmp|var|private)\/\S+/g, "[已省略]");

export default function LessonVisualPanel({ visual, busy, configured, canCapture, focusedFrameId, onAnalyze, onUpload, onConnect }: Props) {
  const [selectedId, setSelectedId] = useState(focusedFrameId || "");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [times, setTimes] = useState("");
  const figure = useRef<HTMLDivElement | null>(null);
  const frames = visual?.frames || [];
  const observations = useMemo(() => new Map(visual?.observations.map(item => [item.frameId, item]) || []), [visual?.observations]);
  const preferredFrame = frames.reduce<typeof frames[number] | undefined>((best, frame) => {
    const score = (id: string) => {
      const item = observations.get(id);
      return item ? Math.min(item.latex.length, 10) * 20 + Math.min(item.visibleText.length, 400) / 10 - item.uncertainties.length * 2 : -1;
    };
    return !best || score(frame.id) > score(best.id) ? frame : best;
  }, undefined);
  const selected = frames.find(frame => frame.id === selectedId) || preferredFrame || frames[0];
  const observation = selected ? observations.get(selected.id) : undefined;
  const recognized = frames.filter(frame => observations.has(frame.id)).length;
  const missing = frames.length - recognized;
  const failed = !!selected && !!visual?.failures?.some(item => item.frameId === selected.id);
  const hasFocusedFrame = !!focusedFrameId && frames.some(frame => frame.id === focusedFrameId);

  useEffect(() => { setSelectedId(focusedFrameId || ""); }, [visual?.id, focusedFrameId]);
  useEffect(() => {
    if (hasFocusedFrame) figure.current?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [focusedFrameId, visual?.id, hasFocusedFrame]);

  const uploadControls = <details className="lesson-visual-upload">
    <summary><UploadSimple size={17} />上传本地视频或板书截图<CaretDown size={15} /></summary>
    <div className="lesson-visual-upload-body">
      <div className="lesson-visual-upload-row">
        <label>本地视频<input type="file" accept=".mp4,.m4v,.webm,.mov,.mkv,.flv,.m4s,video/*" disabled={busy} onChange={event => setVideoFile(event.target.files?.[0] || null)} /></label>
        <button type="button" className="secondary" disabled={busy || !videoFile} onClick={() => { if (videoFile) onUpload("video", [videoFile]); setVideoFile(null); }}><UploadSimple size={16} />上传并采集</button>
      </div>
      <div className="lesson-visual-upload-row">
        <label>板书截图（最多 12 张）<input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={event => setImageFiles(Array.from(event.target.files || []))} /></label>
        <button type="button" className="secondary" disabled={busy || !imageFiles.length || imageFiles.length > 12} onClick={() => { if (imageFiles.length) onUpload("images", imageFiles, times); setImageFiles([]); }}><UploadSimple size={16} />上传截图</button>
      </div>
      {!!imageFiles.length && <label>截图时间点（选填）<input value={times} disabled={busy} onChange={event => setTimes(event.target.value)} placeholder={`${imageFiles.length} 个秒数，用逗号分隔，例如 30, 95, 160`} /></label>}
      <p>视频不超过 256 MB、2 小时；截图每张不超过 4 MB。仅上传你有权使用的内容，原件会在本机归档。</p>
    </div>
  </details>;

  if (!frames.length) return <section className="lesson-visual-empty" aria-label="板书与课程画面">
    <Image size={36} weight="duotone" aria-hidden="true" />
    <h3>{busy ? "正在准备画面" : "把板书和题目也留下来"}</h3>
    <p>{busy ? "完成后自动更新。" : "从课程画面提取公式、图表和题干。"}</p>
    <div className="lesson-visual-actions">
      <button type="button" className="primary" disabled={busy || !canCapture} title={canCapture ? "从课程视频抽样采集关键帧" : "请先填写 B 站链接，或使用下方上传入口"} onClick={() => onAnalyze(configured ? "analyze" : "capture")}>{configured ? <Sparkle size={17} /> : <Camera size={17} />}{busy ? "处理中…" : configured ? "识别板书" : "采集关键帧"}</button>
      {!configured && <button type="button" className="secondary" disabled={busy} onClick={onConnect}><Plug size={17} />连接模型</button>}
    </div>
    {uploadControls}
    <p className="lesson-visual-boundary">抽样画面，未保证全课完整。</p>
    {!!visual?.warnings.length && <details className="lesson-visual-warnings"><summary>采样说明<CaretDown size={15} /></summary><ul>{visual.warnings.map((warning, index) => <li key={index}>{noticeText(warning)}</li>)}</ul></details>}
  </section>;

  return <section className="lesson-visual-panel" aria-label="板书与课程画面">
    <div className="lesson-visual-toolbar">
      <span className="lesson-visual-count">已识别 {recognized}/{frames.length} 帧</span>
      <div className="lesson-visual-actions">
        {!configured ? <button type="button" className="lesson-light-button" disabled={busy} onClick={onConnect}><Plug size={16} />连接模型识别</button>
          : missing > 0 && <button type="button" className="lesson-ai-button" disabled={busy} onClick={() => onAnalyze("read")}><Sparkle size={16} />{busy ? "处理中…" : recognized ? "重试未完成画面" : "读取已有画面"}</button>}
        <button type="button" className="lesson-visual-recapture icon-button" aria-label="重新采集关键帧" title={canCapture ? "重新采集关键帧" : "请先上传本地视频或关联课程链接"} disabled={busy || !canCapture} onClick={() => onAnalyze("capture")}><ArrowClockwise size={18} /></button>
      </div>
    </div>
    <p className="lesson-visual-boundary">抽样画面，未保证全课完整。</p>
    {uploadControls}
    {busy && <p className="lesson-visual-progress" role="status">处理中，完成后自动更新。</p>}
    <div className="lesson-visual-strip" role="group" aria-label="选择课程画面">
      {frames.map(frame => {
        const read = observations.has(frame.id);
        return <button type="button" key={frame.id} className={selected?.id === frame.id ? "is-selected" : ""} aria-pressed={selected?.id === frame.id} aria-label={`查看 ${timeLabel(frame.time)} 的画面${read ? "，已识别" : ""}`} onClick={() => setSelectedId(frame.id)}>
          <AuthenticatedLessonImage src={frame.imageUrl} alt="" width={frame.width} height={frame.height} thumbnail />
          <span><time>{timeLabel(frame.time)}</time>{read && <Check size={13} aria-label="已识别" />}</span>
        </button>;
      })}
    </div>
    {selected && <>
      <div className="lesson-visual-frame" ref={figure}><LessonEvidenceImage frame={selected} caption="原始板书与课堂画面" eager /></div>
      {observation ? <div className="lesson-visual-reading" key={selected.id}>
        {observation.description && <LessonText className="lesson-visual-description" text={observation.description} />}
        {!!observation.latex.length && <section className="lesson-visual-formulas" aria-label="画面中的公式">{observation.latex.map((formula, index) => <LessonText key={index} text={formulaText(formula)} />)}</section>}
        {!!observation.uncertainties.length && <div className="lesson-visual-uncertainties"><WarningCircle size={17} /><ul>{observation.uncertainties.map((item, index) => <li key={index}>{noticeText(item)}</li>)}</ul></div>}
        {observation.visibleText && <details className="lesson-visual-text" open={!observation.latex.length && !observation.description}><summary>画面文字<CaretDown size={16} /></summary><LessonText text={observation.visibleText} /></details>}
        {!!observation.inferences.length && <details className="lesson-visual-inferences"><summary>模型推断 · 待核对<CaretDown size={16} /></summary><ul>{observation.inferences.map((item, index) => <li key={index}><LessonText text={item} /></li>)}</ul></details>}
      </div> : <p className="lesson-visual-unread"><Image size={18} />{failed ? "这张画面未完成识别，可读取已有画面重试。" : configured ? "这张画面还未识别。" : "画面已采集，连接模型后提取文字和公式。"}</p>}
    </>}
    {(!!visual?.warnings.length || !!visual?.coverage.maxGapSeconds) && <details className="lesson-visual-warnings"><summary>采样与核对说明<CaretDown size={15} /></summary><p>最长采样间隔 {Math.ceil(visual?.coverage.maxGapSeconds || 0)} 秒。未采样区间可能还有板书或题目。</p>{!!visual?.warnings.length && <ul>{visual.warnings.map((warning, index) => <li key={index}>{noticeText(warning)}</li>)}</ul>}</details>}
  </section>;
}
