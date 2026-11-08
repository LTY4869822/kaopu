import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUUpLeft, Check, FilePdf, FilePpt, FileText, Plus } from "@phosphor-icons/react";
import "./focus-sculpture.css";

/** A local, reversible product illustration. It never creates or uploads a document. */
export default function FocusSculpture({ quiet }: { quiet: boolean }) {
  const [gathered, setGathered] = useState(false);
  const [reduced, setReduced] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const node = host.current;
    if (!node || quiet || reduced || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let frame = 0;
    let visible = true;
    let bounds: DOMRect | null = null;
    let x = 0;
    let y = 0;
    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      bounds = null;
      node.style.setProperty("--sf-pointer-x", "0deg");
      node.style.setProperty("--sf-pointer-y", "0deg");
    };
    const enter = () => { bounds = node.getBoundingClientRect(); };
    const move = (event: PointerEvent) => {
      if (!visible || event.pointerType !== "mouse") return;
      bounds ||= node.getBoundingClientRect();
      x = ((event.clientX - bounds.left) / bounds.width - .5) * 5;
      y = ((event.clientY - bounds.top) / bounds.height - .5) * -4;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        node.style.setProperty("--sf-pointer-x", `${x.toFixed(2)}deg`);
        node.style.setProperty("--sf-pointer-y", `${y.toFixed(2)}deg`);
      });
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false;
      if (!visible) reset();
    });
    observer.observe(node);
    node.addEventListener("pointerenter", enter);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerleave", reset);
    window.addEventListener("resize", reset);
    return () => {
      observer.disconnect();
      node.removeEventListener("pointerenter", enter);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerleave", reset);
      window.removeEventListener("resize", reset);
      reset();
    };
  }, [quiet, reduced]);

  return <div className="sf-sculpture" ref={host} data-state={gathered ? "gathered" : "scattered"} data-quiet={quiet || reduced ? "true" : "false"}>
    <div className="sf-sculpture-meta" aria-hidden="true"><span>THE STUDY ASSEMBLY</span><span>01 / 03</span></div>
    <div className="sf-sculpture-scene" id={`${id}-scene`} role="img" aria-label={gathered ? "三份示例资料已整理成一份高等数学复习笔记" : "课堂讲义、课件与手写笔记，三份分散的示例资料"}>
      <div className="sf-sculpture-floor" aria-hidden="true"><i /><i /><i /></div>
      <div className="sf-sculpture-stage">
        <article className="sf-sculpture-sheet sf-sculpture-pdf" aria-hidden={gathered}>
          <div className="sf-sculpture-filetype"><FilePdf size={15} weight="light" /><span>LECTURE NOTES</span><small>01</small></div>
          <h3>高等数学</h3><p className="sf-sculpture-sheet-subtitle">第二章 · 导数与微分</p>
          <div className="sf-sculpture-pdf-rule" />
          <span className="sf-sculpture-section-index">2.1</span><h4>从变化，理解导数。</h4>
          <p className="sf-sculpture-sheet-copy">不是把公式记下来，<br />是看清它在说什么。</p>
          <div className="sf-sculpture-formula" aria-label="函数在x处的导数等于h趋于0时，函数增量除以h的极限"><span>f ′(x) =</span><span className="sf-sculpture-limit">lim<small>h → 0</small></span><span className="sf-sculpture-fraction"><span>f(x + h) − f(x)</span><span>h</span></span></div>
          <div className="sf-sculpture-paper-lines" aria-hidden="true"><i /><i /><i /></div>
          <div className="sf-sculpture-sheet-footer"><span>课堂讲义.pdf</span><span>06 / 28</span></div>
        </article>

        <article className="sf-sculpture-sheet sf-sculpture-handwriting" aria-hidden={gathered}>
          <div className="sf-sculpture-filetype"><FileText size={15} weight="light" /><span>MY FIELD NOTES</span><small>02</small></div>
          <div className="sf-sculpture-handwritten"><p>先看条件。</p><span>连续 ≠ 可导</span><p>左右两边，<br />要一起算。</p><i aria-hidden="true" /><small>f(x) = |x|</small></div>
          <div className="sf-sculpture-sheet-footer"><span>我的课堂笔记.jpg</span><span>1 / 3</span></div>
        </article>

        <article className="sf-sculpture-sheet sf-sculpture-slides" aria-hidden={gathered}>
          <div className="sf-sculpture-filetype"><FilePpt size={15} weight="light" /><span>CLASS EXERCISES</span><small>03</small></div>
          <span className="sf-sculpture-section-index">例题 / 01</span><h4>左右都存在，<br />就一定可导吗？</h4>
          <div className="sf-sculpture-graph" aria-label="绝对值函数图像在原点呈尖角"><span>y</span><span>x</span><i /><i /></div>
          <p className="sf-sculpture-sheet-copy">左导数 −1，右导数 1。</p>
          <div className="sf-sculpture-sheet-footer"><span>课堂例题.pptx</span><span>04 / 16</span></div>
        </article>

        <div className="sf-sculpture-bound-pages" aria-hidden="true"><i /><i /><i /><i /></div>
        <article className="sf-sculpture-sheet sf-sculpture-notebook" aria-hidden={!gathered}>
          <div className="sf-sculpture-filetype"><span className="sf-sculpture-notebook-mark">考</span><span>YOUR STUDY EDITION</span><small>01</small></div>
          <p className="sf-sculpture-notebook-eyebrow">高等数学 / 第二章</p><h3>把导数，<br />真正读懂。</h3>
          <p className="sf-sculpture-notebook-subtitle">你的课件、例题与笔记，整理成一份。</p>
          <div className="sf-sculpture-notebook-rule" />
          <ol className="sf-sculpture-notebook-toc"><li><span>01</span><strong>定义与成立条件</strong><span>02</span></li><li><span>02</span><strong>典型例题与推导</strong><span>04</span></li><li><span>03</span><strong>易错点与自测</strong><span>06</span></li></ol>
          <div className="sf-sculpture-notebook-source"><span><Check size={11} weight="bold" />合并重复知识</span><span><Check size={11} weight="bold" />保留资料来源</span></div>
          <div className="sf-sculpture-sheet-footer"><span>复习笔记 · 示例</span><span>KAOPU</span></div>
        </article>
        <div className="sf-sculpture-edge-label" aria-hidden="true"><span>SCATTERED INPUT.</span><ArrowDown size={13} /><span>CLEAR THINKING.</span></div>
      </div>
    </div>
    <div className="sf-sculpture-controls">
      <button type="button" aria-pressed={gathered} aria-controls={`${id}-scene`} onClick={() => setGathered(value => !value)}>
        {gathered ? <ArrowUUpLeft size={15} /> : <Plus size={15} />}<span>{gathered ? "重新展开资料" : "整理示例资料"}</span><ArrowRight size={16} />
      </button>
      <span className="sf-sculpture-status" role="status" aria-live="polite"><i />{gathered ? "3 份资料 → 1 份笔记" : "3 份资料，等待归位"}</span>
    </div>
    <p className="sf-sculpture-disclaimer">交互示例 · 不会写入真实课程</p>
  </div>;
}
