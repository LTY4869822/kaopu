import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, CaretDown, Check, CheckCircle, FileText, Lightbulb, Minus, Plus, Sparkle, WarningCircle } from "@phosphor-icons/react";
import ModelSettings from "./ModelSettings";
import NewbieGuide, { type GuideStep } from "./NewbieGuide";
import LessonText from "./LessonText";
import type { State } from "./types";
import type { AssessmentLibrary, AssessmentSource, AssessmentStatus } from "./assessment-types";
import "./practice-studio.css";
import "./study-flow.css";
import "./practice-batch.css";
import { ActionButton, LoadingState } from "./ui/controls";

type Props = { state: State; courseId: string; onCourseChange: (id: string) => void; onRefresh: () => Promise<unknown>; onNotify: (text: string) => void; onOpenSource: (source: AssessmentSource) => void };
type Mode = "recall" | "understanding";
type Answer = { answer: string; skipped: boolean };
type Question = { id: string; type: "single-choice" | "short-answer"; prompt: string; options: { id: string; text: string }[] };
type Review = { questionId: string; status: AssessmentStatus; answer: string; skipped: boolean; feedback: string; expectedAnswer: string; explanation: string; steps: string[]; sources: AssessmentSource[] };
type PracticeSet = { id: string; status: "draft" | "reviewing" | "review-failed" | "reviewed"; revision: number; questions: Question[]; answers: Record<string, Answer>; error?: string; report?: { summary: string; recommendations: string[]; items: Review[]; mode: "ai" | "source" } };
const complete = (a?: Answer) => !!a && (a.skipped || !!a.answer.trim());
const errorText = (e: unknown) => e instanceof Error ? e.message : "操作未完成，请稍后重试。";
const labels: Record<AssessmentStatus, string> = { correct: "回答正确", partial: "需要补充", incorrect: "需要巩固", ungraded: "待核对" };
const draftKey = (id: string) => `shifen-practice-draft:${id}`;
const guideSteps: GuideStep[] = [
  { title: "先选课，再选练习方式", body: "原文回忆适合核对概念与定义；理解应用会把课程资料变成新情境题。两种方式都可以在讲评中核对资料来源。", target: ".pb-context" },
  { title: "设置这一组怎么练", body: "选择题量、题型和重点；只想巩固薄弱点时勾选「只练错题」。普通模式由模型依据已解析资料现场出题，不是抽取固定题库。", target: ".pb-settings" },
  { title: "整组完成后统一看讲评", body: "点「开始练习」进入作答。题号可自由切换，答案自动保存；全部作答或标记暂时不会后，再提交整组查看解析。", target: ".pb-start" },
  { title: "有具体疑问，去资料答疑", body: "练习用于检验掌握情况；想直接问一个知识点时，切换到「资料答疑」，讲解下方会列出参考资料。", target: ".practice-hub-tabs" },
];
async function request<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, { signal, method: body === undefined ? "GET" : "POST", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await res.json().catch(() => ({ error: "暂时无法读取练习，请稍后重试。" }));
  if (res.status === 401) window.dispatchEvent(new Event("shifen:session-expired"));
  if (!res.ok) throw Object.assign(new Error(value.error || "请求未完成，请重试。"), { set: value.set });
  return value;
}
export default function PracticeStudio({ state, courseId, onCourseChange, onRefresh, onNotify, onOpenSource }: Props) {
  const [mode, setMode] = useState<Mode>(() => { try { return localStorage.getItem("shifen-practice-mode") === "understanding" ? "understanding" : "recall"; } catch { return "recall"; } }), [count, setCount] = useState(3);
  const [types, setTypes] = useState<string[]>(["single-choice", "short-answer"]), [focus, setFocus] = useState("");
  const [set, setSet] = useState<PracticeSet | null>(null), [answers, setAnswers] = useState<Record<string, Answer>>({}), [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(""), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [configured, setConfigured] = useState(state.providerConfigured), [modelOpen, setModelOpen] = useState(false);
  const [wrongOnly, setWrongOnly] = useState(false), [replaceConfirm, setReplaceConfirm] = useState(false), [saved, setSaved] = useState("已保存"), [cardSaved, setCardSaved] = useState<string[]>([]);
  const requests = useRef(new Set<AbortController>()), revision = useRef(0), generation = useRef(0), alive = useRef(true), actionLock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null), settingsRef = useRef<HTMLDetailsElement>(null), callbacks = useRef({ onRefresh, onNotify }); callbacks.current = { onRefresh, onNotify };
  const corpus = useMemo(() => JSON.stringify([state.courses.map(c => [c.id, c.name]), state.documents.map(d => [d.id, d.courseId, d.chunks])]), [state.courses, state.documents]);
  const hasCourse = state.courses.some(c => c.id === courseId);
  const restoredCourse = useRef(false);
  useEffect(() => {
    try {
      if (!restoredCourse.current) {
        restoredCourse.current = true;
        const previous = localStorage.getItem("shifen-practice-course");
        if (courseId === "all" && previous && state.courses.some(c => c.id === previous)) { onCourseChange(previous); return; }
      }
      if (hasCourse) localStorage.setItem("shifen-practice-course", courseId);
      localStorage.setItem("shifen-practice-mode", mode);
    } catch { /* Practice remains usable without browser storage. */ }
  }, [courseId, mode, hasCourse, state.courses, onCourseChange]);
  const scope = `${courseId}:${mode}:${corpus}`, scopeRef = useRef(scope); scopeRef.current = scope;
  useEffect(() => { alive.current = true; return () => { alive.current = false; requests.current.forEach(c => c.abort()); }; }, []);
  const controller = () => { const c = new AbortController(); requests.current.add(c); return c; };
  function install(next: PracticeSet | null) {
    let values = next?.answers || {}, rev = next?.revision || 0;
    if (next?.status === "draft") {
      try { const local = JSON.parse(localStorage.getItem(draftKey(next.id)) || "null"); if (local && Number.isSafeInteger(local.revision) && local.revision > rev && local.answers && typeof local.answers === "object") { values = local.answers; rev = local.revision; } } catch { /* Server draft remains available. */ }
    }
    setSet(next); setAnswers(values); revision.current = rev; setIndex(0); setSaved("已保存"); setReplaceConfirm(false);
  }
  useEffect(() => {
    requests.current.forEach(c => c.abort()); requests.current.clear(); generation.current++; actionLock.current = false;
    setSet(null); setAnswers({}); setIndex(0); setBusy(""); setError(""); setReplaceConfirm(false); setCardSaved([]);
    if (!hasCourse) { setLoading(false); return; }
    const c = controller(), captured = scope; setLoading(true);
    request<{ set: PracticeSet | null; configured: boolean }>(`/practice/sets?courseId=${encodeURIComponent(courseId)}&mode=${mode}`, c.signal)
      .then(v => { if (scopeRef.current === captured && !c.signal.aborted) { install(v.set); setConfigured(v.configured); } })
      .catch(e => { if (!c.signal.aborted && scopeRef.current === captured) setError(errorText(e)); })
      .finally(() => { requests.current.delete(c); if (scopeRef.current === captured && !c.signal.aborted) setLoading(false); });
    return () => c.abort();
  }, [scope, hasCourse]);
  useEffect(() => {
    if (set?.status !== "reviewing") return;
    const captured = scope, id = set.id;
    const timer = window.setInterval(() => {
      const c = controller();
      request<{ set: PracticeSet | null }>(`/practice/sets?courseId=${encodeURIComponent(courseId)}&mode=${mode}`, c.signal)
        .then(v => { if (!c.signal.aborted && scopeRef.current === captured && v.set?.id === id && v.set.status !== "reviewing") { install(v.set); if (v.set.status === "reviewed") void callbacks.current.onRefresh(); } })
        .catch(e => { if (!c.signal.aborted && scopeRef.current === captured) setError(errorText(e)); }).finally(() => requests.current.delete(c));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [set?.id, set?.status, scope, courseId, mode]);
  useEffect(() => {
    if (!set || set.status !== "draft" || !revision.current || busy === "submit") return;
    const id = set.id, rev = revision.current, captured = scope;
    const timer = window.setTimeout(() => {
      const c = controller(); setSaved("保存中…");
      request(`/practice/sets/${encodeURIComponent(id)}/draft`, c.signal, { answers, revision: rev })
        .then(() => { if (!c.signal.aborted && scopeRef.current === captured && revision.current === rev) setSaved("已保存"); })
        .catch(() => { if (!c.signal.aborted && scopeRef.current === captured) setSaved("已保存在本机，稍后同步"); }).finally(() => requests.current.delete(c));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [answers, set, busy, scope]);
  function updateAnswer(id: string, value: Answer) {
    if (!set || set.status !== "draft" || busy) return;
    const next = { ...answers, [id]: value }; revision.current++; setAnswers(next); setSaved("保存中…");
    try { localStorage.setItem(draftKey(set.id), JSON.stringify({ revision: revision.current, answers: next })); } catch { setSaved("等待同步到平台"); }
  }
  async function generate() {
    if (actionLock.current || !hasCourse) return;
    if (set?.status === "draft" && Object.values(answers).some(complete) && !replaceConfirm) { setReplaceConfirm(true); return; }
    const captured = scope, token = ++generation.current, c = controller(); actionLock.current = true; setBusy("generate"); setError("");
    const valid = () => alive.current && scopeRef.current === captured && token === generation.current && !c.signal.aborted;
    try {
      let ids: string[];
      if (wrongOnly) {
        if (mode === "recall") ids = state.questions.filter(q => q.courseId === courseId && state.attempts.filter(a => a.questionId === q.id).at(-1)?.correct === false).slice(0, count).map(q => q.id);
        else { const library = await request<AssessmentLibrary>(`/assessment?courseId=${encodeURIComponent(courseId)}`, c.signal); ids = library.questions.filter(q => ["incorrect", "partial"].includes(library.attempts.filter(a => a.questionId === q.id).at(-1)?.status || "")).slice(0, count).map(q => q.id); }
        if (ids.length !== count) throw new Error(`当前有 ${ids.length} 道可巩固的错题，请减少题量或先完成一组练习。`);
      } else {
        const result = await request<{ questions: { id: string }[] }>(mode === "recall" ? "/questions/generate" : "/assessment/generate", c.signal, { courseId, count, ...(mode === "understanding" ? { types, focus } : {}) });
        ids = result.questions.map(q => q.id); if (ids.length !== count) throw new Error("返回题量与设置不一致，请调整题量后重新生成。");
      }
      if (!valid()) return;
      const response = await request<{ set: PracticeSet }>("/practice/sets", c.signal, { courseId, mode, questionIds: ids });
      if (!valid()) return;
      install(response.set); callbacks.current.onNotify(`本组共 ${response.set.questions.length} 题，完成后统一讲评。`); await callbacks.current.onRefresh();
    } catch (e) { if (valid()) setError(errorText(e)); }
    finally { requests.current.delete(c); if (valid()) { actionLock.current = false; setBusy(""); } }
  }
  async function submit() {
    if (!set || actionLock.current || (set.status === "draft" && set.questions.some(q => !complete(answers[q.id])))) return;
    const captured = scope, id = set.id, c = controller(); actionLock.current = true; setBusy("submit"); setError("");
    try {
      const response = await request<{ set: PracticeSet }>(`/practice/sets/${encodeURIComponent(id)}/submit`, c.signal, { answers, revision: revision.current });
      if (scopeRef.current !== captured || c.signal.aborted) return;
      install(response.set); try { localStorage.removeItem(draftKey(id)); } catch { /* Server report is authoritative. */ }
      callbacks.current.onNotify("整组讲评已生成。"); await callbacks.current.onRefresh();
    } catch (e) { if (scopeRef.current === captured && !c.signal.aborted) { if ((e as { set?: PracticeSet }).set) install((e as { set: PracticeSet }).set); setError(errorText(e)); } }
    finally { requests.current.delete(c); if (scopeRef.current === captured && !c.signal.aborted) { actionLock.current = false; setBusy(""); } }
  }
  async function saveCard(q: Question, item: Review) {
    if (actionLock.current || cardSaved.includes(q.id)) return;
    const captured = scope, c = controller(); actionLock.current = true; setBusy("card"); setError("");
    try {
      await request("/cards", c.signal, { courseId, front: q.prompt.slice(0, 1000), back: [item.expectedAnswer, item.explanation, ...item.steps].join("\n").slice(0, 5000), source: "整组练习讲评", sourceKey: `practice:${q.id}` });
      if (scopeRef.current === captured && !c.signal.aborted) { setCardSaved(prev => [...prev, q.id]); callbacks.current.onNotify("已加入回忆复习。"); await callbacks.current.onRefresh(); }
    } catch (e) { if (scopeRef.current === captured && !c.signal.aborted) setError(errorText(e)); }
    finally { requests.current.delete(c); if (scopeRef.current === captured && !c.signal.aborted) { actionLock.current = false; setBusy(""); } }
  }
  const q = set?.questions[index], current = q ? answers[q.id] : undefined;
  const done = set?.questions.filter(q => complete(answers[q.id])).length || 0, total = set?.questions.length || count;
  const report = set?.report, draft = set?.status === "draft", reviewing = busy === "submit" || set?.status === "reviewing";
  const practiceStep = report || reviewing || set?.status === "review-failed" ? 2 : set ? 1 : 0;
  const modelValidation = error.startsWith("模型题目校验未通过");
  const modelValidationReason = error.replace(/^模型题目校验未通过[：:]?\s*/, "");
  function navigate(next: number) { setIndex(next); heading.current?.focus({ preventScroll: true }); }
  function adjustSettings() {
    const settings = settingsRef.current;
    if (!settings) return;
    settings.open = true;
    settings.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    settings.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
  }
  return <section className="practice-panel practice-studio practice-studio-quiet practice-batch" aria-label="课程练习" aria-busy={loading || !!busy}>
    <div className="pb-context">
      <label className="pb-course"><BookOpen size={19} /><select aria-label="筛选课程" value={courseId} disabled={!!busy} onChange={e => onCourseChange(e.target.value)}><option value="all">选择课程</option>{state.courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <div className="pb-modes" aria-label="练习方式">{([['recall', '原文回忆'], ['understanding', '理解应用']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} disabled={!!busy} onClick={() => setMode(value)}>{label}</button>)}</div>
      <button className="text-button pb-model" type="button" title="查看或修改文字模型配置" onClick={() => setModelOpen(true)}><Sparkle size={17} />{configured ? "模型设置 · 已连接" : "连接 AI 模型"}</button>
    </div>
    <ol className="pb-steps" aria-label="专项练习流程">{[["设置练习", "选择题量与方式"], ["完成作答", "答案自动保存"], ["查看讲评", "核对解析与原文"]].map(([label, description], i) => <li key={label} aria-current={practiceStep === i ? "step" : undefined} className={practiceStep > i ? "is-complete" : ""}><span>{i + 1}</span><div><strong>{label}</strong><small>{description}</small></div></li>)}
    </ol>
    <details ref={settingsRef} className="pb-settings" open={!set || undefined}>
      <summary><span>{set ? "调整下一组练习" : "设置本次练习"}<small>{count} 题 · {mode === "recall" ? "原文回忆" : "理解应用"}</small></span><CaretDown size={16} /></summary>
      <div className="pb-configuration">
        <div className="pb-field"><span id="pb-count-label">每组题量</span><div className="pb-stepper"><button type="button" aria-label="减少题量" disabled={count <= 1 || !!busy} onClick={() => setCount(v => v - 1)}><Minus size={16} /></button><input aria-labelledby="pb-count-label" type="number" min={1} max={6} value={count} disabled={!!busy} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 6) setCount(n); }} /><span>题</span><button type="button" aria-label="增加题量" disabled={count >= 6 || !!busy} onClick={() => setCount(v => v + 1)}><Plus size={16} /></button></div></div>
        {mode === "understanding" && <fieldset className="pb-types"><legend>题目类型</legend>{[['single-choice', '单选题'], ['short-answer', '简答题']].map(([value, label]) => <label key={value}><input type="checkbox" checked={types.includes(value)} disabled={!!busy || (types.length === 1 && types.includes(value))} onChange={e => setTypes(v => e.target.checked ? [...v, value] : v.filter(t => t !== value))} />{label}</label>)}</fieldset>}
        <label className="pb-wrong"><input type="checkbox" checked={wrongOnly} disabled={!!busy} onChange={e => setWrongOnly(e.target.checked)} /><span>只练错题<small>复用本课程需要巩固的历史题</small></span></label>
        {mode === "understanding" && <label className="pb-focus">想重点练什么 <span>选填</span><input aria-label="练习重点" maxLength={500} value={focus} disabled={!!busy} onChange={e => setFocus(e.target.value)} placeholder="如：链式法则、定积分应用" /></label>}
        <details className="pb-source-guide"><summary>题目从哪里来？</summary><p>{wrongOnly ? "当前只复用这门课需要巩固的历史错题，不会生成新题。" : mode === "recall" ? "依据当前课程资料中的原文，生成概念、定义等回忆题。" : "系统从当前课程已解析完成的资料中选取相关原文，由模型现场生成应用场景、题目、选项、答案和解析，不是从固定题库随机抽题。讲评时可展开来源核对原文。"}</p></details>
        <div className="pb-start"><p>{mode === "recall" ? "从资料中回忆概念与定义。" : "依据课程资料出题，覆盖理解与应用。"}<br />下一步：开始练习，整组完成后统一核对与讲解。</p><ActionButton busy={busy === "generate"} disabled={!hasCourse || !!busy || loading || (mode === "understanding" && !configured && !wrongOnly)} onClick={() => void generate()}>{busy === "generate" ? "正在准备题目…" : set ? "开始新一组" : "开始练习"}</ActionButton></div>
        {mode === "understanding" && !configured && <p className="pb-connection">请先用右上角「连接 AI 模型」完成配置，再生成理解应用题和整组讲评。</p>}
      </div>
    </details>
    {replaceConfirm && <div className="pb-confirm" role="alert"><span>本组还有未提交的答案。开始新一组后，当前练习将不再显示。</span><button type="button" className="text-button" onClick={() => setReplaceConfirm(false)}>继续当前练习</button><button type="button" className="primary" disabled={!!busy} onClick={() => void generate()}>确认开始新一组</button></div>}
    {error && (modelValidation ? <div className="pb-error pb-generation-error" role="alert"><WarningCircle size={22} /><div><h3>这次题目没有生成成功</h3><p>模型返回的内容未通过格式或来源核对，系统自动修正后仍未通过。这不是你的作答错误；本次题目未保存，已有练习和答案不受影响。</p>{modelValidationReason && <p className="pb-error-reason"><strong>具体原因：</strong>{modelValidationReason}</p>}<p>可直接重新生成；若仍失败，请减少题量、调整题型或练习重点后再试。</p><button type="button" className="secondary" onClick={adjustSettings}>调整练习设置</button></div></div> : <div className="pb-error" role="alert"><WarningCircle size={20} /><span>{error}</span></div>)}
    {loading ? <LoadingState title="正在读取练习" description="上次的作答会在这里继续。" /> : !set ? <div className="pb-empty"><BookOpen size={32} /><h3>{hasCourse ? "专心完成一组，再看懂每一题。" : "先选一门课，开始练习。"}</h3><p>{hasCourse ? "可以自由切换题目、修改答案。整组提交前不会显示答案或解析。" : "题目会根据这门课的资料生成。"}</p></div> : report ? <div className="pb-report">
      <div className="pb-report-heading"><div><h2>本组讲评</h2><p>{total} 题已完成 · {report.mode === "ai" ? "AI 集中讲评" : "原文核对，未调用 AI"}</p></div><CheckCircle size={30} weight="duotone" /></div>
      <div className="pb-review-counts"><span><i className="correct" />符合参考答案 {report.items.filter(i => i.status === "correct").length}</span><span><i className="incorrect" />需要巩固 {report.items.filter(i => i.status === "incorrect" || i.status === "partial").length}</span>{report.items.some(i => i.status === "ungraded") && <span>待核对 {report.items.filter(i => i.status === "ungraded").length}</span>}</div>
      <div className="pb-diagnosis"><LessonText text={report.summary} /><h3>接下来，优先做这些</h3><ul>{report.recommendations.map((r, i) => <li key={i}><LessonText text={r} inline /></li>)}</ul></div>
      <p className="pb-review-note">AI 讲评请结合来源核对。简答题为学习反馈，不计入掌握度。</p>
      <div className="pb-review-list">{set.questions.map((question, i) => { const item = report.items[i]; return <details key={question.id} className="pb-review-item" open={i === 0 || undefined}><summary><span className="pb-review-number">{i + 1}</span><span><LessonText text={question.prompt} inline /></span><em className={item.status}>{labels[item.status]}</em><CaretDown size={17} /></summary><div className="pb-review-content"><div className="pb-comparison"><div><h4>你的作答</h4><p><LessonText text={item.skipped ? "暂时不会" : question.type === "single-choice" ? `${item.answer}. ${question.options.find(o => o.id === item.answer)?.text || ""}` : item.answer} inline /></p></div><div><h4>参考答案</h4><p><LessonText text={item.expectedAnswer} inline /></p></div></div><p className="pb-personal-feedback"><Lightbulb size={19} /><LessonText text={item.feedback} inline /></p><h4>思路与解析</h4><LessonText text={item.explanation} />{item.steps.length > 0 && <ol className="pb-solution-steps">{item.steps.map((step, j) => <li key={j}><LessonText text={step} inline /></li>)}</ol>}
        <div className="pb-review-actions"><button type="button" className="text-button" disabled={!!busy || cardSaved.includes(question.id) || state.cards.some(c => c.sourceKey === `practice:${question.id}`)} onClick={() => void saveCard(question, item)}><Plus size={16} />{cardSaved.includes(question.id) || state.cards.some(c => c.sourceKey === `practice:${question.id}`) ? "已加入回忆复习" : "加入回忆复习"}</button></div>
        <details className="pb-sources"><summary><FileText size={16} />核对来源 · {item.sources.length} 处</summary>{item.sources.map((s, j) => <article key={j}><div><strong>{s.documentName}</strong><span>{s.locationKind === "timestamp" ? `${s.page} 秒` : `第 ${s.page} ${s.locationKind === "section" ? "段" : "页"}`}</span></div><blockquote><LessonText text={s.text} inline /></blockquote><button type="button" className="text-button" onClick={() => onOpenSource(s)}>查看原文<ArrowRight size={15} /></button></article>)}</details>
      </div></details>; })}</div>
    </div> : <div className="pb-workspace">
      <aside className="pb-navigation" aria-label="本组题目"><div><h3>本组练习</h3><span>{done} / {total} 题已处理</span></div><progress aria-label="本组作答进度" max={total} value={done} /><div className="pb-question-numbers">{set.questions.map((question, i) => <button key={question.id} type="button" aria-label={`第 ${i + 1} 题${answers[question.id]?.skipped ? '，暂时不会' : complete(answers[question.id]) ? '，已作答' : '，未作答'}`} aria-current={i === index ? "step" : undefined} className={`${complete(answers[question.id]) ? "is-done" : ""} ${answers[question.id]?.skipped ? "is-skipped" : ""}`} onClick={() => navigate(i)}>{i + 1}{complete(answers[question.id]) && !answers[question.id]?.skipped && <Check size={10} weight="bold" />}</button>)}</div><p><span className="pb-dot" />已作答<span className="pb-dot skip" />暂时不会</p></aside>
      <div className="pb-question-area">{q && <><div className="pb-question-meta"><span>第 {index + 1} 题 / 共 {total} 题</span><span>{q.type === "single-choice" ? "单项选择" : "简答题"}</span><small role="status">{draft ? saved : "答案已锁定"}</small></div><h3 ref={heading} tabIndex={-1} className="pb-question-title"><LessonText text={q.prompt} inline /></h3>
        {q.type === "single-choice" ? <fieldset className="pb-options" disabled={!draft || !!busy}><legend className="pb-sr-only">选择一个答案</legend>{q.options.map(o => <label key={o.id} className={current?.answer === o.id ? "is-selected" : ""}><input type="radio" name={`practice-${q.id}`} value={o.id} checked={current?.answer === o.id} onChange={() => updateAnswer(q.id, { answer: o.id, skipped: false })} /><span className="pb-option-letter">{o.id}</span><span><LessonText text={o.text} inline /></span><span className="pb-radio-mark">{current?.answer === o.id && <Check size={12} weight="bold" />}</span></label>)}</fieldset> : <label className="pb-answer-field">写下你的思路<textarea aria-label="你的解题思路与答案" maxLength={10000} rows={7} disabled={!draft || !!busy} value={current?.answer || ""} placeholder="先写思路，再给出关键步骤与结论。" onChange={e => updateAnswer(q.id, { answer: e.target.value, skipped: false })} /><span>{(current?.answer || "").length} / 10000</span></label>}
        <div className="pb-question-bottom"><button type="button" className={`text-button ${current?.skipped ? "is-skipped" : ""}`} disabled={!draft || !!busy} aria-pressed={!!current?.skipped} onClick={() => updateAnswer(q.id, { answer: "", skipped: !current?.skipped })}>{current?.skipped ? <CheckCircle size={17} /> : <Lightbulb size={17} />}{current?.skipped ? "已标记暂时不会" : "这题暂时不会"}</button><div><button type="button" className="secondary" disabled={index === 0} onClick={() => navigate(index - 1)}><ArrowLeft size={16} />上一题</button><button type="button" className="secondary" disabled={index === total - 1} onClick={() => navigate(index + 1)}>下一题<ArrowRight size={16} /></button></div></div>
      </>}
      <div className="pb-submit-bar"><p>{reviewing ? "正在结合本组答案和课程资料，逐题整理讲解…" : set.status === "review-failed" ? "全部答案已保存，重试不会重复记录作答。" : done === total ? "本组已全部处理，提交后解锁集中讲评。" : `还有 ${total - done} 题未处理；可以作答，或标记暂时不会。`}<span>整组提交前不会展示答案与解析</span></p><ActionButton busy={reviewing} disabled={reviewing || !!busy || (draft && done !== total)} onClick={() => void submit()}>{reviewing ? "正在生成整组讲评…" : set.status === "review-failed" ? "重新生成讲评" : `提交整组 · ${total} 题`}</ActionButton></div></div>
    </div>}
    <ModelSettings open={modelOpen} onOpenChange={setModelOpen} onConnected={async () => { if (alive.current) { setConfigured(true); await callbacks.current.onRefresh(); } }} />
    <NewbieGuide id="practice" steps={guideSteps} />
  </section>;
}
