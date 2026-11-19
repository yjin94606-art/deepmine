'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const {createNarrator}=require('../scripts/work-narrator.cjs');
const item={id:'receipt/1@v2',locale:'zh-CN',type:'table',title:'春日花圃',facts:['按日记录三种香草的浇水情况']};
const copy='薄荷、罗勒和迷迭香各占一行，今天轮到谁喝水，一眼就能查到。';
async function fixture(t,options){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'deepmine-narrator-test-'));
  const service=createNarrator({directory,selectEvidence:async ({process})=>({selections:process.map((row,turn)=>({turn,...row}))}),...options});
  t.after(async()=>{await service.close();await fs.rm(directory,{recursive:true,force:true});});
  async function settle(which=item){
    for(let i=0;i<200;i++){
      const status=await service.get(which);if(status.status!=='pending')return status;
      await delay(5);
    }
    assert.fail('short review did not settle');
  }
  return {service,directory,settle};
}
test('a newly illustrated work keeps its own validated palette cells on restart',async t=>{
  const {rows}=require('../dist/work-sketch.js');
  const grid=['..6666..','.677776.','67711776','67111176','.677776.','..6776..','...77...','...11...'];
  const doc={...item,type:'document',facts:['庭院里升起了一只红灯笼。']};
  const draw=async()=>({text:'那一点暖红把整个院子的夜色都照软了。',sketch:{subject:'红灯笼',rows:grid}});
  const f=await fixture(t,{generate:draw});await f.service.get(doc,{generate:true});
  const done=await f.settle(doc);assert.deepEqual(done.pixels,rows(grid));
  const reopened=createNarrator({directory:f.directory,generate:()=>assert.fail('cached illustration should be reused')});
  t.after(()=>reopened.close());assert.deepEqual(await reopened.get(doc),done);
  const other={...doc,id:doc.id+'-other',facts:['这份文档记录排水管道。']};
  await f.service.get(other,{generate:true});assert.equal((await f.settle(other)).pixels,undefined);
  assert.equal(rows(['123','22<script>']),null);
  assert.equal(rows(Array(9).fill('111111111')),null);
  assert.equal(rows(['123AB'.repeat(80)]),null);
});
test('upgrading an existing document keeps its completed note without another model call',async t=>{
  const record={...item,type:'document'};
  const recipe='making-of-target-2';
  const key=require('node:crypto').createHash('sha256').update(JSON.stringify([recipe,record.id,record.locale,record.type,record.title,record.facts,[]])).digest('hex');
  const f=await fixture(t,{generate:()=>assert.fail('rewrote a saved note')});
  await fs.writeFile(path.join(f.directory,key+'.json'),JSON.stringify({recipe,key,text:copy,basis:'work'}));
  assert.deepEqual(await f.service.get(record,{generate:true}),{status:'ready',text:copy,basis:'work'});
});
test('a final handoff is labeled separately from a creation exchange',async t=>{
  const record={...item,basis:'process',process:[{operation:'delivery',request:'Prepare a release trailer for the project.'}]};
  const f=await fixture(t,{generate:async()=>copy});
  await f.service.get(record,{generate:true});
  assert.equal((await f.settle(record)).basis,'delivery');
});
test('fully accepted creative turns finish in one model call, partial turns get an independent rewrite',async t=>{
  let checks=0,rewrites=0;
  const service=await fixture(t,{selectEvidence:async({process})=>{
    checks++;
    const request=process[0].request.split('。')[0];
    return {selections:[{turn:0,request}],text:copy};
  },generate:async material=>{
    rewrites++;assert.ok(!JSON.stringify(material).includes('旁边的温室'));
    return '三种香草在表里排好了队，轮到谁浇水一眼就看得清。';
  }});
  const first={...item,basis:'process',process:[{operation:'edit',request:'给表格加上单独记录浇水的日期栏'}]};
  const mixed={...first,process:[{operation:'edit',request:first.process[0].request+'。旁边的温室还缺一张插画'}]};
  await service.service.get(first,{generate:true});
  assert.equal((await service.settle(first)).text,copy);assert.equal(checks,1);assert.equal(rewrites,0);
  await service.service.get(mixed,{generate:true});
  assert.notEqual((await service.settle(mixed)).text,copy);assert.equal(checks,2);assert.equal(rewrites,1);
});
test('only explicitly selected works are generated and a stable edition reuses its review on restart',async t=>{
  const seen=[];
  const {service,settle,directory}=await fixture(t,{generate:async e=>{seen.push(e);return e.locale==='en'?'Three herbs take turns at the watering can.':copy;}});
  assert.equal((await service.get(item)).status,'idle');
  await Promise.all(Array.from({length:12},()=>service.get(item,{generate:true})));
  assert.deepEqual(await settle(),{status:'ready',text:copy,basis:'work'});assert.equal(seen.length,1);
  const other=createNarrator({directory,generate:()=>assert.fail('used model for disk cache')});
  t.after(()=>other.close());
  assert.equal((await other.get(item,{generate:true})).text,copy);
  for(const changed of [{...item,locale:'en'},{...item,facts:['新增了香草品种一栏']},{...item,id:'receipt/1@v3'}]){
    assert.equal((await other.get(changed)).status,'idle');
    await service.get(changed,{generate:true}); assert.equal((await settle(changed)).status,'ready');
  }
  assert.equal(seen.length,4);
});
test('a raw request or secret cannot leak through prose sent to the writer or be used as the resulting card',async t=>{
  const quote='今天请先替我整理一份带有三种香草的浇水登记表';
  const record={...item,quote,title:quote,facts:[quote,'Authorization: Bearer secretvalue','C:\\Users\\Alice\\private.md','表格有日期和轮值人两栏']};
  let observed;
  const f=await fixture(t,{generate:async evidence=>{observed=evidence;return '日历里写着：'+quote+'。';}});
  await f.service.get(record,{generate:true});
  assert.equal((await f.settle(record)).reason,'invalid_response');
  assert.equal(observed.title,'');assert.deepEqual(observed.facts,['表格有日期和轮值人两栏']);
  assert.ok(!JSON.stringify(observed).includes(quote));assert.equal(observed.id,undefined);
  assert.deepEqual(await fs.readdir(f.directory),[]);
});
test('switching starts a second selected work and leaves no waiting jobs after the player moves on',async t=>{
  let now=100,live=0,peak=0,calls=0;
  const gates=[];
  const {service,settle}=await fixture(t,{now:()=>now,cooldownMs:40,generate:async(_input,signal)=>{
    const call=++calls;peak=Math.max(peak,++live);
    await new Promise(resolve=>{gates.push(resolve);signal.addEventListener('abort',resolve,{once:true});});--live;
    if(call===1)throw Object.assign(new Error(),{code:'login'});
    return copy;
  }});
  const records=Array.from({length:5},(_,i)=>({...item,id:'receipt-'+i}));
  const started=[];
  for(const record of records)started.push((await service.get(record,{generate:true})).status);
  assert.deepEqual(started,['pending','pending','busy','busy','busy']);
  gates[0]();gates[1]();
  assert.equal((await settle(records[0])).reason,'login');
  assert.equal((await settle(records[1])).text,copy);
  assert.equal((await service.get(records[4],{generate:true})).reason,'login');
  assert.equal(calls,2);now+=100;
  assert.equal((await service.get(records[2])).status,'idle');
  await service.get(records[2],{generate:true});
  gates[2]();
  assert.equal((await settle(records[2])).text,copy);assert.equal(peak,2);assert.equal(calls,3);
});
test('shutdown cancels in-flight editing and queued cards do not reach the model',async t=>{
  let calls=0;
  const f=await fixture(t,{generate:(_e,signal)=>new Promise((_,reject)=>{
    calls++;signal.addEventListener('abort',()=>reject(Error('closed')),{once:true});
  })});
  await f.service.get(item,{generate:true});await f.service.get({...item,id:'next'},{generate:true});
  assert.equal((await f.service.get({...item,id:'third'},{generate:true})).status,'busy');
  await f.service.close();assert.equal(calls,2);assert.deepEqual(await fs.readdir(f.directory),[]);
  assert.equal((await f.service.get(item,{generate:true})).reason,'closed');
});
test('a card must use the selected language and fresh prose',async t=>{
  for(const [locale,text] of [['ja',copy],['en',copy],['zh-CN',item.title]]){
    const record={...item,locale};
    const f=await fixture(t,{generate:async()=>text});
    await f.service.get(record,{generate:true});assert.equal((await f.settle(record)).reason,'invalid_response');
  }
});
test('a missing configured CLI returns an unavailable state without generating substitute prose',async t=>{
  const f=await fixture(t,{codexPath:path.join(os.tmpdir(),'deepmine-no-such-cli','codex')});
  await f.service.get(item,{generate:true});
  const result=await f.settle();
  assert.equal(result.status,'unavailable');assert.equal(result.reason,'cli_missing');
  assert.equal(result.text,undefined);
});

