import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
let queue = Promise.resolve();

/** Optional local pagination. The portable DOCX retains its native TOC fields. */
export async function paginateWord(bytes) {
  if (process.platform !== 'win32' || process.env.DOCUMENT_WORD_PAGINATION === 'off') return bytes;
  const installed = await Promise.all([process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(root => fs.access(path.join(root,'Microsoft Office/root/Office16/WINWORD.EXE')).then(()=>true,()=>false)));
  if (!installed.some(Boolean)) return bytes;
  const previous = queue; let release; queue = new Promise(resolve => { release = resolve; });
  await previous;
  let tempRoot, folder, pidFile;
  try {
    tempRoot = await fs.realpath(os.tmpdir());
    folder = await fs.mkdtemp(path.join(tempRoot,'shifen-word-page-'));
    const input = path.join(folder,'notes.docx'); pidFile = path.join(folder,'instance.pid');
    await fs.writeFile(input,bytes);
    await exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('../scripts/update-study-word.ps1',import.meta.url)),'-InputDocx',input,'-PidFile',pidFile,'-TempRoot',tempRoot],{windowsHide:true,timeout:45000,maxBuffer:4096});
    return await fs.readFile(input);
  } catch {
    // On timeout, terminate only the freshly created instance recorded by our helper.
    const pid = pidFile ? Number(await fs.readFile(pidFile,'utf8').catch(()=>'')) : 0;
    if (Number.isSafeInteger(pid) && pid > 0) {
      await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$taskProcess=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($taskProcess -and $taskProcess.ProcessName -eq 'WINWORD') { Stop-Process -Id ${pid} -Force }`],{windowsHide:true,timeout:5000,maxBuffer:1024}).catch(()=>{});
    }
    return bytes;
  } finally {
    if (folder && path.dirname(folder) === tempRoot && path.basename(folder).startsWith('shifen-word-page-')) await fs.rm(folder,{recursive:true,force:true,maxRetries:3}).catch(()=>{});
    release();
  }
}
