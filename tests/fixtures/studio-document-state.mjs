import { studyNote } from './study-note.mjs';
export function studioDocumentState(seed) {
  const course = { ...seed.courses[0], id: 'linear-fixture', name: '线性代数', description: '隔离界面验收课程' };
  const sources = studyNote.sources.map((source, i) => ({ ...source, documentId: `source-${i + 1}`, chunkId: `source-${i + 1}-chunk`, text: i ? 'Av=λv，其中v不为零。' : '矩阵与线性方程组的秩、特征值和特征向量。' }));
  const documents = sources.map(source => ({ id: source.documentId, courseId: course.id, name: source.documentName, type: source.documentName.endsWith('pdf') ? 'PDF' : 'DOCX', status: 'ready', size: 2048, createdAt: '2026-11-05', summary: [], chunks: [{ id: source.chunkId, page: source.page, text: source.text }] }));
  const artifact = { ...studyNote, id: 'fixture-note', courseId: course.id, documentId: 'generated-note', sourceDocumentIds: sources.map(source => source.documentId), sourceRefs: sources, createdAt: '2026-11-05', updatedAt: '2026-11-05', coverage: { complete: true, documentCount: 2, sourceChunkCount: 2, processedChunkCount: 2, sourceCharacters: 100, processedCharacters: 100 } };
  delete artifact.sources;
  documents.push({ id: artifact.documentId, courseId: course.id, name: `${artifact.title}.md`, type: 'MD', status: 'ready', createdAt: '2026-11-05', size: 4096, summary: [], chunks: [{ id: 'generated-chunk', page: 1, text: artifact.body }], origin: { kind: 'ai-notes', artifactId: artifact.id } });
  return { ...seed, courses: [course], documents, cards: [], questions: [], attempts: [], courseStudio: { version: 1, artifacts: [artifact], messages: [
    { id: 'user-message', courseId: course.id, role: 'user', content: '请把这些资料整理成期末复习笔记，保留公式和例题。', documentIds: artifact.sourceDocumentIds, createdAt: '2026-11-05' },
    { id: 'assistant-message', courseId: course.id, role: 'assistant', content: '笔记已保存，请查看整理好的笔记。', documentIds: artifact.sourceDocumentIds, artifactId: artifact.id, createdAt: '2026-11-05' },
  ], jobs: [{ id: 'completed-job', courseId: course.id, status: 'completed', artifactId: artifact.id, documentIds: artifact.sourceDocumentIds, createdAt: '2026-11-05', updatedAt: '2026-11-05' }] } };
}
