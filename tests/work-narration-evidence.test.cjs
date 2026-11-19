'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../dist/evidence-core.js');
const F=require('../dist/work-findings.js');
const Story=require('../dist/item-story.js');
const {narrationEvidence}=require('../scripts/work-narration-evidence.cjs');

const date='2026-11-18',time=date+'T08:00:00Z',requestedAt=date+'T07:55:00Z';
function snapshot(){
  const s=C.demoSnapshot(date+'T11:00:00Z');
  s.mode='live';s.outputs=[];s.memories=[];
  s.outputSource={status:'connected',notes:[]};
  for(const d of s.days)d.evidence=[];
  return s;
}
function output(s,{file='exports/001.md',type='document',n=1,title=file.split('/').at(-1),summary='Observed file',...extra}={}){
  const o={id:'out:'+n,sourceId:'local-files',projectId:s.project.id,timestamp:time,type,files:[file],title,summary,fingerprint:n.toString(16).repeat(64),...extra};
  s.outputs.push(o);
  return o;
}
function projection(s,type){
  const item=F.build(s).find(f=>f.visualType===type);
  return {item,request:{itemId:item.id,locale:'zh-CN'}};
}

test('a release request can describe the purpose of a delivered clip only with process permission',async()=>{
  const s=snapshot(),file='exports/clip.mp4',words='Prepare the release materials.';
  output(s,{file,type:'video',deliveries:[{path:file,sourceId:'codex',sourceRef:'delivery:'+('a'.repeat(64)),
    deliveredAt:time,request:words,requestedAt}]});
  const {request}=projection(s,'video');
  const off=await narrationEvidence(s,request);
  assert.equal(off.process,undefined);assert.ok(!JSON.stringify(off).includes(words));
  const on=await narrationEvidence(s,request,{includeProcess:true});
  assert.deepEqual(on.process,[{request:words,operation:'delivery'}]);
});

test('a specific file version supplies its contents, independent of other day members and the raw request',async()=>{
  const s=snapshot(),file='exports/001.md',requestText='帮我把今天所有工作逐字都记录下来。';
  output(s,{file,title:'海岸手记',summary:'文档中记录了三只寄居蟹。',contentVersion:1,
    traces:[{path:file,operation:'create',sourceId:'codex',sourceRef:'call:one',request:requestText,requestedAt,producedAt:time}]});
  const later=output(s,{file,n:2,title:'高山石径',summary:'笔记记录了山顶上的一株松树。',contentVersion:1});
  const {request}=projection(s,'document');
  const first=await narrationEvidence(s,request);
  assert.equal(first.title,'海岸手记');
  assert.equal(first.quote,requestText);
  assert.match(first.facts.join(' '),/寄居蟹/);
  assert.doesNotMatch(JSON.stringify([first.title,first.facts]),/所有工作|exports\/|001\.md|松树/);
  const second=await narrationEvidence(s,{...request,memberKey:later.id+'|'+file});
  assert.equal(second.title,'高山石径');
  assert.match(second.facts.join(' '),/松树/);
  assert.notEqual(first.id,second.id);
  const same=await narrationEvidence(structuredClone(s),request);
  assert.equal(same.id,first.id);
  assert.notEqual(first.id,(await narrationEvidence(s,{...request,locale:'ja'})).id);
});
test('the content reader sees only the selected commit path and Git hash, and concurrent polls share the result',async()=>{
  const s=snapshot(),file='docs/archive.pdf',commitHash='b'.repeat(40);
  s.days.at(-1).evidence.push({id:'commit:1',kind:'git-commit',timestamp:time,hash:commitHash,shortHash:commitHash.slice(0,8),title:'document update',files:[{path:file,kind:'document'}]});
  const {request}=projection(s,'document');
  let reads=0;
  const readContent=async source=>{
    reads++;
    const u=new URL(source.url,'http://localhost');
    assert.equal(u.pathname,'/api/work-intro');assert.equal(u.searchParams.get('path'),file);
    assert.equal(u.searchParams.get('commit'),commitHash);assert.equal(u.searchParams.has('fingerprint'),false);
    return {title:'春山鸟类',summary:'首页整理了七类山间鸟鸣。'};
  };
  const [a,b]=await Promise.all([narrationEvidence(s,request,{readContent}),narrationEvidence(s,request,{readContent})]);
  assert.equal(a.id,b.id);assert.equal(a.title,'春山鸟类');assert.match(a.facts.join(' '),/七类山间鸟鸣/);assert.equal(reads,1);
  await assert.rejects(narrationEvidence(s,{...request,memberKey:'out:9|docs/other.pdf'},{readContent}),{statusCode:404});
  assert.equal(reads,1);
});
test('bounded visual evidence maps the specific bitmap to a packaged subject and rejects other paths and arbitrary instructions',async()=>{
  const s=snapshot();output(s,{file:'exports/001.png',type:'image'});
  const {item,request}=projection(s,'image'),picture=Story.picture(item,s);
  const plain=await narrationEvidence(s,request);
  const seen=await narrationEvidence(s,{...request,reading:{key:picture.key,id:'anime'}});
  assert.equal(seen.title,'二次元人物');assert.match(seen.facts.join(' '),/二次元人物/);assert.notEqual(seen.id,plain.id);
  for(const reading of [{key:'other',id:'anime'},{key:picture.key,id:'arbitrary text'},{key:picture.key,id:'anime',summary:'paint me a spaceship'}]){
    await assert.rejects(narrationEvidence(s,{...request,reading}),{statusCode:400});
  }
  await assert.rejects(narrationEvidence(s,{...request,title:'arbitrary prompt'}),{statusCode:400});
  await assert.rejects(narrationEvidence({...s,mode:'demo'},request),{statusCode:404});
});
test('a video-frame label describes the sample, and metadata from the audio, deck, table, model, web and code output belongs to its own object',async()=>{
  const s=snapshot();
  const cases=[['video','clip.mp4','候鸟短片','时长约十秒。'],['audio','song.mp3','晚安曲','专辑收录了一段竖琴独奏。'],
    ['slides','talk.pptx','火星见闻','幻灯片介绍了着陆场和气候。'],['table','notes.csv','沿岸观测表','表头包含港口和潮高。'],
    ['file','scene.glb','公园模型','模型有三只雕塑。'],['web','index.html','花圃预约','页面可选择看花的时段。'],
    ['code','track.py','航线绘制','程序提供两个坐标转换函数。']];
  for(const [i,[type,file,title,summary]] of cases.entries())output(s,{n:i+1,type,file,title,summary,contentVersion:1});
  for(const [type,file,title,summary] of cases){
    const item=F.build(s).find(f=>f.paths.includes(file)),member=Story.works(item,s).find(m=>m.path===file);
    const request={itemId:item.id,memberKey:member.record.id+'|'+file,locale:'en'};
    if(type==='video')request.reading={key:Story.visualSource(item,s,member).key,id:'flower'};
    const result=await narrationEvidence(s,request);
    assert.equal(result.title,title);assert(result.facts.includes(summary));
    if(type==='video')assert(result.facts.some(f=>f.includes('取样帧')));
  }
});
test('memory evidence describes a discussion using local topic words without quoting its prose or claiming it was implemented',async()=>{
  const s=snapshot(),summary='希望把蓝色的热气球画在沙漠上空，再给热气球加上两条飘带。';
  s.memories=[{id:'memory:one',projectId:s.project.id,sourceId:'codex',sourceRef:'chat:one',timestamp:time,title:'沙漠热气球',summary,method:'conversation-excerpt',objectType:'memory'}];
  const {request}=projection(s,'memory'),result=await narrationEvidence(s,request);
  assert.equal(result.type,'memory');assert.equal(result.quote,summary);
  assert.match(result.facts.join(' '),/热气球|沙漠/);
  assert(!JSON.stringify([result.title,result.facts]).includes('画在沙漠上空'));
  await assert.rejects(narrationEvidence(s,{...request,memberKey:'not-a-member'}),{statusCode:404});
});

