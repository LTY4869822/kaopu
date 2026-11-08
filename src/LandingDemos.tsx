import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  ArrowRight, ArrowUUpLeft, BookOpen, CalendarBlank, Check, CheckCircle,
  FilePdf, FilePpt, FileText, FolderSimple, Play, Stack,
} from "@phosphor-icons/react";
import "./landing-demos.css";

const documents = [
  { name: "第二章 导数.pdf", meta: "28 页 · 课堂讲义", Icon: FilePdf, kind: "pdf", title: "2.1 单侧导数", text: "左右导数存在且相等，函数在这一点才可导。", source: "第二章 导数 · 第 6 页" },
  { name: "课堂例题.pptx", meta: "16 页 · 例题与解法", Icon: FilePpt, kind: "ppt", title: "把条件，放回题目里", text: "分段函数在接头处，先分别计算左导数与右导数，再比较。", source: "课堂例题 · 第 4 页" },
  { name: "期末范围.docx", meta: "3 页 · 复习范围", Icon: FileText, kind: "doc", title: "这次，先复习哪些", text: "函数、极限与导数。把老师划定的范围，和自己的资料放在一起。", source: "期末范围 · 第 1 页" },
] as const;

const tasks = [
  { title: "复习导数定义", minutes: 20, type: "读一遍" },
  { title: "做一道分段函数题", minutes: 15, type: "练一题" },
  { title: "回顾昨天的记忆卡", minutes: 10, type: "记一记" },
];

