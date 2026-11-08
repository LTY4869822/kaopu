import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  CaretDown,
  CaretRight,
  Copy,
  FileMd,
  FolderOpen,
  FolderSimple,
  ImageSquare,
  LinkSimple,
  ListBullets,
  MagnifyingGlass,
  ShareNetwork,
  ShieldCheck,
  Sparkle,
  TreeStructure,
  X,
} from "@phosphor-icons/react";
import { api } from "./api";
import { LoadingState } from "./ui/controls";
import KnowledgeGraph, { friendlyNoteLabel, type GraphData } from "./KnowledgeGraph";
import "./knowledge-base.css";

type FileEntry = { path: string; size: number; kind: "markdown" | "image" | "other" };
type CourseTree = { id: string; name: string; dir: string; files: FileEntry[] };
type TreeData = {
  root: string;
  generatedAt: string;
  counts: { courses: number; lessons: number; documents: number; markdown: number; images: number; files: number };
  files: FileEntry[];
  courses: CourseTree[];
};
type FileData = { path: string; size: number; updatedAt: string; content: string; html: string };
type QueryData = { answer: string; citations: { path: string; reason: string }[]; indexPath: string; consulted: string[]; savedId?: string };
type LintData = { ok: boolean; counts: { issues: number }; issues: { kind: string; message: string; target: string }[]; repaired?: boolean };
type Node = { name: string; path: string; dir: boolean; children: Node[]; kind?: FileEntry["kind"] };

const GUIDE_KEY = "shifen:knowledge-guide:v1";
const DIR_LABELS: Record<string, string> = {
  raw: "原文记录",
  wiki: "知识笔记",
  resources: "课堂截图",
  output: "复习成果",
};
const LINT_KIND_LABEL: Record<string, string> = {
  "broken-link": "断开的链接",
  "orphan-note": "孤立笔记",
  "missing-resource": "图片缺失",
  "invalid-resource": "图片链接异常",
  "raw-hash": "原始文件异常",
  "stale-output": "复习资料过时",
  "missing-index": "缺少课程目录",
  "stale-index": "课程目录过旧",
};
const GUIDE_STEPS = [
  {
    icon: Sparkle,
    title: "这是你的复习笔记库",
    body: "你导入的资料、网课字幕和考点分析，都会被自动整理成一篇篇笔记。不用自己建文件夹，打开就能读。",
  },
  {
    icon: FolderSimple,
    title: "左边选课，右边读笔记",
    body: "先在左边点一门课程，再点文件夹展开。「原文记录」是原始字幕和原文，「知识笔记」是整理好的考点，「课堂截图」是板书画面，「复习成果」是你生成的复习资料。",
  },
  {
    icon: LinkSimple,
    title: "带颜色的词都能点",
    body: "笔记里绿色的小标签，表示这篇笔记和另一篇笔记有关联，点一下就能跳过去。来回跳几次，一个知识点就串起来了。",
  },
  {
    icon: ShareNetwork,
    title: "用关系图看全局",
    body: "切到「知识点关系图」，每个圆点是一篇笔记，连线表示它们互相关联。默认只看当前这门课；如果两门课内容互相衔接（比如 C 语言和数据结构），也可以切到「跨课程关系图」一起看。连线最多的是中心知识点；没有连线的，就是容易被漏掉的孤立笔记。",
  },
];

function dirLabel(name: string) {
  return DIR_LABELS[name] || name;
}

function friendlyPath(path: string) {
  const parts = path.split("/");
  const name = parts.pop() || path;
  return [...parts.map(dirLabel), friendlyNoteLabel(name)].join(" / ");
}

function shortName(path: string) {
  return friendlyNoteLabel(path.split("/").pop() || path);
}