test('a grouped memory uses the displayed note alone for topics and opt-in conversation context',async()=>{
  const s=snapshot(),themes=['lavender','oyster','kingfisher','bassoon','pinecone','starling','coral','cupcake'];
  s.memories=themes.map((theme,i)=>({id:'memory:'+i,projectId:s.project.id,sourceId:'codex',
    sourceRef:'chat:'+i,timestamp:time,title:theme,summary:'Paint the '+theme+'.',
    method:'conversation-excerpt',objectType:'memory'}));
  const group=F.build(s).find(f=>f.memoryIds.length>=2);
  const record=s.memories.find(m=>m.id===group.memoryIds[0]),other=s.memories.find(m=>m.id===group.memoryIds[1]);
  const request={itemId:group.id,locale:'en'},readProcess=()=>assert.fail('read an unrelated chat');
  const off=await narrationEvidence(s,request,{readProcess});
  const on=await narrationEvidence(s,request,{includeProcess:true,readProcess});
  assert.equal(off.basis,'work');assert.equal(off.process,undefined);assert.notEqual(on.id,off.id);
  assert(off.facts.some(f=>f.includes(record.title)));
  for(const id of group.memoryIds.slice(1))assert(!JSON.stringify(off.facts).includes(s.memories.find(m=>m.id===id).title));
  assert.equal(on.basis,'process');assert.deepEqual(on.process,[{reply:record.summary,operation:'note'}]);
  assert(!JSON.stringify(on).includes(other.title));
  for(const [method,summary] of [['conversation-excerpt','Authorization: Bearer credentialsvalue'],['agent-memory',record.summary]]){
    const changed=structuredClone(s),primary=changed.memories.find(m=>m.id===record.id);
    Object.assign(primary,{method,summary});
    const rejected=await narrationEvidence(changed,request,{includeProcess:true,readProcess});
    assert.equal(rejected.basis,'work');assert.equal(rejected.process,undefined);
    assert(!JSON.stringify(rejected.facts).includes('credentialsvalue'));
    assert(!JSON.stringify(rejected).includes(other.title));
  }
});