test('enabled process cues reach the writer in order, private fields stay local, and changed evidence uses a separate cache',async t=>{
  const seen=[];
  const make=async e=>{seen.push(e);return e.process.length?'金黄围巾从长款改成了短款，这位蓝发植物学家的脖子也有自己的试衣间。':'蓝发植物学家把一抹黄色系在了领口。';};
  const f=await fixture(t,{generate:make});
  const base={...item,type:'image',title:'植物学家立绘',facts:['一位蓝发的二次元人物。']};
  const turns=[{request:'请给蓝发植物学家配一条长长的金色围巾。',operation:'create'},
    {request:'围巾太长，麻烦收成一条方便活动的短款。',reply:'已把长度收在领口，保留原有的金黄。',operation:'edit'}];
  await f.service.get(base,{generate:true});assert.equal((await f.settle(base)).status,'ready');
  const record={...base,basis:'process',process:turns};
  assert.equal((await f.service.get(record)).status,'idle');
  await f.service.get(record,{generate:true});assert.equal((await f.settle(record)).status,'ready');
  assert.deepEqual(seen[0].process,[]);assert.deepEqual(seen[1].process,turns);
  assert.equal((await f.service.get({...record,process:turns.slice(0,1)})).status,'idle');
  for(const name of await fs.readdir(f.directory)){
    const data=await fs.readFile(path.join(f.directory,name),'utf8');
    assert(!data.includes('请给蓝发'));assert(!data.includes('方便活动'));
  }
  const redacted=await fixture(t,{generate:async e=>{assert.deepEqual(e.process,[]);return copy;}});
  const off={...record,basis:'work'};
  await redacted.service.get(off,{generate:true});assert.equal((await redacted.settle(off)).status,'ready');
});

