import { projectEditorial } from './lesson-editorial-state.mjs';

const list = value => Array.isArray(value) ? value : [];
const strings = value => list(value).filter(item => typeof item === 'string' && item.trim());
const unique = values => [...new Set(values)];
const text = value => typeof value === 'string' ? value : '';
// Keep mathematical punctuation and case: (1,23) != (12,3), and F may differ from f.
const normalized = value => text(value).replace(/[\s，。；：！？!?、·…“”‘’「」『』《》〈〉【】$]/g, '');
const numbers = value => (text(value).normalize('NFKC').match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?/gi) || []).join('|');
const sourceIds = section => unique(strings(section.sourceSectionIds).length ? strings(section.sourceSectionIds) : [section.id].filter(Boolean));
const appendixTitle = /^(?:来源说明|画面事实与信息缺口|外部推断|课堂闲谈|关于高考|高数与高中数学|大学不再涉及|大学仍会用到|课间休息)|(?:来源说明|信息缺口|后续用途与过渡|过渡说明)$|来源说明[（(：:]|来源说明与|来源说明：|来源说明（/;
const conversational = /^(?:原文补充\s*[·:：]\s*)?(?:我们稍微休息|韩如真是党员|老师\s*你举|老師\s*你舉)/;
const isAppendix = section => appendixTitle.test(text(section.title)) || conversational.test(text(section.title));

// These are topic buckets, not equivalence rules: distinct proofs/conditions stay as subsections.
const functionTopics = [
  ['decomposition', '函数的奇偶分解', /(?:分解|表示).{0,16}(?:偶函数|奇函数)|(?:偶函数|奇函数).{0,16}(?:之和|分解)/],
  ['operations', '函数的运算与定义域条件', /函数.{0,5}(?:运算|乘法|除法)|函数的和与差/],
  ['composition', '复合函数与成立条件', /复合函数|中间变量|含根号函数|无意义情形/],
  ['inverse', '反函数的定义、判定与图像', /反函数|横线法则|竖线法则|原函数与导函数术语/],
  ['period', '周期性与狄利克雷函数', /周期|狄利克雷|有理数的|无理数的|有理点|图像为何是两条线/],
  ['parity', '函数的奇偶性', /奇偶|奇函数|偶函数/],
  ['monotonicity', '单调性与区间条件', /单调|端点归属|y\s*=\s*x[²³]|y\s*=\s*x\s*\^\s*[23]/],
  ['boundedness', '上界、下界与有界性', /上界|下界|有界|无界|充要条件|区间对比/],
  ['special', '常见特殊函数及其图像', /绝对值函数|符号函数|取整函数|sgn\s*\(?x|阶梯形/],
  ['basics', '函数、定义域与值域', /函数的概念|函数的要素|定义域|值域|常值函数|函数的定义/],
];

function functionTopic(section) {
  const title = text(section.title);
  const result = functionTopics.find(([, , pattern]) => pattern.test(title));
  return result ? { key: result[0], title: result[1] } : null;
}

function canonicalTitle(title) {
  return normalized(text(title).replace(/^(?:原文补充|板书画面|原课补充)\s*[·:：]\s*/g, '')
    .replace(/[（(](?:板书|原课|来源|画面|字幕|转写|需核对|待核对)[^）)]*[）)]/g, ''));
}

function validOutline(sections, outline) {
  if (!Array.isArray(outline) || !outline.length || outline.length > 50) return false;
  const ids = sections.map(section => section?.id);
  if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) return false;
  const seen = new Set(), allowed = new Set(ids);
  for (const group of outline) {
    if (!text(group?.title).trim() || !Array.isArray(group.sectionIds) || !group.sectionIds.length) return false;
    for (const id of group.sectionIds) {
      if (!allowed.has(id) || seen.has(id)) return false;
      seen.add(id);
    }
  }
  return seen.size === allowed.size;
}

function joined(values) {
  const seen = new Set();
  return values.filter(value => {
    const key = text(value).replace(/\s/g, '');
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  }).join('\n\n');
}

