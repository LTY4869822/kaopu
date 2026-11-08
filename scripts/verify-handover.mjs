import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';import JSZip from 'jszip';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
const archive=path.resolve(process.argv.find(v=>v.endsWith('.zip'))||path.join(root,'output',`kaopu-handover-${date}.zip`));
const bytes=await fs.readFile(archive),sha=createHash('sha256').update(bytes).digest('hex');
assert.equal((await fs.readFile(`${archive}.sha256`,'utf8')).split(/\s+/)[0],sha,'Archive SHA-256 mismatch');
const zip=await JSZip.loadAsync(bytes), manifestName=Object.keys(zip.files).find(p=>p.endsWith('/BUILD_MANIFEST.json'));assert.ok(manifestName);
const manifest=JSON.parse(await zip.file(manifestName).async('string')),prefix=`${manifest.packageRoot}/`;let total=0;
for(const entry of Object.values(zip.files)){
  assert.ok(entry.name.startsWith(prefix));assert.ok(!entry.name.split('/').includes('..'));assert.ok(!entry.name.includes('\\'));
  assert.ok(!/(?:^|\/)(?:data|node_modules|\.git|\.local|\.venv-docling|test-results)\//.test(entry.name));
  assert.ok(!/(?:^|\/)(?:auth\.json|state\.json|model-service\.json|\.env)$/.test(entry.name));
  assert.notEqual(Number(entry.unixPermissions)&0xf000,0xa000,'Symbolic links are not extracted');
}
for(const file of manifest.files){const entry=zip.file(prefix+file.path);assert.ok(entry,file.path);const data=await entry.async('nodebuffer');total+=data.length;assert.equal(data.length,file.bytes,file.path);assert.equal(createHash('sha256').update(data).digest('hex'),file.sha256,file.path);}
let projectDir,tempDir;
if(process.argv.includes('--extract')){
  tempDir=await fs.mkdtemp(path.join(os.tmpdir(),'shifen-handover-check-'));projectDir=path.join(tempDir,manifest.packageRoot);
  assert.equal(path.dirname(path.resolve(tempDir)),path.resolve(os.tmpdir()));
  for(const entry of Object.values(zip.files)){if(entry.dir)continue;const target=path.resolve(tempDir,entry.name);assert.ok(target.startsWith(path.resolve(tempDir)+path.sep));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,await entry.async('nodebuffer'));}
  const local=path.join(root,'.local/deep-audit');await fs.mkdir(local,{recursive:true});await fs.writeFile(path.join(local,'clean-room.json'),JSON.stringify({archive,tempDir,projectDir,sourceDigest:manifest.sourceDigest},null,2));
}
console.log(JSON.stringify({passed:true,files:manifest.files.length,totalBytes:total,sha256:sha,sourceDigest:manifest.sourceDigest,...(projectDir?{projectDir}:{})}));
