import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
const prefix=`shifen-handover-${date}`, zip=new JSZip(), manifest=[], names=new Set();
const hash=data=>createHash('sha256').update(data).digest('hex');
const deny=new Set(['.git','.local','.venv-docling','node_modules','data','output','test-results','__pycache__','.impeccable']);
const privateNames=new Set(['auth.json','state.json','model-service.json']);
const secrets=new Set();
// Check locally stored credentials in memory; never print or include them.
try { const profile=JSON.parse(await fs.readFile(path.join(root,'data/model-service.json'),'utf8'));
  const scan=value=>{if(!value||typeof value!=='object')return;for(const[k,v]of Object.entries(value))if(/api.?key|token|secret/i.test(k)&&typeof v==='string'&&v.length>=12)secrets.add(v);else if(typeof v==='object')scan(v);};scan(profile);
}catch(error){if(error.code!=='ENOENT')throw error;}
try { const env=await fs.readFile(path.join(root,'.env'),'utf8');for(const match of env.matchAll(/^\s*[A-Z_]*(?:API_KEY|TOKEN|SECRET)\s*=\s*(.+)\s*$/gm)){const value=match[1].trim().replace(/^['"]|['"]$/g,'');if(value.length>=12)secrets.add(value);} }catch(error){if(error.code!=='ENOENT')throw error;}
function add(relative,data) {
  if(names.has(relative))throw new Error(`Duplicate package path: ${relative}`);
  const bytes=Buffer.isBuffer(data)?data:Buffer.from(data);
  for(const secret of secrets)if(bytes.includes(Buffer.from(secret)))throw new Error(`Private credential detected; package stopped: ${relative}`);
  zip.file(`${prefix}/${relative}`,bytes);names.add(relative);manifest.push({path:relative,bytes:bytes.length,sha256:hash(bytes)});
}
async function include(relative) {
  const parts=relative.split(/[\\/]/);if(parts.some(p=>deny.has(p))||privateNames.has(parts.at(-1))||(/\.env/.test(parts.at(-1))&&relative!=='.env.example')||/\.(pyc|log|zip|tsbuildinfo)$/i.test(relative))return;
  if(relative.startsWith('scripts/deep-'))return; // Local audit probes are not product entry points.
  const absolute=path.resolve(root,relative);if(!absolute.startsWith(root+path.sep))throw new Error('Package path escaped root');
  const stat=await fs.lstat(absolute);if(stat.isSymbolicLink())throw new Error(`Symbolic link omitted by policy: ${relative}`);
  if(stat.isDirectory()){for(const name of(await fs.readdir(absolute)).sort())await include(`${relative}/${name}`);return;}
  if(stat.isFile())add(relative,await fs.readFile(absolute));
}
for (const directory of ['src','server','public','tests','scripts','dist','vendor'])await include(directory);
for(const name of ['package.json','package-lock.json','requirements-local.txt','requirements-docling.txt','tsconfig.json','vite.config.ts','index.html','.env.example','.gitignore','README.md','HANDOVER.md','PRODUCT.md','DESIGN.md','THIRD_PARTY_NOTICES.md'])await include(name);
for(const name of(await fs.readdir(path.join(root,'docs'))).sort())if(name.endsWith('.md'))await include(`docs/${name}`);
await include('docs/handover');
// Include exact installed dependency metadata and available license/notice texts.
const lock=JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8')), dependencies=[], copied=new Set();
for(const[location,item]of Object.entries(lock.packages||{}).sort(([a],[b])=>a.localeCompare(b))){
  if(!location.startsWith('node_modules/'))continue;
  const absolute=path.resolve(root,location);if(!absolute.startsWith(path.join(root,'node_modules')+path.sep))throw new Error('Invalid lock package path');
  let metadata;try{metadata=JSON.parse(await fs.readFile(path.join(absolute,'package.json'),'utf8'));}catch{continue;} // Other OS optional packages are not installed.
  const id=`${metadata.name}@${metadata.version}`, licenseFiles=[];
  if(!copied.has(id)){
    copied.add(id);const label=id.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,95)+'-'+hash(id).slice(0,8);
    for(const name of(await fs.readdir(absolute)).filter(n=>/^(?:licen[cs]e|notice|copying|copyright)(?:[._-]|$)/i.test(n)).sort()){
      const file=path.join(absolute,name);if(!(await fs.lstat(file)).isFile())continue;
      const target=`DEPENDENCY_LICENSES/${label}/${name}`;add(target,await fs.readFile(file));licenseFiles.push(target);
    }
  }
  dependencies.push({name:metadata.name,version:metadata.version,license:metadata.license||item.license||null,location,dev:!!item.dev,optional:!!item.optional,licenseFiles});
}
add('DEPENDENCIES.json',JSON.stringify({lockfileVersion:lock.lockfileVersion,description:'Installed packages from the lockfile; optional packages for other operating systems remain specified in package-lock.json. This is an inventory, not legal approval.',packages:dependencies},null,2));
add('DEPENDENCY_LICENSES/README.md','# Dependency notices\n\nAvailable license, notice, copyright and copying files from installed npm packages are retained here. See DEPENDENCIES.json and package-lock.json for versions and optional platform packages. Python packages, model weights and external course content have separate licensing obligations.\n');
if(!manifest.some(f=>/dist\/assets\/pdf\.worker.*\.mjs$/.test(f.path)))throw new Error('PDF.js worker missing; run npm run build first');
for(const required of ['dist/index.html','HANDOVER.md','public/licenses/pdfjs-LICENSE.txt','public/licenses/galaxy-MIT.txt','vendor/ffmpeg/win32-x64/ffmpeg.exe.gz','vendor/ffmpeg/win32-x64/LICENSE.txt'])if(!names.has(required))throw new Error(`Required handover file missing: ${required}`);
const sourceFiles=manifest.filter(file=>/^(?:src\/|server\/|public\/|tests\/|scripts\/|package(?:-lock)?\.json$|tsconfig\.json$|vite\.config\.ts$|index\.html$|requirements-)/.test(file.path)).sort((a,b)=>a.path.localeCompare(b.path));
const sourceDigest=hash(JSON.stringify(sourceFiles.map(file=>[file.path,file.sha256])));
zip.file(`${prefix}/BUILD_MANIFEST.json`,JSON.stringify({createdAt:new Date().toISOString(),packageRoot:prefix,format:'source-and-production-build',sourceDigest,privateCredentialCheck:'passed',exclusions:[...deny,'.env','private runtime JSON','external research downloads','historical test outputs','local audit probes'],files:manifest},null,2));
const output=path.join(root,'output');await fs.mkdir(output,{recursive:true});
const target=path.join(output,`${prefix}.zip`),bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});
await fs.writeFile(target,bytes);await fs.writeFile(`${target}.sha256`,`${hash(bytes)}  ${path.basename(target)}\n`);
console.log(JSON.stringify({archive:target,root:prefix,files:manifest.length,bytes:bytes.length,sha256:hash(bytes),privateCredentialCheck:'passed'}));
