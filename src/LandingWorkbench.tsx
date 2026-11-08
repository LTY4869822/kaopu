import { useId, useState } from "react";
import {
  ArrowRight,
  ArrowUUpLeft,
  BookOpen,
  Check,
  CheckCircle,
  FilePdf,
  FilePpt,
  FileText,
  FolderSimple,
  ListChecks,
  Minus,
  Quotes,
} from "@phosphor-icons/react";
import "./landing-workbench.css";

type StudyStep = 0 | 1 | 2;
const sources = [
  {
    name: "第二章 导数.pdf",
    kind: "PDF",
    course: "高等数学",
    meta: "28 页 · 课堂讲义",
    Icon: FilePdf,
    location: "第 6 页 · 单侧导数",
    excerpt: "函数在一点可导，当且仅当该点的左导数、右导数都存在且相等。只有两边都存在，还不足以推出可导。",
  },
  {
    name: "课堂例题.pptx",
    kind: "PPT",
    course: "高等数学",
    meta: "16 页 · 例题与解法",
    Icon: FilePpt,
    location: "第 4 页 · 绝对值函数",
    excerpt: "对于 y = |x|，在 x = 0 处，左导数为 −1，右导数为 1。左右导数不相等，因此函数在这一点不可导。",
  },
  {
    name: "线性代数提纲.docx",
    kind: "WORD",
    course: "线性代数",
    meta: "5 页 · 复习提纲",
    Icon: FileText,
    location: "第 1 页 · 矩阵与行列式",
    excerpt: "复习范围：矩阵的运算、行列式、线性方程组与特征值。",
  },
] as const;

