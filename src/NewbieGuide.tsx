import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "@phosphor-icons/react";
import "./newbie-guide.css";

export type GuideStep = { title: string; body: string; target?: string };

const OFF_KEY = "shifen:guide";
const SNOOZE_KEY = "shifen:guide-snooze";
function read(key: string) {
  try { return localStorage.getItem(key) === "1" || sessionStorage.getItem(key) === "1"; }
  catch { return false; }
}

export default function NewbieGuide({ id, steps }: { id: string; steps: GuideStep[] }) {
  const [closed, setClosed] = useState(() => read(`${OFF_KEY}:${id}`) || read(`${SNOOZE_KEY}:${id}`));
  const [step, setStep] = useState(0);
  const current = steps[step];

  useEffect(() => {
    if (closed || !current?.target) return;
    const node = document.querySelector(current.target);
    if (!(node instanceof HTMLElement)) return;
    node.classList.add("sf-guide-focus");
    return () => { node.classList.remove("sf-guide-focus"); };
  }, [closed, current]);

  if (closed || !current) return null;
  const dismiss = (forever: boolean) => {
    try { (forever ? localStorage : sessionStorage).setItem(`${forever ? OFF_KEY : SNOOZE_KEY}:${id}`, "1"); }
    catch { /* 存储不可用时本次关闭仍然生效。 */ }
    setClosed(true);
  };
  return <aside className="newbie-guide" role="dialog" aria-label="新手指引">
    <header className="newbie-guide-head">
      <span>新手指引 · {step + 1}/{steps.length}</span>
      <button type="button" className="newbie-guide-close" aria-label="关闭新手指引" onClick={() => dismiss(false)}><X size={16} /></button>
    </header>
    <h3>{current.title}</h3>
    <p>{current.body}</p>
    <div className="newbie-guide-actions">
      <button type="button" disabled={step === 0} onClick={() => setStep(value => value - 1)}><ArrowLeft size={15} />上一步</button>
      {step < steps.length - 1
        ? <button type="button" className="newbie-guide-next" onClick={() => setStep(value => value + 1)}>下一步<ArrowRight size={15} /></button>
        : <button type="button" className="newbie-guide-next" onClick={() => dismiss(true)}>知道啦</button>}
    </div>
    <div className="newbie-guide-dismiss">
      <button type="button" onClick={() => dismiss(false)}>这次先关掉</button>
      <span aria-hidden="true">·</span>
      <button type="button" onClick={() => dismiss(true)}>以后不再提示</button>
    </div>
  </aside>;
}
