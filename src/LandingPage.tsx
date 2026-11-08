import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, BookOpen, Check, FileText, Minus, Pause, Play, Plus } from "@phosphor-icons/react";
import KnowledgeGarden from "./KnowledgeGarden";
import LandingWorkbench from "./LandingWorkbench";
import "./landing-playful.css";
import "./landing-workbench-bright.css";

type Step = 0 | 1 | 2;
const chapters = [
  { id: "collect", label: "资料，各归其位", title: <>一股脑放进来。<br />一门门理清楚。</>, description: "课件、笔记、复习范围一起导入。AI 建议所属课程，你确认后，资料就有了去处。", detail: "PDF / WORD / PPT / 图片", number: "01" },
  { id: "arrange", label: "知识，重新连起来", title: <>少翻十份资料。<br />多看一份好笔记。</>, description: "勾选资料，告诉 AI 你想整理什么。合并重复知识，保留条件、步骤和出处。", detail: "多选资料 · 对话整理 · PDF / Word", number: "02" },
  { id: "remember", label: "看懂，还要会做", title: <>哪里还没掌握，<br />做一遍就知道。</>, description: "围绕自己的资料出题、作答、批改。带着薄弱点回到笔记，复习才有下一步。", detail: "自定义题目 · 作答批改 · 错题回练", number: "03" },
];
const faqs = [
  ["考谱适合谁？", "需要同时准备几门期末考试，手里有课件、笔记和网课的大学生。把 PDF、Word、PPT、手写笔记和 B 站课程一起导进来，考谱按课程归档，再帮你整理笔记、出题练习和模考。"],
  ["我需要先整理好资料吗？", "不用。可以一次选多份资料，考谱会先解析内容，再建议每份资料属于哪门课，确认后才归档，归属不对也能改。手写内容和公式的识别结果仍建议核对。B 站课程支持整门导入，自动读取分 P 并归档到对应课程。"],
  ["所有B站网课都能直接读取吗？", "支持粘贴视频、合集和短链接，自动展开分集目录。有公开字幕时会直接读取字幕生成讲义，不用另外安装转写工具；没有公开字幕、需要本机转写或抽取板书画面时，会依赖可选的转写、抽帧组件，缺少时页面会直接说明。受限视频无法处理。板书是抽样识别，模糊的公式和缺少依据的地方会提示回看原文。"],
  ["资料和AI生成内容会存到哪里？", "都保存在运行考谱这台设备的本地目录里，每个账户有独立的学习空间，课程、笔记、练习和知识库互不可见。知识库还会生成一份 Markdown 文件树，包含原文、整理后的笔记和关键帧，可以直接用 Obsidian 打开。使用 AI 时，相关资料或采样画面会发送给你在设置中配置的模型服务；目前不提供跨设备云同步。"],
];
const clips = [
  { time: "00:00", label: "导数的定义", title: "先看变化，再看极限。", text: "导数描述函数在一点的瞬时变化率。先计算函数增量与自变量增量的比值，再考察增量趋近于0时，这个比值是否有确定的极限。", conclusion: "差商极限存在，才有导数。", source: "课堂讲解 · 导数定义", formula: "导数 = 差商的极限" },
  { time: "02:31", label: "单侧导数", title: "两边存在，还要相等。", text: "左导数与右导数都存在，而且相等，函数在这一点才可导。只知道其中一边，或两边各有一个不同的值，都还不够。", conclusion: "可导 ⇔ 左右导数存在且相等", source: "课堂讲解 · 单侧导数", formula: "f′₋(x₀) = f′₊(x₀)" },
  { time: "04:23", label: "绝对值例题", title: "把条件放回题目里。", text: "对于 f(x)=|x|，在x=0处左导数是−1，右导数是1。虽然两边都存在，但它们不相等，所以函数在0处不可导。", conclusion: "连续不一定可导。这个例子就是反例。", source: "课堂例题 · 绝对值函数", formula: "f′₋(0) = −1 ≠ 1 = f′₊(0)" },
];

