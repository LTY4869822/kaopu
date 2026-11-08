import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveDocumentRevision } from '../server/source-revision-archive.mjs';

function fixture() {
  const document = { id: 'doc-notes', courseId: 'calculus', name: '手写导数.png', chunks: [{ id: 'old-chunk', page: 1, text: '-(-x)' }],
    recognition: { kind: 'handwriting', revision: 2, needsReview: true, pages: [{ page: 1, warnings: ['核对负号'] }] } };
  const state = {
    courses: [{ id: 'calculus', mastery: 73 }], documents: [document],
    questions: [
      { id: 'legacy-related', courseId: 'calculus', sourceDocumentId: document.id, prompt: '旧题', answer: 1 },
      { id: 'legacy-other', courseId: 'calculus', sourceDocumentId: 'other-doc', prompt: '其他题', answer: 0 },
    ],
    attempts: [
      { id: 'legacy-attempt', questionId: 'legacy-related', selected: 1, correct: true, counted: true },
      { id: 'legacy-other-attempt', questionId: 'legacy-other', selected: 0, correct: true },
    ],
    assessments: { version: 1, questions: [
      { id: 'assessment-related', courseId: 'calculus', sources: [{ documentId: document.id, text: '-(-x)' }, { documentId: 'other-doc', text: '补充来源' }], answerKey: ['B'] },
      { id: 'assessment-other', courseId: 'calculus', sources: [{ documentId: 'other-doc' }], answerKey: ['A'] },
    ], attempts: [
      { id: 'assessment-attempt', questionId: 'assessment-related', answer: 'B', expectedAnswer: 'B', feedback: '正确', counted: true },
      { id: 'assessment-other-attempt', questionId: 'assessment-other', answer: 'A' },
    ] },
    exams: { version: 1, templates: [
      { id: 'template-related', documentIds: [document.id], confirmed: true },
      { id: 'template-other', documentIds: ['other-doc'], confirmed: true },
    ], papers: [
      { id: 'paper-related', courseId: 'calculus', documentIds: [document.id, 'other-doc'], templateId: 'template-related', questions: [{ id: 'exam-question', answerKey: ['C'], prompt: '试卷题目' }] },
      { id: 'paper-other', courseId: 'calculus', documentIds: ['other-doc'], questions: [{ id: 'exam-question-other', answerKey: ['D'] }] },
    ], attempts: [
      { id: 'submitted', paperId: 'paper-related', status: 'submitted', answers: { 'exam-question': 'C' }, results: [{ questionId: 'exam-question', score: 10 }] },
      { id: 'draft', paperId: 'paper-related', status: 'in-progress', answers: { 'exam-question': 'A' } },
      { id: 'exam-other-attempt', paperId: 'paper-other', status: 'submitted', answers: { 'exam-question-other': 'D' } },
    ] },
  };
  return { state, document };
}

test('archives only associated learning records and exposes counts without answers', () => {
  const { state, document } = fixture(), before = structuredClone(state);
  const metadata = archiveDocumentRevision(state, document), [archive] = state.sourceRevisionArchives;
  assert.match(metadata.id, /^source-revision-[a-f0-9-]{36}$/);
  assert.equal(metadata.revision, 2);
  assert.ok(Number.isFinite(Date.parse(metadata.createdAt)));
  assert.deepEqual(metadata.counts, { legacyQuestions: 1, legacyAttempts: 1, assessmentQuestions: 1, assessmentAttempts: 1, examTemplates: 1, examPapers: 1, examAttempts: 2 });
  assert.deepEqual(Object.keys(metadata).sort(), ['counts', 'createdAt', 'id', 'revision']);
  assert.deepEqual(document.recognition.archives, [metadata]);
  assert.doesNotMatch(JSON.stringify(document.recognition.archives), /answer|expected|prompt|feedback|selected|results|试卷题目/);
  assert.deepEqual(archive.document, before.documents[0]);
  assert.equal(archive.documentId, document.id);
  assert.equal(archive.courseId, 'calculus');
  assert.equal(archive.readOnly, true);
  assert.equal(archive.reason, 'source-revised');
  assert.deepEqual(archive.legacy.questions.map(question => question.id), ['legacy-related']);
  assert.deepEqual(archive.legacy.attempts.map(attempt => attempt.id), ['legacy-attempt']);
  assert.deepEqual(archive.assessment.questions.map(question => question.id), ['assessment-related']);
  assert.deepEqual(archive.assessment.attempts.map(attempt => attempt.id), ['assessment-attempt']);
  assert.equal(archive.assessment.questions[0].sources.length, 2);
  assert.deepEqual(archive.exams.templates.map(template => template.id), ['template-related']);
  assert.deepEqual(archive.exams.papers.map(paper => paper.id), ['paper-related']);
  assert.deepEqual(archive.exams.attempts.map(attempt => attempt.id), ['submitted', 'draft']);
  for (const key of ['questions', 'attempts', 'assessments', 'exams', 'courses']) assert.deepEqual(state[key], before[key]);
});

