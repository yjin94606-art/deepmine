'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const fingerprintCache = new Map();
const LEGACY_FILE_NOTE='已在配置的输出目录观察到此文件；日期取文件修改时间，未核验作者、生成工具或完成状态。';
const {captureContent}=require('./work-content.cjs');
const C=require('../dist/evidence-core.js');
const EXCLUDED = new Set(['node_modules','vendor','__pycache__','coverage']);
function within(root, candidate) { const rel = path.relative(root, candidate); return rel === '' || (!rel.startsWith('..'+path.sep) && rel !== '..' && !path.isAbsolute(rel)); }
function identity(projectPath) { const canonical = path.resolve(projectPath).replace(/\\/g,'/').replace(/\/+$/,''); return crypto.createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex').slice(0,16); }
async function collectFiles(options = {}) {
  const outputDirs = options.outputDirs || [];
  if (!Array.isArray(outputDirs) || outputDirs.length > 16 || outputDirs.some(dir => typeof dir !== 'string')) throw new TypeError('outputDirs must contain up to 16 project directories');
  if (!outputDirs.length) return { outputs: [], status: 'disabled', notes: ['尚未配置输出目录；不会扫描整台电脑。'] };
  const projectPath = path.resolve(options.projectPath), projectId = options.projectId || identity(projectPath);
  const now = new Date(options.now || Date.now()); if (!Number.isFinite(now.getTime())) throw new TypeError('Invalid collection time');
  const today = C.today(now,options.timezone), start = new Date(today+'T12:00:00Z'); start.setUTCDate(start.getUTCDate()+1-(options.historyDays||14)); const first = start.toISOString().slice(0,10);
  const outputs = [], seen = new Set(), notes = new Set(); let budget = 2*1024*1024*1024, visited = 0, partial = false, validRoots = 0;
  let realProject; try { realProject = await fs.realpath(projectPath); } catch { return {outputs:[],status:'error',notes:['项目目录不可读。']}; }
  const privateRoot=options.dataDirectory && await fs.realpath(options.dataDirectory).catch(()=>path.resolve(options.dataDirectory));
  function limited(message) { partial = true; notes.add(message); }
  async function visit(directory, depth, selectedRoot) {
    if(privateRoot && within(privateRoot,directory))return;
    if (depth > 8) { limited('输出目录层级超出扫描限制。'); return; }
    let entries; try { entries = await fs.readdir(directory,{withFileTypes:true}); } catch { limited('部分输出目录不可读。'); return; }
    entries.sort((a,b)=>a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (++visited > 5000 || outputs.length >= 500) { limited('输出文件数量达到本次扫描上限。'); return; }
      if (entry.name.startsWith('.') || EXCLUDED.has(entry.name) || /(?:credentials?|secrets?|api[_-]?keys?|auth[_-]?tokens?)/i.test(entry.name) || entry.isSymbolicLink()) continue;
      const file = path.join(directory,entry.name);
      if (entry.isDirectory()) { await visit(file,depth+1,selectedRoot); continue; }
      const extension=path.extname(entry.name).slice(1).toLowerCase();
      if(['pem','key','p12','pfx','kdbx'].includes(extension))continue;
      const type = C.classify(entry.name); if (!entry.isFile()) continue;
      let real, stat; try { real = await fs.realpath(file); stat = await fs.lstat(file); } catch { limited('部分输出文件暂不可读。'); continue; }
      if (!within(selectedRoot,real) || stat.isSymbolicLink() || !stat.isFile() || seen.has(real)) continue;
      seen.add(real); const date = C.today(stat.mtime,options.timezone);
      // NTFS and the process clock can disagree by one Windows clock tick
      // immediately after a save. The record cannot be later than observation.
      if (date < first || date>today || stat.mtime.getTime() > now.getTime()+16) continue;
      const observedTime=new Date(Math.min(stat.mtime.getTime(),now.getTime())).toISOString();
      if (stat.size > 1024*1024*1024 || stat.size > budget) { limited('大型输出文件超出指纹读取预算，本次未收录。'); continue; }
      const signature=[stat.size,stat.mtimeMs,stat.ctimeMs,stat.ino].join(':');
      const cached=fingerprintCache.get(real);
      let fingerprint,description=null,read=0;
      if(cached?.signature===signature && stat.size>64*1024 && Date.now()-stat.ctimeMs>2000){fingerprint=cached.fingerprint;description=cached.description;read=stat.size;}
      else try{
        const hash=crypto.createHash('sha256'), excerpt=captureContent(entry.name,stat.size);
        const handle=await fs.open(real,'r');
        try{
          const opened=await handle.stat();
          if(!opened.isFile()||[opened.size,opened.mtimeMs,opened.ctimeMs,opened.ino].join(':')!==signature)throw new Error('File changed');
          for await(const chunk of handle.createReadStream({autoClose:false})){
            excerpt?.push(chunk);
            read+=chunk.length;if(read>stat.size||read>budget)throw new Error('File changed');
            hash.update(chunk);
          }
        }finally{await handle.close();}
        fingerprint=hash.digest('hex');
        description=cached?.fingerprint===fingerprint?cached.description:excerpt?.result() || null;
      }catch{limited('部分输出文件无法读取指纹，将重试。');continue;}
      budget-=read;
      const after=await fs.lstat(file).catch(()=>null);
      if(read!==stat.size||!after||after.isSymbolicLink()||[after.size,after.mtimeMs,after.ctimeMs,after.ino].join(':')!==signature){limited('写入中的输出文件将在下一次采集重试。');continue;}
      if(Date.now()-stat.ctimeMs>2000) fingerprintCache.set(real,{signature,fingerprint,description});
      else fingerprintCache.delete(real);
      if(fingerprintCache.size>2000)fingerprintCache.delete(fingerprintCache.keys().next().value);
      const relative = path.relative(projectPath,file).split(path.sep).join('/');
      const id = 'file:'+crypto.createHash('sha256').update(projectId+'\0'+relative+'\0'+fingerprint).digest('hex');
      outputs.push({id,projectId,sourceId:'local-files',timestamp:observedTime,type,title:description?.title||entry.name.slice(0,160),files:[relative],summary:description?.summary||LEGACY_FILE_NOTE,byteLength:stat.size,...(description?{contentVersion:1}:{}),fingerprint});
    }
  }
  for (const directory of outputDirs) {
    const candidate = path.resolve(projectPath,directory);
    if (!within(projectPath,candidate) || path.relative(projectPath,candidate).split(path.sep).some(part=>part.startsWith('.')&&part!=='')) { limited('输出目录须位于所选项目内且不能是隐藏目录。'); continue; }
    try { const stat=await fs.lstat(candidate), real=await fs.realpath(candidate); if (!stat.isDirectory()||stat.isSymbolicLink()||!within(realProject,real)) { limited('跳过符号链接或项目外输出目录。'); continue; } validRoots++; await visit(candidate,0,real); }
    catch { limited('配置的输出目录不存在或不可读。'); }
  }
  notes.add('扫描所选目录的文件、修改时间与内容指纹。作品介绍来自这个版本能读到的正文、功能、表头或媒体信息。');
  return { outputs:outputs.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)||a.id.localeCompare(b.id)), status:validRoots ? (partial?'partial':'connected') : 'missing', notes:[...notes] };
}
module.exports = {collectFiles,within,LEGACY_FILE_NOTE};
