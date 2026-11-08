import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createModelService} from '../server/model-service.mjs';
import {currentEditorial,editorialFingerprint} from '../server/lesson-editorial-state.mjs';
import {completeChapterSource,editorialRequest} from '../server/lesson-editorial.mjs';
import {auditEditionContent} from '../server/lesson-completeness.mjs';
if(!process.argv.includes('--live'))throw new Error('Use --live for the configured model.');
const root=path.resolve('data'), filename=path.join(root,'lessons.json');
const before=await fs.readFile(filename), saved=JSON.parse(before), lesson=saved.lessons.find(l=>currentEditorial(l));
if(!lesson)throw new Error('No current lecture edition available.');
const output=path.resolve('test-results/lecture-content-quality');await fs.mkdir(output,{recursive:true});
const fingerprint=editorialFingerprint(lesson), model=createModelService({dataDir:root});
const provider={baseUrl:model.provider.baseUrl,model:model.provider.model,apiKey:model.provider.apiKey};
const original=structuredClone(currentEditorial(lesson));
const cached=JSON.parse(await fs.readFile(path.join(output,'checkpoint.json'),'utf8').catch(()=>'null'));
const seed=cached?.fingerprint===fingerprint&&cached.auditVersion===2?cached:original;
const signal=AbortSignal.timeout(12*60*1000);
let calls=0;
const result=await auditEditionContent(seed,lesson,{
  sourceFor:completeChapterSource,signal,
  validateChapter:value=>{
    if(typeof value?.text!=='string'||value.text.length<80||value.text.length>14000||typeof value.takeaway!=='string'||value.takeaway.length>300||typeof value.teacherExplanation!=='string'||value.teacherExplanation.length>2500||!Array.isArray(value.pitfalls)||value.pitfalls.length>4||value.pitfalls.some(p=>typeof p!=='string'||p.length>500))throw Object.assign(new Error('Invalid chapter repair'),{status:502});
    return {text:value.text,takeaway:value.takeaway,teacherExplanation:value.teacherExplanation,pitfalls:value.pitfalls,...(Array.isArray(value.sourceNotes)?{sourceNotes:value.sourceNotes.filter(x=>typeof x==='string'&&x.length<=3000).slice(0,8)}:{}),...(value.checkQuestion?{checkQuestion:value.checkQuestion}:{})};
  },
  request:(system,source,validate,options)=>{calls++;console.log(JSON.stringify({operation:source.operation,chapter:source.chapter?.title||source.title,call:calls}));return editorialRequest(provider,system,source,validate,options);},
  onProgress:progress=>console.log(JSON.stringify(progress)),
  onCheckpoint:result=>fs.writeFile(path.join(output,'checkpoint.json'),JSON.stringify(result)),
});
await fs.writeFile(path.join(output,'edition.json'),JSON.stringify(result,null,2));
await fs.writeFile(path.join(output,'before-edition.json'),JSON.stringify(original,null,2));
const report={source:'existing-imported-public-lecture',sourceFingerprint:fingerprint,modelCalls:calls,...result.contentAudit,
  chapterChanges:result.chapters.map(c=>({title:c.title,beforeCharacters:original.chapters.find(o=>o.id===c.id)?.text.length,afterCharacters:c.text.length,audit:c.contentAudit})),published:false};
if(process.argv.includes('--publish') && result.contentAudit.notChecked===0){
  const latestBytes=await fs.readFile(filename),latest=JSON.parse(latestBytes),target=latest.lessons.find(l=>l.id===lesson.id);
  if(!target || editorialFingerprint(target)!==fingerprint || createHash('sha256').update(JSON.stringify(target.notes.editorial)).digest('hex')!==createHash('sha256').update(JSON.stringify(original)).digest('hex'))throw new Error('Lecture changed; did not overwrite newer content.');
  await fs.mkdir(path.join(root,'backups'),{recursive:true});await fs.writeFile(path.join(root,'backups',`lesson-content-${Date.now()}.json`),latestBytes,{flag:'wx'});
  target.notes.editorial=result;target.updatedAt=new Date().toISOString();const temporary=filename+'.content-quality.tmp';await fs.writeFile(temporary,JSON.stringify(latest,null,2));await fs.rename(temporary,filename);report.published=true;
}
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({finished:true,reviewed:report.reviewed,repaired:report.repaired,initialIssues:report.initialIssues,remainingIssues:report.remainingIssues,notChecked:report.notChecked,published:report.published}));