export function StudyDemo({ step }: { step: 0 | 1 | 2 }) {
  const [documentIndex, setDocumentIndex] = useState(0);
  const [completed, setCompleted] = useState<number[]>([]);
  const [answer, setAnswer] = useState(false);
  const document = documents[documentIndex];
  const studyLabel = ["资料归档", "复习计划", "练习与记忆"][step];
  const done = completed.length;
  function toggleTask(index: number) {
    setCompleted(current => current.includes(index) ? current.filter(item => item !== index) : [...current, index]);
  }
  return <div className="lp-demo-shell" role="region" aria-label={`${studyLabel}交互演示`}>
    <div className="lp-demo-topbar">
      <span className="lp-demo-wordmark"><span aria-hidden="true">考</span> 考谱 <i>/</i> 学习空间</span>
      <span className="lp-demo-sample"><span aria-hidden="true" />交互演示</span>
    </div>
    <div className="lp-demo-layout">
      <aside className="lp-demo-sidebar" aria-label="示例课程">
        <span className="lp-demo-sidebar-label">我的课程</span>
        <span className="lp-demo-course lp-demo-course-current"><BookOpen size={17} /><span>高等数学</span></span>
        <span className="lp-demo-course"><FolderSimple size={17} /><span>线性代数</span></span>
        <span className="lp-demo-course"><FolderSimple size={17} /><span>大学英语</span></span>
        <span className="lp-demo-sidebar-bottom"><Stack size={16} /><span>一点点，拾回来。</span></span>
      </aside>
      <div className="lp-demo-main" key={step}>
        {step === 0 && <>
          <div className="lp-demo-heading"><div><span className="lp-demo-eyebrow">COURSE / 01</span><h3>高等数学</h3></div><span className="lp-demo-pill">3 份示例资料</span></div>
          <div className="lp-demo-document-list" aria-label="选择示例资料">
            {documents.map(({ name, meta, Icon, kind }, index) => <button key={name} type="button" className={`lp-demo-document ${documentIndex === index ? "is-selected" : ""}`} aria-pressed={documentIndex === index} onClick={() => setDocumentIndex(index)}>
              <span className={`lp-demo-file-icon lp-demo-file-${kind}`}><Icon size={24} weight="duotone" /></span>
              <span className="lp-demo-file-copy"><strong>{name}</strong><span>{meta}</span></span>
              <ArrowRight size={16} aria-hidden="true" />
            </button>)}
          </div>
          <div className="lp-demo-source-preview" aria-live="polite">
            <div><span className="lp-demo-mini-rule" /><span>知识点摘录</span></div>
            <strong>{document.title}</strong><p>{document.text}</p>
            <span className="lp-demo-source-location"><BookOpen size={12} />{document.source}</span>
          </div>
        </>}
        {step === 1 && <>
          <div className="lp-demo-heading"><div><span className="lp-demo-eyebrow">TODAY / 示例计划</span><h3>今天，先做好这三件事</h3></div><CalendarBlank size={23} weight="light" aria-hidden="true" /></div>
          <div className="lp-demo-week" aria-label="示例一周，星期三为当天">
            {["一", "二", "三", "四", "五", "六", "日"].map((day, index) => <div key={day} className={index === 2 ? "is-today" : ""}><span>{day}</span><strong>{index + 10}</strong><i aria-hidden="true" /></div>)}
          </div>
          <div className="lp-demo-task-list">
            {tasks.map((task, index) => <label key={task.title} className={`lp-demo-task ${completed.includes(index) ? "is-complete" : ""}`}>
              <input type="checkbox" checked={completed.includes(index)} onChange={() => toggleTask(index)} />
              <span className="lp-demo-task-box" aria-hidden="true"><Check size={13} weight="bold" /></span>
              <span className="lp-demo-task-copy"><strong>{task.title}</strong><span>高等数学 · {task.type}</span></span>
              <span className="lp-demo-task-time">{task.minutes}<small>分钟</small></span>
            </label>)}
          </div>
          <div className="lp-demo-progress-label" aria-live="polite"><span>{done === 3 ? "今天的示例任务，完成了。" : "每完成一件，就往前一点。"}</span><strong>{done}<span> / 3</span></strong></div>
          <div className="lp-demo-progress-track" role="progressbar" aria-label="示例任务完成数量" aria-valuemin={0} aria-valuemax={3} aria-valuenow={done}><span style={{ width: `${done / 3 * 100}%` }} /></div>
        </>}
        {step === 2 && <>
          <div className="lp-demo-heading"><div><span className="lp-demo-eyebrow">PRACTICE / 示例记忆卡</span><h3>看懂了，再试一次</h3></div><Stack size={23} weight="light" aria-hidden="true" /></div>
          <div className={`lp-demo-memory ${answer ? "is-answer" : ""}`}>
            <div className="lp-demo-card-index"><span>{answer ? "A / 答案" : "Q / 想一想"}</span><span>01—03</span></div>
            <div className="lp-demo-memory-content" key={answer ? "answer" : "question"} aria-live="polite">
              {answer ? <><span className="lp-demo-answer-mark"><CheckCircle size={25} weight="light" />不一定。</span><p>左右导数还必须<strong>相等</strong>。</p><span className="lp-demo-memory-example">例如 y = |x| 在 0 处，左导数 −1，右导数 1，仍不可导。</span></> : <><p>左右导数都存在，<br />函数就一定可导吗？</p><span className="lp-demo-memory-hint">先想一想，再揭开答案。</span></>}
            </div>
            <div className="lp-demo-memory-foot"><span>高等数学 · 单侧导数</span><span aria-hidden="true">↗</span></div>
          </div>
          <button type="button" className="lp-demo-flip" onClick={() => setAnswer(current => !current)} aria-expanded={answer}>{answer ? <ArrowUUpLeft size={17} /> : <Stack size={17} />}{answer ? "再看题目" : "翻看答案"}<ArrowRight size={16} /></button>
          <span className="lp-demo-memory-note">这里只演示翻卡，学习记录不会被写入。</span>
        </>}
      </div>
    </div>
    <div className="lp-demo-bottomline"><span>{studyLabel}</span><span><span aria-hidden="true">●</span> 示例内容，可直接点一点</span></div>
  </div>;
}