function combinedFields(items) {
  const fields = {};
  for (const key of ['teacherExplanation', 'intuition']) {
    const value = joined(items.map(item => text(item[key])));
    if (value) fields[key] = value;
  }
  for (const key of ['prerequisites', 'steps', 'pitfalls']) {
    const value = unique(items.flatMap(item => strings(item[key])));
    if (value.length) fields[key] = value;
  }
  const questions = items.flatMap(item => list(item.checkQuestions).length ? item.checkQuestions : item.checkQuestion?.prompt ? [item.checkQuestion] : []);
  if (questions.length) { fields.checkQuestion = { ...questions[0] }; fields.checkQuestions = questions.map(question => ({ ...question })); }
  if (items.some(item => item.explanationOrigin === 'ai-supplement')) fields.explanationOrigin = 'ai-supplement';
  return fields;
}

function teachingSignature(value) {
  const mathematical = (text(value).match(/\\[a-zA-Z]+|[A-Za-z]+|[=<>≤≥≠^√∈∉∞()[\]{}|+−*\/%-]/g) || []).join('|');
  const conditions = (text(value).match(/当且仅当|线性无关|线性相关|连续|可导|可微|单射|满射|双射|收敛|发散|不|非|无|仅|只|至少|至多|小于|大于|等于|存在|任意|所有|每个|单调|奇函数|偶函数|正|负|开|闭|左|右|充分|必要|且|或|若|则|区间|定义域|值域/g) || []).join('|');
  return `${numbers(value)}\n${mathematical}\n${conditions}`;
}

function proseIdentity(value) {
  return text(value).replace(/[\s，,。；;：:！？!?、·…“”‘’「」『』《》〈〉【】$]/g, '')
    .replace(/也就是说|换句话说|可以看到|需要注意的是|大家注意|我们注意|实际上|因此|所以/g, '');
}

function presentationItems(items) {
  const result = [];
  for (const item of items) {
    const value = text(item.text), identity = proseIdentity(value);
    if (!identity) continue;
    const previous = result.find(candidate => {
      const other = proseIdentity(candidate.text);
      if (value.replace(/\s/g, '') === text(candidate.text).replace(/\s/g, '')) return true;
      if (Math.min(identity.length, other.length) < 60 || teachingSignature(value) !== teachingSignature(candidate.text)) return false;
      // A conservative high-similarity rule: retain the longer complete statement, never
      // collapse free paraphrases or merely overlapping vocabulary/technical conditions.
      return Math.min(identity.length, other.length) / Math.max(identity.length, other.length) >= .94
        && (identity.includes(other) || other.includes(identity));
    });
    if (!previous) result.push(item);
    else if (value.length > text(previous.text).length) result[result.indexOf(previous)] = item;
  }
  return result;
}

function unitFor(group, index) {
  const items = group.sections;
  const paragraphs = [];
  for (const item of presentationItems(items)) {
    paragraphs.push(items.length > 1 && canonicalTitle(item.title) !== canonicalTitle(group.title)
      ? `### ${item.title}\n\n${item.text}` : item.text);
  }
  return {
    id: `reading-${index + 1}`, title: group.title, text: text(group.summary).trim() || paragraphs.join('\n\n'),
    cueIds: unique(items.flatMap(item => strings(item.cueIds))),
    frameIds: unique(items.flatMap(item => strings(item.frameIds))),
    sourceSectionIds: unique(items.flatMap(sourceIds)),
    subsections: items.map(item => ({ ...item, cueIds: [...strings(item.cueIds)], ...(item.frameIds ? { frameIds: [...strings(item.frameIds)] } : {}) })),
    inScope: items.some(item => item.inScope === true) ? true : items.every(item => item.inScope === false) ? false : null,
    ...combinedFields(items), ...(group.summary ? { summary: group.summary } : {}), ...(group.appendix ? { isAppendix: true } : {}),
  };
}

