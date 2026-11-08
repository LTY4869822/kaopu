import { createHash } from 'node:crypto';

const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 20);
const GENERIC = /^(?:例|例如|例题|注意|提示|答案|解析|总结|结论|步骤|方法|定义|性质|公式|条件|重点|概念|内容|学习建议|复习建议|易错点|知识点|产品示例资料|非学校考试大纲|第一步|第二步|第三步)$/;
const normalize = (value) => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const validTerm = (value) => value.length >= 2 && value.length <= 24 && !GENERIC.test(value) && !/[。！？；\n\[\]【】]/.test(value);

function cleanTerm(value) {
  return value.trim().replace(/^(?:(?:\d+|[一二三四五六七八九十]+)[、.)）]\s*|[·•-]\s*)/u, '').replace(/(?:的)?(?:常用条件|基本条件|几何意义|物理意义|定义|公式|含义|特点|概念|作用|求解步骤)$/u, '').trim();
}

function concepts(sentence) {
  const found = [];
  const put = (value) => {
    const term = cleanTerm(value);
    if (validTerm(term) && sentence.includes(term) && !found.includes(term)) found.push(term);
  };
  const text = sentence.replace(/^【[^】]*】\s*/u, '');
  // Definitions and explicit section labels offer a defensible deletion target.
  const heading = text.match(/^([^：:，,。；;！？!?]{2,24})[：:]/u);
  if (heading) put(heading[1]);
  const definition = text.match(/^([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9 ()（）·-]{1,23}?)(?:是指|指的是|定义为|指|是|描述|表示|用于|称为)/u);
  if (definition) put(definition[1]);
  const english = text.match(/^([A-Za-z][A-Za-z -]{1,23}?)\s+(?:is|means|refers to)\s/i);
  if (english) put(english[1]);
  return found;
}

/**
 * Literal recall, not semantic question generation: one exact source span is
 * deleted and the learner restores that span from choices also found in sources.
 * No answer is inferred, no external model is called, and no accuracy is claimed.
 */
export function generateSourceQuestions(documents, courseId, existingQuestions = [], count = 8) {
  const passages = [];
  const terms = new Map();
  const seenSentences = new Set();
  for (const document of documents.filter((item) => item.courseId === courseId)) {
    for (const chunk of document.chunks || []) {
      for (const value of String(chunk.text || '').split(/(?<=[。！？；!?;])\s*|\n+/u)) {
        const sentence = value.trim();
        if (sentence.length < 8 || sentence.length > 260 || seenSentences.has(normalize(sentence))) continue;
        seenSentences.add(normalize(sentence));
        const matched = concepts(sentence);
        for (const term of matched) terms.set(normalize(term), term);
        // A short, explicit definition complement can be another source-derived
        // option even when the uploaded note contains only one definition.
        const complement = sentence.match(/(?:是指|指的是|定义为|称为|叫作|是|表示|：)([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9 的·-]{1,22})(?=[，,。；;！？!?]|$)/u)?.[1]?.trim();
        if (complement && validTerm(complement)) terms.set(normalize(complement), complement);
        for (const term of matched) {
          if (sentence.length - term.length >= 5) passages.push({ term, sentence, document, page: chunk.page });
        }
      }
    }
  }
  const pool = [...terms.values()];
  const output = [];
  const seenAnswers = new Set();
  for (const passage of passages) {
    if (seenAnswers.has(normalize(passage.term))) continue;
    const sourceKey = hash(`${courseId}|${normalize(passage.sentence)}|${normalize(passage.term)}`);
    const alternatives = pool.filter((term) => normalize(term) !== normalize(passage.term) && !term.includes(passage.term) && !passage.term.includes(term));
    // Prefer other concepts not visibly mentioned in this sentence, but an
    // explicit complement still makes a valid literal reconstruction option.
    alternatives.sort((a, b) => Number(passage.sentence.includes(a)) - Number(passage.sentence.includes(b)) || hash(sourceKey + a).localeCompare(hash(sourceKey + b)));
    if (!alternatives.length) continue;
    const options = [passage.term, ...alternatives.slice(0, 3)].sort((a, b) => hash(`${sourceKey}:order:${a}`).localeCompare(hash(`${sourceKey}:order:${b}`)));
    const locationLabel = passage.document.locationKind === 'section' || ['DOCX', 'TXT', 'MD'].includes(passage.document.type) ? '段' : '页';
    const source = `${passage.document.name} · 第 ${passage.page} ${locationLabel} · 原文回忆题`;
    const question = {
      id: `cloze-${sourceKey}`, courseId, topic: passage.term,
      prompt: `根据资料原文，选择空缺处的词语：\n“${passage.sentence.split(passage.term).join('____')}”`,
      options, answer: options.indexOf(passage.term),
      explanation: `原文中该位置的词语是“${passage.term}”。这道题只检查对所引资料的回忆，不代表对知识点的完整理解。\n原句：${passage.sentence}`,
      steps: ['先不看选项，尝试回忆空缺处的原词。', `回到来源核对：${source}。`, `完整读一遍原句：${passage.sentence}`],
      difficulty: '原文回忆', source, generationMode: 'source-cloze', sourceKey,
      sourceDocumentId: passage.document.id, sourcePage: passage.page, originalSentence: passage.sentence,
    };
    output.push(existingQuestions.find((item) => item.id === question.id || (item.courseId === courseId && item.sourceDocumentId === question.sourceDocumentId && item.originalSentence === question.originalSentence && item.topic === question.topic)) || question);
    seenAnswers.add(normalize(passage.term));
    if (output.length >= count) break;
  }
  if (!output.length) {
    throw Object.assign(new Error('资料中还没有足够清晰的定义或概念，无法生成有依据的回忆题。请补充含“某概念是……”或“某概念：……”的文字资料后重试；扫描件请先做 OCR。'), { status: 422 });
  }
  if (count <= 6 && output.length < count) throw Object.assign(new Error(`当前资料只能生成 ${output.length} 道不同的原文回忆题，少于你设置的 ${count} 题。请减少题量或补充资料。`), { status: 422 });
  const newQuestions = output.filter((question) => !existingQuestions.some((item) => item.id === question.id));
  const warning = '这些是按原文关键词生成的回忆题，不是预测考题，也不能替代理工科计算与推导练习。请核对原资料；原资料错误不会被自动纠正。'
    + (newQuestions.length ? ` 本次新增 ${newQuestions.length} 题。` : ' 当前资料对应的题目已在题库中，未重复添加。');
  return { questions: output, newQuestions, mode: 'source-cloze', warning };
}
