import test from 'node:test';
import assert from 'node:assert/strict';
import {validateContentAudit,auditAndRepairChapter,auditEditionContent} from '../server/lesson-completeness.mjs';
import {completeChapterSource,editorialRequest,recompileLesson} from '../server/lesson-editorial.mjs';
const chapter={id:'reading-1',title:'有界性',text:'讨论函数的有界性需要指定区间。',takeaway:'先检查区间。',teacherExplanation:'',pitfalls:[],sourceSectionIds:['s1','s2']};
const evidence={sections:[{id:'s1',text:'先指定区间。'},{id:'s2',text:'存在M>0，使所有x满足|f(x)|≤M。'}],cues:[{id:'cue-1',text:'讨论函数的有界性需要指定区间。'},{id:'cue-2',text:'存在M>0，使所有x满足|f(x)|≤M。'}],frames:[]};
const missing={checks:[{id:'s1',status:'covered',noteQuote:'有界性需要指定区间',reason:'区间要求已保留。'},{id:'s2',status:'missing',noteQuote:'',reason:'缺少正数M和全称量词。'}],findings:[{kind:'omission',statement:'保留M>0及所有x的量词。',cueIds:['cue-2'],sourceQuote:'存在M>0，使所有x满足|f(x)|≤M。',reason:'不能只写一个概念名称。'}]};
test('completeness audit rejects fabricated notes, unknown source IDs and unsupported quotations',()=>{
  assert.equal(validateContentAudit(missing,chapter,evidence).checks.length,2);
  for(const change of [x=>x.checks.pop(),x=>x.checks[0].noteQuote='讲义中没有这句话',x=>x.checks[1].id='s1',x=>x.findings[0].cueIds=['unknown'],x=>x.findings[0].sourceQuote='这个公式是我想象的']){
    const value=structuredClone(missing);change(value);assert.throws(()=>validateContentAudit(value,chapter,evidence));
  }
});
test('a missing condition triggers one repair then a second evidence-backed audit',async()=>{
  const fixed={...chapter,text:chapter.text+'存在M>0，使所有x满足|f(x)|≤M。'};let calls=0;
  const result=await auditAndRepairChapter(chapter,evidence,{validateChapter:x=>x,request:async(_system,input,validate)=>{
    calls++;
    if(input.operation==='lecture-content-repair')return validate(fixed);
    if(calls===1)return validate(missing);
    return validate({checks:[missing.checks[0],{id:'s2',status:'covered',noteQuote:'存在M>0，使所有x满足',reason:'补回量词与正数条件。'}],findings:[]});
  }});
  assert.equal(calls,3);assert.equal(result.contentAudit.repaired,true);assert.equal(result.contentAudit.remainingIssues,0);assert.equal(result.contentAudit.initialIssues,2);
  assert.equal(chapter.text,'讨论函数的有界性需要指定区间。');
});
test('unfinished or cancelled content checks preserve the original draft without claiming completeness',async()=>{
  const lesson={notes:{sections:evidence.sections}};
  const result=await auditEditionContent({chapters:[chapter],warnings:[]},lesson,{sourceFor:()=>evidence,request:async()=>{throw new Error('offline');}});
  assert.equal(result.chapters[0].text,chapter.text);assert.equal(result.contentAudit.notChecked,1);assert.match(result.warnings[0],/未完成/);
  const controller=new AbortController();controller.abort();await assert.rejects(auditEditionContent({chapters:[chapter]},lesson,{signal:controller.signal}));
});
test('long speech and board text reach recompile unchanged, including their final conditions',()=>{
  const text='原课完整推导。'.repeat(800)+'末尾条件x不等于零';
  const sections=Array.from({length:50},(_,i)=>({id:'s'+i,title:'知识点',text:i?`片段${i}`:text,cueIds:['c'+i]}));
  const lesson={cues:sections.map((s,i)=>({id:'c'+i,text:i?`短句${i}`:text,start:i})),visualCues:[]};
  const result=completeChapterSource(lesson,sections);
  assert.equal(result.cues[0].text,text);assert.equal(result.sections[0].text,text);assert.ok(!result.cues[0].excerpt);
});

test('quality requests can reason and repair exact validation errors without forwarding secret output',async()=>{
  const requests=[];
  const result=await editorialRequest({baseUrl:'https://api.deepseek.com',model:'fixture',apiKey:'test-secret-only'},'Return JSON',{task:'quality'},value=>{
    if(!value.ok)throw Object.assign(new Error('缺少有效来源引文'),{status:502});return value;
  },{reasoning:true,fetchImpl:async(_url,options)=>{
    const payload=JSON.parse(options.body);requests.push(payload);
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({ok:requests.length>1})}}]}));
  }});
  assert.equal(result.ok,true);assert.equal(requests.length,2);
  assert.equal(requests[0].thinking.type,'enabled');assert.equal(requests[0].reasoning_effort,'high');
  assert.match(requests[1].messages.at(-1).content,/缺少有效来源引文/);
  assert.ok(!JSON.stringify(requests[1].messages).includes('test-secret-only'));
});

test('the production completeness option runs after whole-course rewriting and alignment',async()=>{
  const text='讨论函数的有界性需要指定区间。定义要求存在正数M，使区间内所有自变量对应的函数值绝对值不超过M。这个M可以放大，因此界不唯一。原课条件需要保留，讨论其他区间时应重新判断是否仍存在这样的M。';
  const lesson={id:'quality-integration',cues:[{id:'cue-1',text,start:0,end:10}],visualCues:[],notes:{mode:'ai',overview:[],sections:[{id:'s1',title:'有界性',text,cueIds:['cue-1']}],examples:[],warnings:[]}};
  const operations=[];
  const edition=await recompileLesson({baseUrl:'http://localhost/v1',model:'fixture'},lesson,{verifyContent:true,fetchImpl:async(_url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).messages[1].content);operations.push(input.operation||'editorial');
    const value=input.operation==='lecture-content-audit'?{checks:input.sections.map(s=>({id:s.id,status:'covered',noteQuote:'讨论函数的有界性需要指定区间',reason:'条件与界的性质已经保留。'})),findings:[]}
      :input.chapters?{checks:input.chapters.map(c=>({id:c.id,status:'ok',reason:'保留原课条件。'})),revisions:[]}
      :{text,takeaway:'先指定区间，再检查统一的界。',teacherExplanation:'',pitfalls:[]};
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}));
  }});
  assert.equal(operations.at(-1),'lecture-content-audit');assert.equal(edition.contentAudit.reviewed,1);assert.equal(edition.contentAudit.notChecked,0);
});