function buildTree(dir: string, files: FileEntry[]): Node[] {
  const root: Node = { name: dir, path: dir, dir: true, children: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let cursor = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const partial = parts.slice(0, index + 1).join("/");
      let next = cursor.children.find((node) => node.dir && node.path === partial);
      if (!next) {
        next = { name: parts[index], path: partial, dir: true, children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    }
    cursor.children.push({ name: parts[parts.length - 1], path: file.path, dir: false, children: [], kind: file.kind });
  }
  const sortNodes = (nodes: Node[]) => {
    nodes.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, "zh-CN"));
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(root.children);
  return root.children;
}

function countFiles(node: Node): number {
  return node.dir ? node.children.reduce((total, child) => total + countFiles(child), 0) : 1;
}

function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  return `约 ${Math.max(1, Math.round(bytes / 2.4))} 字`;
}

function TreeRow({
  node,
  depth,
  expanded,
  selected,
  onToggle,
  onOpen,
}: {
  node: Node;
  depth: number;
  expanded: Set<string>;
  selected: string;
  onToggle: (path: string) => void;
  onOpen: (path: string, kind: FileEntry["kind"]) => void;
}) {
  if (node.dir) {
    const open = expanded.has(node.path);
    return (
      <>
        <button
          type="button"
          className="kb-row kb-dir"
          style={{ paddingLeft: 10 + depth * 14 }}
          aria-expanded={open}
          onClick={() => onToggle(node.path)}
        >
          {open ? <CaretDown size={13} /> : <CaretRight size={13} />}
          {open ? <FolderOpen size={16} /> : <FolderSimple size={16} />}
          <span>{dirLabel(node.name)}</span>
          <em>{countFiles(node)}</em>
        </button>
        {open && node.children.map((child) => (
          <TreeRow key={child.path} node={child} depth={depth + 1} expanded={expanded} selected={selected} onToggle={onToggle} onOpen={onOpen} />
        ))}
      </>
    );
  }
  return (
    <button
      type="button"
      className={`kb-row kb-file ${selected === node.path ? "active" : ""}`}
      style={{ paddingLeft: 33 + depth * 14 }}
      onClick={() => onOpen(node.path, node.kind ?? "other")}
    >
      {node.kind === "image" ? <ImageSquare size={15} /> : <FileMd size={15} />}
      <span>{friendlyNoteLabel(node.name)}</span>
    </button>
  );
}

function readGuideDone() {
  try { return localStorage.getItem(GUIDE_KEY) === "1"; } catch { return false; }
}

