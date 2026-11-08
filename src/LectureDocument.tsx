import { useEffect, useState } from "react";
import { BookmarkSimple, CaretDown, ChatCircleText, Check, Clock, FileText, ImageSquare, Stack } from "@phosphor-icons/react";
import LessonText, { splitLessonText } from "./LessonText";
import LessonEvidenceImage from "./LessonEvidenceImage";
import type { Lesson, LessonChatContext, LessonExample, LessonSection, LessonStudy, LessonStudyAction, LessonEditorialEvidence } from "./lesson-types";
import "./lecture-document.css";

export const lectureAnchor = (lessonId: string, kind: "section" | "example", id: string) => `lecture-${lessonId}-${kind}-${id}`;
export function readingSectionsFor(lesson: Lesson): LessonSection[] {
  const source = lesson.notes?.readingSections?.length ? lesson.notes.readingSections : lesson.notes?.sections || [];
  const seen = new Set<string>();
  return source.filter(section => {
    if (/^(?:来源说明|外部推断)/.test(section.title) || /^#{1,6}\s[^\n]+$/.test(section.text.trim())) return false;
    const signature = `${section.title.trim()}|${section.text.replace(/\s/g, "")}`;
    if (seen.has(signature)) return false;
    seen.add(signature); return true;
  });
}
export const readingExamplesFor = (lesson: Lesson) => lesson.notes?.readingExamples || lesson.notes?.examples || [];
const clock = (seconds: number | null) => {
  if (seconds == null || !Number.isFinite(seconds)) return "无时间戳";
  const whole = Math.floor(Math.max(0, seconds));
  return `${Math.floor(whole / 3600) ? `${Math.floor(whole / 3600)}:` : ""}${String(Math.floor(whole % 3600 / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
};
function videoLink(lesson: Lesson, time: number | null) {
  const bvid = lesson.url?.match(/(?:^|\/)(BV[0-9A-Za-z]{10})(?:[/?#]|$)/)?.[1];
  return bvid ? `https://www.bilibili.com/video/${bvid}/?p=${lesson.part}${time == null ? "" : `&t=${Math.floor(time)}`}` : undefined;
}
type Props = {
  lesson: Lesson; examplesOnly?: boolean; busy?: boolean;
  onAsk: (context: LessonChatContext, trigger?: HTMLElement) => void;
  onLocate: (cueId: string) => void; onOpenFrame: (frameId: string) => void;
  onSaveCard: (section: LessonSection) => void; isCardSaved: (section: LessonSection) => boolean;
  study?: LessonStudy; onStudy?: LessonStudyAction; studyBusy?: boolean;
  weakOnly?: boolean;
};

function StudyMarks({ kind, id, study, onStudy, busy }: { kind: "section" | "example"; id: string; study?: LessonStudy; onStudy?: LessonStudyAction; busy?: boolean }) {
  if (!onStudy) return null;
  const status = study?.marks[`${kind}:${id}`], completed = kind === "section" ? "read" : "practiced";
  return <div className="lecture-study-marks" role="group" aria-label={kind === "section" ? "知识点学习记录" : "例题自评记录"}>
    <button type="button" aria-pressed={status === completed} disabled={busy || !study} onClick={() => onStudy(kind, id, status === completed ? "none" : completed)}><Check size={15} />{kind === "section" ? status === "read" ? "已读" : "标为已读" : status === "practiced" ? "已练过" : "我已练过"}</button>
    <button type="button" aria-pressed={status === "weak"} disabled={busy || !study} onClick={() => onStudy(kind, id, status === "weak" ? "none" : "weak")}>还需巩固</button>
    <button type="button" className="lecture-study-bookmark" disabled={busy || !study} onClick={() => onStudy(kind, id, "bookmark")}><BookmarkSimple size={15} />记到这里</button>
  </div>;
}

function proseParagraphs(text: string) {
  const protectedRanges: { start: number; end: number }[] = [];
  let offset = 0;
  for (const part of splitLessonText(text)) {
    const value = part.kind === "math" ? part.raw : part.value;
    if (part.kind === "math") protectedRanges.push({ start: offset, end: offset + value.length });
    offset += value.length;
  }
  let fence: { marker: string; length: number; start: number } | null = null;
  for (const match of text.matchAll(/^[ \t]*(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/gm)) {
    if (!fence) fence = { marker: match[1][0], length: match[1].length, start: match.index };
    else if (match[1][0] === fence.marker && match[1].length >= fence.length) { protectedRanges.push({ start: fence.start, end: match.index + match[0].replace(/\r?\n$/, "").length }); fence = null; }
  }
  if (fence) protectedRanges.push({ start: fence.start, end: text.length });
  const paragraphs: string[] = []; let start = 0;
  for (const match of text.matchAll(/\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*/g)) {
    if (protectedRanges.some(range => match.index < range.end && match.index + match[0].length > range.start)) continue;
    const paragraph = text.slice(start, match.index).trim();
    if (paragraph) paragraphs.push(paragraph);
    start = match.index + match[0].length;
  }
  const last = text.slice(start).trim(); if (last) paragraphs.push(last);
  return paragraphs;
}

function ProgressiveProse({ text, label, limit = 3 }: { text: string; label: string; limit?: number }) {
  const paragraphs = proseParagraphs(text);
  let shown = 0, characters = 0;
  for (const paragraph of paragraphs) {
    // An indivisible mathematical paragraph stays whole, even above the soft budget.
    if (shown >= limit || shown > 0 && characters + paragraph.length > 1200) break;
    shown++; characters += paragraph.length;
  }
  if (shown >= paragraphs.length) return <LessonText text={text} />;
  return <div className="lecture-progressive-prose"><LessonText className="lecture-content-preview" text={paragraphs.slice(0, shown).join("\n\n")} /><details className="lecture-content-more"><summary><span className="lecture-more-collapsed">展开完整{label}（共{paragraphs.length}段）</span><span className="lecture-more-expanded">收起补充{label}（共{paragraphs.length}段）</span><CaretDown size={17} /></summary><LessonText text={paragraphs.slice(shown).join("\n\n")} /></details></div>;
}

function ProgressiveList({ items, ordered = false, limit, label }: { items: string[]; ordered?: boolean; limit: number; label: string }) {
  const render = (values: string[], start = 1) => ordered ? <ol className="lecture-steps" start={start}>{values.map((item, index) => <li key={index}><LessonText text={item} /></li>)}</ol> : <ul>{values.map((item, index) => <li key={index}><LessonText text={item} /></li>)}</ul>;
  return <>{render(items.slice(0, limit))}{items.length > limit && <details className="lecture-content-more"><summary><span className="lecture-more-collapsed">展开其余{label}（共{items.length}{ordered ? "步" : "条"}）</span><span className="lecture-more-expanded">收起补充{label}</span><CaretDown size={17} /></summary>{render(items.slice(limit), limit + 1)}</details>}</>;
}

function Sources({ lesson, item, onLocate }: { lesson: Lesson; item: { cueIds: string[] }; onLocate: Props["onLocate"] }) {
  if (lesson.notes?.evidenceOutdated) return <span className="lecture-source-note">更新讲义后可回查新来源。</span>;
  const ids = new Set(item.cueIds);
  const cues = [...lesson.cues, ...(lesson.visualCues || [])].filter(cue => ids.has(cue.id));
  const timed = cues.filter(cue => cue.start != null).sort((a, b) => a.start! - b.start!);
  const first = timed[0] || cues[0];
  if (!first) return <span className="lecture-source-note">来源位置暂缺，请对照原课核查。</span>;
  const url = videoLink(lesson, first.start);
  return <div className="lecture-sources">{url && <a href={url} target="_blank" rel="noreferrer"><Clock size={16} />{first.start == null ? "打开原课" : clock(first.start)}</a>}<button type="button" onClick={() => onLocate(first.id)}><FileText size={16} />对照原文</button></div>;
}

function Evidence({ lesson, frameIds, onOpenFrame, exercise = false, topic = "", evidence }: { lesson: Lesson; frameIds?: string[]; onOpenFrame: Props["onOpenFrame"]; exercise?: boolean; topic?: string; evidence?: LessonEditorialEvidence }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const frameKey = (frameIds || []).join("|");
  useEffect(() => { setMoreOpen(false); }, [lesson.id, frameKey]);
  if (lesson.notes?.evidenceOutdated) return <p className="lecture-source-note">画面已更新，更新讲义后显示关联截图。</p>;
  if (evidence) return evidence.selections.length ? <div className="lecture-evidence lecture-evidence-curated">{evidence.selections.map(selection => {
    const frame = lesson.visual?.frames.find(item => item.id === selection.frameId);
    return frame ? <LessonEvidenceImage key={frame.id} frame={frame} caption={`${selection.caption} · ${clock(frame.time)}`} onOpenSource={() => onOpenFrame(frame.id)} /> : null;
  })}</div> : <p className="lecture-evidence-missing"><ImageSquare size={17} />{evidence.note || "暂未找到清晰完整的对应画面，可在板书中补采。"}</p>;
  const frames = [...new Set(frameIds || [])].map(id => lesson.visual?.frames.find(frame => frame.id === id)).filter(frame => !!frame);
  if (!frames.length) return <p className="lecture-evidence-missing"><ImageSquare size={17} />{exercise ? "尚未关联这道题的原课截图，题干与公式请对照原课。" : "这一知识点尚未关联原课截图。"}</p>;
  // Rank only frames already cited by this item. Time proximity never creates a citation.
  const tokens = [...new Set((topic.match(/[A-Za-z][A-Za-z0-9_]{2,}|[\u3400-\u9fff]{2,}/g) || []).flatMap(word => /[\u3400-\u9fff]/.test(word) && word.length > 4 ? Array.from({ length: word.length - 2 }, (_, index) => word.slice(index, index + 3)) : [word]).filter(word => !/^(?:知识点|原课|课堂|这个|什么|虚构|例题|函数)$/.test(word)))];
  const ranked = frames.map((frame, index) => {
    const observation = lesson.visual?.observations.find(item => item.frameId === frame.id);
    const text = observation ? [observation.visibleText, observation.description, ...observation.latex].join(" ") : "";
    const matches = tokens.filter(token => text.toLocaleLowerCase().includes(token.toLocaleLowerCase())).length;
    const hasProblem = /例\s*\d|例题|已知|证明|求(?:解|证|值|导|极限)|设(?:函数|数列)|计算/.test(text);
    const hasFormula = !!observation?.latex.length || /[=∫∑]|\\(?:frac|lim|sum|int)/.test(text);
    return { frame, index, isProblem: matches > 0 && hasProblem, score: matches * 6 + (matches && hasFormula ? 4 : 0) + (matches && exercise && hasProblem ? 8 : 0) + (text.trim() ? 1 : 0) };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const limit = exercise ? 2 : 1;
  const renderFrame = (item: typeof ranked[number]) => <LessonEvidenceImage key={item.frame.id} frame={item.frame} caption={`${exercise ? item.isProblem ? "原课例题画面" : "关联课堂画面 · 题干请核对" : "原课板书"} · ${clock(item.frame.time)}`} onOpenSource={() => onOpenFrame(item.frame.id)} />;
  return <div className="lecture-evidence">{ranked.slice(0, limit).map(renderFrame)}{ranked.length > limit && <details className="lecture-more-evidence" open={moreOpen} onToggle={event => setMoreOpen(event.currentTarget.open)}><summary>更多课堂截图（{ranked.length - limit}）<CaretDown size={17} /></summary>{moreOpen && <div>{ranked.slice(limit).map(renderFrame)}</div>}</details>}</div>;
}

function Example({ lesson, example, index, onAsk, onLocate, onOpenFrame, study, onStudy, studyBusy }: Pick<Props, "lesson" | "onAsk" | "onLocate" | "onOpenFrame" | "study" | "onStudy" | "studyBusy"> & { example: LessonExample; index: number }) {
  const steps = example.solutionSteps?.filter(Boolean) || [];
  return <article className="lecture-example" id={lectureAnchor(lesson.id, "example", example.id)} tabIndex={-1}>
    <div className="lecture-block-heading"><div><span className="lecture-example-label">课堂例题 {index + 1}</span><h3><LessonText text={example.title} inline /></h3></div><button type="button" className="lecture-ask" onClick={event => onAsk({ exampleId: example.id }, event.currentTarget)}><ChatCircleText size={18} />问这道题</button></div>
    {example.needsReview && <p className="lecture-review-note">题目条件或原始转写需要核对，请先确认题干。</p>}
    {example.explanationStatus === "needs-confirmation" && <p className="lecture-review-note">{example.explanationGap || "题目条件仍不完整，请先补充或核对原课题干，再继续补齐讲解。"}</p>}
    <div className="lecture-problem"><h4>题目</h4><LessonText text={example.prompt || "未取得完整题干，请回看原课或补充题目截图。"} /></div>
    {example.editorial && (example.sourceExampleIds?.length || 0) > 1 && <p className="lecture-merge-note">已将 {example.sourceExampleIds!.length} 段同题记录合并，原始片段仍保留。</p>}
    <Evidence lesson={lesson} frameIds={example.frameIds} onOpenFrame={onOpenFrame} exercise topic={`${example.title} ${example.prompt}`} evidence={example.evidence} />
    <p className="lecture-practice-hint">先自己试一遍，再展开解法。下方记录为自主标记。</p>
    <details className="lecture-practice-answer"><summary>展开解法与详细讲解<CaretDown size={17} /></summary>
      {(steps.length > 0 || example.detailedSolution) && <section className="lecture-teacher"><h4>详细讲解与解题{example.solutionOrigin === "ai-supplement" && <span>{example.explanationStatus === "conditional" ? "有条件的补充讲解" : "补充讲解"}</span>}</h4>{example.detailedSolution && <ProgressiveProse text={example.detailedSolution} label="题解" />}{steps.length > 0 && <ProgressiveList items={steps} ordered limit={6} label="解题步骤" />}</section>}
      <details className="lecture-original-solution" open={!steps.length && !example.detailedSolution}><summary>{steps.length || example.detailedSolution ? "对照原课解法" : "看原课解法"}<CaretDown size={17} /></summary><LessonText text={example.solution || "当前来源中没有足够的解题过程，请先核对原课，或在右侧针对这道题继续提问。"} /></details>
    </details>
    <StudyMarks kind="example" id={example.id} study={study} onStudy={onStudy} busy={studyBusy} />
    <Sources lesson={lesson} item={example} onLocate={onLocate} />
  </article>;
}

export default function LectureDocument({ lesson, examplesOnly = false, busy, onAsk, onLocate, onOpenFrame, onSaveCard, isCardSaved, study, onStudy, studyBusy, weakOnly = false }: Props) {
  const notes = lesson.notes;
  if (!notes) return null;
  const sections = readingSectionsFor(lesson).filter(item => !weakOnly || study?.marks[`section:${item.id}`] === "weak");
  const examples = readingExamplesFor(lesson).filter(item => !weakOnly || study?.marks[`example:${item.id}`] === "weak");
  const overview = notes.readingOverview || notes.overview;
  const warnings = [...new Set([...(notes.readingWarnings || []), ...notes.warnings])];
  return <div className="lecture-document">
    {weakOnly && !sections.length && !examples.length && <p className="lecture-source-note">还没有标记需巩固的内容。阅读时点「还需巩固」，下次就能集中复习。</p>}
    {!examplesOnly && <>
      <div className="lecture-document-summary"><span><Check size={17} />{sections.some(section => section.editorial) ? "整课重编讲义" : notes.mode === "ai" ? "精读讲义" : "原文整理"}</span><span>{sections.length} 个知识点 · {examples.length} 个课堂例题与例子</span><span>保留 {notes.coverage.cueCount} 段原始来源</span></div>
      {!!overview.length && !weakOnly && <section className="lecture-overview"><h3>这节课先抓住什么</h3><ul>{overview.map((item, index) => <li key={index}><LessonText text={item} inline /></li>)}</ul></section>}
      {!sections.length && !weakOnly && <p className="lecture-source-note">还没有整理出知识点正文，可以先在「原文」中阅读完整来源。</p>}
      {sections.map(section => <article className="lecture-knowledge" id={lectureAnchor(lesson.id, "section", section.id)} key={section.id} tabIndex={-1}>
        <div className="lecture-block-heading"><h3><LessonText text={section.title} inline /></h3><button type="button" className="lecture-ask" onClick={event => onAsk({ sectionId: section.id }, event.currentTarget)}><ChatCircleText size={18} />问这个知识点</button></div>
        {section.inScope === false && <p className="lecture-source-note">请与任课老师的考试范围核对。</p>}
        {section.prerequisites?.length ? <details className="lecture-prerequisites"><summary>先回忆这些基础<CaretDown size={17} /></summary><ul>{section.prerequisites.map((item, index) => <li key={index}><LessonText text={item} /></li>)}</ul></details> : null}
        {section.takeaway && <div className="lecture-takeaway"><LessonText text={section.takeaway} /></div>}
        {section.intuition && <div className="lecture-intuition"><h4>先这样理解</h4><ProgressiveProse text={section.intuition} label="直觉说明" /></div>}
        <LessonText className={`lecture-main-prose ${section.editorial ? "lecture-edited-prose" : ""}`} text={section.text} />
        <Evidence lesson={lesson} frameIds={section.frameIds} onOpenFrame={onOpenFrame} topic={section.title} evidence={section.evidence} />
        {section.teacherExplanation && <details className="lecture-teacher lecture-editorial-supplement"><summary>换个角度理解 · AI 补充<CaretDown size={17} /></summary><ProgressiveProse text={section.teacherExplanation} label="讲解" /></details>}
        {!!section.sourceNotes?.length && <details className="lecture-original-solution"><summary>来源疑问与核对<CaretDown size={17} /></summary>{section.sourceNotes.map((note,index)=><LessonText key={index} text={note} />)}</details>}
        {section.steps?.length ? <section className="lecture-teacher"><h4>推导与应用</h4><ProgressiveList items={section.steps} ordered limit={6} label="推导步骤" /></section> : null}
        {section.pitfalls?.length ? <section className="lecture-pitfalls"><h4>容易卡住的地方</h4><ProgressiveList items={section.pitfalls} limit={5} label="易错点" /></section> : null}
        {section.contentAudit && (section.contentAudit.status !== "reviewed" || !!section.contentAudit.unclearSections) && <details className="lecture-original-solution lecture-content-check"><summary>本节内容待核对{section.contentAudit.remainingIssues ? ` · ${section.contentAudit.remainingIssues} 处` : ""}<CaretDown size={17} /></summary><p className="lecture-source-note">{section.contentAudit.status === "not-checked" ? "逐项内容核对尚未完成，当前讲义不能视为完整。" : "以下为AI对照原课后仍未解决的问题，可定位来源核查。"}</p>{section.contentAudit.checks?.filter(item => ["partial","missing","unclear"].includes(item.status)).map(item => { const raw = lesson.notes?.sections.find(source => source.id === item.id); return <div key={item.id}><strong>{raw?.title || "来源片段"}</strong><LessonText text={item.reason} />{raw?.cueIds[0] && <button type="button" onClick={() => onLocate(raw.cueIds[0])}>定位原文</button>}</div>; })}{section.contentAudit.findings?.map((item,index) => <div key={index}><LessonText text={`${item.statement}\n\n${item.reason}`} /><button type="button" onClick={() => onLocate(item.cueIds[0])}>定位原文</button></div>)}</details>}
        {!!section.subsections?.length && <details className="lecture-source-details"><summary>课堂细节 · {section.subsections.length} 段原始讲义<CaretDown size={17} /></summary><p className="lecture-source-note">这里保留原始课堂片段，可能含转写误差，请结合上方讲解与原图核对。</p>{section.subsections.map(child => <article key={child.id}><h4><LessonText text={child.title} inline /></h4><LessonText text={child.text} /><Sources lesson={lesson} item={child} onLocate={onLocate} /></article>)}</details>}
        {section.checkQuestion?.prompt && <section className="lecture-self-check"><h4>停一下，试着回答</h4><LessonText text={section.checkQuestion.prompt} /><details><summary>核对思路<CaretDown size={17} /></summary><LessonText text={[section.checkQuestion.answer, section.checkQuestion.explanation].filter(Boolean).join("\n\n") || "试着用自己的话说出来，也可以向讲义助手提问。"} /></details></section>}
        <StudyMarks kind="section" id={section.id} study={study} onStudy={onStudy} busy={studyBusy} />
        <footer className="lecture-block-footer"><Sources lesson={lesson} item={section} onLocate={onLocate} /><button type="button" className="lecture-save" disabled={busy || !section.text.trim() || isCardSaved(section)} onClick={() => onSaveCard(section)}>{isCardSaved(section) ? <Check size={17} /> : <Stack size={17} />}{isCardSaved(section) ? "已存记忆卡" : "存记忆卡"}</button></footer>
      </article>)}
    </>}
    {examples.length > 0 ? <section className="lecture-examples"><div className="lecture-examples-heading"><h3>跟着课堂例题练一遍</h3><p>保留原课题干与解法，补充讲解会单独标记。</p></div>{examples.map((example, index) => <Example key={`${lesson.id}:${lesson.notes?.createdAt}:${example.id}`} lesson={lesson} example={example} index={index} onAsk={onAsk} onLocate={onLocate} onOpenFrame={onOpenFrame} study={study} onStudy={onStudy} studyBusy={studyBusy} />)}</section> : examplesOnly && !weakOnly && <div className="lecture-no-examples"><FileText size={28} /><h3>这一讲还没有明确的课堂例题</h3><p>题干可能只在画面中。可以采集板书，或导入完整题目后继续整理。</p></div>}
    {!examplesOnly && !weakOnly && !!notes.readingAppendix?.length && <details className="lecture-appendix"><summary>课堂补充与来源说明 · {notes.readingAppendix.length}<CaretDown size={17} /></summary>{notes.readingAppendix.map(section => <article key={section.id} id={lectureAnchor(lesson.id, "section", section.id)} tabIndex={-1}><h4>{section.title}</h4><LessonText text={section.text} /><Sources lesson={lesson} item={section} onLocate={onLocate} /></article>)}</details>}
    {!examplesOnly && warnings.length > 0 && <details className="lecture-warnings"><summary>阅读与核对提示 · {warnings.length}<CaretDown size={17} /></summary><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
  </div>;
}
