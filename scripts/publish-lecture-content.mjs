import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {editorialFingerprint} from '../server/lesson-editorial-state.mjs';
import {completeChapterSource} from '../server/lesson-editorial.mjs';
import {validateContentAudit} from '../server/lesson-completeness.mjs';
if(!process.argv.includes('--publish'))throw new Error('Use --publish after reviewing the generated lecture.');
const output=path.resolve('test-results/lecture-content-quality'),file=path.resolve('data/lessons.json');
const edition=JSON.parse(await fs.readFile(path.join(output,'edition.json'),'utf8'));
const baseline=JSON.parse(await fs.readFile(path.join(output,'before-edition.json'),'utf8'));
if(edition.contentAudit?.notChecked!==0)throw new Error('Some content checks are unfinished.');
const before=await fs.readFile(file),saved=JSON.parse(before),lesson=saved.lessons.find(l=>editorialFingerprint(l)===edition.fingerprint);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
if(!lesson||hash(lesson.notes.editorial)!==hash(baseline))throw new Error('Source or edition changed; preserved newer user data.');
const sections=new Map(lesson.notes.sections.map(section=>[section.id,section]));
for(const chapter of edition.chapters){
  validateContentAudit(chapter.contentAudit,chapter,completeChapterSource(lesson,chapter.sourceSectionIds.map(id=>sections.get(id))));
  if(chapter.contentAudit.textHash!==createHash('sha256').update(chapter.text).digest('hex'))throw new Error('Chapter changed after review.');
}
const backups=path.resolve('data/backups');await fs.mkdir(backups,{recursive:true});
await fs.writeFile(path.join(backups,`lesson-content-${Date.now()}.json`),before,{flag:'wx'});
if(!(await fs.readFile(file)).equals(before))throw new Error('Lecture changed during backup; no overwrite.');
lesson.notes.editorial=edition;lesson.updatedAt=new Date().toISOString();
const tmp=file+'.quality-update.tmp';await fs.writeFile(tmp,JSON.stringify(saved,null,2));await fs.rename(tmp,file);
console.log(JSON.stringify({published:true,lessonId:lesson.id,sourceUnchanged:true,backupCreated:true,remainingIssues:edition.contentAudit.remainingIssues}));
