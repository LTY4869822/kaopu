import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { createApp } from '../server/index.mjs';

test('photo notes archive to a course, retain original bytes, support revision guarded correction and deduplicate safely', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(),'shifen-handwriting-api-'));
  let calls = 0;
  const parser = {configured:true, async parse(){ calls++; return {
    type:'PNG',locationKind:'page',chunks:[{id:'ocr-1',page:1,text:'高等数学：导数与微分。导数是变化率，极限定义需核对。'}],
    parser:{engine:'vision',ocr:true,formula:false,handwriting:true},
    recognition:{kind:'handwriting',needsReview:true,pages:[{page:1,warnings:['符号需核对']}]},warning:'手写识别文字待核对。',
  };}};
  const app=createApp({dataDir,provider:{},handwritingParser:parser});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const canvas=createCanvas(150,100);const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,150,100);context.fillStyle='#000';context.fillText('f(x)',10,50);
  const original=canvas.toBuffer('image/png');
  const upload=async()=>{const form=new FormData();form.append('parseMode','handwriting');form.append('file',new Blob([original],{type:'image/png'}),'高等数学手写笔记.png');const res=await fetch(`${base}/documents/auto`,{method:'POST',body:form});return {status:res.status,body:await res.json()};};
  try {
    const added=await upload();assert.equal(added.status,201);assert.ok(added.body.course.id);assert.equal(added.body.course.name,'高等数学');
    const doc=added.body.document;assert.equal(doc.recognition.needsReview,true);assert.equal(doc.parser.engine,'vision');
    const source=await fetch(`${base}/documents/${doc.id}/original`);assert.equal(source.headers.get('content-type'),'image/png');assert.match(source.headers.get('content-disposition'),/^inline;/);assert.deepEqual(Buffer.from(await source.arrayBuffer()),original);
    const change=async(body)=>{const res=await fetch(`${base}/documents/${doc.id}/recognition`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,body:await res.json()};};
    assert.equal((await change({page:2,text:'无法凭空添加页',revision:0})).status,400);
    const corrected=await change({page:1,text:'导数：函数在一点的瞬时变化率。',revision:0});assert.equal(corrected.status,200);assert.equal(corrected.body.recognition.needsReview,false);assert.equal(corrected.body.recognition.revision,1);assert.match(corrected.body.recognition.pages[0].originalText,/极限定义需核对/);assert.equal(corrected.body.chunks[0].text,'导数：函数在一点的瞬时变化率。');
    assert.equal((await change({page:1,text:'过期窗口的修改',revision:0})).status,409);
    const duplicate=await upload();assert.equal(duplicate.status,200);assert.equal(duplicate.body.duplicate,true);assert.equal(calls,1);assert.equal(duplicate.body.document.recognition.revision,1);assert.equal(duplicate.body.document.chunks[0].text,'导数：函数在一点的瞬时变化率。');
    const reopened=createApp({dataDir,provider:{},handwritingParser:parser});const persisted=JSON.parse(await fs.readFile(path.join(dataDir,'state.json'),'utf8'));assert.ok(reopened);assert.equal(persisted.documents.find(item=>item.id===doc.id).recognition.revision,1);
  } finally {app.emit('shifen:close');await new Promise(resolve=>server.close(resolve));await fs.rm(dataDir,{recursive:true,force:true});}
});

test('handwriting source and correction routes retain the owner guard',async()=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'shifen-handwriting-owner-'));
  const app=createApp({dataDir,provider:{},authEnabled:true});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}/api`;
  try {assert.equal((await fetch(`${base}/documents/unknown/original`)).status,401);assert.equal((await fetch(`${base}/documents/unknown/recognition-history`)).status,401);assert.equal((await fetch(`${base}/documents/unknown/recognition`,{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);}
  finally{app.emit('shifen:close');await new Promise(resolve=>server.close(resolve));await fs.rm(dataDir,{recursive:true,force:true});}
});

test('correcting a note retires stale practice while preserving private downloadable learning history',async()=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'shifen-handwriting-history-'));
  const initial=createApp({dataDir,provider:{}});initial.emit('shifen:close');
  const stateFile=path.join(dataDir,'state.json');const state=JSON.parse(await fs.readFile(stateFile,'utf8'));
  const document={id:'handwritten-source',courseId:state.courses[0].id,name:'微分笔记',type:'PNG',locationKind:'page',chunks:[{id:'before',page:1,text:'旧的识别正文与负号'}],summary:[],recognition:{kind:'handwriting',needsReview:true,pages:[{page:1,warnings:[]}]}};
  state.documents.push(document);
  state.questions.push({id:'legacy-old',sourceDocumentId:document.id,answer:'legacy-private-answer'});state.attempts.push({questionId:'legacy-old',answer:'student-old-answer'});
  state.assessments={version:1,questions:[{id:'ai-old',sources:[{documentId:document.id}],expectedAnswer:'PRIVATE-ARCHIVED-KEY'}],attempts:[{questionId:'ai-old',answer:'old-submission'}]};
  state.exams={version:1,templates:[],papers:[{id:'paper-old',documentIds:[document.id],expectedAnswer:'PRIVATE-PAPER-KEY'}],attempts:[{paperId:'paper-old',status:'submitted',answers:{q:'old'}}]};
  await fs.writeFile(stateFile,JSON.stringify(state));
  const app=createApp({dataDir,provider:{}});const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base=`http://127.0.0.1:${server.address().port}/api`;
  try {
    const response=await fetch(`${base}/documents/${document.id}/recognition`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:1,text:'已经核对的正文与负号。',revision:0})});assert.equal(response.status,200);
    const updated=await response.json();assert.equal(updated.recognition.archives.length,1);assert.ok(!JSON.stringify(updated).includes('PRIVATE-ARCHIVED-KEY'));
    const visible=await(await fetch(`${base}/state`)).json();assert.equal(visible.sourceRevisionArchives,undefined);assert.ok(!JSON.stringify(visible).includes('PRIVATE-ARCHIVED-KEY'));
    const historyResponse=await fetch(`${base}/documents/${document.id}/recognition-history`);assert.equal(historyResponse.status,200);assert.match(historyResponse.headers.get('content-disposition'),/^attachment;/);
    const history=await historyResponse.json();assert.equal(history.readOnly,true);assert.equal(history.archives[0].document.chunks[0].text,'旧的识别正文与负号');assert.equal(history.archives[0].assessment.questions[0].expectedAnswer,'PRIVATE-ARCHIVED-KEY');assert.equal(history.archives[0].legacy.attempts[0].answer,'student-old-answer');assert.equal(history.archives[0].exams.attempts[0].status,'submitted');
    const persisted=JSON.parse(await fs.readFile(stateFile,'utf8'));assert.equal(persisted.assessments.questions.length,0);assert.equal(persisted.exams.papers.length,0);assert.equal(persisted.sourceRevisionArchives.length,1);
  } finally {app.emit('shifen:close');await new Promise(resolve=>server.close(resolve));await fs.rm(dataDir,{recursive:true,force:true});}
});
