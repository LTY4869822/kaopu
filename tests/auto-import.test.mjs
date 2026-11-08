import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';
import { classifyDocument, canonicalSubject, findSubjectCourse } from '../server/classify.mjs';

const chunks = (text) => [{ page: 1, text }];
test('filename aliases cover the subject catalog and suppress embedded false matches', () => {
  const examples = {
    '高数': '高等数学', '线代': '线性代数', '概率统计': '概率论与数理统计', '物理': '大学物理', '英语': '大学英语',
    'C语言程序设计': 'C语言程序设计', '数据结构': '数据结构', '计组': '计算机组成原理', '操作系统': '操作系统', '计网': '计算机网络',
    '数据库': '数据库', '电路': '电路', '模电': '模拟电子技术', '数电': '数字电子技术', '化学': '化学', '马原': '马克思主义基本原理',
    '毛概': '毛泽东思想和中国特色社会主义理论体系概论', '思修': '思想道德与法治', '近代史': '中国近现代史纲要', '管理学': '管理学', '经济学': '经济学', '会计': '会计学',
    '模拟电路': '模拟电子技术', '数字电路': '数字电子技术', '物理化学': '物理化学', '数据库管理系统': '数据库',
    'Python': 'Python程序设计', 'Java': 'Java程序设计', 'JavaScript': 'JavaScript程序设计', '微观经济学': '微观经济学', '宏观经济学': '宏观经济学', '有机化学': '有机化学', '无机化学': '无机化学',
  };
  for (const [alias, subject] of Object.entries(examples)) {
    const result = classifyDocument(`${alias}_期末复习.docx`, chunks('这里是老师提供的课堂复习提纲，包含考试所需的知识。'));
    assert.equal(result.status, 'classified', alias);
    assert.equal(result.subject, subject, alias);
    assert.ok(result.confidence >= 0.9 && result.confidence <= 1);
    assert.match(result.reason, /文件名/);
  }
  assert.equal(canonicalSubject('高等数学（上）'), '高等数学（上）');
  assert.equal(findSubjectCourse('高等数学（下）', '高数（下）复习.txt', [{ id: 'up', name: '高数（上）' }, { id: 'down', name: '高数（下）' }]).id, 'down');
  assert.equal(findSubjectCourse('高等数学', '高数复习.txt', [{ id: 'up', name: '高数（上）' }]), null);
  assert.equal(findSubjectCourse('Python程序设计', 'Python笔记.txt', [{ id: 'c', name: 'C语言程序设计' }]), null);
  assert.equal(findSubjectCourse('程序设计', '笔记.txt', [{ id: 'c', name: 'C语言程序设计' }]), null);
  assert.equal(classifyDocument('Python和Java复习.txt', chunks('变量类型与函数参数。')).status, 'needs-review');
});

test('content classification requires independent signals and defers ambiguity', () => {
  const content = classifyDocument('课堂笔记.txt', chunks('极限是函数趋近的趋势。导数是瞬时变化率。定积分表示累积量。'));
  assert.equal(content.subject, '高等数学');
  assert.match(content.reason, /3组独立关键词/);
  assert.equal(classifyDocument('未命名.txt', chunks('这段只有一个矩阵关键词。')).status, 'needs-review');
  assert.equal(classifyDocument('未命名.txt', chunks('这是个人的旅行日记，记录了今天去吃饭和散步。')).status, 'needs-review');
  assert.equal(classifyDocument('高数和线代复习.txt', chunks('极限和矩阵相关知识。')).status, 'needs-review');
  assert.equal(classifyDocument('高数.txt', chunks('牛顿第二定律描述力与加速度。机械能包含动能。电场与磁场是电磁学的内容。')).status, 'needs-review');
  assert.equal(classifyDocument('高数.txt', chunks('本章学习资产负债表与会计分录。')).status, 'needs-review');
  assert.equal(classifyDocument('综合笔记.txt', chunks('极限、导数和定积分属于一部分。矩阵、特征值和线性方程组属于另一部分。')).status, 'needs-review');
  const custom = classifyDocument('建筑史_复习.txt', chunks('记录老师划定的复习范围与课堂讨论。'), [{ id: 'custom', name: '建筑史' }]);
  assert.equal(custom.subject, '建筑史');
});

