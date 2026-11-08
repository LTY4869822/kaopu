import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowClockwise, ArrowRight, ArrowSquareOut, BookOpen, Check, CircleNotch, MagnifyingGlass, Sparkle, WarningCircle, X } from "@phosphor-icons/react";
import { api } from "./api";
import type { DiscoveryPoint, DiscoveryResult } from "./course-studio-types";
import type { Doc } from "./types";
import "./discovery-panel.css";

type Props = {
  open: boolean;
  courseId: string;
  courseName: string;
  configured: boolean;
  onClose: () => void;
  onImported: (doc: Doc) => void;
  onNotify: (message: string) => void;
};

const SOURCE_LABEL: Record<DiscoveryPoint["source"], string> = { catalog: "本地知识框架", ai: "AI 扩展 · 未核对", wikipedia: "维基百科 · CC BY-SA" };

export default function DiscoveryPanel({ open, courseId, courseName, configured, onClose, onImported, onNotify }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [online, setOnline] = useState(false);
  const [useAI, setUseAI] = useState(false);
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [points, setPoints] = useState<string[]>([]);
  const [resources, setResources] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  const groups = useMemo(() => {
    const map = new Map<string, DiscoveryPoint[]>();
    for (const point of result?.knowledgePoints || []) {
      const list = map.get(point.chapter);
      if (list) list.push(point);
      else map.set(point.chapter, [point]);
    }
    return [...map.entries()];
  }, [result]);
  const allSelected = !!result && points.length === result.knowledgePoints.length;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      void run("");
    } else if (!open && element.open) { request.current++; element.close(); }
  }, [open]);
  useEffect(() => () => { request.current++; }, []);

  async function run(topic: string) {
    const token = ++request.current;
    setLoading(true); setError("");
    try {
      const data = await api<DiscoveryResult>("/course-studio/discovery", "POST", { courseId, query: topic.trim(), online, useAI });
      if (token !== request.current) return;
      setResult(data);
      setPoints(data.knowledgePoints.map(point => point.id));
      setResources(data.resources.map(resource => resource.id));
    } catch (cause) {
      if (token === request.current) { setResult(null); setError(cause instanceof Error ? cause.message : "检索暂未完成，请重试。"); }
    } finally {
      if (token === request.current) setLoading(false);
    }
  }
  function togglePoint(id: string) {
    setPoints(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }
  function toggleResource(id: string) {
    setResources(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }
  async function importSelected() {
    if (!points.length || importing) { if (!points.length) setError("至少选择一个知识点再导入。"); return; }
    setImporting(true); setError("");
    try {
      const saved = await api<{ document: Doc; duplicate: boolean }>("/course-studio/discovery/import", "POST", {
        courseId, pointIds: points, resourceIds: resources, query: query.trim(), online,
      });
      onNotify(saved.duplicate ? "这份起步资料已经在课程资料里了，没有重复保存。" : `已把《${saved.document.name}》加入课程资料。`);
      onImported(saved.document);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导入暂未完成，请重试。");
    } finally { setImporting(false); }
  }

  return <dialog ref={dialog} className="dp-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose}>
    <div className="dp-head">
      <div>
        <span className="dp-kicker"><BookOpen size={15} />无自有资料时</span>
        <h2 id={titleId}>先为《{courseName}》找一份起步资料</h2>
        <p>按科目匹配知识框架，选中的知识点会保存为本课程资料，之后可以整理笔记或出题。</p>
      </div>
      <button type="button" className="dp-close" aria-label="关闭资料检索" onClick={onClose}><X size={22} /></button>
    </div>

    <form className="dp-search" onSubmit={event => { event.preventDefault(); void run(query); }}>
      <label className="dp-topic"><span>想先学哪一部分</span><input value={query} maxLength={120} placeholder="可留空；例如：二叉树遍历、极限计算" onChange={event => setQuery(event.target.value)} /></label>
      <button type="submit" className="dp-search-button" disabled={loading} aria-label="检索匹配资料">{loading ? <CircleNotch size={18} className="dp-spin" /> : <MagnifyingGlass size={18} />}{loading ? "检索中" : "检索"}</button>
      <div className="dp-options">
        <label><input type="checkbox" checked={online} onChange={event => setOnline(event.target.checked)} /><span>补充中文维基百科公开条目<small>联网检索，结果标注 CC BY-SA</small></span></label>
        <label className={configured ? "" : "is-disabled"}><input type="checkbox" checked={useAI} disabled={!configured} onChange={event => setUseAI(event.target.checked)} /><span>用模型扩展知识脉络<small>{configured ? "扩展内容会标记为未核对" : "连接文字模型后可用"}</small></span></label>
      </div>
    </form>

    <div className="dp-body">
      {loading && !result ? <div className="dp-loading" role="status"><CircleNotch size={24} className="dp-spin" /><strong>正在整理这门课的起步框架</strong><p>本地知识框架立即可用，在线与模型扩展会补充更多线索。</p></div> : null}
      {error && !loading ? <div className="dp-error" role="alert"><WarningCircle size={19} /><span>{error}</span><button type="button" onClick={() => void run(query)}><ArrowClockwise size={15} />重试</button></div> : null}
      {result && !error ? <>
        <div className="dp-summary">
          <div><span className="dp-subject">{result.subject}</span><span className={`dp-engine ${result.matched ? "is-matched" : ""}`}>{result.matched ? "已匹配科目" : "通用起步框架"}</span></div>
          <span>{result.knowledgePoints.length} 个知识点 · {result.resources.length} 条参考资源</span>
        </div>
        {result.warnings.map((warning, index) => <p className="dp-warning" role="status" key={index}><WarningCircle size={16} />{warning}</p>)}
        <div className="dp-points-toolbar">
          <strong>知识点</strong>
          <div>
            <button type="button" onClick={() => setPoints(allSelected ? [] : result.knowledgePoints.map(point => point.id))}>{allSelected ? "取消全选" : "全选"}</button>
            <span>已选 {points.length} / {result.knowledgePoints.length}</span>
          </div>
        </div>
        {groups.map(([chapter, list]) => <section className="dp-group" key={chapter} aria-label={chapter}>
          <h3>{chapter}<span>{list.length}</span></h3>
          <ul>{list.map(point => <li key={point.id} className={points.includes(point.id) ? "is-selected" : ""}>
            <label className="dp-point">
              <input type="checkbox" checked={points.includes(point.id)} onChange={() => togglePoint(point.id)} />
              <span className="dp-check" aria-hidden="true"><Check size={12} weight="bold" /></span>
              <span className="dp-point-copy"><strong>{point.title}</strong><p>{point.detail}</p><span className="dp-meta"><i className={`dp-level is-${point.difficulty === "基础" ? "basic" : point.difficulty === "中等" ? "mid" : "high"}`}>{point.difficulty}</i><i className={`dp-source is-${point.source}`}>{point.source === "ai" ? <Sparkle size={12} /> : null}{SOURCE_LABEL[point.source]}</i>{point.keywords.map(keyword => <em key={keyword}>{keyword}</em>)}</span></span>
            </label>
          </li>)}</ul>
        </section>)}
        {result.resources.length ? <section className="dp-resources" aria-label="参考资源">
          <h3>参考资源<span>{resources.length} / {result.resources.length}</span></h3>
          <p>外部链接归原平台所有；勾选后会写进起步资料的参考列表。</p>
          <ul>{result.resources.map(resource => <li key={resource.id} className={resources.includes(resource.id) ? "is-selected" : ""}>
            <label><input type="checkbox" checked={resources.includes(resource.id)} onChange={() => toggleResource(resource.id)} aria-label={`导入参考资源：${resource.title}`} /></label>
            <div><a href={resource.url} target="_blank" rel="noreferrer noopener">{resource.title}<ArrowSquareOut size={14} /></a><small>{resource.provider} · {resource.license}{resource.note ? ` · ${resource.note}` : ""}</small></div>
          </li>)}</ul>
        </section> : null}
      </> : null}
    </div>

    <div className="dp-foot">
      <span>{points.length ? `将导入 ${points.length} 个知识点${resources.length ? `、${resources.length} 条参考资源` : ""}` : "先勾选需要的知识点"}</span>
      <div>
        <button type="button" className="dp-secondary" onClick={onClose} disabled={importing}>稍后再说</button>
        <button type="button" className="dp-primary" onClick={() => void importSelected()} disabled={!points.length || loading || importing}>{importing ? <CircleNotch size={17} className="dp-spin" /> : <ArrowRight size={17} />}{importing ? "正在保存" : "加入课程资料"}</button>
      </div>
    </div>
  </dialog>;
}
