'use strict';
const path=require('node:path');
const {createHash}=require('node:crypto');
const {parseMetadata,inScope}=require('./collector.cjs');
const {canonical}=require('./source-adapters.cjs');
const {publicPath}=require('./work-content.cjs');

// A delivery identifies the linked project path in an assistant's final response.
// It does not assert that a tool produced the bytes. Never open a chat-supplied path.
function createDeliveryIndex({projectPath,scopePath,codexRoot,claudeRoot,historyDays,memoriesEnabled=false},
    {candidates,rows,quote,asTime}) {
  const project=canonical(projectPath),paths=/^(?:[a-z]:\/|\/\/)/i.test(project)?path.win32:path.posix;
  const logs=new Map();
  const maxSize=128*1024*1024;
  const related=cwd=>inScope(cwd,scopePath)&&(inScope(cwd,projectPath)||inScope(projectPath,cwd));
  function linkedFiles(text,cwd) {
    if(typeof text!=='string'||text.length>80000)return [];
    const found=new Map();
    for(const m of text.matchAll(/\[([^\]\r\n]{1,160})\]\((?:<([^>\r\n]+)>|([^()\r\n]+))\)/g)){
      let name=m[2]||m[3];
      // Markdown absolute Windows targets sometimes use a leading slash.
      try{name=decodeURIComponent(name);}catch{continue;}
      if(paths===path.win32)name=name.replace(/^\/(?=[a-z]:[\\/])/i,'');
      if(/^[a-z][a-z\d+.-]+:|[?#\x00-\x1f]|^[/\\]{2}/i.test(name))continue;
      const full=canonical(paths.resolve(cwd,name));
      if(!inScope(full,project))continue;
      const rel=paths.relative(project,full).split(paths.sep).join('/');
      if(!publicPath(rel))continue;
      const label=memoriesEnabled&&quote(m[1],'local')?.request;
      found.set(full,label||undefined);
      if(found.size>=32)break;
    }return found;
  }
  function parser(file){
    const state={requests:new Map(),links:[],offset:{offset:0,skipping:false},ino:file.stat.ino,dev:file.stat.dev};
    let session,cwd,worker,parent,turn,first,claudeParents=new Map();
    function note(text,at,id){
      if(!turn||!session||!related(cwd)||!at)return;
      for(const [full,label] of linkedFiles(text,cwd)){
        state.links.push({full,label,at,start:turn.start,session,turn:turn.id,root:turn.root,parent,worker,
          sourceId:file.source,sourceRef:'delivery:'+createHash('sha256').update(JSON.stringify([file.source,session,turn.id,id,full])).digest('hex')});
      }
      if(state.links.length>2048)state.links.splice(0,state.links.length-2048);
    }
    state.read=row=>{
      const p=row.payload||{},at=asTime(row.timestamp);
      if(file.source==='claude-code'){
        if(!at||row.isSidechain||row.isMeta||/[\\/]subagents[\\/]/.test(file.filename))return;
        if(!row.sessionId||!row.cwd||!related(row.cwd))return;
        if(session && session!==row.sessionId)return;
        session=row.sessionId;state.session=session;cwd=row.cwd;
        const content=row.message?.content,blocks=Array.isArray(content)?content:[];
        let ancestor=claudeParents.get(row.parentUuid);
        if(row.type==='user'&&row.uuid&&!blocks.some(b=>b.type==='tool_result')){
          ancestor={id:row.uuid,start:at};
          if(memoriesEnabled){const request=quote(content,at);if(request)state.requests.set(ancestor.id,request);}
        }
        if(row.uuid&&ancestor)claudeParents.set(row.uuid,ancestor);
        if(claudeParents.size>4096)claudeParents.delete(claudeParents.keys().next().value);
        if(row.type==='assistant'&&ancestor&&row.message?.stop_reason==='end_turn'&&!blocks.some(b=>b.type==='tool_use')){
          turn=ancestor;note(blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n'),at,row.uuid);
        }return;
      }
      if(row.type==='session_meta'){
        if(session){
          // Worker transcripts include a copied parent prefix. A native child
          // turn carrying this worker's parent-turn attribution resumes the stream.
          if(!worker || p.id!==parent)return 'stop';
          turn=null;return;
        }
        const meta=parseMetadata(row,scopePath);
        if(!meta||meta.excluded)return 'stop';
        session=meta.id;state.session=session;cwd=p.cwd;first=p.timestamp||at;
        worker=meta.kind==='worker'; parent=worker?p.source.subagent.thread_spawn.parent_thread_id:null;
        return;
      }
      if(!session||!at)return;
      if(row.type==='event_msg'&&p.type==='task_started'){
        const origin=p.turn_attribution,root=p.root_turn_id||origin?.root_turn_id;
        const start=Number.isFinite(p.started_at)?new Date(p.started_at*1000).toISOString():at;
        turn=p.turn_id?{id:p.turn_id,start,root}:null;
        if(worker && (!origin?.parent_turn_id||origin.parent_turn_id!==root||!root||root===turn?.id||Date.parse(start)+1000<Date.parse(first)))turn=null;
        return;
      }
      if(row.type==='turn_context'){
        if(!worker && !turn && p.turn_id)turn={id:p.turn_id,start:at};
        if(p.turn_id!==turn?.id){turn=null;return;}
        cwd=p.cwd||cwd; return;
      }
      if(!turn||!related(cwd)||p.thread_id&&p.thread_id!==session)return;
      const eventTurn=p.internal_chat_message_metadata_passthrough?.turn_id||p.turn_id;
      if(eventTurn&&eventTurn!==turn.id)return;
      if(row.type==='event_msg'&&['thread_rolled_back','conversation_rolled_back'].includes(p.type)){
        state.links=[];state.requests.clear();turn=null;return;
      }
      if(row.type!=='response_item'||p.type!=='message')return;
      if(!worker&&p.role==='user'&&memoriesEnabled){
        const words=Array.isArray(p.content)?p.content.filter(b=>b.type==='input_text').map(b=>b.text):[p.content];
        if(!words.some(s=>typeof s==='string'&&s.trim()&&!/^\s*(?:<|# AGENTS\.md instructions)/i.test(s)))return;
        const request=quote(p.content,at),prior=state.requests.get(turn.id);
        // Multiple distinct instructions in one turn cannot be assigned to a single link.
        state.requests.set(turn.id,request && (prior===undefined||prior?.request===request.request)?request:null);
      }
      if(p.role==='assistant' && Array.isArray(p.content) && (p.phase==='final_answer'||p.channel==='final'))
        note(p.content.filter(b=>b.type==='output_text'||b.type==='text').map(b=>b.text).join('\n'),at,p.id||at);
    };
    return state;
  }
  return async function attach(snapshot){
    if(!snapshot.outputs?.length||(!codexRoot&&!claudeRoot))return snapshot;
    const end=Date.parse(snapshot.collectedAt),cutoff=end-((historyDays||365)+1)*86400000;
    const files=await candidates(codexRoot,claudeRoot,cutoff),budget={remaining:maxSize};
    // Remember only bounded in-project deliveries and small optional excerpts.
    const current=new Set(files.map(f=>f.filename));
    for(const key of logs.keys())if(!current.has(key))logs.delete(key);
    const requests=new Map(),links=[];
    for(const file of files){
      let s=logs.get(file.filename);
      if(!s||s.ino!==file.stat.ino||s.dev!==file.stat.dev||s.size>file.stat.size||
          (s.size===file.stat.size&&s.mtime!==file.stat.mtimeMs)){
        s=parser(file);logs.set(file.filename,s);
      }
      s.size=file.stat.size;s.mtime=file.stat.mtimeMs;
      if(!s.stopped && budget.remaining>0){
        try{
          for await(const {row} of rows(file.filename,budget,s.offset,s.size,192*1024)){
            if(s.read(row)==='stop'){s.stopped=true;break;}
            if(s.requests.size>4096)s.requests.delete(s.requests.keys().next().value);
          }
        }catch{logs.delete(file.filename);continue;}
      }
      if(s.session)for(const [id,request] of s.requests)requests.set(s.session+'|'+id,request);
      links.push(...s.links);
    }
    const byPath=new Map();
    for(const o of snapshot.outputs)for(const path of o.files){
      if(!publicPath(path)||!/^[a-f0-9]{64}$/.test(o.fingerprint)||o.sourceId!=='local-files')continue;
      const key=canonical(paths.resolve(projectPath,path));
      if(!byPath.has(key))byPath.set(key,[]);
      byPath.get(key).push({o,path});
    }
    for(const link of links.sort((a,b)=>a.at.localeCompare(b.at))){
      if(Date.parse(link.at)>end)continue;
      const versions=byPath.get(link.full)?.filter(({o})=>Date.parse(o.timestamp)>=Date.parse(link.start)&&Date.parse(o.timestamp)<=Date.parse(link.at));
      if(!versions?.length)continue;
      const latest=versions.reduce((a,b)=>Date.parse(a.o.timestamp)>Date.parse(b.o.timestamp)?a:b);
      if(versions.some(v=>Date.parse(v.o.timestamp)===Date.parse(latest.o.timestamp)&&v.o.fingerprint!==latest.o.fingerprint))continue;
      const {o,path}=latest;
      if(o.deliveries?.some(d=>d.path===path))continue;
      const request=memoriesEnabled&&requests.get(link.worker?link.parent+'|'+link.root:link.session+'|'+link.turn);
      const d={path,sourceId:link.sourceId,sourceRef:link.sourceRef,deliveredAt:link.at};
      if(link.label)d.label=link.label;
      if(request&&request.requestedAt<=link.at)Object.assign(d,request);
      (o.deliveries||=[]).push(d);
    }
    return snapshot;
  };
}
module.exports={createDeliveryIndex};
