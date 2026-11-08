import fs from 'node:fs/promises';
import path from 'node:path';
import {createLessonVision} from '../server/lesson-vision.mjs';
if(!process.argv.includes('--live'))throw new Error('Use --live to fetch the already imported public lecture.');
const source=JSON.parse(await fs.readFile('data/lessons.json','utf8')).lessons.find(l=>l.url?.startsWith('https://www.bilibili.com/video/'));
if(!source)throw new Error('No imported public lecture.');
const root=path.resolve('test-results/lecture-content-quality/capture');await fs.mkdir(root,{recursive:true});
const vision=createLessonVision({dataDir:root});
const result=await vision.capture({...source,id:'isolated-capture-quality'},{signal:AbortSignal.timeout(8*60*1000)});
const report={durationSeconds:result.coverage.durationSeconds,previousFrames:source.visual?.frames.length,previousMaxGapSeconds:source.visual?.coverage.maxGapSeconds,
  sampledFrameCount:result.frames.length,maxGapSeconds:result.coverage.maxGapSeconds,candidateCount:result.coverage.candidateCount,complete:false,recognitionPerformed:false,originalLessonChanged:false};
await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