function LectureSlice({quiet}:{quiet:boolean}) {
  const [clip, setClip] = useState(1);
  const [located, setLocated] = useState(false);
  const [auto,setAuto]=useState(false);
  const host=useRef<HTMLDivElement>(null);
  const current = clips[clip];
  useEffect(()=>{
    if(!auto||quiet||!host.current)return;
    let timer:ReturnType<typeof setInterval>|undefined;let visible=false;
    const sync=()=>{clearInterval(timer);timer=undefined;if(visible&&!document.hidden)timer=setInterval(()=>{setClip(value=>(value+1)%clips.length);setLocated(false);},2600);};
    const observer=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting||false;sync();},{threshold:.2});observer.observe(host.current);document.addEventListener('visibilitychange',sync);
    return()=>{clearInterval(timer);observer.disconnect();document.removeEventListener('visibilitychange',sync);};
  },[auto,quiet]);
  function select(index: number) { setClip(index); setLocated(false);setAuto(false); }
  return <div ref={host} className="sf-lecture-demo" id="lp-lecture-demo" role="region" aria-label="网课精读交互演示" data-playing={auto&&!quiet}>
    <div className="sf-window-bar"><span><BookOpen size={16} />网课精读<span className="sf-window-slash">/</span>高等数学</span><div className="sf-lecture-demo-controls"><span className="sf-sample-label">交互演示</span><button type="button" onClick={()=>setAuto(value=>!value)} aria-pressed={auto&&!quiet} disabled={quiet}>{auto&&!quiet?<Pause size={13}/>:<Play size={13} weight="fill"/>}{auto&&!quiet?'暂停演示':'自动演示'}</button></div></div>
    <div className="sf-lecture-layout"><div className="sf-video-side">
      <div className={`sf-board ${located ? "is-located" : ""}`} aria-label="导数板书示意，不是原视频识别结果">
        <span className="sf-board-label">函数与导数<span>板书示意</span></span>
        <svg className="sf-function-graph" viewBox="0 0 340 190" role="img" aria-label={clip===2?"绝对值函数图像在原点形成折角":"平方函数的光滑曲线，两侧导数相同"}><path d="M25 150H320M170 174V16" fill="none" stroke="currentColor" opacity=".25" strokeWidth="1"/><path key={clip===2?'corner':'smooth'} className="sf-graph-curve" d={clip===2?"M55 35L170 150L285 35":"M45 32Q170 268 295 32"} fill="none" stroke="currentColor" strokeWidth="3"/><circle cx="170" cy="150" r="4" fill="currentColor"/><text x="298" y="171">x</text><text x="182" y="28">y</text><text x="180" y="170">0</text><text x="215" y="70">{clip===2?'f(x) = |x|':'f(x) = x²'}</text></svg>
        <div className="sf-board-formula">{current.formula}</div><div className="sf-board-position"><Play size={13} weight="fill"/><time>{current.time}</time><span>{located ? "已定位对应片段" : "示例片段"}</span></div>
      </div>
      <div className="sf-scrubber"><label htmlFor="sf-lecture-timeline">拖动时间尺，换一段读<time>{current.time}</time></label><input id="sf-lecture-timeline" type="range" min="0" max="2" step="1" value={clip} onFocus={()=>setAuto(false)} onPointerDown={()=>setAuto(false)} onKeyDown={()=>setAuto(false)} onChange={event => select(Number(event.target.value))} /><div><span>00:00</span><span>04:23</span></div></div>
      <div className="sf-clip-list" aria-label="选择示例知识片段">{clips.map((item,index)=><button type="button" key={item.label} onClick={()=>select(index)} aria-pressed={clip===index}><time>{item.time}</time><span>{item.label}</span>{clip===index?<ArrowRight size={15}/>:<span className="sf-clip-index">0{index+1}</span>}</button>)}</div>
    </div>
      <article className="sf-reading-page" aria-live="polite"><div className="sf-page-running"><span>高等数学 / 复习讲义</span><FileText size={16}/></div><div className="sf-reading-content" key={clip}><span className="sf-paper-kicker">{current.time} / {current.label}</span><h3>{current.title}</h3><p>{current.text}</p><div className="sf-reading-conclusion"><span>这一段，记住</span><strong>{current.conclusion}</strong></div><div className="sf-reading-source"><BookOpen size={14}/><span>{current.source}</span><button type="button" onClick={()=>setLocated(!located)} aria-pressed={located}>{located?"已定位":"定位来源"}<ArrowUpRight size={14}/></button></div></div><div className="sf-paper-footer"><span>讲义保留来源，便于核对。</span><span>0{clip+1}</span></div></article>
    </div><p className="sf-demo-disclaimer">示例文字与板书仅用于体验，不会创建真实课程。</p>
  </div>;
}

