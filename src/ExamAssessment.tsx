import { ArrowRight, Sparkle } from '@phosphor-icons/react';
import type { AssessmentSource } from './assessment-types';
import type { ExamQuestionResult } from './exam-types';
import LessonText from './LessonText';

export function uniqueSourceLocations(sources: AssessmentSource[]) {
  const seen = new Set<string>();
  return sources.filter(source => {
    const key = JSON.stringify([source.documentId, source.locationKind, source.page]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export default function ExamAssessment({ result, onOpenSource }: { result: ExamQuestionResult; onOpenSource: (source: AssessmentSource) => void }) {
  const assessment = result.aiAssessment;
  if (!assessment) return null;
  const status = assessment.status === 'correct' ? '关键点已答出' : assessment.status === 'partial' ? '部分答出' : assessment.status === 'incorrect' ? '需要订正' : '仍需核对';
  return <section className={`es-ai-assessment is-${assessment.status}`} aria-label="本题AI建议反馈"><header><span><Sparkle size={18} /><strong>AI建议 · {status}</strong></span><b>{assessment.suggestedPoints === null ? '待核对' : `${assessment.suggestedPoints} / ${assessment.maxPoints} 分`}</b></header><LessonText text={assessment.feedback} />{assessment.weakPoints.map((point, index) => <div className="es-weak-point" key={index}><strong>回到这个知识点：{point.topic}</strong><LessonText text={point.evidence} />{uniqueSourceLocations(point.sourceRefs).map((source, i) => <button key={i} type="button" className="text-button" onClick={() => onOpenSource(source)}>{source.documentName} · 第 {source.page} {source.locationKind === 'section' ? '段' : source.locationKind === 'slide' ? '张' : '页'}<ArrowRight size={15} /></button>)}</div>)}<small>建议分需对照笔记与评分要点核对，不计入掌握度。</small></section>;
}