/** Group presentation only. Every supplied section remains traceable, including appendix material. */
export function buildReadingSections(sections, outline) {
  const source = list(sections).filter(section => section && typeof section === 'object');
  if (!source.length) return [];
  const appendix = source.filter(isAppendix), teaching = source.filter(section => !isAppendix(section));
  const groups = [];
  if (validOutline(source, outline)) {
    const byId = new Map(source.map(section => [section.id, section]));
    for (const group of outline) {
      const mapped = group.sectionIds.map(id => byId.get(id));
      if (group.kind === 'appendix') { appendix.push(...mapped.filter(section => !isAppendix(section))); continue; }
      const members = mapped.filter(section => !isAppendix(section));
      if (members.length) groups.push({ title: group.title.trim(), sections: members, ...(text(group.summary).trim() ? { summary: group.summary.trim() } : {}) });
    }
  } else {
    const recognized = teaching.map(functionTopic).filter(Boolean);
    // Activate this curriculum grouping only for a multi-topic functions lecture.
    const useFunctionTopics = new Set(recognized.map(topic => topic.key)).size >= 4 && recognized.length >= teaching.length * .45;
    const buckets = new Map(); let previousTopic = null;
    for (const section of teaching) {
      let topic = useFunctionTopics ? functionTopic(section) : null;
      if (!topic && previousTopic && /^原文补充\s*[·:：]/.test(text(section.title))) topic = previousTopic;
      const key = topic ? `topic:${topic.key}` : `title:${canonicalTitle(section.title) || section.id || groups.length}`;
      let group = buckets.get(key);
      if (!group) { group = { title: topic?.title || section.title || '课堂知识', sections: [] }; buckets.set(key, group); groups.push(group); }
      group.sections.push(section);
      previousTopic = topic;
    }
  }
  if (appendix.length) groups.push({ title: '附录：课堂补充与来源说明', sections: appendix, appendix: true });
  return groups.map(unitFor);
}

const constantClaim = /定义域\s*(?:与|和|及)\s*值域\s*(?:均|都)?\s*(?:是|为)?\s*(?:集合)?\s*\$?\\?\{\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*\\?\}\$?/g;
function constantValue(value) {
  if (!/(?:常值|常数)函数/.test(value)) return null;
  return value.match(/(?:y|f\s*\(\s*x\s*\))\s*=\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?![\d.xa-z^*/(])/i)?.[1] ?? null;
}

function expresslySingletonDomain(source, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const domain = new RegExp(`(?:定义域\\s*(?:为|是|取|限定为)|D(?:_f)?\\s*=|[xX]\\s*∈)\\s*\\{\\s*${escaped}\\s*\\}`);
  return domain.test(text(source));
}