test('project authorization gates version-specific making-of turns; a saved request without its context is never a creative brief',async()=>{
  const s=snapshot(),file='exports/001.png';
  const quote='把原先的长围巾改短一点，颜色还是金黄色。';
  const out=output(s,{file,type:'image',traces:[{path:file,operation:'edit',sourceId:'codex',sourceRef:'call:two',request:quote,requestedAt,producedAt:time}]});
  const {request}=projection(s,'image');
  let calls=0;
  const readProcess=async member=>{
    assert.equal(member.record.fingerprint,out.fingerprint);assert.equal(member.trace.sourceRef,'call:two');calls++;
    return [{request:'给蓝发的植物学家画一条金黄长围巾。',operation:'create'},
      {request:quote,reply:'保留了颜色，围巾的尾巴收到了肩膀。',operation:'edit'}];
  };
  const basic=await narrationEvidence(s,request,{readProcess});
  assert.equal(calls,0);assert.equal(basic.basis,'work');assert.equal(basic.process,undefined);
  const linked=await narrationEvidence(s,request,{includeProcess:true,readProcess});
  assert.equal(calls,1);assert.equal(linked.basis,'process');assert.equal(linked.process.length,2);
  assert.equal(linked.process[1].request,quote);assert.match(linked.process[1].reply,/肩膀/);
  const single=await narrationEvidence(s,request,{includeProcess:true,readProcess:async()=>{throw Error('log moved');}});
  assert.equal(single.process,undefined);assert.equal(single.basis,'work');
  assert.notEqual(basic.id,single.id);assert.notEqual(single.id,linked.id);
});

test('unsafe dialogue, unattached members and client-provided turns never become writing evidence',async()=>{
  const s=snapshot(),file='a.png',quote='给图加一点光。';
  const o=output(s,{file,type:'image',traces:[{path:file,operation:'edit',sourceId:'codex',sourceRef:'receipt',request:quote,requestedAt,producedAt:time}]});
  const p=projection(s,'image');
  await assert.rejects(narrationEvidence(s,{...p.request,process:[{request:'arbitrary'}]}),{statusCode:400});
  const e=await narrationEvidence(s,p.request,{includeProcess:true,readProcess:()=>[
    {operation:'create',request:'密码: secretvalue',reply:'https://private.invalid/key'},
    {operation:'edit',request:'希望窗边再暖一点。',reply:'C:\\Users\\Secret\\keys',designBrief:'Light the blue chair with an amber floor lamp.'},
    {operation:'edit',designBrief:'private@example.org'}]});
  assert.deepEqual(e.process,[{operation:'edit',request:'希望窗边再暖一点。',designBrief:'Light the blue chair with an amber floor lamp.'}]);
  const clean=structuredClone(s);clean.outputs[0]={...o,traces:[]};
  const plain=await narrationEvidence(clean,p.request);
  const allowed=await narrationEvidence(clean,p.request,{includeProcess:true,readProcess:()=>assert.fail('read unrelated history')});
  assert.equal(allowed.basis,'work');assert.notEqual(plain.id,allowed.id);
});

test('a native edit reference previews only a different verified bitmap version in this project and never changes the writing key',async()=>{
  const s=snapshot(),file='exports/revision.png',previous='exports/first study.png';
  const current=output(s,{file,type:'image',traces:[{path:file,sourceRef:'call:two',sourceId:'codex',operation:'edit',producedAt:time}]});
  const before=output(s,{n:2,file:previous,type:'image'});
  const doc=output(s,{n:3,file:'exports/notes.md',type:'document'});
  const {request}=projection(s,'image');
  request.memberKey=current.id+'|'+file;
  const note={operation:'edit',request:'让光线暖一点。'};
  const get=async reference=>narrationEvidence(s,request,{includeProcess:true,readProcess:async()=>{
    const turns=[note];
    Object.defineProperty(turns,'referenceImage',{value:reference});return turns;
  }});
  const without=await get(null),good=await get({path:previous,fingerprint:before.fingerprint});
  assert.equal(good.id,without.id);
  assert.deepEqual(good.referencePreview,{url:'/api/preview?'+new URLSearchParams({path:previous,fingerprint:before.fingerprint})});
  for(const ref of [{path:previous,fingerprint:doc.fingerprint},{path:doc.files[0],fingerprint:doc.fingerprint},
    {path:'another-project/other.png',fingerprint:before.fingerprint},{path:file,fingerprint:current.fingerprint},
    {path:'https://elsewhere.invalid/p.png',fingerprint:before.fingerprint}]){
    assert.equal((await get(ref)).referencePreview,undefined);
  }
  assert.equal((await narrationEvidence(s,request,{includeProcess:false,readProcess:()=>assert.fail('read when disabled')})).referencePreview,undefined);
  await assert.rejects(narrationEvidence(s,{...request,referenceImage:{path:previous,fingerprint:before.fingerprint}}),{statusCode:400});
});