/** A self-contained, local demonstration. It never uploads files or calls an AI service. */
export default function LandingWorkbench({ step }: { step: StudyStep }) {
  const [organized, setOrganized] = useState(false);
  const [selected, setSelected] = useState<number[]>([0, 1]);
  const [noteSources, setNoteSources] = useState<number[]>([]);
  const [generated, setGenerated] = useState(false);
  const [citationsOpen, setCitationsOpen] = useState(false);
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
  const [checked, setChecked] = useState(false);
  const uid = useId();
  const stageNames = ["资料归科", "整理笔记", "出题与批改"];
  const state = step === 0 ? (organized ? "organized" : "unorganized") : step === 1 ? (generated ? "generated" : "draft") : (checked ? "answered" : "question");
  const visibleSources = step === 0 ? sources : sources.slice(0, 2);
  const correct = answer === "no";

  function toggleSource(index: number) {
    setSelected(current => current.includes(index) ? current.filter(item => item !== index) : [...current, index].sort());
  }

  function createNote() {
    if (!selected.length) return;
    setNoteSources([...selected]);
    setGenerated(true);
    setCitationsOpen(false);
  }

  function retry() {
    setAnswer(null);
    setChecked(false);
  }

  return (
    <div className="sf-workbench" data-step={step} data-state={state}>
      <div className="sf-wb-topbar">
        <span className="sf-wb-wordmark"><span aria-hidden="true">考</span><strong>考谱</strong><Minus size={13} aria-hidden="true" /><span>课程工作台</span></span>
        <span className="sf-wb-demo-label"><i aria-hidden="true" />交互演示 · 示例内容</span>
      </div>

      <div className="sf-wb-layout">
        <aside className="sf-wb-sources" aria-label="示例学习资料">
          <div className="sf-wb-panel-heading"><span>学习资料</span><span className="sf-wb-counter">0{visibleSources.length}</span></div>
          <div className="sf-wb-course-label"><FolderSimple size={14} />{step === 0 ? "全部导入" : "高等数学"}</div>
          <div className="sf-wb-source-list">
            {visibleSources.map((source, index) => {
              const Icon = source.Icon;
              const file = <><Icon size={20} weight="light" aria-hidden="true" /><span><strong title={source.name}>{source.name}</strong><small>{source.meta}</small></span>{step === 0 && organized && <Check size={14} className="sf-wb-complete-icon" aria-hidden="true" />}</>;
              return step === 1 ? (
                <label className={`sf-wb-source ${selected.includes(index) ? "is-selected" : ""}`} key={source.name} data-source-index={index}>
                  <input type="checkbox" checked={selected.includes(index)} onChange={() => toggleSource(index)} aria-label={`选择 ${source.name}`} />{file}
                </label>
              ) : <div className="sf-wb-source" key={source.name} data-source-index={index}>{file}</div>;
            })}
          </div>
          <div className="sf-wb-source-foot"><BookOpen size={14} /><span>{step === 0 ? "先归科，再开始复习" : "选定资料，回答才有依据"}</span></div>
        </aside>

        <section className="sf-wb-conversation" aria-label="示例对话">
          <div className="sf-wb-panel-heading"><span>对话</span><span className="sf-wb-context"><i />基于资料</span></div>
          <div className="sf-wb-dialogue">
            <div className="sf-wb-user-message"><span>你</span><p>{step === 0 ? "这些资料，帮我按课程整理。" : step === 1 ? "把这几份资料，整理成一份复习笔记。" : "根据这份笔记，考考我。"}</p></div>
            <div className="sf-wb-assistant-message"><span className="sf-wb-avatar" aria-hidden="true">考</span><div><strong>考谱</strong><p>{step === 0 ? (organized ? "已整理为两门课程，资料各就各位。" : "先把资料归到对应课程，复习时就不用翻来翻去。") : step === 1 ? (generated ? "笔记已整理，重复内容合并，引用来源也留下了。" : "相同知识合并在一起，条件和例题分别整理。") : "从一个容易混淆的条件开始。先作答，再看解析。"}</p></div></div>
          </div>

          <div className="sf-wb-action-area">
            {step === 0 && <>
              <span className="sf-wb-attachment-count"><FileText size={14} />3 份示例资料已就绪</span>
              <button type="button" className="sf-wb-primary" onClick={() => setOrganized(value => !value)}>{organized ? <><ArrowUUpLeft size={15} />重新演示</> : <>按课程整理<ArrowRight size={16} /></>}</button>
            </>}
            {step === 1 && <>
              <span className="sf-wb-attachment-count" aria-live="polite"><FileText size={14} />已选 {selected.length} 份资料</span>
              <button type="button" className="sf-wb-primary" disabled={!selected.length} onClick={createNote}>{generated ? "重新整理笔记" : "整理复习笔记"}<ArrowRight size={16} /></button>
              {!selected.length && <span className="sf-wb-action-hint">先选择至少一份资料</span>}
            </>}
            {step === 2 && <div className="sf-wb-selected-note"><BookOpen size={19} /><span><strong>导数核心复习笔记</strong><small>已选作出题依据</small></span><Check size={15} /></div>}
          </div>
        </section>

        <section className="sf-wb-output" aria-label="示例学习产物">
          <div className="sf-wb-panel-heading"><span>{step === 0 ? "课程" : step === 1 ? "复习笔记" : "随堂练习"}</span><span className="sf-wb-output-kind">{step === 0 ? "COURSES" : step === 1 ? "NOTES" : "PRACTICE"}</span></div>
          <div className="sf-wb-output-body" key={step}>
            {step === 0 && (organized ? <div className="sf-wb-course-groups" data-testid="sf-course-groups">
              <span className="sf-wb-result-label"><CheckCircle size={16} />3 份资料，已按课程整理</span>
              <div className="sf-wb-course-group"><div><FolderSimple size={20} weight="light" /><h3>高等数学</h3><span>02</span></div>{sources.slice(0, 2).map(source => <p key={source.name}><FileText size={13} /><span>{source.name}</span><Check size={12} /></p>)}</div>
              <div className="sf-wb-course-group"><div><FolderSimple size={20} weight="light" /><h3>线性代数</h3><span>01</span></div><p><FileText size={13} /><span>{sources[2].name}</span><Check size={12} /></p></div>
              <span className="sf-wb-output-note">每门课，都有自己的学习空间。</span>
            </div> : <div className="sf-wb-empty" data-testid="sf-course-empty"><div className="sf-wb-empty-files" aria-hidden="true"><FileText size={29} weight="light" /><FolderSimple size={46} weight="thin" /><FileText size={29} weight="light" /></div><h3>散落的资料，<br />在这里归队。</h3><p>点一下「按课程整理」<br />看看它们各自的去处。</p></div>)}

            {step === 1 && (generated ? <div className="sf-wb-note-result">
              <article className="sf-wb-note-paper" data-testid="sf-note-paper">
                <div className="sf-wb-paper-meta"><span>KAOPU / STUDY NOTES</span><span>01</span></div>
                <span className="sf-wb-paper-course">高等数学 · 第二章</span><h3>导数核心复习笔记</h3>
                <p className="sf-wb-paper-lead">先记条件，再用例题检验。</p>
                {noteSources.includes(0) && <section><h4><span>01</span>可导的判断条件<sup>1</sup></h4><p>左、右导数都存在，且<strong>两者相等</strong>，函数在这一点才可导。</p><div className="sf-wb-note-equation">f ′<sub>−</sub>(x₀) = f ′<sub>+</sub>(x₀)</div></section>}
                {noteSources.includes(1) && <section><h4><span>{noteSources.includes(0) ? "02" : "01"}</span>用 y = |x| 检验一次<sup>{noteSources.indexOf(1) + 1}</sup></h4><p>在 0 处，左导数为 −1，右导数为 1。两者不相等，所以<strong>不可导</strong>。</p></section>}
                <div className="sf-wb-paper-reminder"><span>易错点</span><p>“两边都存在”不等于“两边相等”。</p></div>
                <div className="sf-wb-paper-footer"><span>{noteSources.length} 份来源 · 示例笔记</span><span>考谱 / 01</span></div>
              </article>
              <button type="button" className="sf-wb-citation-button" aria-expanded={citationsOpen} aria-controls={`${uid}-citations`} onClick={() => setCitationsOpen(value => !value)}><Quotes size={15} />{citationsOpen ? "收起引用" : "查看引用"}<span>{noteSources.length}</span></button>
              {citationsOpen && <div className="sf-wb-citations" id={`${uid}-citations`} data-testid="sf-note-citations">{noteSources.map((index, order) => <div key={index}><strong><span>{order + 1}</span>{sources[index].name}</strong><small>{sources[index].location}</small><p>{sources[index].excerpt}</p></div>)}</div>}
            </div> : <div className="sf-wb-note-placeholder"><div className="sf-wb-placeholder-label"><BookOpen size={16} /><span>你的下一份复习笔记</span></div><h3>多份资料。<br />一份清晰的笔记。</h3><div className="sf-wb-placeholder-lines" aria-hidden="true"><i /><i /><i /><i /></div><p>勾选左边的资料，再点整理。<br />内容与引用，会一起留在这里。</p></div>)}

            {step === 2 && <div className="sf-wb-practice" data-testid="sf-practice-question">
              <div className="sf-wb-question-meta"><span>01 / 单选题</span><span>导数 · 基础</span></div><h3>函数 y = |x|<br />在 x = 0 处可导吗？</h3>
              <fieldset className="sf-wb-answer-options"><legend>选择你的答案</legend>{([{value:"yes",label:"可导",letter:"A"},{value:"no",label:"不可导",letter:"B"}] as const).map(option => <label key={option.value} className={answer === option.value ? "is-chosen" : ""}><input type="radio" name={`${uid}-answer`} aria-label={option.label} value={option.value} checked={answer === option.value} onChange={() => {setAnswer(option.value);setChecked(false);}} /><span className="sf-wb-option-letter" aria-hidden="true">{option.letter}</span><span>{option.label}</span>{answer === option.value && <Check size={15} aria-hidden="true" />}</label>)}</fieldset>
              {!checked ? <button type="button" className="sf-wb-primary" disabled={answer === null} onClick={() => setChecked(true)}>核对答案<ArrowRight size={16} /></button> : <div className="sf-wb-answer-feedback" data-testid="sf-answer-feedback" data-correct={correct} role="status"><strong><CheckCircle size={17} weight={correct ? "fill" : "regular"} />{correct ? "答对了，条件掌握得很清楚。" : "再看一步：存在，还不够。"}</strong><p>左导数为 −1，右导数为 1。<br />左右导数不相等，所以在 0 处不可导。</p><span><BookOpen size={13} />对应笔记：可导的判断条件</span><button type="button" className="sf-wb-retry" onClick={retry}><ArrowUUpLeft size={14} />再做一次</button></div>}
            </div>}
          </div>
        </section>
      </div>

      <div className="sf-wb-footer"><span><ListChecks size={13} />{stageNames[step]}</span><span>仅体验交互，不读取或保存你的资料</span></div>
      <span className="sf-wb-sr-only" aria-live="polite" aria-atomic="true">{step === 0 && organized ? "3份示例资料已整理到高等数学和线性代数两门课程。" : step === 1 && generated ? `已根据${noteSources.length}份示例资料整理复习笔记，可查看引用。` : ""}</span>
    </div>
  );
}
