'use strict';
const {createHash}=require('node:crypto');
const path=require('node:path').posix;
const Findings=require('../dist/work-findings.js');
const Story=require('../dist/item-story.js');
const subjects=new Map(require('../vision/subjects.json').filter(s=>s.id!=='unrelated').map(s=>[s.id,s]));
const {planFor,publicPath}=require('./work-content.cjs');

const snapshotIndexes=new WeakMap();
const localeIndex=new Map([['zh-CN',0],['en',1],['ja',2]]);
const generic={image:'一张图片',audio:'一段音频',video:'一段视频',web:'一个网页',slides:'一份演示稿',
  code:'一段程序',document:'一份文档',table:'一张表格',file:'一份文件',memory:'一段对话笔记'};
const fileFormats=new Set('png jpg jpeg webp gif svg ai psd aseprite md txt html htm pdf doc docx odt rtf ppt pptx odp csv tsv xls xlsx ods json geojson ipynb yaml yml toml xml gltf glb blend obj stl fbx zip mp3 wav aac ogg opus flac m4a mp4 mov webm m4v avi mkv py js ts jsx tsx cjs mjs go java c cpp cs rs gd lua css scss sh ps1 vtt srt ics'.split(' '));
const memberKey=member=>(member.record?.id||member.commit?.hash||'')+'|'+member.path;
const fail=(code,message)=>{throw Object.assign(Error(message),{statusCode:code});};
function indexOf(snapshot){
  if(!snapshotIndexes.has(snapshot))snapshotIndexes.set(snapshot,{
    items:new Map(Findings.build(snapshot).map(item=>[item.id,item])),
    memories:new Map((snapshot.memories||[]).map(m=>[m.id,m])),
    content:new Map(),referencePictures:new Map()
  });
  return snapshotIndexes.get(snapshot);
}

