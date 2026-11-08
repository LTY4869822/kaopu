import { CaretDown, Check, FileText, ImageSquare } from "@phosphor-icons/react";
import LessonText from "./LessonText";
import type { LessonCorrection } from "./lesson-types";

export default function LessonCorrections({ corrections = [], onLocate, onOpenFrame }: {
  corrections?: LessonCorrection[];
  onLocate: (cueId: string) => void;
  onOpenFrame: (frameId: string) => void;
}) {
  if (!corrections.length) return null;
  return <details className="lesson-corrections">
    <summary><Check size={17} />术语与公式校对 <span>{corrections.length}</span><CaretDown size={16} /></summary>
    <div>{corrections.map((item, index) => <article key={`${item.cueIds.join("-")}-${index}`}>
      <div className="lesson-correction-comparison"><span>原转写</span><LessonText text={item.original} /><span>校对建议</span><LessonText text={item.corrected || "未能确定，保留原文"} /></div>
      <p>{item.reason}</p>
      <div className="lesson-correction-sources">
        {!!item.cueIds.length && <button type="button" onClick={() => onLocate(item.cueIds[0])}><FileText size={15} />对照原文</button>}
        {!!item.frameIds.length && <button type="button" onClick={() => onOpenFrame(item.frameIds[0])}><ImageSquare size={15} />查看板书</button>}
        <small>{item.frameIds.length ? "有画面依据，仍需核对" : "依据上下文，需回听确认"}</small>
      </div>
    </article>)}</div>
  </details>;
}