function DerivativeFormula({ side = "both", compact = false }: { side?: "left" | "right" | "both"; compact?: boolean }) {
  const sign = side === "left" ? "−" : side === "right" ? "+" : "";
  return <div className={`lp-lecture-formula ${compact ? "lp-lecture-formula-compact" : ""}`} role="math" aria-label={`${side === "left" ? "左导数" : side === "right" ? "右导数" : "导数"}等于h趋于0${side === "left" ? "负" : side === "right" ? "正" : ""}时，f(x0+h)减f(x0)除以h的极限`}>
    <span>f ′<sub>{sign}</sub>(x<sub>0</sub>) = </span><span className="lp-lecture-limit"><span>lim</span><small>h → 0<sup>{sign}</sup></small></span><span className="lp-lecture-fraction"><span>f(x<sub>0</sub> + h) − f(x<sub>0</sub>)</span><span>h</span></span>
  </div>;
}

const lectureSources = [
  { time: "00:00", title: "导数定义", heading: "从变化量，理解导数", text: "当自变量的变化量趋近于 0，函数变化量与它的比值如果趋于一个确定的数，这就是导数。" },
  { time: "02:31", title: "单侧导数", heading: "可导，需要两边都说得通", text: "左导数与右导数都存在，并且相等，函数在这一点才可导。只知道其中一边，还不够。" },
  { time: "04:23", title: "绝对值例题", heading: "用 y = |x|，验一次条件", text: "在 x = 0 处，左导数是 −1，右导数是 1。两者都存在，却不相等，因此在 0 处不可导。" },
] as const;
type LectureTab = "notes" | "example" | "board";
const lectureTabs: { id: LectureTab; label: string }[] = [{ id: "notes", label: "讲义" }, { id: "example", label: "例题" }, { id: "board", label: "板书" }];