export default function KnowledgeBase({ onNotify }: { onNotify?: (message: string) => void }) {
  const [data, setData] = useState<TreeData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeCourse, setActiveCourse] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState("");
  const [file, setFile] = useState<FileData | null>(null);
  const [fileError, setFileError] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [question, setQuestion] = useState("");
  const [saveQuestion, setSaveQuestion] = useState(false);
  const [queryResult, setQueryResult] = useState<QueryData | null>(null);
  const [queryBusy, setQueryBusy] = useState(false);
  const [lint, setLint] = useState<LintData | null>(null);
  const [lintBusy, setLintBusy] = useState(false);
  const [view, setView] = useState<"notes" | "graph">("notes");
  const [graphScope, setGraphScope] = useState<"course" | "all">("course");
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [graphBusy, setGraphBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [guideDone, setGuideDone] = useState(readGuideDone);
  const guideShown = useRef(false);

  async function load(refresh = false) {
    setBusy(true);
    setError("");
    try {
      const next = await api<TreeData>(`/knowledge/tree${refresh ? "?refresh=1" : ""}`);
      setData(next);
      if (refresh) onNotify?.("知识库已按最新内容更新");
      const nextCourse = next.courses.find((item) => item.id === activeCourse) || next.courses[0];
      setActiveCourse(nextCourse?.id || "");
      setExpanded(nextCourse ? new Set([`${nextCourse.dir}/wiki`, `${nextCourse.dir}/raw`, `${nextCourse.dir}/output`, nextCourse.dir]) : new Set());
      setSelected("");
      setFile(null);
      setFileError("");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 第一次进入这个页面时，自动弹出使用引导；之后可以在右上角随时打开。
  useEffect(() => {
    if (!data || guideShown.current) return;
    guideShown.current = true;
    if (!readGuideDone()) {
      setGuideStep(0);
      setGuideOpen(true);
    }
  }, [data]);

  useEffect(() => {
    if (view !== "graph") return;
    if (graphScope === "course" && !activeCourse) return;
    let alive = true;
    setGraphBusy(true);
    const url = graphScope === "all" ? "/knowledge/graph" : `/knowledge/graph?courseId=${encodeURIComponent(activeCourse)}`;
    api<GraphData>(url)
      .then((result) => { if (alive) setGraph(result); })
      .catch((reason) => { if (alive) setError((reason as Error).message); })
      .finally(() => { if (alive) setGraphBusy(false); });
    return () => { alive = false; };
  }, [view, graphScope, activeCourse, data?.generatedAt]);

  const course = data?.courses.find((item) => item.id === activeCourse);
  const nodes = useMemo(() => (course ? buildTree(course.dir, course.files) : []), [course]);
  const rootNodes = useMemo(() => (data ? buildTree("", (data.files || []).filter((file) => !file.path.includes("/"))) : []), [data]);

  function selectCourse(next: CourseTree, keepView = false) {
    setActiveCourse(next.id);
    setExpanded(new Set([`${next.dir}/wiki`, `${next.dir}/raw`, `${next.dir}/output`, next.dir]));
    setSelected("");
    setFile(null);
    setFileError("");
    setShowSource(false);
    if (!keepView) setView("notes");
  }

  function toggle(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function openFile(path: string, kind: FileEntry["kind"]) {
    setSelected(path);
    setFile(null);
    setFileError("");
    setShowSource(false);
    if (kind === "image") return;
    if (kind !== "markdown") {
      setFileError("这个文件不能在这里直接阅读，可以在你电脑的文件夹里打开它。");
      return;
    }
    setFileBusy(true);
    try {
      setFile(await api<FileData>(`/knowledge/file?path=${encodeURIComponent(path)}`));
    } catch (reason) {
      setFileError((reason as Error).message);
    } finally {
      setFileBusy(false);
    }
  }

  async function runQuery(event: FormEvent) {
    event.preventDefault();
    if (!course || !question.trim() || queryBusy) return;
    setQueryBusy(true); setError(""); setQueryResult(null);
    try {
      const result = await api<QueryData>("/knowledge/query", "POST", { courseId: course.id, question: question.trim(), save: saveQuestion });
      setQueryResult(result);
      if (result.savedId) onNotify?.("这次的问答已经保存到这门课");
    } catch (reason) { setError((reason as Error).message); }
    finally { setQueryBusy(false); }
  }

  async function runLint(repair = false) {
    if (lintBusy) return;
    setLintBusy(true); setError("");
    try {
      const result = await api<LintData>("/knowledge/lint", "POST", { repair });
      setLint(result);
      if (repair) await load(true);
      onNotify?.(result.ok ? "检查完成，笔记状态很好" : `检查完成，有 ${result.counts.issues} 处需要留意`);
    } catch (reason) { setError((reason as Error).message); }
    finally { setLintBusy(false); }
  }

  async function copyRoot() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.root);
      onNotify?.("文件夹位置已复制，可以粘贴到文件管理器里打开");
    } catch {
      onNotify?.("复制失败，请手动选中位置复制");
    }
  }

  function openLinked(target: string) {
    const owner = data?.courses.find((item) => target.startsWith(`${item.dir}/`));
    if (owner && owner.id !== activeCourse) setActiveCourse(owner.id);
    setExpanded((current) => {
      const next = new Set(current);
      const parts = target.split("/");
      for (let index = 1; index < parts.length; index += 1) next.add(parts.slice(0, index).join("/"));
      return next;
    });
    openFile(target, target.toLowerCase().endsWith(".md") ? "markdown" : "image");
  }

  function openFromGraph(path: string) {
    setView("notes");
    openLinked(path);
  }

  function finishGuide() {
    try { localStorage.setItem(GUIDE_KEY, "1"); } catch { /* 存储不可用时只在本次生效。 */ }
    setGuideDone(true);
    setGuideOpen(false);
  }

  const selectedKind = [...(course?.files || []), ...(data?.files || [])].find((item) => item.path === selected)?.kind;
  const step = GUIDE_STEPS[guideStep];
  const StepIcon = step.icon;

  return (
    <section className="kb-shell">
      {guideOpen && (
        <div className="kb-guide-layer" role="dialog" aria-modal="true" aria-label="知识库使用引导">
          <div className="kb-guide">
            <div className="kb-guide-visual">
              <StepIcon size={42} weight="duotone" />
              <span>第 {guideStep + 1} / {GUIDE_STEPS.length} 步</span>
            </div>
            <div className="kb-guide-copy">
              <span className="kb-guide-badge">新手指引 · 30 秒看懂这个页面</span>
              <h2>{step.title}</h2>
              <p>{step.body}</p>
              <div className="kb-guide-dots">
                {GUIDE_STEPS.map((item, index) => (
                  <button
                    key={item.title}
                    type="button"
                    className={index === guideStep ? "active" : ""}
                    aria-label={`第 ${index + 1} 步：${item.title}`}
                    onClick={() => setGuideStep(index)}
                  />
                ))}
              </div>
              <div className="kb-guide-actions">
                <button type="button" className="kb-ghost" onClick={() => setGuideOpen(false)}>稍后再说</button>
                <button type="button" className="kb-ghost" disabled={guideStep === 0} onClick={() => setGuideStep((value) => value - 1)}>
                  <ArrowLeft size={15} /> 上一步
                </button>
                {guideStep < GUIDE_STEPS.length - 1
                  ? <button type="button" className="kb-guide-next" onClick={() => setGuideStep((value) => value + 1)}>下一步 <ArrowRight size={15} /></button>
                  : <button type="button" className="kb-guide-next" onClick={finishGuide}>知道啦，开始复习</button>}
              </div>
            </div>
            <button type="button" className="kb-guide-close" aria-label="关闭引导" onClick={() => setGuideOpen(false)}><X size={18} /></button>
          </div>
        </div>
      )}
      <header className="kb-head">
        <div className="kb-head-copy">
          <span className="kb-kicker"><TreeStructure size={15} /> 我的课程知识库</span>
          <p className="kb-head-steps">选一门课 → 点开笔记 → 点绿色小标签继续往下看</p>
        </div>
        <div className="kb-actions">
          <button type="button" className="kb-guide-btn" onClick={() => { setGuideStep(0); setGuideOpen(true); }}>
            <Sparkle size={16} weight="fill" /> 使用引导
          </button>
          <button type="button" className="kb-ghost" onClick={() => void runLint()} disabled={!data || lintBusy}>
            <ShieldCheck size={16} />{lintBusy ? "检查中…" : "检查笔记"}
          </button>
          <button type="button" className="kb-ghost" onClick={copyRoot} disabled={!data}>
            <Copy size={16} /> 复制文件夹位置
          </button>
          <button type="button" className="kb-primary" onClick={() => load(true)} disabled={busy}>
            <ArrowClockwise size={16} className={busy ? "kb-spin" : ""} />
            {busy ? "更新中…" : "更新内容"}
          </button>
        </div>
      </header>

      {!guideDone && data && (
        <div className="kb-guide-banner">
          <span className="kb-guide-banner-icon"><Sparkle size={18} weight="fill" /></span>
          <p>第一次用这个页面？花 30 秒看一遍图上的引导，就知道笔记怎么读、知识点怎么连起来了。</p>
          <div>
            <button type="button" className="kb-guide-btn kb-small" onClick={() => { setGuideStep(0); setGuideOpen(true); }}>马上看看</button>
            <button type="button" className="kb-ghost kb-small" onClick={finishGuide}>我熟悉了</button>
          </div>
        </div>
      )}

      {error && <p className="kb-error">{error}</p>}

      {!data ? (
        <LoadingState title="正在整理你的笔记…" description="把课程、资料和网课内容整理成可以互相跳转的笔记。" />
      ) : !data.courses.length ? (
        <div className="kb-empty">
          <TreeStructure size={38} />
          <h3>还没有可以整理的笔记</h3>
          <p>先在「资料导入」里添加课程和资料，或者去「网课笔记」完成一节分析，整理好的笔记才会出现在这里。</p>
        </div>
      ) : (
        <>
          <div className="kb-summary">
            <div className="kb-stats">
              <span><strong>{data.counts.courses}</strong> 门课程</span>
              <span><strong>{data.counts.lessons}</strong> 节网课</span>
              <span><strong>{data.counts.documents}</strong> 份资料</span>
              <span><strong>{data.counts.markdown}</strong> 篇笔记</span>
              <span><strong>{data.counts.images}</strong> 张板书截图</span>
            </div>
            <div className="kb-view-tabs" role="tablist" aria-label="选择查看方式">
              <button type="button" role="tab" aria-selected={view === "notes"} className={view === "notes" ? "active" : ""} onClick={() => setView("notes")}>
                <ListBullets size={15} /> 笔记浏览
              </button>
              <button type="button" role="tab" aria-selected={view === "graph"} className={view === "graph" ? "active" : ""} onClick={() => setView("graph")}>
                <ShareNetwork size={15} /> 知识点关系图
              </button>
            </div>
          </div>

          {view === "notes" && (
            <div className="kb-workflow">
            <form className="kb-query" onSubmit={runQuery}>
              <MagnifyingGlass size={17} />
              <input aria-label="向这门课的笔记提问" value={question} onChange={event => setQuestion(event.target.value)} maxLength={4000} placeholder="想问点什么？比如：函数极限的定义是什么？" />
              <label><input type="checkbox" checked={saveQuestion} onChange={event => setSaveQuestion(event.target.checked)} />保存这次问答</label>
              <button type="submit" className="kb-primary" disabled={!course || queryBusy || !question.trim()}>{queryBusy ? "思考中…" : "提问"}</button>
            </form>
            {queryResult && (
              <div className="kb-query-result">
                <p>{queryResult.answer}</p>
                <div>
                  <strong>回答依据的笔记</strong>
                  {queryResult.citations.map(citation => (
                    <button type="button" key={citation.path} onClick={() => openLinked(citation.path)} title={citation.reason}>
                      {shortName(citation.path)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {lint && (
              <div className={`kb-lint ${lint.ok ? "is-ok" : ""}`}>
                <strong>{lint.ok ? "检查完成：笔记之间都连得上，没有发现问题" : `检查完成：有 ${lint.counts.issues} 处需要留意`}</strong>
                {lint.issues.slice(0, 5).map((issue, index) => (
                  <span key={`${issue.target}-${index}`}>
                    {LINT_KIND_LABEL[issue.kind] || "需要留意"} · {issue.message}
                  </span>
                ))}
                {!lint.ok && <button type="button" className="kb-ghost kb-small" onClick={() => void runLint(true)}>重新整理可修复的笔记</button>}
              </div>
            )}
            </div>
          )}

          {view === "graph" ? (
            <>
              <div className="kb-graph-toolbar">
                <div className="kb-graph-scope" role="group" aria-label="关系图范围">
                  <button type="button" className={graphScope === "course" ? "active" : ""} aria-pressed={graphScope === "course"} onClick={() => setGraphScope("course")}>只看当前课程</button>
                  <button type="button" className={graphScope === "all" ? "active" : ""} aria-pressed={graphScope === "all"} onClick={() => setGraphScope("all")}>跨课程关系图</button>
                </div>
                <p>{graphScope === "course"
                  ? "每个圆点是一篇笔记，两点之间的线表示它们互相引用。点一下圆点，可以看到它连了哪些内容。"
                  : "把各门课的笔记放在一起看。像 C 语言和数据结构这种内容互相衔接的课程，用它可以发现跨课程的知识联系。"}</p>
              </div>
              {graphScope === "course" && (
                <div className="kb-course-tabs kb-graph-courses" role="tablist" aria-label="选择课程">
                  {data.courses.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={item.id === activeCourse}
                      className={item.id === activeCourse ? "active" : ""}
                      onClick={() => selectCourse(item, true)}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              )}
              <KnowledgeGraph
                data={graphScope === "all" ? (graph && !graph.course ? graph : null) : (graph && graph.course?.id === activeCourse ? graph : null)}
                busy={graphBusy}
                onOpen={openFromGraph}
              />
            </>
          ) : (
            <div className="kb-body">
              <aside className="kb-side">
                <div className="kb-course-tabs" role="tablist" aria-label="选择课程">
                  {data.courses.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={item.id === activeCourse}
                      className={item.id === activeCourse ? "active" : ""}
                      onClick={() => selectCourse(item)}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
                <div className="kb-path" title={data.root}>笔记保存在：{data.root}</div>
                <div className="kb-tree">
                  {nodes.length ? nodes.map((node) => (
                    <TreeRow key={node.path} node={node} depth={0} expanded={expanded} selected={selected} onToggle={toggle} onOpen={openFile} />
                  )) : <p className="kb-tree-empty">这门课程还没有整理出笔记。</p>}
                  {rootNodes.length > 0 && <div className="kb-tree-divider">说明文件</div>}
                  {rootNodes.map((node) => (
                    <TreeRow key={node.path} node={node} depth={0} expanded={expanded} selected={selected} onToggle={toggle} onOpen={openFile} />
                  ))}
                </div>
              </aside>

              <section className="kb-preview" aria-live="polite">
                {!selected ? (
                  <div className="kb-preview-empty">
                    <FileMd size={30} />
                    <p>从左边点一篇笔记就能阅读；点绿色的小标签，可以跳到相关的另一篇笔记。</p>
                    <small>笔记会自动跟着课程内容更新，不需要你手动整理。</small>
                  </div>
                ) : fileError ? (
                  <p className="kb-error">{fileError}</p>
                ) : selectedKind === "image" ? (
                  <>
                    <div className="kb-preview-head">
                      <strong>{shortName(selected)}</strong>
                      <span>{friendlyPath(selected)}</span>
                    </div>
                    <div className="kb-image">
                      <img src={`/api/knowledge/asset?path=${encodeURIComponent(selected)}`} alt={shortName(selected)} />
                    </div>
                  </>
                ) : fileBusy ? (
                  <LoadingState title="正在打开笔记…" />
                ) : file ? (
                  <>
                    <div className="kb-preview-head">
                      <div>
                        <strong>{shortName(selected)}</strong>
                        <span>{friendlyPath(selected)} · {fileSize(file.size)}</span>
                      </div>
                      <button type="button" className="kb-ghost kb-small" onClick={() => setShowSource((value) => !value)}>
                        {showSource ? "回到阅读视图" : "查看原始文字"}
                      </button>
                    </div>
                    {showSource
                      ? <pre className="kb-source">{file.content}</pre>
                      : <article
                          className="kb-markdown"
                          onClick={(event) => {
                            const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a.kb-wikilink");
                            const target = anchor?.dataset.kbPath;
                            if (!target) return;
                            event.preventDefault();
                            openLinked(target);
                          }}
                          dangerouslySetInnerHTML={{ __html: file.html }}
                        />}
                  </>
                ) : (
                  <div className="kb-preview-empty"><p>从左边选一篇笔记开始阅读。</p></div>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </section>
  );
}
