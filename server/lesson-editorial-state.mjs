import { createHash } from 'node:crypto';

export const EDITORIAL_VERSION = 1;
const list = value => Array.isArray(value) ? value : [];
export function editorialFingerprint(lesson) {
  const notes = lesson.notes || {};
  return createHash('sha256').update(JSON.stringify({
    cues: lesson.cues, visualCues: lesson.visualCues, scope: lesson.scope,
    sections: notes.sections, examples: notes.examples, outline: notes.readingOutline,
    visual: lesson.visual && { id: lesson.visual.id, frames: list(lesson.visual.frames).map(({ id, time, sha256 }) => ({ id, time, sha256 })), observations: lesson.visual.observations },
  })).digest('hex');
}
export function currentEditorial(lesson) {
  const result = lesson.notes?.editorial;
  return result?.version === EDITORIAL_VERSION && !lesson.notes?.evidenceOutdated && result.fingerprint === editorialFingerprint(lesson)
    && Array.isArray(result.chapters) && result.chapters.length && Array.isArray(result.exercises) ? result : null;
}

/** Build a derived reading edition; source fragments, subtitles and original images stay intact. */
export function projectEditorial(lesson, correctedSections, correctedExamples) {
  const edition = currentEditorial(lesson);
  if (!edition) return null;
  const sections = new Map(correctedSections.map(item => [item.id, item]));
  const examples = new Map(list(lesson.notes.examples).map(item => [item.id, item]));
  const unique = values => [...new Set(values.filter(Boolean))];
  const evidence = (item, sources) => ({
    cueIds: unique(sources.flatMap(source => list(source.cueIds))),
    // Only visually reviewed selections enter the document. Other candidates remain in the board view.
    frameIds: list(item.evidence?.selections).map(selection => selection.frameId),
    evidence: item.evidence || (list(lesson.visual?.frames).length
      ? { status: 'unreviewed', selections: [], note: '尚未完成截图筛选，可在板书中查看原始画面。' }
      : { status: 'missing', selections: [], note: '本讲目前只有文字原文，尚无视频截图。提供视频画面后可补充配图。' }),
  });
  return {
    readingOverview: edition.overview,
    readingSections: edition.chapters.map(item => {
      const sources = item.sourceSectionIds.map(id => sections.get(id)).filter(Boolean);
      return { ...item, ...evidence(item, sources), editorial: true, inScope: sources.some(source => source.inScope === false) ? false : null,
        subsections: sources, explanationOrigin: 'ai-supplement' };
    }),
    readingExamples: edition.exercises.map(item => {
      const sources = item.sourceExampleIds.map(id => examples.get(id)).filter(Boolean);
      const corrected = correctedExamples.find(source => list(source.sourceExampleIds).includes(item.canonicalExampleId));
      return { ...item, ...evidence(item, sources), editorial: true, sourceExamples: sources,
        needsReview: item.explanationStatus !== 'complete', solutionOrigin: 'ai-supplement',
        // Preserve narrow mathematical corrections for the newly rewritten solution too (caller audits it).
        ...(corrected?.explanationStatus === 'needs-confirmation' && item.explanationStatus === 'complete' && sources.every(source => source.explanationStatus === 'needs-confirmation')
          ? { needsReview: true, explanationStatus: 'needs-confirmation' } : {}) };
    }),
  };
}