export function LectureDemo() {
  const [sourceIndex, setSourceIndex] = useState(1);
  const [tab, setTab] = useState<LectureTab>("notes");
  const [solution, setSolution] = useState(false);
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const source = lectureSources[sourceIndex];
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % lectureTabs.length;
    else if (event.key === "ArrowLeft") next = (index + lectureTabs.length - 1) % lectureTabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = lectureTabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    setTab(lectureTabs[next].id);
    tabRefs.current[next]?.focus();
  }
  return <div className="lp-lecture-shell" role="region" aria-label="网课精读交互演示">
    <div className="lp-lecture-topbar"><span><span className="lp-lecture-logo" aria-hidden="true">考</span><strong>网课精读</strong><i>/</i><span>单侧导数</span></span><span className="lp-lecture-demo-label">内容演示</span></div>
    <div className="lp-lecture-layout">
      <div className="lp-lecture-source">
        <div className="lp-lecture-chalkboard" aria-label="板书示意，独立排版的公式，并非原始视频截图">
          <div className="lp-lecture-chalk-label"><span>板书示意</span><span>{source.time}</span></div>
          <div className="lp-lecture-chalk-content" key={sourceIndex}>
            <span className="lp-lecture-chalk-title">{source.title}</span>
            {sourceIndex === 2 ? <><span className="lp-lecture-absolute">y = |x|</span><div className="lp-lecture-chalk-result"><span>f ′<sub>−</sub>(0) = −1</span><span>f ′<sub>+</sub>(0) = 1</span></div><span className="lp-lecture-chalk-note">左右不等，故不可导。</span></> : <><DerivativeFormula compact side={sourceIndex === 1 ? "left" : "both"} />{sourceIndex === 1 ? <span className="lp-lecture-chalk-note">左导数 = 右导数 ⇔ 可导</span> : <span className="lp-lecture-chalk-note">变化量 h，可以为正，也可以为负。</span>}</>}
          </div>
          <span className="lp-lecture-chalk-dash" aria-hidden="true" />
        </div>
        <div className="lp-lecture-time-ruler">
          <div><label htmlFor={`${id}-time-ruler`}>拖动时间尺，切一段重点</label><output htmlFor={`${id}-time-ruler`}>{source.time}</output></div>
          <input id={`${id}-time-ruler`} type="range" min={0} max={2} step={1} value={sourceIndex} aria-valuetext={`${source.time}，${source.title}`} onChange={event => { setSourceIndex(Number(event.target.value)); setTab("notes"); }} />
          <span className="lp-lecture-ruler-marks" aria-hidden="true"><span>00:00</span><span>02:31</span><span>04:23</span></span>
        </div>
        <div className="lp-lecture-timeline-label"><span>按知识点回看</span><span>点击定位 <ArrowRight size={12} /></span></div>
        <div className="lp-lecture-timeline" aria-label="选择网课示例片段">
          {lectureSources.map((item, index) => <button key={item.time} type="button" onClick={() => { setSourceIndex(index); setTab("notes"); }} aria-pressed={sourceIndex === index} className={sourceIndex === index ? "is-current" : ""}><span className="lp-lecture-source-play">{sourceIndex === index ? <Play size={11} weight="fill" /> : <span />}</span><time>{item.time}</time><span>{item.title}</span><ArrowRight size={14} aria-hidden="true" /></button>)}
        </div>
      </div>
      <div className="lp-lecture-reader">
        <div className="lp-lecture-tabs" role="tablist" aria-label="切换网课演示内容">
          {lectureTabs.map((item, index) => <button key={item.id} ref={node => { tabRefs.current[index] = node; }} type="button" role="tab" id={`${id}-${item.id}-tab`} aria-controls={`${id}-${item.id}-panel`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={event => moveTab(event, index)}>{item.label}</button>)}
        </div>
        <div className="lp-lecture-read-body" role="tabpanel" id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}-tab`} tabIndex={0}>
          {tab === "notes" && <>
            <div className="lp-lecture-reader-meta"><span>考前速览</span><span>1 个条件 · 1 道例题</span></div>
            <h3>读完这一页，<br />把单侧导数讲清楚。</h3>
            <p className="lp-lecture-intro">先看结论，再沿着来源回去理解。</p>
            <article className="lp-lecture-source-callout" key={sourceIndex} aria-live="polite"><span><span className="lp-lecture-citation-dot" /><time>{source.time}</time><span>· {source.title}</span></span><h4>{source.heading}</h4><p>{source.text}</p></article>
            <div className="lp-lecture-key-condition"><span>记住这个关系</span><strong>可导 ⇔ 左右导数存在且相等</strong></div>
            <div className="lp-lecture-reader-note"><BookOpen size={14} /><span>每个知识点，都留着回到原课的路。</span></div>
          </>}
          {tab === "example" && <>
            <div className="lp-lecture-reader-meta"><span>原课例题 · 内容示例</span><time>04:23</time></div>
            <h3>两边都有，<br />就一定可导吗？</h3>
            <div className="lp-lecture-example-question"><span>例 01</span><p>判断函数 <strong>y = |x|</strong><br />在 <strong>x = 0</strong> 处是否可导。</p></div>
            <button type="button" className="lp-lecture-solution-button" onClick={() => setSolution(current => !current)} aria-expanded={solution} aria-controls={`${id}-solution`}>{solution ? "收起解法" : "展开解法"}<ArrowRight size={16} /></button>
            {solution && <div className="lp-lecture-solution" id={`${id}-solution`}><p><span>01</span>左导数 f ′<sub>−</sub>(0) = −1</p><p><span>02</span>右导数 f ′<sub>+</sub>(0) = 1</p><strong>左右导数不相等，所以不可导。</strong></div>}
            <p className="lp-lecture-example-foot">先自己做，再对照条件与解法。</p>
          </>}
          {tab === "board" && <>
            <div className="lp-lecture-reader-meta"><span>公式整理 · 板书示意</span><time>{source.time}</time></div>
            <h3>听到的符号，<br />也要看得清楚。</h3>
            <div className="lp-lecture-formula-paper"><span>左导数</span><DerivativeFormula side="left" /><span>右导数</span><DerivativeFormula side="right" /></div>
            <p className="lp-lecture-board-warning">抽样画面需核对原图。遮挡、模糊与采样间隙，仍可能遗漏内容。</p>
            <div className="lp-lecture-reader-note"><BookOpen size={14} /><span>这里为排版示意，不是原课识别结果。</span></div>
          </>}
        </div>
      </div>
    </div>
    <div className="lp-lecture-footer"><span><Check size={13} />讲义、例题与来源，放在一起</span><span>示例可点，不会创建真实课程</span></div>
  </div>;
}