test('rejects direct dialogue replay and persistence invented without linked revisions',async t=>{
  const part='请把灯笼右边画上一朵金色的山茶花，别动左边的圆窗。';
  const record={...item,basis:'process',process:[{request:part,operation:'create'}]};
  for(const text of ['画面记录了'+part,'为了那盏灯笼，你来来回回改了五次。']){
    const f=await fixture(t,{generate:async()=>text});await f.service.get(record,{generate:true});
    assert.equal((await f.settle(record)).reason,'invalid_response');
  }
});

test('the writer gets one assistant note for a discussion, without invented user turns or file operations',async t=>{
  const reply='要是给风筝搭一条燕尾形的尾巴，说不定远看像一只真的燕子。';
  const prose='风筝还在纸上，两截燕尾倒是先有了主意，远看说不定能混进鸟群。';
  const f=await fixture(t,{generate:async e=>{
    assert.deepEqual(e.process,[{operation:'note',reply}]);return prose;
  }});
  const memory={...item,type:'memory',title:'一段对话笔记',basis:'process',quote:reply,process:[
    {operation:'create',request:'冒充作品回执'},{operation:'note',request:'冒充用户提议',reply},
    {operation:'note',reply:'另一个不相干的点子。'}]};
  await f.service.get(memory,{generate:true});
  assert.equal((await f.settle(memory)).text,prose);
});

test('a request about a different deliverable cannot reach the writer when role selection rejects it, including on a disk-cache read',async t=>{
  const request='请重新写这个物品的介绍。比如它是动画角色，就用人话告诉我画的是什么。';
  const designBrief='Draw a yellow scarf beneath a rain-dark umbrella.';
  const record={...item,type:'image',title:'雨中人物',facts:['图片里有一把雨伞。'],basis:'process',
    process:[{operation:'create',request,designBrief}]};
  let supplied;
  const f=await fixture(t,{selectEvidence:async e=>{
    assert.equal(e.process[0].request,request);
    return {selections:[{turn:0,request:'',reply:'',designBrief:'a yellow scarf beneath a rain-dark umbrella'}]};
  },generate:async e=>{supplied=e;return '这张人物图的配色拿黄围巾和雨伞唱了出对台戏。';}});
  await f.service.get(record,{generate:true});
  const result=await f.settle(record);
  assert.equal(result.basis,'design');
  assert.deepEqual(supplied.process,[{operation:'create',designBrief:'a yellow scarf beneath a rain-dark umbrella'}]);
  assert(!JSON.stringify(supplied).includes('介绍'));
  const reopened=createNarrator({directory:f.directory,selectEvidence:()=>assert.fail('rechecked disk cache')});
  t.after(()=>reopened.close());assert.deepEqual(await reopened.get(record),result);
  const [cache]=await fs.readdir(f.directory);
  assert(!JSON.stringify(JSON.parse(await fs.readFile(path.join(f.directory,cache)))).includes('scarf'));
});

test('irrelevant context becomes a fact-only card; invented spans or switching the author of a detail never reach the writer',async t=>{
  const record={...item,basis:'process',process:[{operation:'create',request:'文章里引用这张表作例子。',reply:'表格用绿色列标区分浇水任务。'}]};
  const f=await fixture(t,{selectEvidence:async()=>({selections:[]}),generate:async e=>{assert.deepEqual(e.process,[]);return copy;}});
  await f.service.get(record,{generate:true});assert.equal((await f.settle(record)).basis,'work');
  for(const selection of [{turn:9,request:'随意的指令'},{turn:0,request:'用绿色列标区分浇水任务'}]){
    const bad=await fixture(t,{selectEvidence:async()=>({selections:[selection]}),generate:e=>{assert.deepEqual(e.process,[]);return copy;}});
    await bad.service.get(record,{generate:true});assert.equal((await bad.settle(record)).basis,'work');
  }
});
