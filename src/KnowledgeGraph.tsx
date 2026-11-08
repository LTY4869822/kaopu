import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowSquareOut, ArrowsClockwise, CircleNotch } from "@phosphor-icons/react";

export type GraphKind = "index" | "concept" | "note" | "raw" | "output" | "question" | "system";

export type GraphNode = {
  id: string;
  path: string;
  name: string;
  title: string;
  kind: GraphKind;
  courseId: string;
  courseName: string;
  inLinks: number;
  outLinks: number;
  degree: number;
};

export type GraphData = {
  generatedAt: string;
  course: { id: string; name: string } | null;
  counts: { nodes: number; links: number; orphans: number; truncated: boolean };
  nodes: GraphNode[];
  edges: { source: string; target: string }[];
  hubs: string[];
  orphans: string[];
};

export const GRAPH_KIND_META: Record<GraphKind, { label: string; color: string }> = {
  concept: { label: "考点", color: "#d98a3d" },
  note: { label: "课堂笔记", color: "#4a7fb5" },
  index: { label: "课程目录", color: "#2f5a45" },
  raw: { label: "原文记录", color: "#9aa89c" },
  output: { label: "复习成果", color: "#7a5fa8" },
  question: { label: "问答记录", color: "#3f8f83" },
  system: { label: "说明与记录", color: "#c0b9a8" },
};

const MAX_VISIBLE_NODES = 300;

type SimNode = GraphNode & { x: number; y: number; vx: number; vy: number; r: number };

function pickNodes(nodes: GraphNode[]): GraphNode[] {
  if (nodes.length <= MAX_VISIBLE_NODES) return nodes;
  const picked = new Map<string, GraphNode>();
  for (const node of nodes) if (node.degree === 0) picked.set(node.path, node);
  for (const node of [...nodes].sort((a, b) => b.degree - a.degree)) {
    if (picked.size >= MAX_VISIBLE_NODES) break;
    picked.set(node.path, node);
  }
  return [...picked.values()];
}

function radiusOf(node: GraphNode) {
  return 5 + Math.min(10, Math.sqrt(node.degree) * 2.4);
}

export function friendlyNoteLabel(name: string) {
  const bare = String(name).replace(/\.md$/i, "");
  const map: Record<string, string> = {
    SCHEMA: "使用说明",
    index: "总目录",
    log: "操作记录",
    "lint-report": "检查报告",
  };
  return map[bare] || bare;
}