// Keep filenames, credentials, and source-path metadata out of model inputs,
// including old editor reports that predate the current local content reader.
function safeText(text,exclude=[],limit=340){
  if(typeof text!=='string')return '';
  let s=text.trim().replace(/\s+/gu,' ');
  if(!s||/https?:\/\/|(?:^|[\s"'（(「])[A-Za-z]:[\\/]|(?:^|[\s"'（(「])\/(?:home|users|var|etc|tmp)\/|[\w.+-]+@[\w.-]+\.\w+|\b(?:sk-[\w-]{12,}|gh[pousr]_\w{12,}|AKIA[A-Z0-9]{16}|[a-f0-9]{40,})\b|(?:password|bearer|api[ _-]?key|access[ _-]?token|密钥|密码)\s*[:=：]\s*\S+/iu.test(s))return '';
  for(const literal of exclude){
    if(typeof literal!=='string'||!literal)continue;
    if(s===literal || (s.length>=10 && literal.includes(s)))return '';
    s=s.split(literal).join(' ').trim();
  }
  return s.slice(0,limit);
}

function checkRequest(request){
  if(!request||typeof request!=='object'||Array.isArray(request)||
    Object.keys(request).some(key=>!['itemId','memberKey','locale','reading'].includes(key))||
    typeof request.itemId!=='string'||!request.itemId||request.itemId.length>640||
    (request.memberKey!=null && (typeof request.memberKey!=='string'||request.memberKey.length>2450))||
    !localeIndex.has(request.locale))fail(400,'Invalid work selection.');
  const r=request.reading;
  if(r!=null && (typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!['key','id'].includes(k))||
      typeof r.key!=='string'||r.key.length>2750||!subjects.has(r.id)))fail(400,'Invalid visual reading.');
}

// The default mode derives separated topic words on-device.
function topics(records){
  return Story.topicWords(records.flatMap(record=>[record.title,record.summary].map(source=>processExcerpt(source,'',340))));
}

async function verifiedContent(index,source,readContent){
  if(!source||!readContent||!publicPath(source.path)||!planFor(source.path,0))return null;
  if(!index.content.has(source.key)){
    index.content.set(source.key, Promise.resolve().then(()=>readContent(source)).catch(()=>{
      index.content.delete(source.key);
      return null;
    }));
  }
  return index.content.get(source.key);
}

function processExcerpt(value,file,limit){
  if(typeof value!=='string')return '';
  // A terminal transcript, an attachment or a pasted code block is not a
  // conversational beat. Exclude those lines before selecting a short phrase.
  const words=value.replace(/```[\s\S]*?(?:```|$)/g,'').split(/[\r\n]+/u).filter(line=>
    !/^\s*(?:<\/?[\w:-]+[\s>]|[-+]{3}\s|@@|\*\*\* |[{[]\s*["\]]|(?:\$|PS>)\s)/u.test(line)).join(' ');
  const text=safeText(words,[file,path.basename(file)],limit);
  if(/(?:[A-Za-z]:[\\/]|\\\\[\w.-]+\\|(?:^|\s)[~/][^\s]{1,80}\/|github_pat_|\beyJ[\w-]{10,}\.|\b(?:authorization|bearer)\s*[:=： ]\s*\S+|\+?\d[\d ()-]{8,}\d|\b[\da-f]{32,}\b|-----BEGIN .*PRIVATE KEY)/iu.test(text))return '';
  return text.slice(0,limit).trim();
}
function processNotes(turns,file){
  const notes=[];
  for(const turn of turns.slice(-3)){
    if(!turn||!['create','edit'].includes(turn.operation))continue;
    // Strip paths and reject sensitive passages before any material leaves the
    // local collector. Excerpts stay in memory; only their digest enters IDs.
    const request=processExcerpt(turn.request,file,200);
    const reply=processExcerpt(turn.reply,file,160);
    // Composition and edit instructions often come after a style preamble.
    const designBrief=processExcerpt(turn.designBrief,file,1200);
    if(request||reply||designBrief)notes.push({...(request?{request}:{}),...(reply?{reply}:{}),
      ...(designBrief?{designBrief}:{}),operation:turn.operation});
  }
  return notes;
}

function referencePicture(index,snapshot,reference,current){
  if(typeof reference?.path!=='string'||!publicPath(reference.path)||
     typeof reference.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(reference.fingerprint)||
     reference.fingerprint===current.record?.fingerprint)return null;
  const key=JSON.stringify([reference.path,reference.fingerprint]);
  if(!index.referencePictures.has(key)){
    let result=null;
    for(const item of index.items.values()){
      if(!item.paths?.includes(reference.path))continue;
      const member=Story.works(item,snapshot).find(m=>m.path===reference.path&&m.record?.fingerprint===reference.fingerprint&&
        m.record.projectId===snapshot.project.id&&Story.memberType(item,m)==='image');
      if(!member)continue;
      const picture=Story.picture(item,snapshot,member);
      if(picture){result={url:picture.url};break;}
    }
    index.referencePictures.set(key,result);
  }
  return index.referencePictures.get(key);
}

async function narrationEvidence(snapshot,request,{readContent,includeProcess=false,readProcess}={}){
  checkRequest(request);
  if(!snapshot || snapshot.mode!=='live')fail(404,'Live work not found.');
  const index=indexOf(snapshot),item=index.items.get(request.itemId);
  if(!item)fail(404,'Work not found.');
  let type,title,quote,version,referencePreview,process=[];
  const facts=[];
  if(item.memoryIds?.length){
    if(request.memberKey || request.reading)fail(404,'Memory member not found.');
    const records=item.memoryIds.map(id=>index.memories.get(id)).filter(Boolean);
    // A memory slot may contain unrelated chats. Anchor a story to a single
    // saved assistant message; nearby notes cannot establish a dialogue.
    const selected=records[0];
    if(includeProcess===true&&selected?.method==='conversation-excerpt'){
      const reply=processExcerpt(selected.summary,'',160);
      if(reply)process.push({reply,operation:'note'});
    }
    const words=topics(records.slice(0,1));
    type='memory';
    title=generic.memory;
    facts.push('这是对话中记下的想法；记录本身不能说明任何作品已经完成。');
    if(words.length)facts.push('话题词：'+words.join('、')+'。');
    quote=selected?.summary;
    version=['conversation-note-2',...item.memoryIds];
  }else{
    const members=Story.works(item,snapshot);
    const member=request.memberKey?members.find(m=>memberKey(m)===request.memberKey):members[0];
    if(!member)fail(404,'Work version not found.');
    const visual=Story.visualSource(item,snapshot,member);
    if(request.reading && (!visual || visual.key!==request.reading.key))fail(400,'Visual reading belongs to another version.');
    type=Story.memberType(item,member);
    const reading=subjects.get(request.reading?.id),file=path.basename(member.path);
    const ext=path.extname(file).slice(1).toLowerCase();
    quote=member.trace?.request;
    const exclude=[quote,member.path,file];
    const content=await verifiedContent(index,Story.contentSource(item,snapshot,member),readContent) || member.content;
    const parsed=Story.describe(item,snapshot,request.locale,member,undefined,content);
    const allowed=publicPath(member.path);
    const titleHint=type==='image'&&reading?reading.title[localeIndex.get(request.locale)]:parsed.title;
    title=allowed&&safeText(titleHint,exclude)||generic[type]||generic.file;
    const summary=allowed&&safeText(content?.summary||member.report?.summary,exclude);
    if(summary)facts.push(summary);
    if(reading)facts.push((type==='video'?'本机从一个视频取样帧中辨认出的主题：':'本机从这张图片辨认出的主题：')+reading.title[0]+'。');
    if(!summary && allowed && !reading){
      const summaryHint=safeText(parsed.summary,exclude);
      if(summaryHint)facts.push(summaryHint);
    }
    if(fileFormats.has(ext))facts.push('文件格式：'+ext.toUpperCase()+'。');
    if(member.trace)facts.push(member.trace.operation==='edit'?'生成工具留有这次文件修改的回执。':'生成工具留有这次文件创建的回执。');
    else if(member.commit)facts.push('此版本由一次 Git 提交留存。');
    const delivery=member.delivery||member.record?.deliveries?.find(d=>d.path===member.path);
    if(delivery)facts.push('助手在最终答复中提供了这个作品的本地链接。');
    if(!facts.length)facts.push('项目里记录了这种类型的文件。');
    version=[member.path,member.record?.fingerprint||member.commit?.hash||memberKey(member)];
    if(includeProcess===true && allowed && member.record && member.trace){
      let turns=[];
      if(typeof readProcess==='function'){
        try{turns=await readProcess(member);}catch{/* The receipt alone cannot recover the context of a conversation. */}
      }
      if(Array.isArray(turns)){
        process=processNotes(turns,member.path);
        if(type==='image')referencePreview=referencePicture(index,snapshot,turns.referenceImage,member);
      }
    }
    if(!process.length && includeProcess===true && allowed && delivery?.request){
      const request=processExcerpt(delivery.request,member.path,200);
      if(request){
        process=[{request,operation:'delivery'}];
        quote=delivery.request;
      }
    }
  }
  const {locale}=request;
  const basis=process.length?'process':'work';
  const id=createHash('sha256').update(JSON.stringify([snapshot.project.id,item.id,version,locale,type,title,facts,includeProcess===true,process])).digest('hex');
  return {id,locale,type,title,facts,basis,...(process.length?{process}:{}),...(quote?{quote}:{}),...(referencePreview?{referencePreview}:{})};
}

module.exports={narrationEvidence};