async function start(dataDir) {
  const app = createApp({ dataDir, provider: {} });
  const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const api = async (route, method = 'GET', data) => {
    const response = await fetch(`${base}${route}`, { method, ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
    return { status: response.status, body: await response.json() };
  };
  const upload = async (name, text, courseId) => {
    const form = new FormData();
    form.append('file', new Blob([text]), name);
    if (courseId) form.append('courseId', courseId);
    const response = await fetch(`${base}/documents${courseId ? '' : '/auto'}`, { method: 'POST', body: form });
    return { status: response.status, body: await response.json() };
  };
  return { api, upload, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('auto import creates/reuses courses, handles uncertainty and duplicates, persists and supports reassignment', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-auto-test-'));
  let running;
  try {
    running = await start(dir);
    const { api, upload } = running;
    await api('/reset', 'POST', { mode: 'empty' });
    const firstText = '矩阵是按行和列排列的数表。特征值表示线性变换中的伸缩因子。';
    const first = await upload('线代笔记.txt', firstText);
    assert.equal(first.status, 201);
    assert.equal(first.body.createdCourse, true);
    assert.equal(first.body.duplicate, false);
    assert.equal(first.body.course.name, '线性代数');
    assert.equal(first.body.course.examDate, '');
    assert.equal(first.body.course.mastery, 0);
    assert.equal(first.body.document.courseId, first.body.course.id);
    assert.equal(first.body.document.classification.status, 'classified');
    assert.match(first.body.document.contentHash, /^[a-f0-9]{64}$/);
    const second = await upload('线性代数第二章.txt', '线性方程组可以通过消元法求解。矩阵的秩表示线性无关列的最大个数。');
    assert.equal(second.body.createdCourse, false);
    assert.equal(second.body.course.id, first.body.course.id);
    const duplicate = await upload('改了文件名.txt', firstText);
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.duplicate, true);
    assert.equal(duplicate.body.document.id, first.body.document.id);
    const differentContent = await upload('线代笔记.txt', '特征向量是线性变换下方向不变的非零向量。矩阵是用于表示线性映射的工具。');
    assert.equal(differentContent.status, 201);
    assert.notEqual(differentContent.body.document.id, first.body.document.id);
    const aliasCourse = (await api('/courses', 'POST', { name: '高数', target: 85 })).body;
    assert.equal(aliasCourse.examDate, '');
    const math = await upload('高等数学复习.txt', '导数是函数的瞬时变化率。定积分是带符号面积的累积。');
    assert.equal(math.body.course.id, aliasCourse.id);
    assert.equal(math.body.createdCourse, false);
    const unknown = await upload('临时文件.txt', '请复习课堂笔记，并注意老师布置的课后练习，这些内容需要自己整理。');
    assert.equal(unknown.body.classification.status, 'needs-review');
    assert.equal(unknown.body.document.courseId, '');
    assert.equal(unknown.body.course, null);
    const conflict = await upload('高数_线代.txt', '极限是关于函数趋势的概念。矩阵是数的排列。');
    assert.equal(conflict.body.classification.status, 'needs-review');
    const beforeDamage = (await api('/state')).body;
    const broken = await upload('大学物理.pdf', 'this is not a real PDF');
    assert.equal(broken.status, 422);
    const afterDamage = (await api('/state')).body;
    assert.equal(afterDamage.courses.length, beforeDamage.courses.length);
    assert.equal(afterDamage.documents.length, beforeDamage.documents.length);
    const missing = await api(`/documents/${unknown.body.document.id}`, 'PATCH', { courseId: 'nonexistent' });
    assert.equal(missing.status, 404);
    const unknownAssigned = await api(`/documents/${unknown.body.document.id}`, 'PATCH', { courseId: aliasCourse.id });
    assert.equal(unknownAssigned.body.courseId, aliasCourse.id);
    assert.equal(unknownAssigned.body.classification.confidence, 1);
    assert.match(unknownAssigned.body.classification.reason, /手动/);
    const generated = (await api('/questions/generate', 'POST', { courseId: first.body.course.id })).body;
    const sourceQuestion = generated.questions.find((item) => item.sourceDocumentId === first.body.document.id);
    assert.ok(sourceQuestion);
    await api('/attempts', 'POST', { questionId: sourceQuestion.id, selected: sourceQuestion.answer });
    const moved = await api(`/documents/${first.body.document.id}`, 'PATCH', { courseId: aliasCourse.id });
    assert.equal(moved.body.courseId, aliasCourse.id);
    const reassigned = (await api('/state')).body;
    assert.equal(reassigned.questions.find((item) => item.id === sourceQuestion.id).courseId, aliasCourse.id);
    assert.equal(reassigned.attempts.find((item) => item.questionId === sourceQuestion.id).courseId, aliasCourse.id);
    await api('/questions/generate', 'POST', { courseId: aliasCourse.id });
    const regenerated = (await api('/state')).body.questions.filter((item) => item.sourceDocumentId === first.body.document.id);
    assert.equal(new Set(regenerated.map((item) => item.originalSentence + item.topic)).size, regenerated.length);
    const duplicateAfterMove = await upload('线代再传.txt', firstText);
    assert.equal(duplicateAfterMove.body.course.id, aliasCourse.id);
    const manualText = '这是手动归档的资料，之后重复上传应该保留手动归属。';
    const manual = await upload('手动.txt', manualText, aliasCourse.id);
    assert.equal(manual.status, 201);
    assert.ok(manual.body.contentHash);
    const manualDuplicate = await upload('无名.txt', manualText);
    assert.equal(manualDuplicate.body.duplicate, true);
    assert.equal(manualDuplicate.body.document.id, manual.body.id);
    const separateSubjects = ['C语言', 'Python', 'Java', '微观经济学', '宏观经济学', '有机化学', '无机化学', '物理化学', '高数上', '高数下'];
    const independentCourseIds = new Set();
    for (const subject of separateSubjects) {
      const separate = await upload(`${subject}复习.txt`, `${subject}：这一份资料记录了本课程老师布置的复习范围与课堂笔记。`);
      assert.equal(separate.status, 201, subject);
      assert.equal(separate.body.createdCourse, true, subject);
      independentCourseIds.add(separate.body.course.id);
    }
    assert.equal(independentCourseIds.size, separateSubjects.length);
    const pythonAgain = await upload('Python第二讲.txt', 'Python第二讲：这一份资料是同一课程的下一章补充说明。');
    assert.equal(pythonAgain.body.createdCourse, false);
    assert.equal(pythonAgain.body.course.name, 'Python程序设计');
    const mixedLanguage = await upload('Python和Java综合.txt', '比较这两种课程涉及的教学安排，并分别复习老师提供的内容。');
    assert.equal(mixedLanguage.body.classification.status, 'needs-review');
    await running.close();
    running = await start(dir);
    const persisted = (await running.api('/state')).body;
    assert.equal(persisted.documents.find((item) => item.id === first.body.document.id).courseId, aliasCourse.id);
    assert.equal(persisted.documents.find((item) => item.id === conflict.body.document.id).classification.status, 'needs-review');
    assert.equal(persisted.courses.find((item) => item.id === aliasCourse.id).examDate, '');
    assert.equal((await running.api('/courses', 'POST', { name: '非法日期', examDate: '2027-02-30', target: 80 })).status, 400);
  } finally {
    if (running) await running.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
