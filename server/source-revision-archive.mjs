import { randomUUID } from 'node:crypto';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function list(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('资料修订历史数据格式无效。');
  return value;
}
const hasSource = (value, documentId) => value?.sourceDocumentId === documentId
  || list(value?.sources).some(source => source?.documentId === documentId);
const hasDocument = (value, documentId) => list(value?.documentIds).includes(documentId);

function relatedPractice(questions, attempts, documentId) {
  const selectedIds = new Set(questions.filter(question => hasSource(question, documentId)).map(question => question.id));
  const selectedAttempts = attempts.filter(attempt => selectedIds.has(attempt.questionId) || hasSource(attempt, documentId));
  // Keep a question's contract alongside its attempt even if only the attempt
  // retained an explicit source reference (for example, imported older data).
  for (const attempt of selectedAttempts) selectedIds.add(attempt.questionId);
  return { questions: questions.filter(question => selectedIds.has(question.id)), attempts: selectedAttempts };
}

/**
 * Preserve the pre-edit source and learning records before the caller prunes
 * their now-invalid active contracts. This function does not prune, persist,
 * restore contracts, or change the course's accumulated mastery.
 *
 * sourceRevisionArchives is PRIVATE state: its snapshots contain answer keys.
 * Only the small returned metadata belongs in public document recognition data.
 */
export function archiveDocumentRevision(state, document) {
  if (!object(state) || !object(document) || typeof document.id !== 'string' || !document.id) {
    throw new TypeError('无法归档无效的资料修订。');
  }
  const legacy = relatedPractice(list(state.questions), list(state.attempts), document.id);
  const assessment = relatedPractice(list(state.assessments?.questions), list(state.assessments?.attempts), document.id);
  const papers = list(state.exams?.papers).filter(paper => hasDocument(paper, document.id));
  const paperIds = new Set(papers.map(paper => paper.id));
  const templateIds = new Set(papers.map(paper => paper.templateId).filter(Boolean));
  const exams = {
    templates: list(state.exams?.templates).filter(template => hasDocument(template, document.id) || templateIds.has(template.id)),
    papers,
    attempts: list(state.exams?.attempts).filter(attempt => paperIds.has(attempt.paperId)),
  };
  const counts = {
    legacyQuestions: legacy.questions.length,
    legacyAttempts: legacy.attempts.length,
    assessmentQuestions: assessment.questions.length,
    assessmentAttempts: assessment.attempts.length,
    examTemplates: exams.templates.length,
    examPapers: exams.papers.length,
    examAttempts: exams.attempts.length,
  };
  if (!Object.values(counts).some(Boolean)) return null;

  const recognition = object(document.recognition) ? document.recognition : {};
  const revision = Number.isInteger(recognition.revision) && recognition.revision >= 0 ? recognition.revision : 0;
  const metadata = { id: `source-revision-${randomUUID()}`, revision, createdAt: new Date().toISOString(), counts };
  // Clone and validate everything before mutating either object. In particular,
  // future pruning or page edits must never modify the only copy of old work.
  const archive = structuredClone({ ...metadata, documentId: document.id, courseId: document.courseId,
    reason: 'source-revised', readOnly: true, document, legacy, assessment, exams });
  const archives = [...list(state.sourceRevisionArchives), archive];
  const nextRecognition = { ...recognition, archives: [...list(recognition.archives), structuredClone(metadata)] };
  const result = structuredClone(metadata);
  state.sourceRevisionArchives = archives;
  document.recognition = nextRecognition;
  return result;
}