test('a later prune and page correction cannot mutate the archived source or completed work', () => {
  const { state, document } = fixture();
  const metadata = archiveDocumentRevision(state, document), expected = structuredClone(state.sourceRevisionArchives[0]);
  state.questions[0].answer = 0;
  state.questions = [];
  state.attempts.length = 0;
  state.assessments.questions[0].sources[0].text = '已校对';
  state.assessments = { version: 1, questions: [], attempts: [] };
  state.exams.attempts[0].results[0].score = 0;
  state.exams = { version: 1, templates: [], papers: [], attempts: [] };
  document.chunks[0].text = 'x';
  document.recognition.pages[0].warnings.length = 0;
  document.recognition.revision++;
  metadata.counts.examAttempts = 999;
  assert.deepEqual(state.sourceRevisionArchives[0], expected);
  assert.equal(document.recognition.archives[0].counts.examAttempts, 2);
  assert.equal(state.courses[0].mastery, 73);
});

test('no related data returns null without creating or changing archive metadata', () => {
  const { state, document } = fixture();
  document.id = 'unreferenced-document';
  const before = structuredClone(state);
  assert.equal(archiveDocumentRevision(state, document), null);
  assert.deepEqual(state, before);
  assert.equal(Object.hasOwn(state, 'sourceRevisionArchives'), false);
  assert.equal(Object.hasOwn(document.recognition, 'archives'), false);
});

test('related attempts retain their question contract when only the attempt carries the source', () => {
  const document = { id: 'doc', courseId: 'course', chunks: [] };
  const state = { assessments: { questions: [{ id: 'q', answerKey: ['A'] }], attempts: [{ id: 'a', questionId: 'q', sources: [{ documentId: 'doc' }], answer: 'A' }] } };
  const metadata = archiveDocumentRevision(state, document);
  assert.equal(metadata.revision, 0);
  assert.deepEqual(state.sourceRevisionArchives[0].assessment.questions, state.assessments.questions);
  assert.deepEqual(state.sourceRevisionArchives[0].assessment.attempts, state.assessments.attempts);
  assert.deepEqual(state.sourceRevisionArchives[0].legacy, { questions: [], attempts: [] });
  assert.equal(Object.hasOwn(state.sourceRevisionArchives[0].document, 'recognition'), false);
});

test('a confirmed template is preserved even before it has generated a paper', () => {
  const document = { id: 'doc', recognition: { revision: 1 } };
  const state = { exams: { templates: [{ id: 'template', documentIds: ['doc'], confirmed: true }] } };
  const metadata = archiveDocumentRevision(state, document);
  assert.equal(metadata.counts.examTemplates, 1);
  assert.equal(metadata.counts.examPapers, 0);
  assert.equal(state.sourceRevisionArchives[0].exams.templates[0].confirmed, true);
});

test('archives append independently and preserve prior metadata without recursive raw snapshots', () => {
  const { state, document } = fixture();
  const first = archiveDocumentRevision(state, document), firstSnapshot = structuredClone(state.sourceRevisionArchives[0]);
  document.recognition.revision++;
  document.chunks[0].text = 'x';
  const second = archiveDocumentRevision(state, document);
  assert.notEqual(first.id, second.id);
  assert.equal(second.revision, 3);
  assert.deepEqual(state.sourceRevisionArchives[0], firstSnapshot);
  assert.deepEqual(document.recognition.archives, [first, second]);
  assert.deepEqual(state.sourceRevisionArchives[1].document.recognition.archives, [first]);
  assert.equal(Object.hasOwn(state.sourceRevisionArchives[1].document, 'sourceRevisionArchives'), false);
});

test('invalid archive state or an uncloneable snapshot fails before mutating either object', () => {
  const { state, document } = fixture();
  state.sourceRevisionArchives = { unsupported: true };
  const before = structuredClone(state);
  assert.throws(() => archiveDocumentRevision(state, document), /修订历史数据格式无效/);
  assert.deepEqual(state, before);
  delete state.sourceRevisionArchives;
  state.assessments.questions[0].uncloneable = () => {};
  assert.throws(() => archiveDocumentRevision(state, document), { name: 'DataCloneError' });
  assert.equal(Object.hasOwn(state, 'sourceRevisionArchives'), false);
  assert.equal(Object.hasOwn(document.recognition, 'archives'), false);
});
