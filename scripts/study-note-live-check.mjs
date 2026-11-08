import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/index.mjs';
import {createModelService,isModelConfigured} from '../server/model-service.mjs';
import {studioDocumentState} from '../tests/fixtures/studio-document-state.mjs';
import {studyNote} from '../tests/fixtures/study-note.mjs';
if (!process.argv.includes('--live')) throw new Error('Use --live to explicitly enable the configured model call.');
const modelService = createModelService({dataDir:path.resolve('data')});
const provider = {baseUrl:modelService.provider.baseUrl,model:modelService.provider.model,apiKey:modelService.provider.apiKey};
if (!isModelConfigured(provider)) throw new Error('No configured text model.');
const folder = await fs.mkdtemp(path.join(os.tmpdir(),'shifen-note-live-'));
let app,server;
try {
  const seed = createApp({dataDir:folder,provider:{},visionProvider:{},videoFetcher:null}); seed.emit('shifen:close');
  const state = studioDocumentState(JSON.parse(await fs.readFile(path.join(folder,'state.json'),'utf8')));
  state.documents = state.documents.filter(d=>!d.origin);state.courseStudio={version:1,messages:[],artifacts:[],jobs:[]};
  const divide = studyNote.body.indexOf('## 特征值与特征向量');
  state.documents.forEach((d,i)=>{d.chunks[0].text=(i?studyNote.body.slice(divide):studyNote.body.slice(0,divide)).replace(/\[来源[^\]]*\]/g,'');});
  await fs.writeFile(path.join(folder,'state.json'),JSON.stringify(state));
  app=createApp({dataDir:folder,provider,visionProvider:{},videoFetcher:null});
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(base+'/api/course-studio/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({courseId:'linear-fixture',documentIds:state.documents.map(d=>d.id),action:'notes',prompt:'整理成结构清晰的学霸复习讲义，合并重复知识点，完整保留已有例题、条件、公式与解题步骤。围绕原结论设计回忆自测，不添加来源没有的题目和定理。'})});
  if(!response.ok)throw new Error('Could not start isolated note job.');
  let job=await response.json(),deadline=Date.now()+150000;
  while(['running','queued'].includes(job.status)&&Date.now()<deadline){await new Promise(r=>setTimeout(r,1000));job=await(await fetch(base+'/api/course-studio/jobs/'+job.id)).json();}
  if(job.status!=='completed')throw new Error(`Isolated note generation status: ${job.status}`);
  const result=await(await fetch(base+'/api/course-studio?courseId=linear-fixture')).json();const note=result.artifacts.find(a=>a.id===job.artifactId);
  const output=path.resolve('test-results/study-document/live');await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(output,'generated-notes.md'),note.body);
  for(const format of ['pdf','docx']){const file=await fetch(base+`/api/course-studio/artifacts/${encodeURIComponent(note.id)}/export?format=${format}`);if(!file.ok)throw new Error('Live note export failed.');await fs.writeFile(path.join(output,'generated-notes.'+format),Buffer.from(await file.arrayBuffer()));}
  const report={isolated:true,syntheticSourceDocuments:state.documents.length,sourceCharacters:state.documents.reduce((n,d)=>n+d.chunks[0].text.length,0),generatedCharacters:note.body.length,sections:(note.body.match(/^## /gm)||[]).length,subsections:(note.body.match(/^### /gm)||[]).length,sourceRefs:note.sourceRefs.length,pdfAndWord:true,originalUserDataChanged:false};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {
  app?.emit('shifen:close');server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));
  if(path.dirname(folder)===os.tmpdir()&&path.basename(folder).startsWith('shifen-note-live-'))await fs.rm(folder,{recursive:true,force:true,maxRetries:3});
}
