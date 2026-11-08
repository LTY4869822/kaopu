import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { ArrowClockwise, ArrowDownRight, ArrowRight, Check, FilePdf, Hand, Play } from "@phosphor-icons/react";
import "./knowledge-garden.css";

type ObjectId = "pdf" | "matrix" | "notes" | "video";
type Position = { x: number; y: number; rotate: number; scale: number };
type Body = Position & { target: Position; vx: number; vy: number; vr: number; vs: number };
const items: { id: ObjectId; label: string; course: string; home: Position; pocket: Position }[] = [
  { id: "pdf", label: "课堂讲义", course: "高等数学", home: { x: -202, y: -133, rotate: -14, scale: 1 }, pocket: { x: -115, y: -24, rotate: -5, scale: .52 } },
  { id: "matrix", label: "矩阵课件", course: "线性代数", home: { x: 202, y: -132, rotate: 11, scale: 1 }, pocket: { x: 116, y: -18, rotate: 7, scale: .56 } },
  { id: "notes", label: "手写笔记", course: "高等数学", home: { x: -200, y: 130, rotate: 9, scale: 1 }, pocket: { x: -110, y: 107, rotate: -8, scale: .52 } },
  { id: "video", label: "网课片段", course: "高等数学", home: { x: 205, y: 125, rotate: -11, scale: 1 }, pocket: { x: 113, y: 103, rotate: 8, scale: .58 } },
];
const makeBodies = () => Object.fromEntries(items.map(item => [item.id, { ...item.home, target: { ...item.home }, vx: 0, vy: 0, vr: 0, vs: 0 }])) as Record<ObjectId, Body>;
const unit = (value: number) => `${(value / 650 * 100).toFixed(4)}cqw`;
const spring = (value: number, target: number, velocity: number, delta: number) => {
  const nextVelocity = (velocity + (target - value) * .14 * delta) * Math.pow(.69, delta);
  return [value + nextVelocity * delta, nextVelocity];
};

