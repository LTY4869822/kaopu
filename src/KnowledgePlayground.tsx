import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { ArrowDownRight, ArrowUpRight, Check, FilePdf, FilePpt, FilmStrip, Sparkle } from "@phosphor-icons/react";
import "./knowledge-playground.css";

export default function KnowledgePlayground({ quiet }: { quiet: boolean }) {
  const [collected, setCollected] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({ x: .5, y: .5 });
  const collection = useRef(false);
  const motion = useRef({ phase: 0, blend: 0 });
  collection.current = collected;
  useEffect(() => {
    const host = stage.current, layer = canvas.current;
    if (!host || !layer) return;
    const context = layer.getContext("2d");
    if (!context) return;
    let frame = 0, visible = true, width = 600, height = 540;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const nodes = Array.from({ length: 43 }, (_, i) => ({
      x: ((i * 137.51) % 997) / 997,
      y: ((i * 263.37 + 83) % 991) / 991,
      char: ["+", "+", "·", "∫", "f′", "∑", "x²", "·"][i % 8],
    }));
    const draw = () => {
      if (!visible || document.hidden) { frame = 0; return; }
      const still = quiet || media.matches;
      let { phase, blend } = motion.current;
      phase += still ? 0 : .004;
      blend += ((collection.current ? 1 : 0) - blend) * (still ? 1 : .07);
      motion.current = { phase, blend };
      context.clearRect(0, 0, width, height);
      context.lineWidth = .6;
      nodes.forEach((node, index) => {
        const tx = .2 + (index % 7) * .1, ty = .19 + Math.floor(index / 7) * .1;
        const wave = still ? 0 : Math.sin(phase + index) * 5;
        const influence = still ? 0 : 1 - Math.min(1, Math.hypot(node.x - pointer.current.x, node.y - pointer.current.y) * 2);
        const x = (node.x * (1 - blend) + tx * blend) * width + wave + (pointer.current.x - .5) * influence * 24;
        const y = (node.y * (1 - blend) + ty * blend) * height + wave;
        context.fillStyle = index % 4 ? "#a99bc03d" : "#dcff7070";
        context.font = `${index % 8 < 3 ? 11 : 13}px Consolas,monospace`;
        context.fillText(node.char, x, y);
        if (blend > .05 && index < 36) {
          context.strokeStyle = `rgba(183,160,255,${blend * .09})`;
          context.beginPath(); context.moveTo(x + 12, y); context.lineTo(x + width * .075, y); context.stroke();
        }
      });
      if (!still) frame = requestAnimationFrame(draw); else frame = 0;
    };
    const restart = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };
    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width; height = entry.contentRect.height;
      const dpr = Math.min(devicePixelRatio, 2);
      layer.width = width * dpr; layer.height = height * dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0); restart();
    });
    resize.observe(host);
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; restart(); });
    observer.observe(host); media.addEventListener("change", restart); document.addEventListener("visibilitychange", restart);
    restart();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); observer.disconnect(); media.removeEventListener("change", restart); document.removeEventListener("visibilitychange", restart); };
  }, [quiet, collected]);
  function move(event: PointerEvent<HTMLDivElement>) {
    if (quiet || event.pointerType === "touch" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width, y = (event.clientY - bounds.top) / bounds.height;
    pointer.current = { x, y };
    event.currentTarget.style.setProperty("--kg-x", `${(x - .5) * 14}deg`);
    event.currentTarget.style.setProperty("--kg-y", `${(.5 - y) * 9}deg`);
  }
  function reset() { stage.current?.style.setProperty("--kg-x", "0deg"); stage.current?.style.setProperty("--kg-y", "0deg"); pointer.current = { x: .5, y: .5 }; }
  const cards = [
    { type: "PDF", title: "第二章 · 导数", note: "28 页课件", Icon: FilePdf },
    { type: "COURSE", title: "没看完的网课", note: "04:23 / 单侧导数", Icon: FilmStrip },
    { type: "PPT", title: "老师划的重点", note: "16 页课堂例题", Icon: FilePpt },
  ];
  return <div className={`kg-playground ${collected ? "is-collected" : ""} ${quiet ? "is-quiet" : ""}`} ref={stage} onPointerMove={move} onPointerLeave={reset} style={{ "--kg-x": "0deg", "--kg-y": "0deg" } as CSSProperties}>
    <canvas ref={canvas} className="kg-field" aria-hidden="true" />
    <div className="kg-coordinates"><span>KNOWLEDGE / PLAYGROUND</span><span>001 — KAOPU</span></div>
    <div className="kg-orbit kg-orbit-one" aria-hidden="true" /><div className="kg-orbit kg-orbit-two" aria-hidden="true" />
    <span className="kg-cross kg-cross-one" aria-hidden="true">+</span><span className="kg-cross kg-cross-two" aria-hidden="true">+</span>
    <div className="kg-system-label"><i />{collected ? "ORDER RESTORED" : "A LITTLE CHAOS IS OKAY"}</div>
    <div className="kg-cards" aria-hidden="true">{cards.map(({ type, title, note, Icon }, index) => <div className={`kg-fragment kg-fragment-${index}`} key={type}><div className="kg-fragment-type"><Icon size={17} /><span>{type}</span><span>0{index+1}</span></div><strong>{title}</strong><small>{note}</small><div className="kg-fragment-line" /><div className="kg-fragment-line short" /><span className="kg-fragment-check"><Check size={16} />归队</span></div>)}</div>
    <div className="kg-key-ground" aria-hidden="true"><span /><span /><span /><span /></div>
    <div className="kg-key-tilt"><button type="button" className="kg-key" onClick={() => setCollected(value => !value)} aria-pressed={collected} aria-label={collected ? "再次散开示例资料" : "按下考谱键，收拢示例资料"}><span className="kg-key-base" /><span className="kg-key-face"><span className="kg-key-top"><span>KAOPU</span><ArrowUpRight size={22} /></span><span className="kg-key-character">考</span><span className="kg-key-bottom"><span>COLLECT</span><span>↵</span></span></span></button></div>
    <span className="kg-spark kg-spark-one" aria-hidden="true">✳</span><span className="kg-spark kg-spark-two" aria-hidden="true">✦</span>
    <div className="kg-sticker"><Sparkle size={14} weight="fill" /><span>知识可散装<br /><strong>复习有章法</strong></span></div>
    <div className="kg-caption"><ArrowDownRight size={23} /><div><strong>{collected ? "归队了。就是这个感觉。" : "来，按一下「考」键。"}</strong><span aria-live="polite">{collected ? "3 份示例碎片已归位 · 再点可以散开" : "把散落的知识，重新聚在一起。"}</span></div><small>交互演示</small></div>
  </div>;
}