export default function KnowledgeGraph({ data, busy, onOpen }: { data: GraphData | null; busy?: boolean; onOpen: (path: string) => void }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<{
    nodes: SimNode[];
    edges: { a: number; b: number }[];
    alpha: number;
    hover: string | null;
    drag: { index: number; startX: number; startY: number; moved: boolean } | null;
    width: number;
    height: number;
  } | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const selectedRef = useRef("");
  const [size, setSize] = useState({ width: 720, height: 480 });
  const [selected, setSelected] = useState("");
  const [round, setRound] = useState(0);

  const visible = useMemo(() => (data ? pickNodes(data.nodes) : []), [data]);
  const byPath = useMemo(() => new Map(visible.map((node) => [node.path, node])), [visible]);
  const selectedNode = selected ? byPath.get(selected) : undefined;

  const kindCounts = useMemo(() => {
    const counts = new Map<GraphKind, number>();
    for (const node of visible) counts.set(node.kind, (counts.get(node.kind) || 0) + 1);
    return counts;
  }, [visible]);

  useEffect(() => {
    setSelected("");
  }, [data]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      setSize({ width: Math.max(320, Math.round(rect.width)), height: Math.max(360, Math.round(rect.height || 480)) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
    // 数据加载完成后画布才会出现，依赖 busy/data 保证尺寸能被正确测量。
  }, [busy, data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible.length) return;
    const { width, height } = size;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const nodes: SimNode[] = visible.map((node, index) => {
      const angle = (index / Math.max(1, visible.length)) * Math.PI * 2;
      const spread = Math.min(width, height) * 0.42 * (0.55 + ((index * 37) % 100) / 130);
      return {
        ...node,
        x: width / 2 + Math.cos(angle) * spread,
        y: height / 2 + Math.sin(angle) * spread,
        vx: 0,
        vy: 0,
        r: radiusOf(node),
      };
    });
    const indexOf = new Map(nodes.map((node, index) => [node.path, index]));
    const edges = data?.edges
      .map((edge) => ({ a: indexOf.get(edge.source) ?? -1, b: indexOf.get(edge.target) ?? -1 }))
      .filter((edge) => edge.a >= 0 && edge.b >= 0 && edge.a !== edge.b) || [];
    const neighbours = new Map<string, Set<string>>();
    for (const edge of edges) {
      const source = nodes[edge.a].path, target = nodes[edge.b].path;
      if (!neighbours.has(source)) neighbours.set(source, new Set());
      if (!neighbours.has(target)) neighbours.set(target, new Set());
      neighbours.get(source)!.add(target);
      neighbours.get(target)!.add(source);
    }
    const state = { nodes, edges, alpha: 1, hover: null as string | null, drag: null as { index: number; startX: number; startY: number; moved: boolean } | null, width, height };
    stateRef.current = state;

    const adjacency = neighbours;
    const render = () => {
      context.clearRect(0, 0, width, height);
      const focus = state.hover || selectedRef.current || "";
      const related = focus ? adjacency.get(focus) : undefined;
      for (const edge of edges) {
        const a = nodes[edge.a], b = nodes[edge.b];
        const active = focus && (a.path === focus || b.path === focus);
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.strokeStyle = active ? "rgba(47, 90, 69, 0.5)" : focus ? "rgba(47, 90, 69, 0.08)" : "rgba(47, 90, 69, 0.16)";
        context.lineWidth = active ? 1.6 : 1;
        context.stroke();
      }
      const showAllLabels = nodes.length <= 8;
      for (const node of nodes) {
        const isFocus = focus === node.path;
        const isRelated = related?.has(node.path) || false;
        const dim = focus ? !isFocus && !isRelated : false;
        context.globalAlpha = dim ? 0.3 : 1;
        if (data?.hubs.includes(node.path)) {
          context.beginPath();
          context.arc(node.x, node.y, node.r + 8, 0, Math.PI * 2);
          context.fillStyle = "rgba(47, 90, 69, 0.1)";
          context.fill();
        }
        if (node.degree === 0 && node.kind !== "system") {
          context.beginPath();
          context.arc(node.x, node.y, node.r + 4, 0, Math.PI * 2);
          context.setLineDash([3, 4]);
          context.strokeStyle = "#c4a883";
          context.lineWidth = 1.3;
          context.stroke();
          context.setLineDash([]);
        }
        context.beginPath();
        context.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        context.fillStyle = GRAPH_KIND_META[node.kind]?.color || "#9aa89c";
        context.fill();
        if (isFocus) {
          context.beginPath();
          context.arc(node.x, node.y, node.r + 5, 0, Math.PI * 2);
          context.strokeStyle = "#2f5a45";
          context.lineWidth = 2;
          context.stroke();
        }
        const labelled = isFocus || isRelated || showAllLabels || data?.hubs.includes(node.path);
        if (labelled && !dim) {
          const label = node.title.length > 16 ? `${node.title.slice(0, 15)}…` : node.title;
          context.font = `${isFocus ? "600 " : ""}12px system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
          context.textAlign = "center";
          context.textBaseline = "top";
          context.lineWidth = 3;
          context.strokeStyle = "rgba(255, 255, 255, 0.9)";
          context.strokeText(label, node.x, node.y + node.r + 4);
          context.fillStyle = isFocus ? "#1f3b2d" : "#42544a";
          context.fillText(label, node.x, node.y + node.r + 4);
        }
      }
      context.globalAlpha = 1;
    };
    drawRef.current = render;

    let frame = 0;
    const tick = () => {
      const alpha = Math.max(0.02, state.alpha);
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let distance2 = dx * dx + dy * dy;
          if (distance2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; distance2 = 1; }
          if (distance2 > 200000) continue;
          const distance = Math.sqrt(distance2);
          const force = (3200 * alpha) / distance2;
          const fx = (dx / distance) * force, fy = (dy / distance) * force;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }
      for (const edge of edges) {
        const a = nodes[edge.a], b = nodes[edge.b];
        const dx = b.x - a.x, dy = b.y - a.y;
        const distance = Math.hypot(dx, dy) || 1;
        const force = (distance - 112) * 0.013 * alpha;
        const fx = (dx / distance) * force, fy = (dy / distance) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
      for (const node of nodes) {
        node.vx += (width / 2 - node.x) * 0.0018 * alpha;
        node.vy += (height / 2 - node.y) * 0.0018 * alpha;
        if (state.drag && nodes[state.drag.index] === node) { node.vx = 0; node.vy = 0; continue; }
        node.vx *= 0.82; node.vy *= 0.82;
        node.x += node.vx; node.y += node.vy;
        const padX = node.r + 46, padY = node.r + 20;
        node.x = Math.min(width - padX, Math.max(padX, node.x));
        node.y = Math.min(height - padY, Math.max(padY, node.y));
      }
      render();
      state.alpha *= 0.985;
      if (state.alpha > 0.03) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // 选中状态变化时单独重绘，避免重建整张图。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, visible, size.width, size.height, round]);

  useEffect(() => {
    if (stateRef.current) stateRef.current.hover = null;
    selectedRef.current = selected;
    drawRef.current();
  }, [selected]);

  function locate(event: ReactPointerEvent<HTMLCanvasElement>): { state: typeof stateRef.current; x: number; y: number; hit: number } {
    const state = stateRef.current;
    const canvas = canvasRef.current;
    if (!state || !canvas) return { state: null, x: 0, y: 0, hit: -1 };
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    let hit = -1;
    for (let index = state.nodes.length - 1; index >= 0; index -= 1) {
      const node = state.nodes[index];
      if (Math.hypot(node.x - x, node.y - y) <= node.r + 7) { hit = index; break; }
    }
    return { state, x, y, hit };
  }

  function handleMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const { state, x, y, hit } = locate(event);
    if (!state) return;
    if (state.drag) {
      const node = state.nodes[state.drag.index];
      node.x = x; node.y = y; node.vx = 0; node.vy = 0;
      if (Math.hypot(x - state.drag.startX, y - state.drag.startY) > 4) state.drag.moved = true;
      drawRef.current();
      return;
    }
    const nextHover = hit >= 0 ? state.nodes[hit].path : null;
    if (nextHover !== state.hover) {
      state.hover = nextHover;
      drawRef.current();
    }
  }

  function handleDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const { state, x, y, hit } = locate(event);
    if (!state) return;
    if (hit >= 0) {
      state.drag = { index: hit, startX: x, startY: y, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function handleUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const state = stateRef.current;
    if (!state) return;
    if (state.drag && !state.drag.moved) setSelected(state.nodes[state.drag.index].path);
    state.drag = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drawRef.current();
  }

  if (busy) {
    return <div className="kb-graph-loading"><CircleNotch size={20} className="kb-spin" /> 正在整理知识点之间的关系…</div>;
  }
  if (!data) return null;
  if (!visible.length) {
    return <div className="kb-graph-empty">这里还没有可以连线的笔记。先导入资料或在网课精读里完成一节分析，这里就会出现知识点关系图。</div>;
  }

  const crossCourse = !data.course;
  const label = (node: GraphNode) => (crossCourse && node.courseName ? `${node.courseName} · ${node.title}` : node.title);
  const hubNodes = data.hubs.map((path) => byPath.get(path)).filter((node): node is GraphNode => Boolean(node));
  const orphanNodes = data.orphans.filter((path) => byPath.has(path)).map((path) => byPath.get(path)!);

  return (
    <div className="kb-graph">
      <div className="kb-graph-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="kb-graph-canvas"
          role="img"
          aria-label="知识点关系图"
          onPointerMove={handleMove}
          onPointerDown={handleDown}
          onPointerUp={handleUp}
          onPointerLeave={() => { const state = stateRef.current; if (state && !state.drag) { state.hover = null; drawRef.current(); } }}
        />
        <div className="kb-graph-legend">
          <span className="kb-graph-legend-title">颜色代表笔记类型</span>
          <div className="kb-graph-legend-row">
            {(Object.keys(GRAPH_KIND_META) as GraphKind[]).filter((kind) => kindCounts.get(kind)).map((kind) => (
              <span key={kind} className="kb-graph-chip">
                <i style={{ background: GRAPH_KIND_META[kind].color }} />
                {GRAPH_KIND_META[kind].label} {kindCounts.get(kind)}
              </span>
            ))}
          </div>
        </div>
        <button type="button" className="kb-graph-reset" onClick={() => { setSelected(""); setRound((value) => value + 1); }}>
          <ArrowsClockwise size={14} /> 重新布局
        </button>
        {selectedNode && (
          <div className="kb-graph-card">
            <span className="kb-graph-card-kind">{GRAPH_KIND_META[selectedNode.kind]?.label || "笔记"}</span>
            <strong>{label(selectedNode)}</strong>
            <p>
              被 {selectedNode.inLinks} 篇笔记引用，链到另外 {selectedNode.outLinks} 篇笔记
              {selectedNode.degree === 0 ? "（目前还没有和其他笔记连起来）" : ""}
            </p>
            <div className="kb-graph-card-actions">
              <button type="button" className="kb-primary kb-small" onClick={() => onOpen(selectedNode.path)}>
                <ArrowSquareOut size={14} /> 打开这篇笔记
              </button>
              <button type="button" className="kb-ghost kb-small" onClick={() => setSelected("")}>取消选中</button>
            </div>
          </div>
        )}
      </div>

      <aside className="kb-graph-side">
        <section>
          <h4>中心知识点</h4>
          <p className="kb-graph-hint">被其他笔记引用得最多的页面，通常是知识的主干。</p>
          {hubNodes.length ? hubNodes.slice(0, 6).map((node) => (
            <button type="button" key={node.path} className="kb-graph-item" onClick={() => setSelected(node.path)}>
              <i style={{ background: GRAPH_KIND_META[node.kind]?.color || "#9aa89c" }} />
              <span>{label(node)}</span>
              <em>{node.degree} 条连线</em>
            </button>
          )) : <p className="kb-graph-none">还没有出现连接特别多的知识点。</p>}
        </section>
        <section>
          <h4>还没连起来的笔记 {orphanNodes.length ? `(${orphanNodes.length})` : ""}</h4>
          <p className="kb-graph-hint">这些笔记暂时没有和其他笔记互相引用，复习时容易漏掉。</p>
          {orphanNodes.length ? orphanNodes.slice(0, 8).map((node) => (
            <button type="button" key={node.path} className="kb-graph-item is-orphan" onClick={() => setSelected(node.path)}>
              <i style={{ background: GRAPH_KIND_META[node.kind]?.color || "#9aa89c" }} />
              <span>{label(node)}</span>
            </button>
          )) : <p className="kb-graph-none">很好，所有笔记都已经连起来了。</p>}
        </section>
        {data.counts.truncated && <p className="kb-graph-hint">笔记数量较多，图中优先展示连接最多和独立的笔记。</p>}
      </aside>
    </div>
  );
}
