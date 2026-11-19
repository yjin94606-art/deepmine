'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {normalizeEvent}=require('./event-ingest.cjs');
const A=require('./source-adapters.cjs');
function createEventStore({directory,projectPath,projectId,now=()=>new Date(),allowTraceRequests=false}){
  const filename=path.join(directory,projectId+'.ndjson'),records=new Map(),notes=[];let loaded=false,queue=Promise.resolve(),tail=false;
  const provider=event=>event.kind==='usage'&&/^api-(openai|anthropic|gemini)(?:-|$)/.exec(event.source)?.[1];
  const recordKey=event=>(provider(event)?'api:'+provider(event):event.source)+'/'+event.id;
  const fingerprint=event=>crypto.createHash('sha256').update(JSON.stringify(provider(event)?{projectId:event.projectId,usage:event.usage}:event)).digest('hex');
  async function load(){
    if(loaded)return;
    try{const stat=await fs.stat(filename);if(stat.size>128*1024*1024)throw new Error('Event journal exceeds supported size');const text=await fs.readFile(filename,'utf8');tail=Boolean(text&&!text.endsWith('\n'));const lines=text.split('\n');
      for(let i=0;i<lines.length;i++){if(!lines[i])continue;let raw;try{raw=JSON.parse(lines[i]);}catch{
          if(i===lines.length-1&&tail){
            const suffix=Date.now()+'-'+crypto.randomBytes(4).toString('hex'),quarantine=filename+'.partial-'+suffix+'.bak',temporary=filename+'.repair-'+suffix+'.tmp';
            await fs.writeFile(quarantine,text,{encoding:'utf8',flag:'wx',mode:0o600});
            const prefix=lines.slice(0,i).join('\n');
            try{await fs.writeFile(temporary,prefix?(prefix+'\n'):'',{encoding:'utf8',flag:'wx',mode:0o600});await fs.rename(temporary,filename);}catch(error){await fs.unlink(temporary).catch(()=>{});throw error;}
            tail=false;notes.push('事件日志写入中断的末行已隔离保存，完整事件已恢复；未推测缺失事件。');continue;
          }
          throw new Error('Event journal corrupt; source preserved');
        }
        const event=normalizeEvent({...raw,projectPath},{projectPath,projectId,now:now(),allowTraceRequests:true});const key=recordKey(event),old=records.get(key);
        if(old&&fingerprint(old)!==fingerprint(event))throw new Error('Event journal has conflicting ids');if(!old)records.set(key,event);
      }
    }catch(error){if(error.code!=='ENOENT')throw error;}loaded=true;
  }
  function enqueue(work){const result=queue.then(work);queue=result.catch(()=>{});return result;}
  async function append(event){return enqueue(async()=>{
    await load();event=normalizeEvent({...event,projectPath},{projectPath,projectId,now:now(),allowTraceRequests});const key=recordKey(event),old=records.get(key);
    if(old){
      const compareOld = old.output?.receipt && (!old.output.receipt.request || !event.output?.receipt?.request)
        ? normalizeEvent({...old,projectPath},{projectPath,projectId,now:now()}) : old;
      const compareEvent = event.output?.receipt && (!old.output?.receipt?.request || !event.output.receipt.request)
        ? normalizeEvent({...event,projectPath},{projectPath,projectId,now:now()}) : event;
      if(fingerprint(compareOld)!==fingerprint(compareEvent))throw new Error('Event id conflict');return{duplicate:true};
    }
    if(records.size>=50000)throw new Error('Event journal capacity reached');
    await fs.mkdir(directory,{recursive:true});const file=await fs.open(filename,'a',0o600);
    try{await file.writeFile((tail?'\n':'')+JSON.stringify(event)+'\n','utf8');await file.sync();}finally{await file.close();}
    tail=false;records.set(key,event);return{duplicate:false};
  });}
  async function project(dates,timezone){await queue;await load();const groups=new Map(),outputs=[],memories=[];
    for(const event of records.values()){
      if(event.kind==='usage'){if(!groups.has(event.source))groups.set(event.source,[]);groups.get(event.source).push({schemaVersion:1,id:event.id,source:event.source,projectPath:event.projectPath,timestamp:event.timestamp,sessionId:event.sessionId,usage:event.usage});}
      else if(event.kind==='output'){
        const {receipt,...output}=event.output;
        const entry={id:'event:'+crypto.createHash('sha256').update(event.source+'/'+event.id).digest('hex'),projectId,sourceId:event.source,timestamp:event.timestamp,...output,summary:output.summary||''};
        if(receipt) {
          const {path,sourceRef,operation,title,requestedAt,request}=receipt;
          entry.traces=[{path,sourceId:event.source,sourceRef,operation,producedAt:event.timestamp,...(title?{title}:{}),...(allowTraceRequests&&request?{requestedAt,request}:{})}];
          if(receipt.usage)entry.traces[0].workTokens=receipt.usage.totalTokens;
        }
        outputs.push(entry);
      }
      else memories.push({id:'memory:'+crypto.createHash('sha256').update(event.source+'/'+event.id).digest('hex'),projectId,sourceId:event.source,timestamp:event.timestamp,...event.memory,method:'agent-memory'});
    }
    const usage=[];
    for(const[source,rows]of groups){
      const sourceId='event:'+source,events=rows.map(row=>({sourceId,key:row.id,sessionId:row.sessionId,timestamp:row.timestamp,project:A.canonical(projectPath),usage:{...row.usage,reasoningOutputTokens:row.usage.reasoningOutputTokens??null,cacheWriteInputTokens:row.usage.cacheWriteInputTokens??null},partial:row.usage.cachedInputTokens===null}));
      const total=A.aggregate(events,dates,now(),sourceId,'import',false,timezone);
      usage.push({...total,source:{id:sourceId,label:source,status:total.partial?'partial':'connected',method:'Explicit per-call API / hook event journal',notes:[...total.notes,...notes]}});
    }
    return{usage,outputs,memories,count:records.size,diagnostics:notes.slice()};
  }
  return{append,project,filename,diagnostics:()=>notes.slice()};
}
module.exports={createEventStore};
