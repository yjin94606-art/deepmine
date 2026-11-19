'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {start}=require('../scripts/server.cjs');
const L=require('../dist/gallery-ledger.js'),F=require('../dist/work-findings.js');
const Story=require('../dist/item-story.js');
const {createEventStore}=require('../scripts/event-store.cjs');
const {normalizeEvent}=require('../scripts/event-ingest.cjs');

test('a completed single-file receipt can price a particular revision without charging the daily ledger twice',async t=>{
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'deepmine-meter-'));
  t.after(()=>fs.rm(scratch,{recursive:true,force:true}));
  const opts={directory:scratch,projectPath:scratch,projectId:'a123456789abcdef'};
  const stamp=new Date(Date.now()-1000).toISOString(),fingerprint='a'.repeat(64),file='poster.png';
  const raw={kind:'output',schemaVersion:1,source:'artist-sdk',id:'image-one',sessionId:'call-1',timestamp:stamp,projectPath:scratch,
    output:{type:'image',title:'Test poster',files:[file],fingerprint,receipt:{status:'completed',path:file,sha256:fingerprint,
      sourceRef:'response-1',operation:'create',usage:{inputTokens:700,cachedInputTokens:200,outputTokens:200,totalTokens:900}}}};
  const store=createEventStore(opts);await store.append(normalizeEvent(raw,opts));
  const result=await store.project([stamp.slice(0,10)],'UTC');
  assert.equal(result.usage.length,0);
  assert.equal(result.outputs[0].traces[0].workTokens,900);
  raw.output.receipt.usage.totalTokens++;
  assert.throws(()=>normalizeEvent(raw,opts));
});

test('workshop persists individual editions, charges upgrades once and rejects stale or unearned actions',async t=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'deepmine-workshop-')),project=path.join(home,'project');
  await fs.mkdir(project);
  const options={projectPath:project,scopePath:project,dataDirectory:path.join(home,'save'),historyDays:2,
    sources:{codex:false,claude:false,git:false,imports:false},outputDirs:['.'],ingestionKey:'test-workshop',port:0};
  await fs.writeFile(path.join(project,'first.md'),'# A vessel\nA copper kettle with a tall handle.');
  await fs.writeFile(path.join(project,'second.md'),'# On wind\nA balloon flies above the town.');
  let app=await start(options);
  t.after(async()=>{await new Promise(r=>app.server.close(r));await fs.rm(home,{recursive:true,force:true});});
  const url=()=> 'http://127.0.0.1:'+app.port;
  async function post(route,client,data){
    const res=await fetch(url()+route,{method:'POST',headers:{'Content-Type':'application/json','X-Deepmine-Client':client},body:JSON.stringify(data)});
    return [res.status,await res.json()];
  }
  const snap=await app.snapshot();
  const item=F.build(snap).find(i=>i.visualType==='document');
  assert.ok(item);
  const works=Story.works(item,snap);assert.equal(works.length,2);
  assert.deepEqual(L.quote(works[0]),{coins:6,tokens:null});
  assert.deepEqual(L.quote({trace:{workTokens:900}}),{coins:9,tokens:900});
  const edition=L.edition(item,works[0]);
  const sell={id:item.id,edition,action:'sell',revision:0};
  assert.equal((await post('/api/gallery','gallery',sell))[0],409);
  await post('/api/mining','mining',{action:'start'});
  await post('/api/mining','mining',{action:'progress',depth:snap.mining.earnedDepth});
  const ask=data=>post('/api/gallery','gallery',data);
  const [a,b]=await Promise.all([ask(sell),ask(sell)]);
  assert.deepEqual([a[0],b[0]].sort(),[200,409]);
  const sold=a[0]===200?a[1]:b[1];assert.equal(sold.coins,6);
  assert.equal(L.members(item,snap,sold).length,1);
  assert.equal((await ask({...sell,revision:1}))[0],409);
  const bought=(await ask({action:'upgrade',style:'lamp',revision:1}))[1];
  assert.deepEqual(bought.upgrades,['lamp']);assert.equal(bought.coins,0);
  assert.equal((await ask({action:'upgrade',style:'tile',revision:2}))[0],409);
  assert.equal((await ask({action:'move',id:item.id,side:-1,row:9,revision:2}))[0],409);
  const moved=(await ask({action:'move',id:item.id,side:1,row:-2,revision:2}))[1];
  assert.deepEqual(moved.positions[item.id],{side:1,row:-2,edition:L.edition(item,works[1])});
  const last=L.edition(item,works[1]);
  const removed=(await ask({action:'discard',revision:3,id:item.id,edition:last}))[1];
  assert.equal(L.available(item,snap,removed),false);assert.equal(removed.coins,0);
  await new Promise(r=>app.server.close(r));app=await start(options);
  const restored=await (await fetch(url()+'/api/gallery')).json();
  assert.deepEqual(restored,removed);
  assert.deepEqual(await fs.readdir(project),['first.md','second.md']);
});
