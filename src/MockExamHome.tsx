import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ArrowClockwise, CheckCircle, Clock, FileText, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import type { Course } from "./types";
import type { ExamLibrary } from "./exam-types";
import "./mock-exam.css";

type Props = {
  course?: Course; library: ExamLibrary; loading: boolean; busy: boolean; materialCount: number;
  onBuild: (mode: "custom" | "template") => void; onOpenPaper: (id: string) => void;
  onOpenAttempt: (id: string) => void; onRefresh: () => void;
};
export default function MockExamHome({ course, library, loading, busy, onBuild, onOpenPaper, onOpenAttempt, onRefresh }: Props) {
  const [filter, setFilter] = useState<"all" | "ongoing" | "completed">("all"), [query, setQuery] = useState("");
  useEffect(() => { setFilter("all"); setQuery(""); }, [course?.id]);
  const ongoing = [...library.attempts].reverse().find(item => item.status === "in-progress" && item.available);
  const papers = useMemo(() => [...library.papers].reverse().filter(paper => {
    const records = library.attempts.filter(item => item.paperId === paper.id);
    return (!query.trim() || paper.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
      && (filter === "all" || records.some(item => item.status === (filter === "ongoing" ? "in-progress" : "submitted")));
  }), [library, filter, query]);
  return <div className="mock-home">
    {ongoing && <section className="mock-resume" aria-label="未完成的考试"><Clock size={24} /><div><strong>{ongoing.mode === "exam" ? "继续这场模拟考" : "继续未完成的练习"}</strong><p>{ongoing.title}</p><span>{ongoing.mode === "exam" ? "离开页面后仍然计时，已保存的答案可以恢复。" : "作答记录已保留，可从上次的位置继续。"}</span></div><button type="button" className="primary" disabled={busy} onClick={() => onOpenAttempt(ongoing.id)}>{ongoing.mode === "exam" ? "继续考试" : "继续练习"}<ArrowRight size={18} /></button></section>}
    <section className="mock-prepare" aria-labelledby="mock-prepare-title">
      <div className="mock-prepare-copy"><h2 id="mock-prepare-title">准备一套模拟试卷</h2><p>{course ? "按自己的薄弱点出卷，或参照历年真题。" : "先选择上方课程，再准备你的模拟试卷。"}</p></div>
      <div className="mock-build-choices"><button type="button" className="primary" disabled={!course || busy} onClick={() => onBuild("custom")}><Plus size={18} /><span>自定义组卷</span></button><button type="button" className="text-button" disabled={!course || busy} onClick={() => onBuild("template")}><FileText size={17} /><span>参照历年真题</span><ArrowRight size={16} /></button></div>
    </section>
    <section className="mock-library" aria-labelledby="mock-library-title"><header><div><h2 id="mock-library-title">我的试卷与记录</h2><p>试卷、进行中的考试与考后复盘。</p></div><button type="button" className="text-button" disabled={loading || busy || !course} onClick={onRefresh}><ArrowClockwise size={17} />{loading ? "读取中…" : "刷新记录"}</button></header>
      {library.papers.length > 0 && <div className="mock-library-tools"><div role="group" aria-label="试卷筛选">{([["all", "全部试卷"], ["ongoing", "未完成"], ["completed", "已交卷"]] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div><label className="mock-search"><MagnifyingGlass size={18} /><input type="search" aria-label="搜索模拟试卷" placeholder="搜索试卷" value={query} onChange={event => setQuery(event.target.value)} /></label></div>}
      {loading && !library.papers.length ? <div className="es-skeleton" aria-label="正在读取试卷"><i /><i /><i /></div> : !papers.length ? <div className="mock-empty"><FileText size={31} /><h3>{!course ? "先选一门要模拟的课程" : query || filter !== "all" ? "没有符合条件的试卷" : "还没有模拟试卷"}</h3><p>{!course ? "课程资料、试卷与作答记录会一起显示。" : query || filter !== "all" ? "可以更换关键词，或查看全部试卷。" : "在上方新建一套试卷，确认后即可开始模拟。"}</p>{(query || filter !== "all") && <button type="button" className="text-button" onClick={() => { setQuery(""); setFilter("all"); }}>查看全部试卷<ArrowRight size={16} /></button>}</div> : <div className="es-paper-list">{papers.map(item => {
        const records = library.attempts.filter(record => record.paperId === item.id), active = [...records].reverse().find(record => record.status === "in-progress"), latest = records.filter(record => record.status === "submitted").at(-1);
        return <article key={item.id} className={!item.available ? "is-unavailable" : ""}><div className="es-paper-symbol"><FileText size={23} /></div><div className="es-paper-copy"><div className="es-paper-title"><h4>{item.title}</h4><span>{item.templateId ? "仿真题结构" : "自定义试卷"}</span></div><p>{item.totalQuestions} 题 · {item.totalPoints} 分 · {item.durationMinutes} 分钟{item.sourcePolicy === "extended" ? " · 含 AI 扩展范围" : " · 课程资料范围"}</p>{latest?.summary && <span className="mock-record-note"><CheckCircle size={15} />最近客观参考分 {latest.summary.objectiveEarned} / {latest.summary.objectiveTotal}{latest.summary.pendingPoints ? ` · ${latest.summary.pendingPoints} 分待核对` : ""}</span>}{!item.available && <p className="es-warning-text">来源已变化，原记录保留；继续训练请重新组卷。</p>}</div><div className="es-paper-actions">{active && <button className="primary" type="button" disabled={!active.available || busy} onClick={() => onOpenAttempt(active.id)}>继续作答</button>}{latest && <button className="text-button" type="button" disabled={busy} onClick={() => onOpenAttempt(latest.id)}>查看复盘</button>}<button className="secondary" type="button" disabled={!item.available || busy} onClick={() => onOpenPaper(item.id)}>查看试卷<ArrowRight size={16} /></button></div></article>;
      })}</div>}
    </section>
  </div>;
}
