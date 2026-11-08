// Opt-in real-model smoke using authored sample materials and isolated data only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { createApp } from '../server/index.mjs';
import { createModelService } from '../server/model-service.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'test-results', 'course-studio');
const fresh = process.argv.includes('--fresh');
const dataDir = path.join(output, fresh ? 'verified-data' : 'live-data');
const serve = process.argv.includes('--serve');
await fs.mkdir(output, { recursive: true });
const service = createModelService({ dataDir: path.join(root, 'data') });
assert.equal(service.provider.configured, true, 'A text model must already be configured.');
const diagnostics = [];
const instrument = async (url, init) => {
  const start = performance.now();
  let task = 'classification';
  try { task = JSON.parse(JSON.parse(init.body).messages[1].content).task || task; } catch {}
  const response = await fetch(url, init);
  const entry = { task, status: response.status, seconds: Number(((performance.now() - start) / 1000).toFixed(1)) };
  if (task.includes('exam-grade')) {
    try {
      const envelope = await response.clone().json();
      const value = JSON.parse(envelope.choices[0].message.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
      const safeKeys = item => Object.keys(item || {}).map(key => ['status','suggestedPoints','confidence','feedback','weakPoints','reason','evidence','sourceIndices','assessment','results','questionId','score','topic','points','explanation','evaluation','grading','sourceRefs','maxPoints','warning','answer','source_ids'].includes(key) ? key : '<other>');
      entry.shape = { keys: safeKeys(value), weakPoints: Array.isArray(value.weakPoints) ? value.weakPoints.map(safeKeys) : typeof value.weakPoints };
    } catch { entry.shape = 'unreadable'; }
  }
  diagnostics.push(entry); console.log(JSON.stringify({ modelCall: entry })); return response;
};
const app = createApp({ dataDir, provider: service.provider, visionProvider: service.visionProvider, videoFetcher: null,
  classificationFetch: instrument, studioFetch: instrument, examFetch: instrument });
const server = await new Promise(resolve => { const current = app.listen(serve ? fresh ? 3005 : 3004 : 0, '127.0.0.1', () => resolve(current)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const report = { passed: false, syntheticDataOnly: true, productionDataModified: false, base, diagnostics };
const api = async (route, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await fetch(base + route, { method, signal: AbortSignal.timeout(150000), ...(body === undefined ? {} : {
    headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' }, body: body instanceof FormData ? body : JSON.stringify(body),
  }) });
  const value = await response.json(); if (!response.ok) throw new Error(`${route}: HTTP ${response.status}: ${value.error || 'Request failed'}`); return value;
};
const waitJob = async (route, active) => {
  const end = Date.now() + 6 * 60 * 1000; let job;
  while (Date.now() < end) {
    job = await api(route);
    if (!active.includes(job.status)) { assert.equal(job.status, 'completed', job.message); return job; }
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  throw new Error(`Timed out waiting for ${route}`);
};
const first = `# 合成高数课堂笔记：导数与连续
导数定义：若极限存在，f在a处的导数为f'(a)=lim(h→0)[f(a+h)-f(a)]/h，h不能取0。可导能推出连续，连续不一定可导。
函数在a处连续需要三个条件：f(a)有定义；lim(x→a)f(x)存在；这个极限等于f(a)。只检查函数值存在是不够的。
链式法则：若y=f(g(x))，内层g在x处可导、外层f在g(x)处可导，则y'=f'(g(x))g'(x)。必须保留内层导数。
例题：y=sin(x²)，令u=x²，则dy/du=cos u，du/dx=2x，所以y'=2x cos(x²)。常见错误是只写cos(x²)，漏掉2x。
例题：y=e^(3x)，外层为e^u、内层为3x，导数为3e^(3x)。两个例子都使用链式法则，但内层导数不同。
复习顺序：先识别内外层，再检查可导条件，分别求导后相乘，最后检查是否遗漏因子。`;
const second = `# 合成高数复习补充：条件与易错点
复合函数y=f(g(x))的定义域必须同时满足x在g的定义域且g(x)落在f的定义域。不能只看内层允许哪些x。
复合函数求导使用链式法则y'=f'(g(x))g'(x)，条件是内层和外层在对应位置可导；外层求导后仍保留g(x)，再乘内层导数。
例题y=sin(x²)的导数是2x cos(x²)。若写为cos(x²)，错误在于漏乘内层x²的导数2x。
连续性的三个条件是函数值存在、极限存在、极限等于函数值。函数|x|在0连续，但左右导数不同，所以0处不可导。
注意区分：可导推出连续；连续不能推出可导。绝对值函数在0提供反例。判断连续时也不能忽略左右极限是否一致。
合并笔记时，应将重复链式法则放在一起，同时保留定义域条件、两个不同例题以及连续与可导的反例。`;

if (!process.argv.includes('--review-only')) { try {
  await api('/reset', { mode: 'empty' });
  const files = [
    ['高等数学课堂笔记.md', first], ['课堂补充资料_02.md', second],
    ['第六周材料.md', '牛顿第二定律：合外力等于质量乘加速度F=ma。机械能守恒的条件是只有重力或弹力做功；摩擦等非保守力做功时需要检查能量变化。动量守恒要求系统合外力为零或冲量可忽略。'],
    ['矩阵与方程组.md', '矩阵初等行变换包括交换两行、一行乘以非零数、将一行的倍数加到另一行。线性方程组可以通过增广矩阵消元求解；系数矩阵的秩与增广矩阵的秩不等时无解，秩相等且小于未知数个数时有自由变量和无穷多解。'],
  ];
  const imported = [];
  for (const [name, text] of files) {
    const form = new FormData(); form.append('file', new Blob([text], { type: 'text/markdown' }), name); form.append('parseMode', 'auto');
    const result = await api('/documents/auto', form); imported.push(result);
    console.log(JSON.stringify({ imported: name, course: result.course?.name, engine: result.classification.engine, status: result.classification.status }));
  }
  assert.ok(imported.every(item => item.classification.engine === 'ai'));
  for (const [index, result] of imported.entries()) {
    if (result.document.courseId) continue;
    // Exercise the learner's explicit confirmation path on a review result.
    const name = index === 2 ? '大学物理' : index === 3 ? '线性代数' : '高等数学';
    const state = await api('/state');
    const course = state.courses.find(item => item.name === name) || await api('/courses', { name });
    result.document = await api(`/documents/${result.document.id}`, { courseId: course.id }, 'PATCH');
    result.course = course; result.confirmedByTest = true;
  }
  const courseId = imported[0].document.courseId; assert.equal(imported[1].document.courseId, courseId);
  report.courseId = courseId; report.classifications = imported.map(item => ({ course: item.course.name, engine: item.classification.engine, manuallyConfirmed: !!item.confirmedByTest }));
  const documents = imported.slice(0, 2).map(item => item.document.id);
  const requested = await api('/course-studio/jobs', { courseId, action: 'notes', documentIds: documents,
    prompt: '请将两份资料合并为详细的期末复习笔记，按知识点合并重复讲解，保留全部条件、公式、不同例题和反例。不要只有摘要。疑似错误标出来源并说明待核对，不要编造内容。' });
  const noteJob = await waitJob(`/course-studio/jobs/${requested.id}`, ['queued', 'running']);
  let workspace = await api(`/course-studio?courseId=${courseId}`);
  const note = workspace.artifacts.find(item => item.id === noteJob.artifactId); assert.ok(note?.body.length > 600); assert.equal(note.coverage.complete, true);
  report.note = { id: note.id, characters: note.body.length, sourceCount: note.sourceDocumentIds.length, documentId: note.documentId };
  const revision = await api('/course-studio/jobs', { courseId, action: 'revise', documentIds: [], artifactId: note.id,
    prompt: '请核对第1节及相关链式法则内容，明确复合函数的定义域和可导条件，把易错点解释得更清楚。原有不同例题和连续性反例都保留，输出一份完整的新版本。' });
  const revisedJob = await waitJob(`/course-studio/jobs/${revision.id}`, ['queued', 'running']);
  workspace = await api(`/course-studio?courseId=${courseId}`);
  const revised = workspace.artifacts.find(item => item.id === revisedJob.artifactId); assert.equal(revised.previousId, note.id); assert.equal(revised.revision, 2);
  report.revised = { id: revised.id, characters: revised.body.length, documentId: revised.documentId, revision: revised.revision };
  const generated = await api('/exams/papers', { courseId, title: '链式法则与连续性 · 联调练习', durationMinutes: 20, goal: 'balanced', sourcePolicy: 'materials',
    focus: '链式法则、复合函数定义域、连续性三条件与可导关系。计算题只考对sin(x²)求导，便于核对。', documentIds: [revised.documentId],
    sections: [{ type: 'single-choice', count: 1, difficulty: 'easy', points: 2, topics: ['链式法则'] }, { type: 'true-false', count: 1, difficulty: 'easy', points: 2, topics: ['连续与可导'] },
      { type: 'short-answer', count: 1, difficulty: 'medium', points: 5, topics: ['连续性三条件'] }, { type: 'calculation', count: 1, difficulty: 'medium', points: 6, topics: ['复合函数求导'] }] });
  const paperJob = await waitJob(`/exams/jobs/${generated.jobId}`, ['queued', 'generating']);
  const paper = await api(`/exams/papers/${paperJob.paperId}`); assert.equal(paper.questions.length, 4);
  report.paperId = paper.id;
  let attempt = await api(`/exams/papers/${paper.id}/start`, { mode: 'practice' }); const answers = {};
  const calculation = paper.questions.find(item => item.type === 'calculation');
  const canvas = createCanvas(1100, 370), ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1100, 370); ctx.fillStyle = '#111'; ctx.font = '32px "Microsoft YaHei"';
  ['我的作答：复合函数求导', 'y = sin(x²)', "y' = cos(x²)", '我只对外层求导，没有继续处理内层。'].forEach((line, index) => ctx.fillText(line, 55, 70 + index * 75));
  const picture = canvas.toBuffer('image/png'); await fs.writeFile(path.join(output, 'synthetic-answer.png'), picture);
  const file = new FormData(); file.append('questionId', calculation.id); file.append('file', new Blob([picture], { type: 'image/png' }), '合成作答图.png');
  const transcript = await api(`/exams/attempts/${attempt.id}/submission`, file); assert.equal(transcript.needsReview, true); assert.match(transcript.text, /cos/);
  report.imageSubmission = { characters: transcript.text.length, filename: transcript.filename, needsReview: transcript.needsReview };
  for (const question of paper.questions) {
    answers[question.id] = question.type === 'single-choice' ? question.options[0].id : question.type === 'true-false' ? 'true'
      : question.type === 'calculation' ? transcript.text : '函数在a处连续需要f(a)有定义，并且x趋于a时极限存在。我没有写出第三个条件。';
  }
  attempt = await api(`/exams/attempts/${attempt.id}`, { revision: attempt.revision, answers }, 'PATCH');
  attempt = await api(`/exams/attempts/${attempt.id}/submit`, { revision: attempt.revision, answers });
  const grading = await api(`/exams/attempts/${attempt.id}/grade`, { revision: attempt.revision });
  const gradeJob = await waitJob(`/exams/grading-jobs/${grading.jobId}`, ['queued', 'generating']);
  attempt = await api(`/exams/attempts/${attempt.id}`); assert.equal(gradeJob.completed, 2); assert.ok(attempt.results.filter(item => item.aiAssessment).length === 2);
  assert.ok(attempt.results.flatMap(item => item.aiAssessment?.sourceRefs || []).every(source => source.documentId === revised.documentId));
  report.attemptId = attempt.id; report.grading = { completed: gradeJob.completed, weakTopics: attempt.summary.weakTopics, suggestedPoints: attempt.summary.aiSuggestedEarned, suggestedTotal: attempt.summary.aiSuggestedTotal };
  const createdLesson = await api('/lessons', { courseId, title: '合成网课片段：链式法则', scope: '复合函数求导', transcript: first, format: 'txt' });
  await api(`/lessons/${createdLesson.id}/analyze`, { mode: 'extractive' });
  await waitJob(`/lessons/${createdLesson.id}`, ['queued', 'analyzing']);
  const published = await api(`/lessons/${createdLesson.id}/publish`, {});
  const state = await api('/state'); const lectureDocument = state.documents.find(item => item.id === published.documentId);
  assert.equal(lectureDocument.courseId, courseId); assert.equal(lectureDocument.origin.kind, 'lecture-notes'); report.lecturePublished = true;
  report.passed = true;
} catch (error) {
  report.error = error.message; process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(output, fresh ? 'verified-report.json' : 'live-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (serve) console.log(`Isolated review server: http://127.0.0.1:${server.address().port}`);
  else { app.emit('shifen:close'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
} } else console.log(`Isolated review server: http://127.0.0.1:${server.address().port}`);
