import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { examReviewFocus } from '../server/exams.mjs';
import { buildPlanner } from '../server/planner.mjs';

const hash = x => createHash('sha256').update(JSON.stringify(x, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key,value[key]])) : value)).digest('hex');
function fixture() {
  const course = {id:'math',name:'合成高数',examDate:'2026-11-10',target:80,mastery:35,chapters:3,difficulty:3};
  const doc = {id:'doc',name:'合成讲义',courseId:course.id,chunks:[{id:'c',text:'复合函数先确定自然定义域。'}]};
  const paper = {id:'paper',courseId:course.id,courseFingerprint:hash({id:course.id,name:course.name}),documentFingerprints:{doc:hash(doc)},questions:[{id:'q1',topic:'复合函数'},{id:'q2',topic:'单调性'}]};
  paper.contractHash=hash(paper);
  return {courses:[course],documents:[doc],questions:[],cards:[],settings:{dailyMinutes:120,goal:'balanced',planner:{startDate:'2026-11-05',reservePercent:10}},completedTasks:[],exams:{papers:[paper],attempts:[{id:'attempt',paperId:'paper',courseId:course.id,mode:'exam',status:'submitted',submittedAt:'2026-11-05T03:00:00Z',results:[{questionId:'q1',status:'incorrect'},{questionId:'q2',status:'ungraded'}]}]}};
}
test('latest source-valid exam wrong answers enter the rolling time budget with a direct report target',()=>{
  const state=fixture(),before=structuredClone(state),focus=examReviewFocus(state,'math');
  assert.deepEqual(focus,{attemptId:'attempt',topics:['复合函数'],questionIds:['q1']});
  const plan=buildPlanner(state,{date:'2026-11-05',days:2,now:new Date('2026-11-05T04:00:00Z')});
  const tasks=plan.days.flatMap(day=>day.tasks).filter(task=>task.action==='exams');
  assert.ok(tasks.length);assert.ok(tasks.every(task=>task.attemptId==='attempt'&&task.title.includes('复合函数')));
  for(const day of plan.days) assert.ok(day.allocated+day.breakMinutes+day.reserveMinutes<=day.budget);
  assert.deepEqual(state,before);
});
test('new successful exam supersedes older mistakes; practice and another course cannot redirect revision',()=>{
  const state=fixture();state.exams.attempts.push({...state.exams.attempts[0],id:'new',submittedAt:'2026-11-05T04:00:00Z',results:[{questionId:'q1',status:'correct'}]});
  assert.equal(examReviewFocus(state,'math'),null);assert.equal(examReviewFocus(state,'other'),null);
  state.exams.attempts.pop();state.exams.attempts[0].mode='practice';assert.equal(examReviewFocus(state,'math'),null);
});
test('changed material, moved course and tampered question contract invalidate remediation',()=>{
  for(const change of [s=>s.documents[0].chunks[0].text='new',s=>s.documents[0].courseId='other',s=>s.exams.papers[0].questions[0].topic='changed']) {
    const state=fixture();change(state);assert.equal(examReviewFocus(state,'math'),null);
  }
});
test('ungraded answers are not mistakes until the student records a need for correction',()=>{
  const state=fixture();state.exams.attempts[0].results=[{questionId:'q2',status:'ungraded',aiAssessment:{status:'incorrect'}}];
  assert.equal(examReviewFocus(state,'math'),null);
  state.exams.attempts[0].results[0].review={selfAssessment:'partial'};
  assert.deepEqual(examReviewFocus(state,'math').topics,['单调性']);
  state.exams.attempts[0].results[0].review={selfAssessment:'correct'};assert.equal(examReviewFocus(state,'math'),null);
});
