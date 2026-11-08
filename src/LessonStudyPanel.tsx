import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, Camera, CaretDown, Check, WarningCircle } from "@phosphor-icons/react";
import type { LessonStudy } from "./lesson-types";
import "./lesson-study.css";

export const studyClock = (value: number) => `${Math.floor(value / 3600) ? `${Math.floor(value / 3600)}:` : ""}${String(Math.floor(value / 60) % 60).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
const seconds = (text: string) => {
  if (!/^\d{1,3}:\d{2}(?::\d{2})?$/.test(text.trim())) return NaN;
  const parts = text.trim().split(":").map(Number);
  if (parts.slice(1).some(part => part > 59)) return NaN;
  return parts.reduce((total, part) => total * 60 + part, 0);
};
type Props = { study?: LessonStudy; error: string; busy: boolean; canCapture: boolean; canRead: boolean; canEnrich: boolean;
  onRetry: () => void;
  weakOnly: boolean; onWeakOnly: (value: boolean) => void; duration?: number; outdated: boolean; onContinue: (kind: "section" | "example", id: string) => void;
  onResolve: (issue: LessonStudy["issues"][number]) => void; onSupplement: (range: { start: number; end: number }) => void; onUpdate: () => void };

export default function LessonStudyPanel({ study, error, busy, canCapture, canRead, canEnrich, duration, outdated, weakOnly, onWeakOnly, onContinue, onResolve, onSupplement, onUpdate, onRetry }: Props) {
  const [start, setStart] = useState("00:00"), [end, setEnd] = useState("00:30"), [formError, setFormError] = useState("");
  const [limit, setLimit] = useState(8);
  const supplement = useRef<HTMLDetailsElement>(null);
  const startInput = useRef<HTMLInputElement>(null);
  useEffect(() => { setLimit(8); }, [study?.version]);
  const pick = (issue: LessonStudy["issues"][number]) => {
    if (issue.kind !== "gap") { onResolve(issue); return; }
    setStart(studyClock(issue.start || 0)); setEnd(studyClock(issue.end || 30)); setFormError("");
    if (supplement.current) supplement.current.open = true;
    startInput.current?.focus();
  };
  return <section className="lesson-study" aria-label="本课复习进度与待完善内容">
    <div className="lesson-study-progress"><BookOpen size={18} /><span>{study ? <>已读 <b>{study.progress.readCount}/{study.progress.sectionCount}</b>{study.progress.weakCount > 0 && <> · 需巩固 <b>{study.progress.weakCount}</b></>}</> : "正在读取学习记录…"}</span>
      {study?.bookmark && <button type="button" onClick={() => onContinue(study.bookmark!.kind, study.bookmark!.id)} title={study.bookmark.title}>继续上次阅读<ArrowRight size={15} /></button>}
    </div>
    {study && (study.progress.weakCount > 0 || weakOnly) && <div className="lesson-study-filter" role="group" aria-label="讲义复习范围"><button type="button" aria-pressed={!weakOnly} onClick={() => onWeakOnly(false)}>全部内容</button><button type="button" aria-pressed={weakOnly} onClick={() => onWeakOnly(true)}>只看需巩固 · {study.progress.weakCount}</button></div>}
    {error && <div className="lesson-study-error" role="alert">{error}<button type="button" disabled={busy} onClick={onRetry}>重试学习记录</button></div>}
    {outdated && <div className="lesson-study-outdated" role="status"><WarningCircle size={18} /><span>新截图已保留，重新生成笔记后即可用于复习。</span><button type="button" disabled={busy} onClick={onUpdate}>重新生成笔记<ArrowRight size={15} /></button></div>}
    {!!study?.issueCount && <details className="lesson-study-issues"><summary><WarningCircle size={16} />待完善 <span>{study.issueCount}</span><CaretDown size={16} /></summary>
      <ul>{study.issues.slice(0, limit).map(issue => <li key={`${issue.kind}:${issue.id}`}><div><strong>{issue.time != null && <time>{studyClock(issue.time)} · </time>}{issue.title}</strong><p>{issue.detail}</p></div>
        <button type="button" disabled={busy || issue.kind === "gap" && !canCapture || issue.action === "read" && !canRead || issue.action === "enrich" && !canEnrich} onClick={() => pick(issue)}>{issue.kind === "notes" ? "重新生成笔记" : issue.kind === "gap" ? "补截这段" : issue.action === "read" ? "重新识别" : issue.action === "enrich" ? "补全答案" : "去看字幕"}<ArrowRight size={14} /></button></li>)}</ul>
      {study.issues.length > limit && <button type="button" className="lesson-study-more" onClick={() => setLimit(value => value + 12)}>再显示 {Math.min(12, study.issues.length - limit)} 项<CaretDown size={14} /></button>}
      <p className="lesson-study-footnote">这是来源检查清单，不代表已核验全部内容。</p>
    </details>}
    {canCapture && <details className="lesson-study-supplement" ref={supplement}><summary><Camera size={16} />补截指定时段<CaretDown size={15} /></summary><form onSubmit={event => {
      event.preventDefault(); const from = seconds(start), to = seconds(end);
      if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to - from < 1 || to - from > 120 || to > (duration || 7200)) { setFormError("请填写有效的起止时间，一次补截 1–120 秒。"); return; }
      setFormError(""); onSupplement({ start: from, end: to });
    }}><label>开始<input ref={startInput} aria-label="补截开始时间" value={start} onChange={event => { setStart(event.target.value); setFormError(""); }} placeholder="12:30" maxLength={9} disabled={busy} /></label><span aria-hidden="true">→</span><label>结束<input aria-label="补截结束时间" value={end} onChange={event => { setEnd(event.target.value); setFormError(""); }} placeholder="13:00" maxLength={9} disabled={busy} /></label><button type="submit" disabled={busy}><Camera size={15} />{busy ? "处理中…" : "补截画面"}</button></form><p>保留已有截图，每次最多补充 12 张。{!canRead && "开启看图能力后可以识别。"}</p>{formError && <p role="alert" className="lesson-study-error">{formError}</p>}</details>}
    {study && !study.issueCount && <p className="lesson-study-clear"><Check size={14} />暂未发现上述来源缺口，公式和结论仍请结合原课核对。</p>}
  </section>;
}
