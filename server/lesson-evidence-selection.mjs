import { readLessonFrame } from './lesson-assets.mjs';
import { editorialRequest } from './lesson-editorial.mjs';

const list = value => Array.isArray(value) ? value : [];
const fail = message => Object.assign(new Error(message), { status: 502 });

/** Lexical matching only narrows candidates; the image model must actually inspect every selected image. */
export function evidenceCandidates(lesson, target, limit = 6) {
  const sources = target.kind === 'exercise' ? list(lesson.notes?.examples).filter(item => target.sourceExampleIds.includes(item.id))
    : list(lesson.notes?.sections).filter(item => target.sourceSectionIds.includes(item.id));
  const cueIds = new Set(sources.flatMap(item => list(item.cueIds)));
  const cues = [...list(lesson.cues), ...list(lesson.visualCues)].filter(cue => cueIds.has(cue.id));
  const direct = new Set([...sources.flatMap(item => list(item.frameIds)), ...cues.map(cue => cue.frameId).filter(Boolean)]);
  const tokens = [...new Set((`${target.title} ${target.prompt || ''}`.match(/[a-zA-Z]{3,}|[\u3400-\u9fff]{2,}/g) || [])
    .flatMap(word => word.length > 4 ? Array.from({ length: word.length - 2 }, (_, index) => word.slice(index, index + 3)) : [word]))];
  return list(lesson.visual?.frames).filter(frame => direct.has(frame.id) || cues.some(cue => cue.start != null && frame.time >= cue.start - 10 && frame.time <= (cue.end ?? cue.start) + 15))
    .map(frame => {
      const observation = list(lesson.visual?.observations).find(item => item.frameId === frame.id);
      const text = observation ? [observation.visibleText, observation.description, ...list(observation.latex)].join(' ') : '';
      return { ...frame, score: tokens.filter(token => text.toLowerCase().includes(token.toLowerCase())).length * 4 + (direct.has(frame.id) ? 1 : 0), observation };
    }).sort((a, b) => b.score - a.score || a.time - b.time).slice(0, limit).sort((a, b) => a.time - b.time);
}

export function validateEvidenceSelection(value, candidates, exercise = false) {
  const allowed = new Set(candidates.map(frame => frame.id));
  if (!Array.isArray(value?.assessments) || value.assessments.length !== allowed.size || !Array.isArray(value.selections) || value.selections.length > (exercise ? 2 : 3) || typeof value.note !== 'string' || value.note.length > 700) throw fail('截图筛选返回格式无效。');
  const used = new Set();
  const assessments = value.assessments.map(item => {
    if (!allowed.has(item.frameId) || used.has(item.frameId) || !['clear', 'partial', 'unreadable'].includes(item.legibility)
      || !['complete', 'partial', 'irrelevant'].includes(item.completeness) || typeof item.relevant !== 'boolean' || typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 500) throw fail('截图质量评估不完整。');
    used.add(item.frameId);
    return { frameId: item.frameId, legibility: item.legibility, completeness: item.completeness, relevant: item.relevant, reason: item.reason.trim() };
  });
  const selections = value.selections.map(item => {
    const assessment = assessments.find(candidate => candidate.frameId === item.frameId);
    if (!assessment || !assessment.relevant || assessment.legibility !== 'clear' || assessment.completeness !== 'complete'
      || !['definition', 'problem', 'derivation', 'illustration'].includes(item.role) || typeof item.caption !== 'string' || !item.caption.trim() || item.caption.length > 240) throw fail('截图未通过清晰度或完整性检查，不能自动配图。');
    return { frameId: item.frameId, role: item.role, caption: item.caption.trim() };
  });
  if (new Set(selections.map(item => item.frameId)).size !== selections.length) throw fail('截图筛选包含重复画面。');
  return { status: selections.length ? 'selected' : 'no-clear-match', selections, assessments, note: value.note.trim() };
}

export async function selectLessonEvidence(provider, lesson, targets, { dataDir, signal, fetchImpl = fetch, onProgress = () => {} } = {}) {
  const result = new Map();
  await onProgress({ phase: 'evidence', done: 0, total: targets.length });
  for (const [index, target] of targets.entries()) {
    signal?.throwIfAborted();
    const candidates = evidenceCandidates(lesson, target);
    let selected;
    if (!candidates.length) selected = { status: 'missing', selections: [], note: lesson.visual?.frames?.length ? '该段尚无对应画面，可以到板书中补采这个时段。' : '本讲目前只有文字原文，尚无视频截图。提供视频画面后可补充配图。' };
    else {
      try {
        const images = await Promise.all(candidates.map(async frame => ({ label: `${frame.id} · ${frame.time.toFixed(1)}秒`, ...(await readLessonFrame(dataDir, lesson, frame.id)) })));
        selected = await editorialRequest(provider,
          `你是教学讲义配图编辑。必须实际看所附的每一张原课截图，OCR仅供对照。给指定知识点/课堂题选择能直接用于复习的最少画面，默认1张；例题只有在题目与推导分屏且都必要时才用2张；一个知识单元包含多种不同定义时至多3张。逐张检查文字/公式可读性、老师遮挡、裁切、题干是否抄写完成、与目标是否同一问题及条件是否一致。字符相似、时间相近不能当成相关性证据；重复画面只选最完整且遮挡最少的一张。不要选择空白、过渡画面、严重遮挡、未写完的题干、不同题目的画面。对于知识点，complete表示展示的这一项定义/关系完整，不要求整章同屏；对于例题problem必须关键题干条件全部可见，derivation必须展示可读完整的一段推导。没有合格画面时selections为空，并在note具体说明缺少什么，不硬配图。每个输入frameId须且只能有一项assessment:{frameId,legibility:"clear"|"partial"|"unreadable",completeness:"complete"|"partial"|"irrelevant",relevant:boolean,reason:string}。返回{assessments:[],selections:[{frameId,role:"definition"|"problem"|"derivation"|"illustration",caption:string}],note:string}。caption用最多90个汉字说明图中真正可见的内容，不逐字抄整板书，不声称这是已核验的正确答案；每项reason最多80字，note最多240字。`,
          { target: { title: target.title, kind: target.kind, prompt: target.prompt, text: target.text?.slice(0, 3000) },
            candidates: candidates.map(frame => ({ frameId: frame.id, time: frame.time, observation: frame.observation })) },
          value => validateEvidenceSelection(value, candidates, target.kind === 'exercise'), { signal, fetchImpl, maxTokens: 3800, images });
      } catch (error) {
        if (signal?.aborted) throw error;
        selected = { status: 'unreviewed', selections: [], note: '这一项的截图筛选未完成，暂不自动配图；原始画面仍保留在板书中。' };
      }
    }
    result.set(target.id, selected);
    await onProgress({ phase: 'evidence', done: index + 1, total: targets.length });
  }
  return result;
}
