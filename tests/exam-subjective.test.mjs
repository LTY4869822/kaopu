import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mountExams } from '../server/exams.mjs';
import { parseDocument } from '../server/parsers.mjs';

const provider = { baseUrl: 'https://subjective.example.test/v1', model: 'fixture', apiKey: 'private-subjective-fixture-key' };
const stateSeed = () => ({ courses: [{ id: 'math', name: '高等数学', mastery: 35 }], documents: [{ id: 'notes', courseId: 'math', name: '合并笔记.md', type: 'MD', locationKind: 'section', chunks: [{ id: 'n1', page: 1, text: '链式法则：复合函数求导需要乘以内层导数。计算前应确认定义域和变量条件。' }] }] });
const completion = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }), { headers: { 'Content-Type': 'application/json' } });
const assessment = (patch = {}) => ({ status: 'partial', suggestedPoints: 3, confidence: .94, feedback: '外层函数求导正确，但遗漏了内层函数的导数，请回到链式法则复习。', weakPoints: [{ reason: 'method', evidence: '缺少内层导数这个因子，需重新核对复合函数求导的完整步骤。', sourceIndices: [0] }], ...patch });
function questions(payload) { return { questions: payload.slots.map(s => ({ slotId: s.id, type: s.type, difficulty: s.difficulty, topic: '链式法则', prompt: `请用自己的语言解释第${s.number}题中的复合函数求导步骤，并说明适用条件。`, options: s.type === 'single-choice' ? ['A','B','C','D'].map(id => ({ id, text: `${id}号独立选项内容` })) : [], answerKey: s.type === 'single-choice' ? 'A' : null, expectedAnswer: '外层函数导数乘以内层函数导数。', acceptedAnswers: [], rubric: '先识别复合关系，再求外层导数，最后乘以内层导数。', explanation: '复合函数求导需要完整保留内外层导数及原函数条件。', steps: ['识别内层函数及外层函数。','求外层导数后乘以内层导数。'], hints: ['先辨识函数的复合关系。','检查是否还遗漏一个求导因子。'], sources: [{ sourceId: payload.sources[0].sourceId, citationId: payload.sources[0].citations[0].id }], origin: 'material-based' })) }; }
async function fixture(t, options = {}) {
  let state = stateSeed(), failure = false, now = Date.now(); const calls = [];
  const app = express(); app.use(express.json({ limit: '1mb' }));
  const service = mountExams(app, { getState: () => state, saveState: () => { if (failure) throw new Error('private disk error'); }, provider, timeoutMs: options.timeoutMs || 1000, now: () => now, parseSubmission: options.parseSubmission,
    fetchImpl: async (_url, init) => { const raw = JSON.parse(init.body), payload = JSON.parse(raw.messages[1].content); calls.push(payload); const custom = await options.model?.(payload, init); if (custom !== undefined) return custom; return completion(payload.task.includes('exam-grade') ? assessment() : questions(payload)); } });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.status ? error.message : '操作失败' }));
  const server = await new Promise(resolve => { const s = app.listen(0,'127.0.0.1',()=>resolve(s)); });
  t.after(async()=>{service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const api = async (route, body, method = body === undefined ? 'GET' : 'POST') => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api/exams${route}`, { method, ...(body === undefined ? {} : body instanceof FormData ? { body } : { headers:{'Content-Type':'application/json'},body:JSON.stringify(body) }) });return {status:response.status,body:await response.json()}; };
  const finish = async (id, grading = false) => { for(let i=0;i<250;i++){const r=await api(`/${grading?'grading-jobs':'jobs'}/${id}`);if(!['queued','generating'].includes(r.body.status))return r.body;await new Promise(resolve=>setTimeout(resolve,8));}throw new Error('job did not finish'); };
  const start = async(types=['short-answer'])=>{const made=await api('/papers',{courseId:'math',title:'虚构主观反馈测试',sections:types.map(type=>({type,count:1,points:6,difficulty:'medium',topics:['链式法则']})),durationMinutes:20,goal:'balanced',focus:'',sourcePolicy:'materials',documentIds:['notes']});assert.equal(made.status,202,JSON.stringify(made.body));const job=await finish(made.body.jobId);assert.equal(job.status,'completed',job.message);return(await api(`/papers/${job.paperId}/start`,{mode:'practice'})).body;};
  const submit = async(a)=> (await api(`/attempts/${a.id}/submit`,{revision:a.revision,answers:Object.fromEntries(a.paper.questions.map(q=>[q.id,q.options.length?'A':'只写出了外层函数的导数。']))})).body;
  return {api,finish,start,submit,calls,service,get state(){return state;},reset(){state=stateSeed();},failSave(value){failure=value;},advance(ms){now+=ms;}};
}

test('subjective feedback stays separate from objective scores and points back to the selected notes',async t=>{
  const f=await fixture(t),a=await f.start(['single-choice','short-answer']),submitted=await f.submit(a);
  const job=await f.api(`/attempts/${a.id}/grade`,{revision:submitted.revision});assert.equal(job.status,202);const done=await f.finish(job.body.jobId,true);assert.equal(done.status,'completed');assert.equal(done.kind,'grading');
  const result=(await f.api(`/attempts/${a.id}`)).body, subjective=result.results.find(r=>r.earned===null);
  assert.equal(subjective.status,'ungraded');assert.equal(subjective.earned,null);assert.equal(subjective.aiAssessment.suggestedPoints,3);assert.equal(subjective.aiAssessment.status,'partial');assert.equal(subjective.aiAssessment.weakPoints[0].sourceRefs[0].documentId,'notes');
  assert.equal(result.summary.objectiveEarned,6);assert.equal(result.summary.objectiveTotal,6);assert.equal(result.summary.pendingPoints,6);assert.equal(result.summary.aiSuggestedEarned,3);assert.equal(result.summary.aiSuggestedTotal,6);assert.equal(result.summary.weakTopics[0].topic,'链式法则');assert.equal(f.state.courses[0].mastery,35);
  const payload=f.calls.find(c=>c.task==='exam-grade');assert.equal(payload.studentAnswer,'只写出了外层函数的导数。');assert.ok(payload.questionContract.rubric);assert.ok(!JSON.stringify(result).includes(provider.apiKey));
});
test('grade endpoints require a submitted answer, current revision and real subjective question IDs',async t=>{
  const f=await fixture(t),a=await f.start(['single-choice','short-answer']);assert.equal((await f.api(`/attempts/${a.id}/grade`,{revision:0})).status,409);const submitted=await f.submit(a);
  assert.equal((await f.api(`/attempts/${a.id}/grade`,{revision:0})).status,409);assert.equal((await f.api(`/attempts/${a.id}/grade`,{revision:submitted.revision,questionIds:[a.paper.questions[0].id]})).status,400);assert.equal(f.calls.filter(c=>c.task.includes('grade')).length,0);
});
test('low confidence never becomes a score or a claimed mastery update',async t=>{
  const f=await fixture(t,{model:p=>p.task==='exam-grade'?completion(assessment({confidence:.6})):undefined}),a=await f.start(),submitted=await f.submit(a);const made=await f.api(`/attempts/${a.id}/grade`,{revision:submitted.revision});await f.finish(made.body.jobId,true);const r=(await f.api(`/attempts/${a.id}`)).body;assert.equal(r.results[0].aiAssessment.status,'ungraded');assert.equal(r.results[0].aiAssessment.suggestedPoints,null);assert.equal(r.summary.aiAssessedQuestions,0);assert.equal(f.state.courses[0].mastery,35);
});
test('forged grading references get one repair and never become note links',async t=>{
  const f=await fixture(t,{model:p=>p.task.includes('exam-grade')?completion(assessment({weakPoints:[{reason:'method',evidence:'伪造的薄弱点与来源不能通过服务端检查。',sourceIndices:[99]}]})):undefined}),a=await f.start(),submitted=await f.submit(a);const made=await f.api(`/attempts/${a.id}/grade`,{revision:submitted.revision});const job=await f.finish(made.body.jobId,true);assert.equal(job.status,'failed');assert.match(job.message,/^批改反馈未通过校验：/);assert.doesNotMatch(job.message,/组卷/);assert.equal(f.calls.filter(c=>c.task.includes('exam-grade')).length,2);assert.equal((await f.api(`/attempts/${a.id}`)).body.results[0].aiAssessment,undefined);
});
test('cancellation fences late uncooperative model responses and refuses a duplicate grading job',async t=>{
  let release,started;const waiting=new Promise(resolve=>{started=resolve;});const f=await fixture(t,{model:async p=>{if(p.task==='exam-grade'){started();await new Promise(resolve=>{release=resolve;});return completion(assessment());}}});const a=await f.start(),submitted=await f.submit(a),made=await f.api(`/attempts/${a.id}/grade`,{revision:submitted.revision});await waiting;
  assert.equal((await f.api(`/attempts/${a.id}/grade`,{revision:submitted.revision})).status,409);await f.api(`/grading-jobs/${made.body.jobId}/cancel`,{});release();await new Promise(resolve=>setTimeout(resolve,30));assert.equal((await f.api(`/attempts/${a.id}`)).body.results[0].aiAssessment,undefined);assert.equal((await f.api(`/grading-jobs/${made.body.jobId}`)).body.status,'cancelled');
});
test('source changes during grading cannot save a recommendation against stale notes',async t=>{
  let release,started;const waiting=new Promise(resolve=>{started=resolve;});const f=await fixture(t,{model:async p=>{if(p.task==='exam-grade'){started();await new Promise(resolve=>{release=resolve;});return completion(assessment());}}});const a=await f.start(),submitted=await f.submit(a),made=await f.api(`/attempts/${a.id}/grade`,{revision:submitted.revision});await waiting;f.state.documents[0].chunks[0].text='修订后新的资料内容。';release();assert.equal((await f.finish(made.body.jobId,true)).status,'failed');assert.equal(f.state.exams.attempts[0].results[0].aiAssessment,undefined);
});
test('a failed second question preserves first feedback and a failed save rolls back only the current result',async t=>{
  let graded=0;const f=await fixture(t,{model:p=>{if(p.task==='exam-grade'&&++graded===2)throw new Error(provider.apiKey);}}),a=await f.start(['short-answer','calculation']),submitted=await f.submit(a),made=await f.api(`/attempts/${a.id}/grade`,{revision:submitted.revision});const job=await f.finish(made.body.jobId,true);assert.equal(job.status,'failed');assert.equal(job.completed,1);assert.ok(!job.message.includes(provider.apiKey));const read=(await f.api(`/attempts/${a.id}`)).body;assert.equal(read.summary.aiAssessedQuestions,1);assert.ok(read.results[0].aiAssessment);assert.equal(read.results[1].aiAssessment,undefined);
  f.failSave(true);const retry=await f.api(`/attempts/${a.id}/grade`,{revision:read.revision,questionIds:[a.paper.questions[1].id]});assert.equal((await f.finish(retry.body.jobId,true)).status,'failed');assert.equal(f.state.exams.attempts[0].results[1].aiAssessment,undefined);assert.equal(f.state.exams.attempts[0].summary.aiAssessedQuestions,1);
});
test('multipart answer extraction returns a reviewable draft without touching the saved answer',async t=>{
  const f=await fixture(t,{parseSubmission:async()=>({chunks:[{page:1,text:'不应重复拼入的chunk'}],structure:{blocks:[{page:1,text:'外层函数导数需要乘以内层导数。'}]}})}),a=await f.start();const form=new FormData();form.append('questionId',a.paper.questions[0].id);form.append('file',new Blob(['local fixture']),'纸上作答.txt');const read=await f.api(`/attempts/${a.id}/submission`,form);assert.equal(read.status,200);assert.equal(read.body.filename,'纸上作答.txt');assert.equal(read.body.text,'外层函数导数需要乘以内层导数。');assert.equal(read.body.needsReview,true);assert.deepEqual((await f.api(`/attempts/${a.id}`)).body.answers,{});
});
test('answer extraction refuses objective questions, expired attempts and oversized text instead of truncating',async t=>{
  const f=await fixture(t,{parseSubmission:async()=>({chunks:[{page:1,text:'x'.repeat(10001)}]})}),a=await f.start(['single-choice','short-answer']);const upload=async id=>{const form=new FormData();form.append('questionId',id);form.append('file',new Blob(['fixture']),'answer.txt');return f.api(`/attempts/${a.id}/submission`,form);};assert.equal((await upload(a.paper.questions[0].id)).status,400);const long=await upload(a.paper.questions[1].id);assert.equal(long.status,422);assert.match(long.body.error,/10000/);await f.submit(a);assert.equal((await upload(a.paper.questions[1].id)).status,409);
});
test('missing parser and parser diagnostics fail safely without fabricating answer text',async t=>{
  const f=await fixture(t),a=await f.start();const form=new FormData();form.append('questionId',a.paper.questions[0].id);form.append('file',new Blob(['fixture']),'answer.txt');const missing=await f.api(`/attempts/${a.id}/submission`,form);assert.equal(missing.status,503);assert.equal(missing.body.text,undefined);
  const failing=await fixture(t,{parseSubmission:async()=>{throw new Error(provider.apiKey);}}),b=await failing.start();const form2=new FormData();form2.append('questionId',b.paper.questions[0].id);form2.append('file',new Blob(['fixture']),'answer.txt');const failed=await failing.api(`/attempts/${b.id}/submission`,form2);assert.equal(failed.status,502);assert.ok(!JSON.stringify(failed).includes(provider.apiKey));
});

test('native answer extraction decodes a Chinese filename before parsing and restores overlapping text chunks',async t=>{
  let receivedName='';const text=Array.from({length:180},(_,i)=>`第${i}个推导项：保留内层导数并检查定义域。`).join('\n');
  const f=await fixture(t,{parseSubmission:async file=>{receivedName=file.originalname;return parseDocument(file);}}),a=await f.start();const form=new FormData();form.append('questionId',a.paper.questions[0].id);form.append('file',new Blob([text]),'期末推导作答.txt');
  const response=await f.api(`/attempts/${a.id}/submission`,form);assert.equal(response.status,200);assert.equal(receivedName,'期末推导作答.txt');assert.equal(response.body.filename,receivedName);assert.equal(response.body.text,text);
});

test('reset aborts a pending grading request and cannot populate the replacement space',async t=>{
  let started,seenSignal,release;const waiting=new Promise(resolve=>{started=resolve;});
  const f=await fixture(t,{model:async(p,init)=>{if(p.task==='exam-grade'){seenSignal=init.signal;started();await new Promise(resolve=>{release=resolve;});return completion(assessment());}}}),a=await f.start(),submitted=await f.submit(a),job=await f.api(`/attempts/${a.id}/grade`,{revision:submitted.revision});
  await waiting;f.service.reset();f.reset();assert.equal(seenSignal.aborted,true);release();const done=await f.finish(job.body.jobId,true);assert.equal(done.status,'cancelled');assert.equal(f.state.exams,undefined);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.state.exams,undefined);
});

test('reset aborts an active attachment extraction, leaves no answer and releases the parser slot',async t=>{
  let started,seenSignal,release;const waiting=new Promise(resolve=>{started=resolve;});let calls=0;
  const f=await fixture(t,{parseSubmission:async(_file,{signal})=>{calls++;if(calls===1){seenSignal=signal;started();await new Promise(resolve=>{release=resolve;});}return{chunks:[{page:1,text:'保留内层导数的完整作答文字。'}]};}}),a=await f.start();
  const form=new FormData();form.append('questionId',a.paper.questions[0].id);form.append('file',new Blob(['fixture']),'answer.txt');const pending=f.api(`/attempts/${a.id}/submission`,form);await waiting;f.service.reset();assert.equal(seenSignal.aborted,true);release();assert.equal((await pending).status,499);assert.equal(f.state.exams.attempts.length,0);
  const b=await f.start(),next=new FormData();next.append('questionId',b.paper.questions[0].id);next.append('file',new Blob(['fixture']),'answer.txt');assert.equal((await f.api(`/attempts/${b.id}/submission`,next)).status,200);assert.deepEqual((await f.api(`/attempts/${b.id}`)).body.answers,{});
});

test('PDF answer mode defaults to handwriting, permits explicit text extraction and rejects invalid modes before parsing',async t=>{
  const modes=[];const f=await fixture(t,{parseSubmission:async(file,{mode})=>{modes.push({name:file.originalname,mode});return {chunks:[{page:1,text:'核对复合函数的内层导数与变量条件。'}]};}}),a=await f.start();
  const upload=async(mode,name='answer.pdf')=>{const form=new FormData();form.append('questionId',a.paper.questions[0].id);if(mode!==undefined)form.append('parseMode',mode);form.append('file',new Blob(['fixture']),name);return f.api(`/attempts/${a.id}/submission`,form);};
  assert.equal((await upload(undefined)).status,200);assert.equal(modes.at(-1).mode,'handwriting');assert.equal((await upload('auto')).status,200);assert.equal(modes.at(-1).mode,'auto');assert.equal((await upload('handwriting','answer.txt')).status,200);assert.equal(modes.at(-1).mode,'auto');const count=modes.length;assert.equal((await upload('unsupported')).status,400);assert.equal(modes.length,count);
});

test('an extra model topic is rejected and repaired instead of being accepted as the stored knowledge point',async t=>{
  let gradeCalls=0;const f=await fixture(t,{model:(p,init)=>{if(!p.task.includes('exam-grade'))return;const system=JSON.parse(init.body).messages[0].content;assert.match(system,/顶层必须且只能有这5个字段/);assert.match(system,/只能有reason、evidence、sourceIndices这3个字段/);gradeCalls++;return completion(gradeCalls===1?assessment({topic:'模型试图替换的知识点'}):assessment());}}),a=await f.start(),submitted=await f.submit(a),made=await f.api(`/attempts/${a.id}/grade`,{revision:submitted.revision});const done=await f.finish(made.body.jobId,true);assert.equal(done.status,'completed');assert.equal(gradeCalls,2);const repair=f.calls.find(p=>p.task==='repair-exam-grade');assert.match(repair.validationError,/^批改反馈未通过校验：/);assert.equal(repair.original.questionContract.topic,'链式法则');const result=(await f.api(`/attempts/${a.id}`)).body.results[0];assert.equal(result.aiAssessment.weakPoints[0].topic,'链式法则');assert.ok(!JSON.stringify(result.aiAssessment).includes('模型试图替换的知识点'));
});