/** A bounded local illustration. Dragging and clicking only change this sample. */
export default function KnowledgeGarden({ quiet }: { quiet: boolean }) {
  const [collected, setCollected] = useState<ObjectId[]>([]);
  const [pulse, setPulse] = useState(0);
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const nodes = useRef<Partial<Record<ObjectId, HTMLButtonElement | null>>>({});
  const paths = useRef<Partial<Record<ObjectId, SVGPathElement | null>>>({});
  const bodies = useRef(makeBodies());
  const frame = useRef(0);
  const previousTime = useRef(0);
  const visible = useRef(true);
  const stopped = useRef(quiet || reduced);
  const currentCollected = useRef(collected);
  const drag = useRef<{ id: ObjectId; pointer: number; startX: number; startY: number; bodyX: number; bodyY: number; width: number; height: number; moved: boolean } | null>(null);
  const lastDrag = useRef<{ id: ObjectId; time: number } | null>(null);
  const wake = useRef<() => void>(() => {});
  const uid = useId();
  const complete = collected.length === items.length;
  currentCollected.current = collected;
  stopped.current = quiet || reduced;

  const paint = (id: ObjectId) => {
    const body = bodies.current[id];
    const node = nodes.current[id];
    if (node) {
      node.style.setProperty("--kg-x", unit(body.x));
      node.style.setProperty("--kg-y", unit(body.y));
      node.style.setProperty("--kg-rotation", `${body.rotate.toFixed(3)}deg`);
      node.style.setProperty("--kg-scale", body.scale.toFixed(4));
    }
    const x = 325 + body.x, y = 250 + body.y;
    paths.current[id]?.setAttribute("d", `M ${x.toFixed(2)} ${y.toFixed(2)} Q ${(325 + body.x * .32).toFixed(2)} ${(250 + body.y * .95).toFixed(2)} 325 250`);
  };

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(preference.matches);
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    const tick = (time: number) => {
      frame.current = 0;
      if (!visible.current || document.hidden) return;
      const delta = Math.min(1.5, Math.max(.5, previousTime.current ? (time - previousTime.current) / 16.667 : 1));
      previousTime.current = time;
      let unsettled = false;
      for (const item of items) {
        const body = bodies.current[item.id];
        if (drag.current?.id === item.id) { paint(item.id); continue; }
        if (stopped.current) {
          Object.assign(body, body.target, { vx: 0, vy: 0, vr: 0, vs: 0 });
        } else {
          [body.x, body.vx] = spring(body.x, body.target.x, body.vx, delta);
          [body.y, body.vy] = spring(body.y, body.target.y, body.vy, delta);
          [body.rotate, body.vr] = spring(body.rotate, body.target.rotate, body.vr, delta);
          [body.scale, body.vs] = spring(body.scale, body.target.scale, body.vs, delta);
          const distance = Math.abs(body.x - body.target.x) + Math.abs(body.y - body.target.y) + Math.abs(body.rotate - body.target.rotate) + Math.abs(body.scale - body.target.scale) * 100;
          const speed = Math.abs(body.vx) + Math.abs(body.vy) + Math.abs(body.vr) + Math.abs(body.vs) * 100;
          if (distance > .08 || speed > .035) unsettled = true;
          else Object.assign(body, body.target, { vx: 0, vy: 0, vr: 0, vs: 0 });
        }
        paint(item.id);
      }
      if (unsettled) frame.current = requestAnimationFrame(tick);
    };
    wake.current = () => {
      if (frame.current || !visible.current || document.hidden) return;
      previousTime.current = 0;
      frame.current = requestAnimationFrame(tick);
    };
    const cancel = () => { cancelAnimationFrame(frame.current); frame.current = 0; previousTime.current = 0; };
    const observer = new IntersectionObserver(entries => {
      visible.current = entries[0]?.isIntersecting ?? false;
      if (visible.current) wake.current(); else cancel();
    });
    if (host.current) observer.observe(host.current);
    const visibility = () => { if (document.hidden) cancel(); else wake.current(); };
    document.addEventListener("visibilitychange", visibility);
    items.forEach(item => paint(item.id));
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", visibility); cancel(); wake.current = () => {}; };
  }, []);

  useEffect(() => {
    for (const item of items) bodies.current[item.id].target = { ...(collected.includes(item.id) ? item.pocket : item.home) };
    wake.current();
  }, [collected, quiet, reduced]);

  function collect(id: ObjectId) {
    const wasCollected = currentCollected.current.includes(id);
    setCollected(value => value.includes(id) ? value.filter(item => item !== id) : [...value, id]);
    if (!wasCollected) setPulse(value => value + 1);
  }

  function pointerDown(event: ReactPointerEvent<HTMLButtonElement>, id: ObjectId) {
    if (event.button !== 0 || drag.current) return;
    const bounds = scene.current?.getBoundingClientRect(); if (!bounds) return;
    const body = bodies.current[id];
    lastDrag.current = null;
    drag.current = { id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, bodyX: body.x, bodyY: body.y, width: bounds.width, height: bounds.height, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.setAttribute("data-dragging", "true");
    body.vx = body.vy = body.vr = body.vs = 0;
    host.current?.setAttribute("data-dragging", id);
  }

  function pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = drag.current; if (!active || active.pointer !== event.pointerId) return;
    const dx = (event.clientX - active.startX) / active.width * 650;
    const dy = (event.clientY - active.startY) / active.width * 650;
    active.moved ||= Math.hypot(dx, dy) > 7;
    const body = bodies.current[active.id];
    body.x = Math.max(-280, Math.min(280, active.bodyX + dx));
    body.y = Math.max(-211, Math.min(211, active.bodyY + dy));
    body.rotate = Math.max(-20, Math.min(20, dx * .035));
    body.scale = 1.04;
    host.current?.setAttribute("data-near", Math.hypot(body.x, body.y) < 111 ? "true" : "false");
    // Pointer paints are batched; continuous coordinates never enter React state.
    wake.current();
  }

  function pointerEnd(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) {
    const active = drag.current; if (!active || active.pointer !== event.pointerId) return;
    const body = bodies.current[active.id];
    drag.current = null;
    event.currentTarget.removeAttribute("data-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    host.current?.removeAttribute("data-dragging");
    host.current?.removeAttribute("data-near");
    if (active.moved) {
      lastDrag.current = { id: active.id, time: performance.now() };
      if (!cancelled && Math.hypot(body.x, body.y) < 111 && !currentCollected.current.includes(active.id)) {
        setCollected(value => value.includes(active.id) ? value : [...value, active.id]);
        setPulse(value => value + 1);
      }
    }
    const item = items.find(item => item.id === active.id)!;
    body.target = { ...(currentCollected.current.includes(active.id) ? item.pocket : item.home) };
    wake.current();
  }

  function clickObject(event: MouseEvent<HTMLButtonElement>, id: ObjectId) {
    if (event.detail && lastDrag.current?.id === id && performance.now() - lastDrag.current.time < 400) return;
    collect(id);
  }

  function gatherAll() {
    drag.current = null;
    if (complete) setCollected([]);
    else { setCollected(items.map(item => item.id)); setPulse(value => value + 1); }
    host.current?.removeAttribute("data-dragging");
    host.current?.removeAttribute("data-near");
    items.forEach(item => nodes.current[item.id]?.removeAttribute("data-dragging"));
  }

  return <div className="kg-garden" ref={host} data-count={collected.length} data-state={complete ? "connected" : collected.length ? "collecting" : "scattered"} data-quiet={quiet || reduced ? "true" : "false"} role="region" aria-label="知识游乐场交互演示">
    <div className="kg-scene" ref={scene}>
      <div className="kg-floor" aria-hidden="true"><span /><span /><i /><i /></div>
      <svg className="kg-connections" viewBox="0 0 650 500" aria-hidden="true">{items.map(item => <path key={item.id} ref={node => { paths.current[item.id] = node; }} className={collected.includes(item.id) ? "is-connected" : ""} d={`M ${325 + item.home.x} ${250 + item.home.y} Q 325 ${250 + item.home.y} 325 250`} />)}</svg>
      <div className="kg-magnet"><span className="kg-magnet-orbit" aria-hidden="true"/><button type="button" className="kg-core-skin" data-pop={pulse>0} style={{animationName:pulse ? pulse % 2 ? 'kg-core-pop' : 'kg-core-pop-alternate' : 'none'}} aria-label={complete ? "重新散开示例资料" : "连接所有示例资料"} aria-pressed={complete} onClick={gatherAll}><span className="kg-core-plus" aria-hidden="true">+</span><strong aria-hidden="true">考</strong><span className="kg-core-caption" aria-hidden="true">把知识接起来</span><span className="kg-core-corner" aria-hidden="true">↗</span></button><span className="kg-drop-hint" aria-hidden="true"><Hand size={13} />拖一份资料到这里</span></div>
      {items.map(item => <button key={item.id} ref={node => { nodes.current[item.id] = node; }} className={`kg-object kg-object-${item.id}`} type="button" data-object={item.id} data-collected={collected.includes(item.id) ? "true" : "false"} aria-label={`${collected.includes(item.id) ? "取出" : "归位"}${item.label}`} aria-pressed={collected.includes(item.id)} aria-describedby={`${uid}-hint`} onPointerDown={event => pointerDown(event, item.id)} onPointerMove={pointerMove} onPointerUp={event => pointerEnd(event)} onPointerCancel={event => pointerEnd(event, true)} onLostPointerCapture={event => { if (drag.current?.pointer === event.pointerId) pointerEnd(event, true); }} onClick={event => clickObject(event, item.id)} style={{ "--kg-x": unit(item.home.x), "--kg-y": unit(item.home.y), "--kg-rotation": `${item.home.rotate}deg`, "--kg-scale": 1 } as CSSProperties}>
        {item.id === "pdf" && <div className="kg-pdf-card"><div className="kg-card-meta"><FilePdf size={14}/><span>课堂讲义</span><small>01</small></div><h3>函数与极限</h3><div className="kg-pdf-rule"/><span className="kg-mini-formula"><span className="kg-mini-limit">lim<small>x → 0</small></span><span className="kg-mini-fraction"><span>sin x</span><span>x</span></span><span>= 1</span></span><div className="kg-paper-lines"><i/><i/><i/></div><div className="kg-card-bottom"><span>高等数学.pdf</span><span>28页</span></div></div>}
        {item.id === "matrix" && <div className="kg-matrix-cube"><span className="kg-cube-side"/><span className="kg-cube-top"/><div className="kg-cube-front"><span>线性代数</span><div className="kg-matrix"><span>1</span><span>2</span><span>0</span><span>1</span></div><small>MATRIX / 02</small></div></div>}
        {item.id === "notes" && <div className="kg-notes-card"><span className="kg-note-pin"/><span className="kg-note-label">我的课堂随记</span><h3>先看条件，<br/>再做题。</h3><p>连续 ≠ 可导</p><span className="kg-note-underline"/><small>手写笔记.jpg</small></div>}
        {item.id === "video" && <div className="kg-video-disc"><span className="kg-disc-groove"/><span className="kg-disc-groove"/><span className="kg-disc-label">高数网课</span><span className="kg-video-play"><Play size={22} weight="fill"/></span><span className="kg-disc-time">02:31</span><span className="kg-disc-caption">COURSE / 04</span></div>}
        <span className="kg-object-check" aria-hidden="true"><Check size={16} weight="bold"/></span>
      </button>)}
      {pulse>0 && <div className="kg-sparks" key={`sparks-${pulse}`} aria-hidden="true">{Array.from({length:12},(_,index)=><i key={index} style={{"--kg-spark-x":unit(Math.cos(index/12*Math.PI*2)*(80+index%3*26)),"--kg-spark-y":unit(Math.sin(index/12*Math.PI*2)*(90+index%4*18)),"--kg-spark-r":`${index*47}deg`,"--kg-spark-delay":`${index%3*25}ms`} as CSSProperties}/>)}</div>}
      <div className="kg-route" aria-hidden={!complete}><div className="kg-route-top"><span>YOUR STUDY ROUTE</span><Check size={16}/></div><h3>知识，有了下一步。</h3><div className="kg-route-courses"><span>高等数学</span><span>线性代数</span></div><div className="kg-route-steps"><span><i>1</i>整理笔记</span><ArrowRight size={13}/><span><i>2</i>理解知识</span><ArrowRight size={13}/><span><i>3</i>练习巩固</span></div><p>一份清晰的复习路线</p></div>
      <span className="kg-scene-note" aria-hidden="true"><i/>知识可以散，复习不用乱。</span>
    </div>
    <div className="kg-controls"><button type="button" className="kg-gather" onClick={gatherAll} aria-pressed={complete}>{complete?<ArrowClockwise size={16}/>:<ArrowDownRight size={17}/>}<span>{complete?"重新散开":"一键归位"}</span><span className="kg-control-count">{collected.length}/4</span></button><p id={`${uid}-hint`}>拖一拖，或点一下。<span>这是可玩的示例，不会上传资料。</span></p></div>
    <p className="kg-live" role="status" aria-live="polite">{complete ? "四份示例资料已归位，已生成一份清晰的复习路线。" : collected.length ? `已归位${collected.length}份示例资料：${collected.map(id=>items.find(item=>item.id===id)!.label).join("、")}。` : "四份示例资料等待归位。可拖动资料到中间，也可直接点击。"}</p>
  </div>;
}