function rejectedClaim(value, index, length) {
  const before = value.slice(Math.max(0, index - 80), index).split(/[。；;！？!?\n]/).at(-1);
  const after = value.slice(index + length, index + length + 60).split(/[。；;！？!?\n]/)[0];
  const prefix = /(?:不能说|不能认为|不可认为|不能断言|不可断言|并非|不是说|不意味着|并不意味着|不要写成|不应写成|不可写成|绝不能写|错误(?:观点|说法|断言)\s*[：:]?|误写为|误认为|错误地认为)[^。；;！？!?\n]{0,24}$/;
  const suffix = /^[\s，,：:“”「」『』"']*(?:(?:这种|这个|上述|此)(?:说法|结论|观点|断言))?\s*(?:是|并)?\s*(?:不对的|错误的|不正确的|错误|不正确|不成立)/;
  return prefix.test(before) || suffix.test(after);
}

/** A narrow audit, not a general mathematical correctness checker. */
export function auditMathExplanation(value, source = '') {
  const original = text(value), canonical = original;
  const valueOfConstant = constantValue(canonical), issues = [];
  if (valueOfConstant != null && !expresslySingletonDomain(source, valueOfConstant)) {
    for (const match of canonical.matchAll(constantClaim)) {
      if (match[1] === valueOfConstant && !rejectedClaim(canonical, match.index, match[0].length)) issues.push({ code: 'constant-function-domain', excerpt: match[0],
        message: '常值函数的定义域由自变量的允许取值确定，不能由常数函数值推出单元素定义域。' });
    }
  }
  const exponential = exponentialRisks(original);
  if (exponential.lowerBound) issues.push({ code: 'exponential-lower-bound', excerpt: '只有下界0', message: '0是e^x在实数域上的下界和下确界；所有小于等于0的实数也都是下界。' });
  if (exponential.strictWitness) issues.push({ code: 'exponential-strict-witness', excerpt: 'M≤1可取x₁=0', message: 'M=1时e^0=1并不严格大于M；任意M>0可统一取x₁=ln(M+1)。' });
  return { issues, needsReview: issues.length > 0 };
}

/** Correct only the established domain/range confusion; never silently assume the domain is R. */
export function normalizeConstantFunctionClaim(value, source = '') {
  const original = text(value);
  if (!auditMathExplanation(original, source).issues.some(issue => issue.code === 'constant-function-domain')) return original;
  const constant = constantValue(original);
  return original.replace(constantClaim, (claim, number, index) => number === constant && !rejectedClaim(original, index, claim.length)
    ? `值域在非空定义域上为{${number}}，定义域由原题对自变量的限制确定` : claim);
}

const compositionClarification = '适用范围澄清：若要求复合函数在内层的整个定义域 D_g 上都有定义，需要 R_g ⊆ D_f；若求复合表达式的自然定义域，应取 {x∈D_g : g(x)∈D_f}。即使 R_g 不全包含于 D_f，也可能在这个子集上有意义。';
const endpointClarification = '本例范围澄清：这里只讨论 y=x² 在0处分开的两侧单调区间，0可以同时计入两侧。一般函数的端点取值仍须按单调性定义单独核对，不能把本例推广成“端点个别点可以忽略”。';
const mathCompact = value => text(value).replace(/_\{([gf])\}/g, '_$1').replace(/\\subseteq?/g, '⊂').replace(/\s/g, '');
const terseCompositionClaim = /复合函数\s*y\s*=\s*f\s*\[\s*g\s*\(\s*x\s*\)\s*\]\s*要求内层值域包含于外层定义域/g;
const assertedTerseComposition = value => [...text(value).matchAll(terseCompositionClaim)].filter(match => !rejectedClaim(text(value), match.index, match[0].length));

function exponentialRisks(value) {
  const compact = mathCompact(value);
  const pureExponential = /(?:y|f\(x\))=e\^(?:x|\{x\})(?=$|[，,。；;（）()]|在|无|有)/.test(compact);
  const realDomain = /在(?:R|ℝ|\\mathbb\{R\}|[（(][-−]∞[,，]\+?∞[)）])上|定义域(?:为|是)(?:R|ℝ|\\mathbb\{R\})/.test(compact);
  if (!pureExponential || !realDomain || !/无界|无上界|没有上界/.test(compact)) return { lowerBound: false, strictWitness: false };
  const onlyLowerBound = /(?:只有|仅有|唯一的?)下界\s*(?:是|为)?\s*0/g;
  const lowerBound = [...text(value).matchAll(onlyLowerBound)].some(match => !rejectedClaim(text(value), match.index, match[0].length));
  const strictWitness = /(?:若)?M(?:≤|<=)1可取x(?:₁|_1|1)=0/.test(compact);
  return { lowerBound, strictWitness };
}

function qualifyExponential(value, context, field) {
  const risk = exponentialRisks(context); let result = text(value);
  if (risk.lowerBound) result = result.replace(/(?:只有|仅有|唯一的?)下界\s*(?:是|为)?\s*0/g, (claim, index) => rejectedClaim(result, index, claim.length) ? claim : '以0为下界和下确界，所有≤0的实数也都是它的下界');
  if (risk.strictWitness) {
    result = result.replace(/令\s*x₁\s*=\s*ln\s*M（若\s*M≤1\s*可取\s*x₁=0\s*等），则\s*e\^\{x₁\}=M；再取稍大的\s*x\s*即可使\s*e\^x>M/g,
      '取 x₁=ln(M+1)，则 e^{x₁}=M+1>M，直接满足严格不等式');
    if (field === 'step') result = result.replace(/对\s*e\^x\s*取\s*x₁=ln\s*M，则\s*e\^\{x₁\}=M。?/g, '对任意 M>0，取 x₁=ln(M+1)，则 e^{x₁}=M+1>M。')
      .replace(/取\s*x₁\s*稍大于\s*ln\s*M，即得\s*e\^\{x₁\}>M，突破该界。?/g, '上述取点已直接满足 e^{x₁}>M，突破该界。');
  }
  return result;
}

function compositionRisk(value) {
  const compact = mathCompact(value);
  if (/自然定义域/.test(compact) && /(?:整个|全部|全体|全)D_?g|g的?整个定义域/.test(compact)) return false;
  if (assertedTerseComposition(value).length) return true;
  if (!/复合/.test(compact) || !/R_?g(?:⊂|⊆)D_?f/.test(compact)) return false;
  return compact.split(/[。；;\n]/).some(sentence => {
    if (/(?:整个|全部|全体|全)D_?g|在D_?g上|自然定义域|不能(?:认为|断言)|不意味着|并非|不是.*必要条件/.test(sentence)) return false;
    return /复合函数(?:成立的条件|有意义的条件|要求)|复合(?:函数|表达式|式)[^。]{0,35}要有意义[^。]{0,12}必须|R_?g(?:⊂|⊆)D_?f是复合函数有意义的条件/.test(sentence);
  });
}

function endpointRisk(value) {
  const compact = mathCompact(value);
  return /(?:y|f\(x\))=x(?:²|\^2|\^\{2\})/.test(compact) && /0/.test(compact) && /单调/.test(compact)
    && /分界点是否包含不影响单调性判断|端点处个别点的归属不会改变|端点归属[^。]{0,12}不影响|端点[^。]{0,12}不是特别在乎/.test(compact)
    && !/仅(?:针对|就)|不能(?:推广|泛化)|不应(?:推广|泛化)|一般函数的端点取值仍须/.test(compact);
}

function sectionQualityContext(section) {
  return [section.title, section.text, section.teacherExplanation, section.intuition, ...strings(section.steps), ...strings(section.pitfalls)].map(text).join('\n');
}

/** Targeted presentation qualifications for specific known overgeneralizations, not a proof engine. */
function qualifyTeaching(value, context, field) {
  let result = qualifyExponential(value, context, field);
  if (!result) return result;
  if (compositionRisk(context)) {
    const hadTerseClaim = assertedTerseComposition(result).length > 0;
    result = result.replace(terseCompositionClaim, (claim, index) => rejectedClaim(result, index, claim.length) ? claim : '若要求复合函数y=f[g(x)]在g的整个定义域 D_g 上成立，需要内层值域包含于外层定义域；通常复合表达式的自然定义域为{x∈D_g:g(x)∈D_f}')
      .replace(/复合函数成立的条件是/g, '复合函数若要求在整个 D_g 上成立，其条件是')
      .replace(/原课指出复合函数要求/g, '原课在全 D_g 上讨论复合映射时要求')
      .replace(/(复合(?:函数|表达式|式)[^。；\n]{0,35}?)要有意义，必须保证/g, '$1若要求在整个 D_g 上有定义，就必须保证')
      .replace(/((?:R_?g|R_\{g\})\s*(?:⊂|⊆|\\subseteq?)\s*(?:D_?f|D_\{f\}))\s*是复合函数有意义的条件/g, '$1 是复合函数在整个 D_g 上有定义时的条件')
      .replace(/检查\s*((?:R_?g|R_\{g\})\s*(?:⊂|⊆|\\subseteq?)\s*(?:D_?f|D_\{f\}))/g, '若要求在整个 D_g 上复合，再检查 $1')
      .replace(/若求复合函数定义域，解/g, '若求复合表达式的自然定义域，同时满足 x∈D_g 和');
    if (['text', 'teacherExplanation', 'summary', 'overview'].includes(field) && !hadTerseClaim && !result.includes(compositionClarification)) result = `${compositionClarification}\n\n${result}`;
  }
  if (endpointRisk(context)) {
    result = result.replace(/分界点是否包含不影响单调性判断/g, '本例 y=x² 的0可同时计入两侧单调区间，其它端点须另行核对')
      .replace(/端点处个别点的归属不会改变[“"]?在区间上递增或递减[”"]?的结论/g, '本例 y=x² 的0可同时计入两侧单调区间，但一般函数的端点取值仍须单独核对')
      .replace(/考察单调性时，对某一个端点处的情况其实不是特别在乎；这个点算在增区间还是减区间都可以/g, '本例 y=x² 在0处满足两侧所需的函数值比较，因此0可同时计入两侧区间；其它函数的端点仍须单独核对')
      .replace(/不要因为端点归属不同就认为单调性结论错了/g, '本例 y=x² 的0可同时计入两侧区间；一般函数的端点函数值仍须检查');
    if (['text', 'teacherExplanation', 'intuition', 'summary', 'overview'].includes(field) && !result.includes(endpointClarification)) result = `${endpointClarification}\n\n${result}`;
  }
  return result;
}

function qualifyIncompleteExample(example) {
  const incomplete = /\[(?:模糊|缺失|未知|不清|待补充)\]|题干(?:不完整|缺失)|(?:条件|集合符号|第二[行项支]|分支).{0,12}(?:模糊|不清|缺失|未识别)/.test(text(example.prompt));
  if (!incomplete || !text(example.detailedSolution).trim() && !strings(example.solutionSteps).length) return example;
  const adoptedIrrationals = /(?:无理数|x\s*(?:∉|\\notin)\s*Q)/.test([example.detailedSolution, ...strings(example.solutionSteps)].join('\n'));
  const condition = adoptedIrrationals
    ? '条件性补充解法：原题第二分支的集合符号尚未确认。仅在该分支确为无理数（x∉Q）时，以下按这一假设给出的推导与周期结论才适用；核对原题前，不能视为已确认的原题答案。'
    : '条件性补充解法：原始题干含未确认条件。以下推导仅在所采用的条件与原题一致时成立；请先核对题干，不能视为已确认的原题答案。';
  return { ...example, needsReview: true, detailedSolution: text(example.detailedSolution).startsWith('条件性补充解法：') ? example.detailedSolution : `${condition}${example.detailedSolution ? `\n\n${example.detailedSolution}` : ''}`,
    solutionSteps: strings(example.solutionSteps)[0]?.startsWith('条件性补充解法：') ? [...example.solutionSteps] : [condition, ...strings(example.solutionSteps)] };
}

function evidenceFor(item, lesson) {
  const cues = [...list(lesson?.cues), ...list(lesson?.visualCues)];
  const cueMap = new Map(cues.map(cue => [cue.id, cue]));
  const frames = new Set(list(lesson?.visual?.frames).map(frame => frame.id));
  const cueIds = unique(strings(item.cueIds)), frameIds = [...strings(item.frameIds)];
  for (const id of cueIds) {
    const cue = cueMap.get(id);
    if (cue?.frameId) frameIds.push(cue.frameId);
    // Legacy visual cues use an exact frame-derived ID; do not guess by nearest timestamp.
    if (id.startsWith('visual-') && frames.has(id.slice(7))) frameIds.push(id.slice(7));
  }
  return { ...item, cueIds, frameIds: unique(frameIds) };
}

function examplesMatch(left, right) {
  const a = normalized(left.prompt), b = normalized(right.prompt);
  const sameTitle = canonicalTitle(left.title) === canonicalTitle(right.title);
  if (!sameTitle || numbers(left.prompt) !== numbers(right.prompt)) return false;
  if (a && b && a === b) return true;
  if (!a || !b) return true;
  return Math.min(a.length, b.length) >= 20 && (a.includes(b) || b.includes(a));
}

function readingExamples(examples, lesson) {
  const result = [];
  for (const item of list(examples)) {
    const example = evidenceFor(item, lesson);
    const previous = result.find(candidate => examplesMatch(candidate, example));
    if (!previous) { result.push({ ...example, sourceExampleIds: [item.id].filter(Boolean), sourceExamples: [{ ...item }] }); continue; }
    previous.sourceExampleIds = unique([...previous.sourceExampleIds, item.id].filter(Boolean));
    previous.sourceExamples.push({ ...item });
    previous.cueIds = unique([...previous.cueIds, ...example.cueIds]);
    previous.frameIds = unique([...previous.frameIds, ...example.frameIds]);
    previous.solution = joined([text(previous.solution), text(example.solution)]);
    if (!text(previous.prompt).trim()) previous.prompt = example.prompt;
    previous.needsReview = !!(previous.needsReview || example.needsReview);
    const detailed = joined([text(previous.detailedSolution), text(example.detailedSolution)]);
    if (detailed) previous.detailedSolution = detailed;
    const steps = unique([...strings(previous.solutionSteps), ...strings(example.solutionSteps)]);
    if (steps.length) previous.solutionSteps = steps;
    if (example.solutionOrigin === 'ai-supplement') previous.solutionOrigin = 'ai-supplement';
  }
  return result;
}

/** Build a read-only presentation projection. Original sections/examples/overview are never rewritten. */
export function decorateLessonNotes(notes, lesson = {}) {
  if (!notes || typeof notes !== 'object') return notes;
  const originalSections = list(notes.sections), warnings = [];
  if (notes.readingOutline && !validOutline(originalSections, notes.readingOutline)) warnings.push('整课目录映射不完整或含重复/未知章节，已改用保留全部来源的本地目录整理。');
  const source = [...list(lesson.cues), ...list(lesson.visualCues)].map(cue => text(cue.text)).join('\n');
  const corrected = originalSections.map(section => {
    const result = evidenceFor(section, lesson);
    const qualityContext = sectionQualityContext(section);
    if (compositionRisk(qualityContext)) warnings.push(`「${section.title}」已区分全 D_g 上复合与复合表达式的自然定义域，原始整理保留供对照。`);
    if (endpointRisk(qualityContext)) warnings.push(`「${section.title}」的端点说明已限定为当前 y=x² 在0处的例子，一般端点仍须单独核对。`);
    for (const key of ['text', 'teacherExplanation', 'intuition']) {
      if (typeof result[key] !== 'string') continue;
      const audit = auditMathExplanation(result[key], source);
      if (audit.issues.some(issue => issue.code === 'constant-function-domain')) warnings.push(`「${section.title}」已澄清常值函数的定义域和值域：定义域须看原题限制，原始整理保留供对照。`);
      result[key] = qualifyTeaching(normalizeConstantFunctionClaim(result[key], source), qualityContext, key);
    }
    for (const key of ['steps', 'pitfalls']) if (Array.isArray(result[key])) result[key] = result[key].map(value => qualifyTeaching(value, qualityContext, key));
    return result;
  });
  const outline = Array.isArray(notes.readingOutline) ? notes.readingOutline.map(group => {
    if (auditMathExplanation(group?.summary, source).issues.some(issue => issue.code === 'constant-function-domain')) warnings.push('整课知识点概要已澄清常值函数的定义域和值域，原目录概要仍保留供对照。');
    return group && typeof group === 'object' ? { ...group, ...(typeof group.summary === 'string' ? { summary: qualifyTeaching(normalizeConstantFunctionClaim(group.summary, source), group.summary, 'summary') } : {}) } : group;
  }) : notes.readingOutline;
  const all = buildReadingSections(corrected, outline);
  // Keep the unmodified generated text available beneath the corrected presentation.
  const originalsById = new Map(originalSections.map(section => [section.id, section]));
  all.forEach(section => { section.subsections = section.subsections.map(item => ({ ...(originalsById.get(item.id) || item) })); });
  const readingOverview = list(notes.overview).map(item => {
    if (auditMathExplanation(item, source).issues.some(issue => issue.code === 'constant-function-domain')) warnings.push('课程速览已澄清常值函数的定义域和值域，未擅自将定义域改成实数集。');
    return qualifyTeaching(normalizeConstantFunctionClaim(item, source), item, 'overview');
  });
  const examples = readingExamples(notes.examples, lesson).map(example => {
    const context = [example.title, example.prompt, example.detailedSolution, ...strings(example.solutionSteps)].map(text).join('\n');
    const exponential = exponentialRisks(context);
    const clarified = exponential.lowerBound || exponential.strictWitness ? { ...example,
      detailedSolution: qualifyExponential(example.detailedSolution, context, 'detailedSolution'),
      ...(Array.isArray(example.solutionSteps) ? { solutionSteps: example.solutionSteps.map(value => qualifyExponential(value, context, 'step')) } : {}),
    } : example;
    if (clarified !== example) warnings.push(`「${example.title}」的补解已核对e^x在实数域上的下界表述与严格超界取点，原始补解保留供对照。`);
    const qualified = qualifyIncompleteExample(clarified);
    if (qualified !== clarified) warnings.push(`「${example.title}」的题干尚有未确认条件，补充解法已前置适用假设，请核对原题截图。`);
    return qualified;
  });
  const edition = projectEditorial({ ...lesson, notes }, corrected, examples);
  if (edition) {
    edition.readingSections = edition.readingSections.map(section => {
      const context = sectionQualityContext(section), result = { ...section };
      for (const key of ['text', 'takeaway', 'teacherExplanation']) if (typeof result[key] === 'string') result[key] = qualifyTeaching(normalizeConstantFunctionClaim(result[key], source), context, key);
      result.pitfalls = strings(result.pitfalls).map(value => qualifyTeaching(value, context, 'pitfalls'));
      result.subsections = section.sourceSectionIds.map(id => originalsById.get(id)).filter(Boolean);
      return result;
    });
    edition.readingExamples = edition.readingExamples.map(example => {
      const context = [example.title, example.prompt, example.detailedSolution, ...strings(example.solutionSteps)].join('\n');
      return qualifyIncompleteExample({ ...example, detailedSolution: qualifyExponential(example.detailedSolution, context, 'detailedSolution'),
        solutionSteps: strings(example.solutionSteps).map(value => qualifyExponential(value, context, 'step')) });
    });
    warnings.push(...list(notes.editorial.warnings));
  } else if (notes.editorial) warnings.push('原课内容或题解已变化，旧的重编版本已停用。可重新重编讲义。');
  return { ...notes, readingSections: all.filter(section => !section.isAppendix),
    readingAppendix: all.filter(section => section.isAppendix).flatMap(section => section.subsections),
    readingExamples: examples, readingOverview, ...edition, readingWarnings: unique(warnings) };
}