export default function LandingPage({ onLogin, onRegister, publicDemo = false }: { onLogin: () => void; onRegister: () => void; publicDemo?: boolean }) {
  const [step, setStep] = useState<Step>(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(()=>window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [scrolled,setScrolled] = useState(false);
  const root=useRef<HTMLDivElement>(null);
  const quiet=paused||reduced;
  useEffect(()=>{const preference=window.matchMedia("(prefers-reduced-motion: reduce)");const update=()=>setReduced(preference.matches);preference.addEventListener("change",update);return()=>preference.removeEventListener("change",update);},[]);
  useEffect(()=>{
    let frame=0;
    const followHash=()=>{const index=chapters.findIndex(chapter=>window.location.hash===`#lp-${chapter.id}`);if(index<0)return;setStep(index as Step);if(window.matchMedia('(max-width: 640px)').matches){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>root.current?.querySelector('.sf-stage-tabs')?.scrollIntoView({block:'start',behavior:'instant'}));}};
    followHash();window.addEventListener('hashchange',followHash);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener('hashchange',followHash);};
  },[]);
  useEffect(()=>{
    const host=root.current;if(!host||!('IntersectionObserver' in window))return;
    const marker=host.querySelector('.sf-top-marker');const headerObserver=new IntersectionObserver(entries=>setScrolled(!entries[0].isIntersecting));if(marker)headerObserver.observe(marker);
    const visible=new Map<number,number>();
    const storyObserver=new IntersectionObserver(entries=>{entries.forEach(entry=>visible.set(Number((entry.target as HTMLElement).dataset.studyStep),entry.isIntersecting?entry.intersectionRatio:0));const nearest=[...visible].sort((a,b)=>b[1]-a[1])[0];if(nearest?.[1]>0)setStep(nearest[0] as Step);},{rootMargin:'-22% 0px -30% 0px',threshold:[0,.15,.4,.65,1]});
    host.querySelectorAll('[data-study-step]').forEach(el=>storyObserver.observe(el));
    const revealObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('sf-in-view');revealObserver.unobserve(entry.target);}}),{threshold:.08});host.querySelectorAll('[data-reveal]').forEach(el=>revealObserver.observe(el));host.dataset.enhanced='true';
    return()=>{headerObserver.disconnect();storyObserver.disconnect();revealObserver.disconnect();};
  },[]);
  function start(action:()=>void){window.scrollTo({top:0,behavior:'instant'});action();}
  function chooseStep(index:Step){setStep(index);if(window.matchMedia('(min-width: 1081px)').matches)document.getElementById(`lp-${chapters[index].id}`)?.scrollIntoView({behavior:quiet?'instant':'smooth',block:'center'});}
  return <div ref={root} className={`sf-landing ${quiet?'sf-quiet':''}`} data-theme="light" id="lp-top"><span className="sf-top-marker" aria-hidden="true"/><span className="sf-reading-progress" aria-hidden="true"/><a href="#lp-story" className="sf-skip">跳到功能介绍</a>
    <header className={`sf-nav ${scrolled?'is-scrolled':''}`}><div className="sf-nav-inner"><a href="#lp-top" className="sf-brand" aria-label="考谱介绍首页"><BookOpen size={27} weight="regular"/><strong>考谱</strong><span>KAOPU</span></a><nav aria-label="介绍页导航"><a href="#lp-story">如何复习</a><a href="#lp-lecture">网课精读</a><a href="#lp-faq">你可能想问</a></nav><div className="sf-nav-actions"><button className="sf-login" type="button" onClick={()=>start(onLogin)}>{publicDemo ? "项目文档" : "登录"}</button><button className="sf-button sf-button-small" type="button" onClick={()=>start(onRegister)}>{publicDemo ? "启动完整版" : "开始考谱"}<ArrowUpRight size={16}/></button></div></div></header>
    <main>
      <section className="sf-hero sf-container" aria-labelledby="lp-hero-title"><div className="sf-hero-copy"><p className="sf-intro-label"><BookOpen size={15}/>你的期末复习搭子</p><h1 id="lp-hero-title">散落的知识，<br/><span>这次连起来。</span></h1><p className="sf-hero-description">课件、笔记、网课，尽管放进来。<br/>考谱帮你理清课程，连成自己的知识。</p><div className="sf-hero-actions"><button type="button" className="sf-button" onClick={()=>start(onRegister)}>{publicDemo ? "在 Codespaces 中运行" : "开始我的复习"}<ArrowUpRight size={19}/></button><a href="#lp-playground" className="sf-inline-link">先玩一下<ArrowDown size={16}/></a></div></div><div className="sf-hero-art" id="lp-playground"><KnowledgeGarden quiet={quiet}/></div></section>
      <div className="sf-formats sf-container"><span>从你已经有的资料开始</span><div><span>PDF</span><i/><span>Word</span><i/><span>PPT</span><i/><span>手写笔记</span><i/><span>网课链接</span></div><a href="#lp-story"><span>如何复习</span><ArrowDown size={16}/></a></div>
      <section className="sf-journey sf-container" id="lp-story" aria-labelledby="lp-story-title"><div className="sf-section-heading" data-reveal><span className="sf-section-rule"/><h2 id="lp-story-title">复习的每一步，<br/><span>终于连得起来。</span></h2><p>从文件夹里的一堆资料，到真正装进脑海的知识。</p></div><div className="sf-story-layout"><div className="sf-story-copy">{chapters.map((chapter,index)=><article key={chapter.id} id={`lp-${chapter.id}`} data-study-step={index} className={`sf-story-step ${step===index?'is-current':''}`}><span className="sf-step-number">{chapter.number}</span><div><p className="sf-step-label">{chapter.label}</p><h3>{chapter.title}</h3><p className="sf-step-description">{chapter.description}</p><span className="sf-step-detail">{chapter.detail}</span></div></article>)}</div><div className="sf-story-stage"><div className="sf-stage-inner"><div className="sf-stage-tabs" role="group" aria-label="切换复习流程演示">{chapters.map((chapter,index)=><button type="button" key={chapter.id} onClick={()=>chooseStep(index as Step)} aria-pressed={step===index}><span>{chapter.number}</span>{['导入资料','整理笔记','巩固练习'][index]}</button>)}</div><div className="sf-mobile-step-copy" aria-live="polite"><h3>{chapters[step].title}</h3><p>{chapters[step].description}</p></div><LandingWorkbench step={step}/><div className="sf-stage-caption"><span>用你的资料，搭起自己的知识体系。</span><span>示例可操作<ArrowUpRight size={13}/></span></div></div></div></div></section>
      <section className="sf-lecture-section" id="lp-lecture" aria-labelledby="lp-lecture-title"><div className="sf-container"><div className="sf-section-heading sf-lecture-heading" data-reveal><span className="sf-section-rule"/><h2 id="lp-lecture-title">网课好长。<br/><span>那就换个读法。</span></h2><p>拖动时间尺，讲义跟着走。读不懂的地方，再回原课看一眼。</p></div><div data-reveal><LectureSlice quiet={quiet}/></div><div className="sf-lecture-benefits"><span><Check size={15}/>按知识点阅读</span><span><Check size={15}/>沿来源回看</span><span><Check size={15}/>整理后导入课程</span></div></div></section>
      <section className="sf-note-band sf-container" aria-label="从理解到掌握" data-reveal><span className="sf-note-band-symbol" aria-hidden="true">↳</span><div><h2>不止收进文件夹。<br/><span>还要装进脑海。</span></h2><p>整理、理解、练习，再回到没有掌握的那一点。</p></div><a href="#lp-remember" aria-label="回看巩固练习演示" onClick={()=>setStep(2)}><span>看巩固练习</span><ArrowUpRight size={26} weight="light"/></a></section>
      <section className="sf-faq sf-container" id="lp-faq" aria-labelledby="lp-faq-title"><div><span className="sf-section-rule"/><h2 id="lp-faq-title">开始之前，<br/>你可能想问。</h2><p>把问题说明白，再安心开始。</p></div><div className="sf-faq-list">{faqs.map(([question,answer],index)=><details key={question}><summary><span><small>0{index+1}</small>{question}</span><Plus size={18} className="sf-faq-plus"/><Minus size={18} className="sf-faq-minus"/></summary><p>{answer}</p></details>)}</div></section>
      <section className="sf-final sf-container" aria-labelledby="lp-final-title"><div className="sf-final-word" aria-hidden="true"><span>考</span><span>谱</span></div><div className="sf-final-copy"><BookOpen size={28}/><h2 id="lp-final-title">期末这回事，<br/><span>这回有谱。</span></h2><button type="button" className="sf-button" onClick={()=>start(onRegister)}>{publicDemo ? "在 Codespaces 中运行" : "开启我的复习"}<ArrowUpRight size={19}/></button><p>{publicDemo ? "想在自己的电脑上使用？" : "已有账户？"}<button type="button" onClick={()=>start(onLogin)}>{publicDemo ? "查看安装说明" : "继续上次的复习"}<ArrowRight size={14}/></button></p></div></section>
    </main>
    <footer className="sf-footer sf-container"><a className="sf-brand" href="#lp-top"><BookOpen size={23}/><strong>考谱</strong></a><p>温故，而知新。</p><div className="sf-footer-controls"><button type="button" onClick={()=>setPaused(!paused)} aria-pressed={quiet} disabled={reduced}>{quiet?<Play size={15}/>:<Pause size={15}/>}<span>{reduced?'已减少动态':paused?'开启动效':'暂停动效'}</span></button></div><a href="#lp-top" className="sf-back-top" aria-label="返回介绍页顶部"><span>回到顶部</span><ArrowUpRight size={16}/></a></footer>
  </div>;
}
