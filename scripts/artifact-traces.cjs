'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {parseMetadata, inScope} = require('./collector.cjs');
const {canonical} = require('./source-adapters.cjs');
const {describeBytes, publicPath} = require('./work-content.cjs');
const {singleWorkUsage}=require('./work-usage.cjs');

const mb = 1024 * 1024;
const cache = new Map();
// Local locators only. They contain no conversation text and are never serialized.
const processLocations=new Map();
const locatorKey=(project,ref,name,fingerprint)=>JSON.stringify([project,ref,name,fingerprint]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const asTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

function quote(content, at) {
  const blocks = typeof content === 'string' ? [content] : (Array.isArray(content) ? content : [])
    .filter(b => ['input_text','text','Text'].includes(b?.type)).map(b => b.text);
  const text = blocks.find(value => typeof value === 'string' && value.trim() && !/^\s*(?:<|# AGENTS\.md instructions)/i.test(value));
  if (!text || !at) return null;
  // Keep a literal excerpt. Skip commands, attachments and credential-bearing
  // messages instead of storing them in the project journal.
  if (/```|https?:\/\/\S+[?]|\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{12,}|Bearer\s+\S+)|(?:api[_ -]?key|password|密码|密钥)\s*[:=]/i.test(text)) return null;
  const line = text.trim().split(/\r?\n/)[0];
  if (!line || /[\x00-\x1f]/.test(line)) return null;
  return {requestedAt:at,request:Array.from(line).slice(0,220).join('')};
}

function imageDigest(raw) {
  if (typeof raw !== 'string') return null;
  const encoded = raw.replace(/^data:image\/(?:png|jpeg|gif|webp);base64,/i, '');
  if (!encoded.length || encoded.length > 15*mb || encoded.length % 4 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded)) return null;
  const image = Buffer.from(encoded, 'base64');
  return isImageBytes(image)?hash(image):null;
}
function isImageBytes(image){
  return image.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) ||
    image.subarray(0,3).equals(Buffer.from('ffd8ff','hex')) ||
    /^GIF8[79]a$/.test(image.toString('ascii',0,6)) ||
    (image.toString('ascii',0,4) === 'RIFF' && image.toString('ascii',8,12) === 'WEBP');
}

// A log line can contain an entire bitmap. Stop accumulating an oversized
// line, and skip it through the next newline. Never read past the scan budget.
async function* rows(filename, budget, position, size, lineLimit=16*mb) {
  if (budget.remaining <= 0 || position.offset>=size) return;
  const start=position.offset, stop=Math.min(size,start+budget.remaining);
  const stream = fs.createReadStream(filename,{start,end:stop-1});
  let chunks=[], length=0, oversized=position.skipping, readThrough=start;
  function parse() {
    if (!oversized && length) {
      try { return JSON.parse(Buffer.concat(chunks,length).toString('utf8')); } catch {}
    }
    return null;
  }
  try {
    for await (const chunk of stream) {
      budget.remaining -= chunk.length;
      const chunkStart=readThrough;
      readThrough+=chunk.length;
      for (let pos=0; pos<chunk.length;) {
        const newline=chunk.indexOf(10,pos), end=newline < 0 ? chunk.length : newline;
        if (!oversized) {
          length+=end-pos;
          if (length>lineLimit) { oversized=true; chunks=[]; }
          else chunks.push(chunk.subarray(pos,end));
        }
        if (newline < 0) break;
        position.offset=chunkStart+newline+1;
        position.skipping=false;
        const row=parse(); if (row) yield {row,location:{offset:position.offset-length-1,length}};
        chunks=[]; length=0; oversized=false; pos=end+1;
      }
      if (oversized) {position.offset=readThrough; position.skipping=true;}
    }
    if (readThrough===size) {
      const last=parse();
      // JSONL writers can append the remainder of their last row on a later poll.
      if(last || !length || oversized){position.offset=size; position.skipping=oversized;}
      if (last) yield {row:last,location:{offset:size-length,length}};
    }
  } finally { stream.destroy(); }
}

async function candidates(codexRoot,claudeRoot,cutoff) {
  const found=[]; let directories=0;
  async function visit(directory,source,depth=0) {
    if (depth>9 || ++directories>6000 || found.length>=4000) return;
    let children;
    try { children=await fs.promises.readdir(directory,{withFileTypes:true}); } catch { return; }
    for (const child of children) {
      if (found.length>=4000) break;
      if (child.isSymbolicLink() || child.name.startsWith('.')) continue;
      const filename=path.join(directory,child.name);
      if (child.isDirectory()) await visit(filename,source,depth+1);
      else if (child.isFile() && child.name.endsWith('.jsonl')) {
        const stat=await fs.promises.stat(filename).catch(()=>null);
        if (stat && stat.mtimeMs>=cutoff) found.push({filename,source,stat});
      }
    }
  }
  if (codexRoot) { await visit(path.join(codexRoot,'sessions'),'codex'); await visit(path.join(codexRoot,'archived_sessions'),'codex'); }
  if (claudeRoot) await visit(path.join(claudeRoot,'projects'),'claude-code');
  return found.sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs);
}

function validRelative(value) {
  return typeof value==='string' && value.length && !path.isAbsolute(value) && !/[:\\]/.test(value)
    && !value.split('/').some(part=>!part||part==='.'||part==='..');
}

// Some Claude Write completions acknowledge only the path. Keep a pointer to
// the call, not its body, across the interval before success. Reread a bounded
// line only for an exact path/digest match and verify the recovered bytes.
function originalWrite(filename,location,id,name) {
  if (!location || location.offset<0 || location.length>12*mb) return;
  let fd;
  try {
    fd=fs.openSync(filename,'r');
    const line=Buffer.alloc(location.length);
    if(fs.readSync(fd,line,0,line.length,location.offset)!==line.length)return;
    const row=JSON.parse(line.toString('utf8'));
    const tool=Array.isArray(row.message?.content) && row.message.content.find(block=>
      block?.type==='tool_use' && block.name==='Write' && block.id===id && block.input?.file_path===name);
    return tool?.input?.content;
  } catch { return; }
  finally {if(fd!==undefined)fs.closeSync(fd);}
}

// Receipts always carry an independently derived content digest: Claude Write
// bytes, Codex added-file bytes, generated image bytes, or an explicit image
// tool receipt digest. A path and a nearby mtime alone never bind a request.
async function collectTraces({codexRoot,claudeRoot,scopePath,projectPath,outputs=[],memoriesEnabled=false,now=new Date(),historyDays=365,onAmbiguous,scanByteBudget=128*mb}={}) {
  const indexed = new Map();
  for (const output of outputs) for (const name of output.files||[]) {
    if (!validRelative(name) || !/^[a-f0-9]{64}$/.test(output.fingerprint) || !asTime(output.timestamp)) continue;
    if (!indexed.has(output.fingerprint)) indexed.set(output.fingerprint,[]);
    indexed.get(output.fingerprint).push({output,name});
  }
  if (!indexed.size || !projectPath || !scopePath) return [];
  const project=canonical(projectPath);
  if (!project) return [];
  const paths=/^(?:[a-z]:\/|\/\/)/i.test(project)?path.win32:path.posix;
  const latest = new Date(now).getTime(), earliest = latest - (Math.min(10000,Math.max(1,historyDays))+1)*86400000;
  const files=await candidates(codexRoot,claudeRoot,earliest), budget={remaining:Math.min(128*mb,Math.max(1,Math.floor(scanByteBudget)))}, matched=new Map();
  const signature=hash(JSON.stringify([projectPath,scopePath,memoriesEnabled,[...indexed].map(([key,items])=>[key,items.map(i=>[i.output.id,i.name,i.output.timestamp])])]));
  for (const file of files) {
    const fileKey = file.filename, revision=[signature,file.stat.size,file.stat.mtimeMs,file.stat.ctimeMs].join('/');
    let receipts = cache.get(fileKey);
    if (receipts?.revision!==revision) {
      if (budget.remaining<=0) continue;
      const hits=[];
      function accept({name,fingerprint,at,state,callId,operation,request,image=false,imageBytes=false,title,content,recoverContent,location}) {
        const matches=indexed.get(fingerprint);
        if (!matches || !at || !callId || typeof callId!=='string' || !state.session || !inScope(state.cwd,scopePath)) return;
        const target = typeof name==='string' && name.length ? canonical(paths.resolve(state.cwd,name)) : null;
        const relative = target && inScope(target,project) ? paths.relative(project,target).split(paths.sep).join('/') : null;
        const normalize = p => paths===path.win32 ? p.toLowerCase() : p;
        let eligible=matches.filter(m=>relative && normalize(m.name)===normalize(relative));
        // A generated image may be copied from the tool's own cache. Match
        // its actual bytes to a single watched image in the same workspace.
        if (!eligible.length && imageBytes && (inScope(state.cwd,projectPath)||inScope(projectPath,state.cwd))) {
          const seen=matches.filter(m=>m.output.type==='image');
          if (seen.length===1) eligible=seen;
        }
        let intro;
        for (const {output,name:pathName} of eligible) {
          if (image && output.type!=='image') continue;
          // A copy with a preserved mtime can precede the completion callback
          // by a few seconds, but never attribute older content to a later run.
          if (Date.parse(at)>Date.parse(output.timestamp)+5000) continue;
          const trace={outputId:output.id,path:pathName,fingerprint,sourceId:file.source,
            sourceRef:'trace:'+hash([file.source,state.session,callId].join('\0')),producedAt:at,operation};
          if(location){
            const key=locatorKey(project,trace.sourceRef,pathName,fingerprint);
            processLocations.set(key,{filename:file.filename,end:location.offset+location.length,image,
              dev:file.stat.dev,ino:file.stat.ino,target,source:file.source});
            if(processLocations.size>8192)processLocations.delete(processLocations.keys().next().value);
          }
          if (memoriesEnabled && request && request.requestedAt<=at) Object.assign(trace,request);
          if (typeof title==='string' && title.trim() && !/[<>\x00-\x1f]/.test(title) && title.length<=120) trace.title=title.trim();
          if (!image && relative && normalize(pathName)===normalize(relative) && output.sourceId==='local-files' && output.files.length===1) {
            if (intro===undefined) {
              const source=content ?? recoverContent?.();
              intro=null;
              if (typeof source==='string' && source.length<=2*mb && Buffer.byteLength(source)<=2*mb) {
                const bytes=Buffer.from(source);
                if(hash(bytes)===fingerprint)intro=describeBytes(pathName,bytes);
              }
            }
            if(intro)trace.contentIntro=intro;
          }
          if (hits.length<8192) hits.push(trace);
        }
      }
      const read=file.source==='codex' ? codexReader(scopePath,memoriesEnabled,accept) :
        claudeReader(scopePath,memoriesEnabled && !/[\\/]subagents[\\/]/.test(file.filename),accept,file.filename);
      receipts={revision,hits,read,usage:file.source==='codex'?singleWorkUsage():null,position:{offset:0,skipping:false}};
      cache.set(fileKey,receipts);
      if (cache.size>160) cache.delete(cache.keys().next().value);
    }
    if (receipts.read && budget.remaining>0) {
      try {
        const input=rows(file.filename,budget,receipts.position,file.stat.size);
        for await (const {row,location} of input) {
          receipts.usage?.read(row,location);
          if (receipts.read(row,location)==='stop') { delete receipts.read; break; }
        }
        if (receipts.position.offset===file.stat.size) delete receipts.read;
      } catch { cache.delete(fileKey); continue; }
    }
    for (const receipt of receipts.hits) {
      const workTokens=receipts.usage?.tokens(receipt.sourceRef);
      const hit=workTokens===undefined?receipt:{...receipt,workTokens};
      const time=Date.parse(hit.producedAt);
      if (time>latest || time<earliest) continue;
      const key=hit.outputId+'\0'+hit.path;
      if (!matched.has(key)) matched.set(key,hit);
      else if (matched.get(key) && matched.get(key).sourceRef!==hit.sourceRef) {
        onAmbiguous?.({path:hit.path,fingerprint:hit.fingerprint});
        matched.set(key,null);
      } else if (matched.get(key) && !matched.get(key).request && hit.request) matched.set(key,hit);
    }
  }
  return [...matched.values()].filter(Boolean).slice(0,1000);
}

function receiptImage(receipt) {
  if (!receipt || typeof receipt!=='object' || receipt.failure || receipt.is_error || receipt.isError || receipt.error) return null;
  const bytes=imageDigest(receipt.result || receipt.b64_json || receipt.image_url);
  const fingerprint=bytes ||
    (/^[a-f0-9]{64}$/.test(receipt.sha256) ? receipt.sha256 : null);
  if (!fingerprint) return null;
  return {name:receipt.saved_path || receipt.savedPath || receipt.path, fingerprint, image:true, imageBytes:Boolean(bytes), title:receipt.title};
}

function toolImage(result) {
  if (!result || result.isError || result.is_error || result.error) return null;
  const structured=receiptImage(result.structuredContent || result.structured_content || result);
  if (structured) return structured;
  const blocks=Array.isArray(result)?result:result.content;
  if (!Array.isArray(blocks)) return null;
  const images=blocks.filter(b=>b.type==='image');
  if (images.length!==1) return null;
  const fingerprint=imageDigest(images[0].data || images[0].source?.data);
  return fingerprint ? {fingerprint,image:true,imageBytes:true} : null;
}

// Desktop Codex records native image receipts separately from its JS tool
// envelope. Read only a small literal subset of that envelope, never execute it.
const jsString='"(?:[^"\\\\]|\\\\.)*"';
function imageEnvelope(code) {
  if(typeof code!=='string'||code.length>32768)return null;
  let s=code.replace(/^\s*\/\/ @exec:[^\r\n]*[\r\n]+/,'').trim();
  const declared=new RegExp('^const\\s+prompt\\s*=\\s*('+jsString+');\\s*').exec(s);
  try{
    let prompt;
    if(declared){prompt=JSON.parse(declared[1]);s=s.slice(declared[0].length).replace(/^store\("[\w-]+",\s*prompt\);\s*/,'');}
    const call=/^(?:const|let)\s+(\w+)\s*=\s*await\s+tools\.image_gen__imagegen\(\s*\{/.exec(s);
    if(!call)return null;
    s=s.slice(call[0].length).trimStart();
    const keys=new Set(),args={};
    while(!s.startsWith('}')){
      const prop=/^(prompt|num_last_images_to_include|referenced_image_paths|transparent_background)\b\s*/.exec(s);
      if(!prop||keys.has(prop[1]))return null;
      const key=prop[1];keys.add(key);s=s.slice(prop[0].length);
      if(s.startsWith(':')){
        s=s.slice(1).trimStart();
        const value=new RegExp('^(?:'+jsString+'|true|false|[0-9]+|\\[\\s*'+jsString+'(?:\\s*,\\s*'+jsString+')*\\s*\\])').exec(s);
        if(!value)return null;
        args[key]=JSON.parse(value[0]);s=s.slice(value[0].length).trimStart();
      }else if(key==='prompt'&&prompt)args.prompt=prompt;
      else return null;
      if(s.startsWith(','))s=s.slice(1).trimStart();
      else if(!s.startsWith('}'))return null;
    }
    if(typeof args.prompt!=='string')return null;
    const result=call[1],end=new RegExp('^}\\s*\\)\\s*;\\s*(?:store\\("[\\w-]+",\\s*'+result+'\\);\\s*)?generatedImage\\('+result+'\\)\\s*;?\\s*(?:text\\(\\{hint:\\s*'+result+'\\.output_hint\\s*\\|\\|\\s*null\\}\\);?\\s*)?$');
    // Extra expressions could display a different result. The display must
    // also match the native call's prompt and actual output bytes.
    return end.test(s)?args:null;
  }catch{return null;}
}
function designExcerpt(text){
  if(typeof text!=='string'||text.length>32768||/https?:\/\/|(?:[A-Z]:[\\/]|\/Users\/|\/home\/)|```|(?:password|api[_ -]?key|密钥|密码)\s*[:=：]|\b(?:sk-|github_pat_|ghp_)[\w-]{8,}/iu.test(text))return undefined;
  return text.replace(/\s+/gu,' ').trim().slice(0,1600)||undefined;
}
function bindingFor(args,lastImage){
  if(!args||typeof args.prompt!=='string'||args.prompt.length>32768)return null;
  const refs=args.referenced_image_paths;
  return {promptHash:hash(args.prompt),parent:args.num_last_images_to_include===1&&!refs?lastImage:null,
    referencePath:!args.num_last_images_to_include&&Array.isArray(refs)&&refs.length===1&&typeof refs[0]==='string'?refs[0]:null};
}
function nativeArguments(value){
  if(typeof value==='string'){
    if(value.length>32768)return null;
    try{return JSON.parse(value);}catch{return null;}
  }
  return value;
}

function codexReader(scope,allowQuotes,accept,processOnly=false) {
  let state=null, turn=null, worker=false, headerRows=0;
  const prompts=new Map(), calls=new Map(), directories=new Map(),replies=new Map(), imageCalls=new Map();
  let lastImage=null;
  function promptFor(id,started) {
    const items=prompts.get(id)||[];
    return started ? items.filter(p=>p.at<=started).at(-1)?.quote : items.length===1 ? items[0].quote : undefined;
  }
  return function read(row,location) {
    const p=row.payload||{}, at=asTime(row.timestamp);
    if (row.type==='session_meta') {
      const meta=parseMetadata(row,scope);
      if (!meta || meta.excluded || state || (processOnly && meta.kind==='worker')) return 'stop';
      state={session:meta.id,cwd:p.cwd}; worker=meta.kind==='worker'; return;
    }
    if (!state) return ++headerRows>3 ? 'stop' : undefined;
    if (!at || (p.thread_id && p.thread_id!==state.session)) return;
    if(processOnly && ['thread_rolled_back','conversation_rolled_back'].includes(p.type)){
      prompts.clear();calls.clear();directories.clear();replies.clear();imageCalls.clear();lastImage=null;turn=null;return;
    }
    if (row.type==='turn_context' || (row.type==='event_msg' && p.type==='task_started')) {
      turn=p.turn_id || (row.type==='turn_context' ? turn : null);
      if (row.type==='turn_context' && p.cwd) state.cwd=p.cwd;
      directories.set(turn,state.cwd);
      if (directories.size>256) directories.delete(directories.keys().next().value);
      return;
    }
    const event=row.type==='event_msg', item=event&&p.type==='item_completed'?p.item:null, id=p.turn_id||turn||'legacy';
    const blocks=row.type==='response_item'?(Array.isArray(p.output)?p.output:p.content):item?.content;
    const display=Array.isArray(blocks)?blocks.filter(b=>/^(?:input_image|image|output_image|local_?image|image_url|image_pointer)$/i.test(b?.type)):[];
    if(display.length||event&&p.type==='user_message'&&(p.images?.length||p.local_images?.length)||
       row.type==='response_item'&&p.type==='function_call'&&/(?:^|__)view_image$/.test(p.name||''))lastImage=null;
    if(row.type==='response_item'&&p.type==='custom_tool_call_output'){
      const entry=imageCalls.get(p.call_id);imageCalls.delete(p.call_id);
      if(entry?.result&&entry.turn===id&&display.length===1 && !p.is_error && !p.error && !['failed','cancelled','incomplete'].includes(p.status) &&
        imageDigest(display[0].image_url||display[0].data)===entry.result.fingerprint){
        const result=entry.result;
        accept({...result,location,parentImage:entry.binding.parent,referencePath:entry.binding.referencePath});
        lastImage={callId:result.callId,fingerprint:result.fingerprint};
      }
      return;
    }
    const user=(item?.type==='UserMessage' && item.content) ||
      (row.type==='response_item' && p.type==='message' && p.role==='user' && p.content) || (event && p.type==='user_message' && p.message);
    if (user) {
      if (!allowQuotes || worker || !inScope(state.cwd,scope)) return;
      const userQuote=quote(user,at), items=prompts.get(id)||[];
      // Metadata-only user messages are not fresh human instructions. For
      // skipped sensitive instructions, never reuse the previous excerpt.
      if (!userQuote && (Array.isArray(user)?user.every(x=>!x?.text||/^\s*</.test(x.text)):/^\s*</.test(user))) return;
      if (!items.length || items.at(-1).quote?.request!==userQuote?.request) {items.push({at,quote:userQuote}); replies.delete(id);}
      prompts.set(id,items.slice(-12)); if (prompts.size>24) prompts.delete(prompts.keys().next().value);
      return;
    }
    if(processOnly && row.type==='response_item' && p.type==='message' && p.role==='assistant' && Array.isArray(p.content)){
      // Only ordinary user-facing assistant text can accompany its next action.
      const words=p.content.filter(b=>['output_text','text'].includes(b?.type)).map(b=>({type:'text',text:b.text}));
      replies.set(id,quote(words,at)?.request);
      if(replies.size>64)replies.delete(replies.keys().next().value);
    }
    const nativeImage=row.type==='response_item' && p.type==='image_generation_call';
    const callId=item?.id || p.call_id || (nativeImage?p.id:null);
    const cwd=directories.get(id) || (id===turn || id==='legacy' ? state.cwd : null);
    if (!callId || !cwd || !inScope(cwd,scope)) return;
    if (event && ['image_generation_begin','patch_apply_begin'].includes(p.type) || row.type==='response_item' && ['function_call','custom_tool_call'].includes(p.type)) {
      if(row.type==='response_item' && p.type==='custom_tool_call' && p.name==='exec' && typeof p.input==='string' && p.input.includes('tools.image_gen__imagegen(')){
        const binding=bindingFor(imageEnvelope(p.input),lastImage);
        if(binding){imageCalls.set(callId,{binding,turn:id});if(imageCalls.size>32)imageCalls.delete(imageCalls.keys().next().value);}
      }
      if(!calls.has(callId)){
        const call={request:promptFor(id,at),cwd,reply:replies.get(id),turnKey:id};
        if(processOnly&&(p.type==='image_generation_begin'||/(?:^|__)(?:imagegen|image_gen)$/.test(p.name||''))){
          const args=nativeArguments(p.arguments||p.input||p);
          const binding=bindingFor(args,lastImage);
          call.designBrief=designExcerpt(args?.prompt);
          call.parentImage=binding?.parent;
          call.referencePath=binding?.referencePath;
        }
        calls.set(callId,call);
        replies.delete(id);
      }
      if (calls.size>1024) calls.delete(calls.keys().next().value);
      return;
    }
    if (!event && !nativeImage) return;
    const call=calls.get(callId);
    const startDate=new Date(Number.isFinite(p.started_at_ms)?p.started_at_ms:NaN);
    const started=Number.isFinite(startDate.getTime())?startDate.toISOString():null;
    const base={at,state:{...state,cwd:call?.cwd || cwd},callId,operation:'create',request:call ? call.request : promptFor(id,started),
      location,reply:call?.reply,turnKey:call?.turnKey||id};
    if ((p.type==='patch_apply_end' && p.success===true && (!p.status||p.status==='completed')) || (item?.type==='FileChange' && item.status==='completed')) {
      for (const [name,change] of Object.entries((item||p).changes||{})) {
        if (change?.type==='add' && typeof change.content==='string') accept({...base,name,fingerprint:hash(change.content),content:change.content});
        else if(processOnly && ['update','delete'].includes(change?.type))accept({...base,name,operation:change.type==='update'?'edit':'delete'});
      }
    }
    if (nativeImage || p.type==='image_generation_end' || item?.type==='ImageGeneration' || (item?.type==='Extension' && item.kind==='image_gen.generation')) {
      const image=item||p, receipt=image.status==='completed'?receiptImage(image):null;
      if (receipt){
        lastImage=null;
        const brief=image.revisedPrompt||image.revised_prompt||image.prompt;
        const hit={...base,...receipt,designBrief:processOnly?designExcerpt(brief)||call?.designBrief:undefined,
          parentImage:call?.parentImage,referencePath:call?.referencePath};
        accept(hit);
        if(typeof brief==='string'){
          const promptHash=hash(brief),matches=[...imageCalls.values()].filter(entry=>entry.turn===id&&entry.binding.promptHash===promptHash);
          if(matches.length===1){
            const entry=matches[0];
            if(entry.result||entry.ambiguous){entry.ambiguous=true;entry.result=null;}
            else entry.result=hit;
          }
        }
      }
    }
    if (item?.type==='McpToolCall' && item.status==='completed' && ['imagegen','image_gen'].includes(item.server) && ['imagegen','image_gen'].includes(item.tool)) {
      const image=toolImage(item.result);
      if (image){
        const args=nativeArguments(item.arguments || item.input),binding=bindingFor(args,null);
        accept({...base,...image,designBrief:processOnly?designExcerpt(args?.prompt)||call?.designBrief:undefined,
          parentImage:call?.parentImage || binding?.parent,referencePath:call?.referencePath || binding?.referencePath});
        lastImage=null;
      }
    }
  };
}

function claudeReader(scope,allowQuotes,accept,filename,processOnly=false) {
  let state=null, latest=null, headerRows=0;
  const parents=new Map(), calls=new Map();
  return function read(row,location) {
    if (row.isSidechain || row.isMeta) return;
    if (!state) {
      if (!row.sessionId || !row.cwd) return ++headerRows>32 ? 'stop' : undefined;
      if (!inScope(row.cwd,scope)) return 'stop';
      state={session:row.sessionId,cwd:row.cwd};
    }
    if (row.sessionId && row.sessionId!==state.session || row.cwd && !inScope(row.cwd,scope)) return 'stop';
    if (row.cwd) state.cwd=row.cwd;
    const at=asTime(row.timestamp), content=row.message?.content;
    if (!at || !content) return;
    const blocks=Array.isArray(content)?content:[];
    let request=row.parentUuid ? parents.get(row.parentUuid) : processOnly ? null : latest;
    if (row.type==='user' && !blocks.some(b=>b.type==='tool_result')) {
      request=allowQuotes?quote(content,at):null;
      latest=request;
    }
    if (row.uuid) { parents.set(row.uuid,request); if (parents.size>2048) parents.delete(parents.keys().next().value); }
    if (row.type==='assistant') for (const tool of blocks) {
      const supported=tool.name==='Write' || tool.name==='Edit' || /(?:^|__)imagegen(?:__imagegen)?$/.test(tool.name||'');
      if (tool.type==='tool_use' && supported && typeof tool.id==='string' && tool.input) {
        // Keep a digest and an offset only. Most completions supply the bytes
        // themselves, and the fallback does not retain arbitrary Write inputs.
        const {file_path,content:written}=tool.input;
        const small=typeof written==='string' && written.length<=2*mb && Buffer.byteLength(written)<=2*mb;
        const solo=processOnly && blocks.filter(b=>b.type==='tool_use').length===1;
        calls.set(tool.id,{tool:tool.name,name:file_path,fingerprint:typeof written==='string'?hash(written):null,location:small?location:null,request,cwd:state.cwd,
          reply:solo?quote(blocks,at)?.request:undefined,callNode:row.uuid,hasParent:!!row.parentUuid,
          designBrief:processOnly?designExcerpt(tool.input.prompt):undefined,
          referencePath:processOnly?bindingFor(tool.input,null)?.referencePath:undefined});
        if (calls.size>512) calls.delete(calls.keys().next().value);
      }
    }
    if (row.type!=='user') return;
    const results=blocks.filter(b=>b.type==='tool_result');
    for (const result of results) {
      const call=calls.get(result.tool_use_id); calls.delete(result.tool_use_id);
      if (!call || result.is_error || result.isError) continue;
      const receipt=results.length===1 ? row.toolUseResult : null;
      const base={at,state:{...state,cwd:call.cwd},callId:result.tool_use_id,operation:'create',request:call.request,
        location,reply:call.reply,callNode:call.callNode,hasParent:call.hasParent};
      if (call.tool==='Write' && typeof call.name==='string' && call.fingerprint) {
        const text=typeof result.content==='string'?result.content:null;
        const explicit=receipt?.filePath===call.name && ['create','update'].includes(receipt.type);
        if (explicit || text==='File created successfully at: '+call.name) {
          if (explicit && typeof receipt.content==='string' && hash(receipt.content)!==call.fingerprint) continue;
          accept({...base,name:call.name,fingerprint:call.fingerprint,operation:receipt?.type==='update'?'edit':'create',
            content:receipt?.content,recoverContent:call.location?()=>originalWrite(filename,call.location,result.tool_use_id,call.name):undefined});
        }
      } else if (call.tool==='Edit' && receipt?.filePath===call.name && typeof receipt.originalFile==='string' && typeof receipt.oldString==='string' && receipt.oldString && typeof receipt.newString==='string') {
        const pieces=receipt.originalFile.split(receipt.oldString);
        if (pieces.length===2 || (pieces.length>2 && receipt.replaceAll===true)) {
          const length=receipt.originalFile.length+(pieces.length-1)*(receipt.newString.length-receipt.oldString.length);
          if(length>16*mb)continue;
          const content=pieces.join(receipt.newString);
          accept({...base,name:call.name,fingerprint:hash(content),operation:'edit',content});
        }
      } else if (call.tool!=='Edit' && call.tool!=='Write') {
        const image=toolImage(receipt) || toolImage(result.content);
        if (image) accept({...base,...image,designBrief:call.designBrief,referencePath:call.referencePath});
      }
    }
  };
}
function createProcessReader({projectPath,scopePath,codexRoot,claudeRoot,processByteBudget=20*mb}) {
  const project=canonical(projectPath);
  const paths=/^(?:[a-z]:\/|\/\/)/i.test(project)?path.win32:path.posix;
  const recent=new Map();
  const checkedImages=new WeakMap();
  const windowBytes=Number.isSafeInteger(processByteBudget)?Math.min(20*mb,Math.max(1,processByteBudget)):20*mb;
  const waiting=[];
  let active=0,epoch=0;
  async function read(member){
    const generation=epoch;
    const trace=member?.trace, name=member?.path, digest=member?.record?.fingerprint;
    if(!trace||!validRelative(name)||trace.path!==name||!member.record.files?.includes(name)||!digest)return [];
    const key=locatorKey(project,trace.sourceRef,name,digest),loc=processLocations.get(key);
    if(!loc || trace.sourceId!==loc.source || loc.end<=0)return [];
    const root=loc.source==='codex'?codexRoot:claudeRoot;
    if(!root || !inScope(loc.filename,root)||/[\\/]subagents[\\/]/.test(loc.filename))return [];
    try{
      const [actual,rootReal,stat]=await Promise.all([fs.promises.realpath(loc.filename),fs.promises.realpath(root),fs.promises.stat(loc.filename)]);
      if(generation!==epoch||!inScope(actual,rootReal)||!stat.isFile()||stat.ino!==loc.ino||stat.dev!==loc.dev||stat.size<loc.end)return [];
      const revision=JSON.stringify([key,trace.producedAt,trace.operation,loc.filename,loc.end,stat.size,stat.ctimeMs]);
      if(!recent.has(revision)){
        if(waiting.length>=8)return [];
        const task=(async()=>{
          if(active>=2)await new Promise(resolve=>waiting.push(resolve));
          active++;
          try{return generation===epoch?await readSession(loc,trace,digest,generation):[];}
          finally{active--;waiting.shift()?.();}
        })();
        recent.set(revision,task);
        if(recent.size>12)recent.delete(recent.keys().next().value);
      }
      const turns=await recent.get(revision);
      if(!turns.referenceImage)return turns;
      // An old drawing can move or be overwritten after its chat was indexed.
      // Keep its valid story even when its previous pixels cannot be shown.
      const ref=turns.referenceImage;
      let file;
      try{
        const target=await fs.promises.realpath(paths.join(projectPath,ref.path));
        if(!inScope(target,await fs.promises.realpath(projectPath)))return turns.slice();
        file=await fs.promises.open(target,'r');
        const stat=await file.stat();
        if(!stat.isFile()||stat.size>8*mb)return turns.slice();
        const stamp=JSON.stringify([target,stat.ino,stat.dev,stat.size,stat.ctimeMs,stat.mtimeMs]);
        if(checkedImages.get(turns)!==stamp){
          const bytes=Buffer.alloc(stat.size);
          const {bytesRead}=await file.read(bytes,0,bytes.length,0);
          if(bytesRead!==stat.size||!isImageBytes(bytes)||hash(bytes)!==ref.fingerprint)return turns.slice();
          checkedImages.set(turns,stamp);
        }
        return turns;
      }catch{return turns.slice();}
      finally{if(file)await file.close();}
    }catch{return [];}
  }
  async function readSession(loc,trace,digest,generation){
    // The anchor was indexed by the collector after matching bytes. Read just
    // this originating session, through that receipt, and verify it again.
    const claude=loc.source==='claude-code', parents=new Map(), successes=[];
    const images=new Map(), knownImages=new Map();
    if(loc.image)for(const [key,entry] of processLocations){
      if(!entry.image||entry.filename!==loc.filename)continue;
      const [repository,ref,name,sha]=JSON.parse(key);
      if(repository===project)knownImages.set(ref,{name:canonical(paths.resolve(project,name)),path:name,sha});
    }
    let current,answer=[];
    function ancestor(node,descendant){
      for(let count=0;node&&descendant&&count<4096;count++){
        if(node===descendant)return true;
        descendant=parents.get(descendant);
      }
      return false;
    }
    const accept=hit=>{
      const target=typeof hit.name==='string'?canonical(paths.resolve(hit.state.cwd,hit.name)):null;
      if(!inScope(hit.state.cwd,scopePath)||target!==loc.target&&!(loc.image&&hit.image))return;
      const ref='trace:'+hash([loc.source,hit.state.session,hit.callId].join('\0'));
      const exact=hit.location.offset+hit.location.length===loc.end && hit.fingerprint===digest &&
        ref===trace.sourceRef && hit.at===trace.producedAt && hit.operation===trace.operation;
      if(claude && (!hit.hasParent||!ancestor(hit.callNode,current.parentUuid)))return;
      if(hit.operation==='delete'){
        if(!claude)successes.length=0;
        return;
      }
      const request=hit.request&&hit.request.requestedAt<=hit.at?hit.request.request:undefined;
      if(!request&&!hit.designBrief)return;
      const turnKey=JSON.stringify([hit.turnKey||'',hit.request?.requestedAt,request]);
      const line={...(request?{request}:{}),operation:hit.operation};
      if(hit.reply)line.reply=hit.reply;
      if(hit.designBrief)line.designBrief=hit.designBrief;
      if(hit.image){
        if(knownImages.get(ref)?.sha!==hit.fingerprint)return;
        let parent;
        if(hit.parentImage){
          const candidate=images.get(hit.parentImage.callId);
          if(candidate?.sha===hit.parentImage.fingerprint)parent=candidate;
        }else if(hit.referencePath){
          const named=paths.resolve(hit.state.cwd,hit.referencePath),full=canonical(named);
          const matches=[...images.values()].filter(x=>x.name===full);
          // Paths can be reused. A reference must still name the same project
          // bytes as the earlier receipt; never follow a link outside it.
          if(matches.length===1&&inScope(full,project)){
            try{
              const real=fs.realpathSync(named),stat=fs.statSync(real);
              if(inScope(real,project)&&stat.isFile()&&stat.size<=16*mb&&hash(fs.readFileSync(real))===matches[0].sha)parent=matches[0];
            }catch{/* Missing historical input. */}
          }
        }
        if(parent&&claude&&!ancestor(parent.node,current.parentUuid))parent=null;
        if(parent&&parent.turnKey!==turnKey){
          line.operation='edit';
          const chain=[...parent.chain,line].slice(-3);
          images.set(hit.callId,{...knownImages.get(ref),chain,node:current.uuid,turnKey});
          if(exact){
            answer=chain;
            if(parent.sha!==hit.fingerprint&&publicPath(parent.path)&&/\.(?:png|jpe?g|webp|gif)$/i.test(parent.path)){
              Object.defineProperty(answer,'referenceImage',{value:Object.freeze({path:parent.path,fingerprint:parent.sha})});
            }
          }
        }else{
          images.set(hit.callId,{...knownImages.get(ref),chain:[line],node:current.uuid,turnKey});
          if(exact)answer=[line];
        }
        if(images.size>128)images.delete(images.keys().next().value);
        return;
      }
      if(exact){
        // Distinct cache images can have identical bytes. Such a copy is
        // sufficient for its own turn but cannot connect earlier revisions.
        const related=target && inScope(target,project) && (claude||hit.turnKey!=='legacy');
        const turns=new Map();
        if(related)for(const prior of successes){
          if(prior.at>hit.at || (claude&&!ancestor(prior.node,current.parentUuid)))continue;
          turns.set(prior.turnKey,prior.line);
        }
        turns.set(turnKey,line);
        answer=[...turns.values()].slice(-3);
      }
      successes.push({turnKey,line,at:hit.at,node:current.uuid});
      if(successes.length>96)successes.shift();
    };
    const parser=claude?claudeReader(scopePath,true,accept,loc.filename,true):codexReader(scopePath,true,accept,true);
    const start=Math.max(0,loc.end-windowBytes);
    let needContext=false;
    if(start && !claude){
      // A suffix cannot establish whether the session is a worker or where
      // its project is. Re-read the native header and wait for an explicit cwd.
      let initialized=false;
      for await(const {row,location} of rows(loc.filename,{remaining:256*1024},{offset:0,skipping:false},loc.end)){
        if(generation!==epoch)return [];
        if(parser(row,location)==='stop')return [];
        if(row.type==='session_meta'){initialized=true;break;}
      }
      if(!initialized)return [];
      needContext=true;
    }
    for await(const {row,location} of rows(loc.filename,{remaining:windowBytes},{offset:start,skipping:start>0},loc.end)){
      if(generation!==epoch)return [];
      if(needContext){
        if(row.type!=='turn_context' || !row.payload?.turn_id || !row.payload?.cwd)continue;
        needContext=false;
      }
      current=row;
      if(claude && row.uuid && !row.isMeta && !row.isSidechain){parents.set(row.uuid,row.parentUuid);if(parents.size>16384)parents.delete(parents.keys().next().value);}
      if(!claude && (row.payload?.type==='thread_rolled_back'||row.payload?.type==='conversation_rolled_back')){successes.length=0;images.clear();}
      if(parser(row,location)==='stop')break;
    }
    return answer;
  }
  read.clear=()=>{epoch++;recent.clear();};
  return read;
}
function createDeliveryReader(config){
  return require('./work-deliveries.cjs').createDeliveryIndex(config,{candidates,rows,quote,asTime});
}
module.exports={collectTraces,createProcessReader,createDeliveryReader};
