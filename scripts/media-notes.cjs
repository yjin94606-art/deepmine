'use strict';
const path = require('node:path').posix;
const diskPath = require('node:path');
const fs = require('node:fs/promises');
const {createHash} = require('node:crypto');
const execFile = require('node:util').promisify(require('node:child_process').execFile);
const {publicPath} = require('./work-content.cjs');
const {cleanExcerpt, decodeEntities} = require('./text-content.cjs');

const maxBytes = 96 * 1024;
const mediaFile = /\.(?:wav|mp3|m4a|flac|ogg|oga|opus|mp4|mov|m4v|webm|mkv)$/i;
function prose(raw) {
  const value = cleanExcerpt(decodeEntities(raw.replace(/<[^>]*>/g, ' ')), 400);
  if (!value || value.length < 8 || /^(?:下载|download\b|全长\s*\d|播放视频|点击播放)/i.test(value)) return '';
  return value;
}
function captionText(text) {
  const lines = [];
  for (const block of text.trim().split(/\r?\n[ \t]*\r?\n/)) {
    const rows = block.split(/\r?\n/);
    const time = rows.findIndex(line=>/^\s*(?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+(?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3}/.test(line));
    if (time < 0 || time > 1) continue;
    const cue = prose(rows.slice(time+1).join(' '));
    if (cue && !lines.includes(cue)) lines.push(cue);
    if (lines.length === 2) break;
  }
  return lines.join(' ').slice(0,360);
}
function linksHere(value, file) {
  try { return decodeURIComponent(decodeEntities(value)).replace(/^\.\//,'') === file; }
  catch { return false; }
}
function htmlNote(text,file) {
  // A section lead can describe its principal clip and that clip's language downloads.
  // Other figures in the section have their own captions.
  const visible = text.replace(/<!--[\s\S]*?(?:-->|$)|<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,'');
  for (const section of visible.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section\s*>/gi)) {
    const body=section[1], firstFigure=body.search(/<figure\b/i);
    for (const figure of body.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure\s*>/gi)) {
      const block=figure[1], player=block.match(/<(video|audio)\b[^>]*>/i);
      if (!player) continue;
      const caption=block.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption\s*>/i)?.[1] || '';
      const refs=[...block.matchAll(/<(?:video|audio|source)\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi),
        ...caption.matchAll(/<a\b[^>]*?\shref\s*=\s*["']([^"']+)["']/gi)];
      if (!refs.some(match=>linksHere(match[1],file))) continue;
      const lead=firstFigure===figure.index && [...body.slice(0,firstFigure).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].at(-1);
      const text=lead && prose(lead[1]);
      if (text) return text;
      const specific=prose(caption.replace(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi,'').replace(/[\s·|]+$/,''));
      if (specific) return specific;
    }
  }
  return '';
}
function markdownNote(text,file) {
  for(const line of text.split(/\r?\n/)) {
    const links=[...line.matchAll(/\[([^\]\n]*)\]\(([^()\s]+)\)/g)];
    if (links.length!==1 || !linksHere(links[0][2],file)) continue;
    const rest=line.replace(links[0][0],'').replace(/^[\s*\-|:：]+|[\s|]+$/g,'');
    if(rest.length>=12 && !rest.includes('|')) { const note=prose(rest); if(note)return note; }
  }
  return '';
}
async function mediaNote(file, read) {
  if (!mediaFile.test(file)) return null;
  const filename=path.basename(file), stem=filename.slice(0,-path.extname(filename).length), dir=path.dirname(file);
  for (const sibling of [stem+'.vtt',stem+'.srt','index.html','README.md']) {
    const relative=path.join(dir,sibling),bytes=await read(relative,maxBytes);
    if (!bytes || bytes.length>maxBytes) continue;
    let text;
    try { text=new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { continue; }
    const summary=/\.(srt|vtt)$/i.test(sibling)?captionText(text):sibling==='index.html'?htmlNote(text,filename):markdownNote(text,filename);
    if (summary) return {summary,contextSource:relative};
  }
  return null;
}
async function readWorkCompanion(name,maximum,{projectPath,allowed,outputs,commit},asOf) {
  // A Git item reads its companion at the same commit. A live item can only
  // use a currently readable companion whose bytes were observed in this project.
  if (!allowed.has(name) || !publicPath(name))return null;
  try {
    if (commit) {
      const options={cwd:projectPath,timeout:3500,windowsHide:true},spec=commit+':./'+name;
      const size=Number((await execFile('git',['cat-file','-s',spec],options)).stdout.trim());
      if(!Number.isSafeInteger(size)||size<1||size>maximum)return null;
      return (await execFile('git',['cat-file','blob',spec],{...options,encoding:'buffer',maxBuffer:maximum})).stdout;
    }
    let versions=outputs.filter(o=>o.files.includes(name) && o.fingerprint);
    if(asOf){
      const cutoff=Date.parse(asOf);
      versions=versions.filter(o=>o.sourceId==='local-files' && Date.parse(o.timestamp)<=cutoff);
      const latest=versions.reduce((n,o)=>Math.max(n,Date.parse(o.timestamp)),-Infinity);
      versions=versions.filter(o=>Date.parse(o.timestamp)===latest);
      if(new Set(versions.map(o=>o.fingerprint)).size!==1)return null;
    }
    if (!versions.length)return null;
    const root=await fs.realpath(projectPath),real=await fs.realpath(diskPath.resolve(root,name)),rel=diskPath.relative(root,real);
    if(!rel||rel==='..'||rel.startsWith('..'+diskPath.sep)||diskPath.isAbsolute(rel)||!publicPath(rel.split(diskPath.sep).join('/')))return null;
    const handle=await fs.open(real,'r');
    try {
      const stat=await handle.stat();
      if(!stat.isFile() || stat.size<1 || stat.size>maximum)return null;
      const buffer=Buffer.alloc(stat.size+1);
      const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
      if(bytesRead!==stat.size)return null;
      const bytes=buffer.subarray(0,bytesRead),hash=createHash('sha256').update(bytes).digest('hex');
      return versions.some(o=>o.fingerprint===hash)?bytes:null;
    } finally {await handle.close();}
  } catch {return null;}
}
function projectMediaNote(file,context) {
  return mediaNote(file,(name,maximum)=>readWorkCompanion(name,maximum,context));
}
module.exports={projectMediaNote,mediaFile,readWorkCompanion};
