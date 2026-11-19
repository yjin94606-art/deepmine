'use strict';
const fs=require('node:fs');
const path=require('node:path');
const readline=require('node:readline');
const crypto=require('node:crypto');
const {inScope,parseMetadata}=require('./collector.cjs');
const C=require('../dist/evidence-core.js');
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
function detectLanguage(text){
  const clean=String(text||'').replace(/```[\s\S]*?```/g,'').replace(/<[^>]*>[\s\S]*?<\/[^>]*>/g,'');
  if(/[\u3040-\u30ff]/.test(clean))return'ja';
  if((clean.match(/[\u3400-\u9fff]/g)||[]).length>=3)return'zh-CN';
  return /[a-zA-Z]{3}/.test(clean)?'en':null;
}
function messageText(payload){
  if(typeof payload.content==='string')return payload.content;
  if(!Array.isArray(payload.content))return '';
  return payload.content.filter(item=>['text','input_text','output_text'].includes(item.type)&&typeof item.text==='string').map(item=>item.text).join('\n');
}
function excerpt(text){
  // Preserve a visible excerpt, not a synthesized claim or a metaphor. Remove
  // fenced code and URLs before the bounded local journal receives it.
  return text.replace(/```[\s\S]*?```/g,'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/g,'').replace(/^\s*[#>*-]+\s*/gm,'').replace(/\n{3,}/g,'\n\n').trim().slice(0,500);
}
async function collectConversations({codexRoot,claudeRoot,scopePath,projectId,enabled=false,now=new Date(),timezone='Asia/Shanghai',historyDays=365,localeOnly=false}={}){
  if(!enabled&&!localeOnly)return{memories:[],locale:null,status:'disabled',notes:[]};
  const candidates=[],notes=new Set();let bytes=0,partial=false;
  async function scan(dir,source,depth=0){
    if(depth>9||candidates.length>=4000){partial=true;return;}
    let entries;try{entries=await fs.promises.readdir(dir,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT'){partial=true;notes.add('部分会话目录不可读。');}return;}
    for(const entry of entries){if(entry.isSymbolicLink())continue;const filename=path.join(dir,entry.name);if(entry.isDirectory())await scan(filename,source,depth+1);else if(entry.isFile()&&entry.name.endsWith('.jsonl')){const stat=await fs.promises.stat(filename).catch(()=>null);if(stat)candidates.push({filename,source,mtime:stat.mtimeMs,size:stat.size});}}
  }
  if(codexRoot){await scan(path.join(codexRoot,'sessions'),'codex');await scan(path.join(codexRoot,'archived_sessions'),'codex');}
  if(claudeRoot)await scan(path.join(claudeRoot,'projects'),'claude-code');
  candidates.sort((a,b)=>b.mtime-a.mtime);
  const memories=new Map(),users=[];
  const first=new Date(C.today(now,timezone)+'T12:00:00Z');first.setUTCDate(first.getUTCDate()+1-historyDays);
  const start=first.toISOString().slice(0,10);
  for(const file of candidates){
    if(bytes>128*1024*1024){partial=true;notes.add('对话记录达到本次扫描预算，稍后的记录可能未覆盖。');break;}
    const input=fs.createReadStream(file.filename,{encoding:'utf8'}),lines=readline.createInterface({input,crlfDelay:Infinity});
    let matched=false,sessionId=null,worker=/(?:^|[\\/])subagents[\\/]/.test(file.filename);
    try{
      for await(const line of lines){
        bytes+=Buffer.byteLength(line);if(line.length>1024*1024){partial=true;continue;}
        let row;try{row=JSON.parse(line);}catch{continue;}
        if(file.source==='codex'&&row.type==='session_meta'){
          const meta=parseMetadata(row,scopePath);
          matched=Boolean(meta&&!meta.excluded);sessionId=meta?.id;worker=meta?.kind==='worker';
          if(!matched)break;
          continue;
        }
        if(file.source==='codex' && row.type==='turn_context' && row.payload && Object.hasOwn(row.payload,'cwd')){
          matched=inScope(row.payload.cwd,scopePath);
          continue;
        }
        if(file.source==='claude-code'&&typeof row.cwd==='string'){
          if(!inScope(row.cwd,scopePath))break;
          matched=true;sessionId=row.sessionId;
        }
        if(!matched||!sessionId||!Number.isFinite(Date.parse(row.timestamp))||Date.parse(row.timestamp)>new Date(now).getTime())continue;
        const date=C.today(row.timestamp,timezone);if(date<start)continue;
        const payload=file.source==='codex'?(row.type==='response_item'&&row.payload?.type==='message'?row.payload:null):(['user','assistant'].includes(row.type)?row.message:null);
        if(!payload)continue;
        const role=payload.role||row.type,text=messageText(payload);
        if(!text)continue;
        if(role==='user'&&!worker&&!row.isSidechain&&!/^\s*<(?:environment_context|permissions|system|developer|send_user_message_question_reply)/.test(text)){
          const locale=detectLanguage(text);if(locale)users.push({timestamp:row.timestamp,locale});
        }
        if(!enabled||role!=='assistant'||worker||row.isSidechain)continue;
        const summary=excerpt(text);if(summary.length<30)continue;
        const marked=/\[\[DEEPMINE_MEMORY\]\]/.test(text);
        // Codex final replies and explicitly marked notes are actual conversation
        // memories. Claude messages need a marker; intermediate tool prose is skipped.
        if(!marked&&!(file.source==='codex'&&(payload.channel==='final'||payload.phase==='final_answer')))continue;
        const sourceRef=String(payload.id||row.uuid||sessionId+':'+row.timestamp).slice(0,240);
        const id='memory:'+hash(projectId+'\0'+file.source+'\0'+sessionId+'\0'+summary);
        const existing=memories.get(id);if(existing&&Date.parse(existing.timestamp)<=Date.parse(row.timestamp))continue;
        memories.set(id,{id,projectId,sourceId:file.source,timestamp:new Date(row.timestamp).toISOString(),sourceRef,title:summary.replace(/\[\[DEEPMINE_MEMORY\]\]/g,'').split(/[\n。.!！?？]/)[0].trim().slice(0,100)||'Conversation note',summary:summary.replace(/\[\[DEEPMINE_MEMORY\]\]/g,'').trim(),method:'conversation-excerpt',objectType:'memory'});
      }
    }catch{partial=true;notes.add('写入中的会话将在下一轮重新读取。');}finally{lines.close();input.destroy();}
  }
  users.sort((a,b)=>b.timestamp.localeCompare(a.timestamp));
  // Bounded per day: these are quoted memories, never a fabricated completion.
  const counts=new Map(),selected=[...memories.values()].sort((a,b)=>b.timestamp.localeCompare(a.timestamp)).filter(item=>{const date=C.today(item.timestamp,timezone),n=counts.get(date)||0;counts.set(date,n+1);return n<3;});
  return{memories:selected,locale:users[0]?.locale||null,status:partial?'partial':'connected',notes:[...notes]};
}
module.exports={collectConversations,detectLanguage,messageText,excerpt};
