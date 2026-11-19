'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {setImmediate:nextTurn}=require('node:timers/promises');
const {create,modeOf,settingsFor}=require('../dist/work-narration.js');

test('legacy consent only enables writing from the work and memory consent is independent',()=>{
  assert.equal(modeOf({enabled:true,memoriesEnabled:true}),'work');
  assert.equal(modeOf({enabled:true,includeProcess:true,memoriesEnabled:false}),'process');
  assert.equal(modeOf({enabled:false,includeProcess:true}),'off');
  assert.deepEqual(settingsFor('off'),{enabled:false,includeProcess:false});
  assert.deepEqual(settingsFor('work'),{enabled:true,includeProcess:false});
  assert.deepEqual(settingsFor('process'),{enabled:true,includeProcess:true});
  assert.deepEqual(settingsFor('unknown'),settingsFor('off'));
});

const project='project-1',item={itemId:'day/document',memberKey:'record-1|notes/001.md',locale:'zh-CN'};
const response=data=>({ok:true,json:async()=>data});
test('the wall restores only cached sketches, serializes reads and discards replies after a consent change',async()=>{
  const {archivedSketches}=require('../dist/work-narration.js');
  const requests=[],restored=[];
  const reader=archivedSketches((url,options)=>new Promise(resolve=>requests.push({options,resolve})),()=>{});
  const restore=pixels=>restored.push(pixels);
  const stale=reader.read('first',item,'process',restore);
  assert.equal(reader.needs('second'),false);
  assert.equal(requests[0].options.headers['X-Deepmine-Cache'],'only');
  reader.reset();
  const result={status:'ready',basis:'process',pixels:['123']};
  requests[0].resolve(response(result));await stale;assert.deepEqual(restored,[]);
  const privateNote=reader.read('second',item,'work',restore);
  requests[1].resolve(response(result));await privateNote;assert.deepEqual(restored,[]);
  const previous=reader.read('third',item,'work',restore);
  requests[2].resolve(response({...result,basis:'work'}));await previous;
  assert.deepEqual(restored,[result.pixels]);assert.equal(reader.needs('third'),false);
  reader.forget('third');assert.equal(reader.needs('third'),true);
});
test('a generated sketch follows the discovery, work version, project, language and narration permission',()=>{
  const {illustrationKey}=require('../dist/work-sketch.js');
  const original=['day-1/document','record-1|notes/001.md','project/notes/001.md/same-digest','en','work'];
  const cached=new Map([[illustrationKey(...original),'blue clock']]);
  assert.equal(cached.get(illustrationKey(...original)),'blue clock');
  for(const [index,next] of [[0,'day-2/document'],[1,'record-2|notes/001.md'],[2,'other-project/notes/001.md/same-digest'],
    [2,'project/notes/001.md/changed-digest'],[3,'ja'],[4,'process'],[4,'off']]){
    const another=original.slice();another[index]=next;
    assert.equal(cached.get(illustrationKey(...another)),undefined);
  }
});
function fixture(){
  const pending=[],timers=new Set(),updates=[];
  const reader=create({request:(url,init)=>new Promise(resolve=>pending.push({url,init,resolve})),
    changed:()=>updates.push(true),schedule:fn=>{timers.add(fn);return fn;},cancel:fn=>timers.delete(fn)});
  return {reader,pending,timers,updates};
}

test('popup, detail and hover share one short description for the exact work',async()=>{
  const {reader,pending,timers}=fixture();
  assert.equal(reader.select(project,'hash-1',item,420).status,'pending');
  assert.equal(timers.size,1); assert.equal(pending.length,0);
  reader.select(project,'hash-1',item);
  reader.select(project,'hash-1',item);
  assert.equal(pending.length,1); assert.equal(timers.size,0);
  const req=pending[0];
  assert.equal(req.url,'/api/work-narration'); assert.equal(req.init.headers['X-Deepmine-Client'],'work-narration');
  assert.deepEqual(JSON.parse(req.init.body),item);
  req.resolve(response({status:'ready',text:'今天，潮池里的寄居蟹也上了观察名单。'}));await nextTurn();
  reader.clear();
  assert.match(reader.select(project,'hash-1',item,420).text,/寄居蟹/);
  assert.equal(pending.length,1);
});

test('brief hovers never launch a job, and closing cancels polling',async()=>{
  const {reader,pending,timers}=fixture();
  reader.select(project,'hash',item,420);
  reader.clear();
  assert.equal(timers.size,0); assert.equal(pending.length,0);
  reader.select(project,'hash',item);
  pending[0].resolve(response({status:'pending'}));await nextTurn();
  assert.equal(timers.size,1);
  reader.clear();
  assert.equal(timers.size,0);
});
test('hovering across a hundred finds starts zero jobs and preserves the card being read',async()=>{
  const {reader,pending,timers}=fixture();
  for(let i=0;i<100;i++)assert.equal(reader.peek(project,'hash',{...item,itemId:'find-'+i}).status,'idle');
  assert.equal(pending.length,0);assert.equal(timers.size,0);
  reader.select(project,'hash',item);
  reader.peek(project,'hash',{...item,itemId:'another'});
  assert.equal(pending[0].init.signal.aborted,false);
  pending[0].resolve(response({status:'ready',text:'潮池里留下了寄居蟹的观察记录。'}));await nextTurn();
  assert.match(reader.peek(project,'hash',item).text,/寄居蟹/);
  assert.equal(reader.peek(project,'updated',item).status,'idle');
  assert.equal(reader.peek(project,'hash',item,'off').status,'disabled');
});
test('a resting hover requests disk cache only, and opening a miss promotes it to a normal request',async()=>{
  const {reader,pending,timers}=fixture();
  for(let i=0;i<100;i++)reader.select(project,'hash',{...item,itemId:'find-'+i},420,'work',true);
  assert.equal(timers.size,1);assert.equal(pending.length,0);
  const display={...item,itemId:'find-99'};
  [...timers][0]();assert.equal(pending.length,1);
  assert.equal(pending[0].init.headers['X-Deepmine-Cache'],'only');
  pending[0].resolve(response({status:'idle'}));await nextTurn();
  assert.equal(reader.select(project,'hash',display,420,'work',true).status,'idle');
  assert.equal(reader.select(project,'hash',display).status,'pending');
  assert.equal(pending.length,2);assert.equal(pending[1].init.headers['X-Deepmine-Cache'],undefined);
  pending[1].resolve(response({status:'pending',pollId:'local-receipt'}));await nextTurn();
  [...timers].at(-1)();assert.deepEqual(JSON.parse(pending[2].init.body),{pollId:'local-receipt'});
  pending[2].resolve(response({status:'ready',text:'A small crab chart.'}));await nextTurn();
});

test('returning to an unfinished opening uses its ticket and late pixel classification cannot start a parallel rewrite',async()=>{
  const {reader,pending}=fixture();
  const other={...item,itemId:'other'},read={...item,reading:{id:'bird',key:'canvas-1'}};
  reader.select(project,'art-v1',item);
  pending[0].resolve(response({status:'pending',pollId:'old-work'}));await nextTurn();
  reader.select(project,'art-v1',read);assert.equal(pending.length,1);
  reader.select(project,'other-v1',other);reader.select(project,'art-v1',item);
  assert.deepEqual(JSON.parse(pending[2].init.body),{pollId:'old-work'});
  pending[2].resolve(response({status:'ready',text:'The pier is ready for its first guest.'}));await nextTurn();
  assert.equal(reader.select(project,'art-v1',read).status,'ready');assert.equal(pending.length,3);
  reader.reset();reader.select(project,'art-v1',read);
  assert.deepEqual(JSON.parse(pending[3].init.body),read);
  pending[1].resolve(response({status:'disabled'}));pending[3].resolve(response({status:'disabled'}));await nextTurn();
});
test('an old reply cannot replace the description of another version, language or project',async()=>{
  const {reader,pending,updates}=fixture();
  reader.select(project,'sha-a',item);
  const en={...item,locale:'en'};
  reader.select(project,'sha-a',en);
  assert.ok(pending[0].init.signal.aborted);
  pending[0].resolve(response({status:'ready',text:'旧语言的介绍。'}));await nextTurn();
  assert.equal(updates.length,0);
  pending[1].resolve(response({status:'ready',text:'One hermit crab made the roll call.'}));await nextTurn();
  assert.match(reader.select(project,'sha-a',en).text,/hermit/);
  assert.equal(reader.select(project,'sha-b',en).status,'pending');
  assert.equal(reader.select('project-2','sha-a',en).status,'pending');
  assert.equal(reader.select(project,'sha-a',{...en,memberKey:'record-2|notes/001.md'}).status,'pending');
  assert.equal(pending.length,5);
  reader.clear();
  for(const old of pending.slice(2))old.resolve(response({status:'unavailable'}));
  await nextTurn();
});

test('opt-out, invalid responses and failures never become a generated comment',async()=>{
  const {reader,pending}=fixture();
  reader.select(project,'memory-1',{...item,memberKey:''});
  pending[0].resolve(response({status:'disabled'}));await nextTurn();
  assert.deepEqual(reader.select(project,'memory-1',{...item,memberKey:''}),{status:'disabled'});
  reader.reset();
  reader.select(project,'hash',item);
  pending[1].resolve(response({status:'ready',text:' '}));await nextTurn();
  assert.equal(reader.select(project,'hash',item).status,'unavailable');
  reader.clear();reader.select(project,'hash',item);
  pending[2].resolve({ok:false,json:async()=>({status:'ready',text:'invalid'})});await nextTurn();
  assert.deepEqual(reader.select(project,'hash',item),{status:'unavailable'});
});

test('permission changes isolate cached process stories and ignore replies from earlier scopes',async()=>{
  const {reader,pending}=fixture();
  const select=mode=>reader.select(project,'version',item,0,mode);
  select('process');
  pending[0].resolve(response({status:'ready',basis:'process',text:'A story about the edit.'}));await nextTurn();
  assert.equal(select('process').basis,'process');
  assert.equal(select('work').status,'pending');
  pending[1].resolve(response({status:'ready',basis:'process',text:'A disallowed story.'}));await nextTurn();
  assert.equal(select('work').status,'unavailable');
  assert.equal(select('off').status,'disabled');
  assert.equal(select('process').status,'pending');
  select('work');
  pending[2].resolve(response({status:'ready',basis:'process',text:'A late reply.'}));await nextTurn();
  assert.equal(select('work').status,'pending');
  pending[3].resolve(response({status:'ready',basis:'work',text:'A story about the work.'}));await nextTurn();
  assert.equal(select('work').basis,'work');
});

test('artist instructions keep their own attribution and need process permission',async()=>{
  const {reader,pending}=fixture();
  const select=mode=>reader.select(project,'painting',item,0,mode);
  const design={status:'ready',basis:'design',text:'The artist chose an ochre scarf.'};
  select('process');pending[0].resolve(response(design));await nextTurn();
  assert.deepEqual(select('process'),design);
  select('work');pending[1].resolve(response(design));await nextTurn();
  assert.equal(select('work').status,'unavailable');
});

test('only a version-bound previous draft from the local preview can accompany a creative note',async()=>{
  const digest='a'.repeat(64);
  const path='/api/preview?path=art%2Frough.png&fingerprint='+digest;
  const {reader,pending}=fixture();
  async function result(url,basis='process',mode='process'){
    const id=String(pending.length);
    reader.select(project,id,item,0,mode);
    pending.at(-1).resolve(response({status:'ready',basis,text:'A copper drill.',referencePreview:{url}}));
    await nextTurn();
    return reader.select(project,id,item,0,mode);
  }
  assert.deepEqual((await result(path)).referencePreview,{url:path});
  const git='/api/preview?path=art%2Frough.png&commit='+'b'.repeat(40);
  assert.deepEqual((await result(git,'design')).referencePreview,{url:git});
  assert.equal((await result(path,'work','work')).referencePreview,undefined);
  const delivery=await result(path,'delivery','process');
  assert.equal(delivery.basis,'delivery');
  assert.equal(delivery.referencePreview,undefined);
  assert.equal((await result(path,'delivery','work')).status,'unavailable');
  for(const url of ['https://elsewhere.test'+path,'//elsewhere.test'+path,'data:image/png,x','/api/work-intro?path=a.png',
    '/api/preview?path=a.png','/api/preview?path=a.png&fingerprint=wrong',
    path+'&path=other.png',path.replace('art%2F','..%2F'),path.replace('rough.png','rough.html')]){
    assert.equal((await result(url)).referencePreview,undefined,url);
  }
});

test('switching works or withdrawing creative permission immediately drops the previous-draft image',async()=>{
  const {reader,pending}=fixture();
  const first={status:'ready',basis:'process',text:'A green cave.',referencePreview:{url:'/api/preview?path=cave.png&fingerprint='+'c'.repeat(64)}};
  reader.select(project,'draft-a',item,0,'process');pending.at(-1).resolve(response(first));await nextTurn();
  assert.deepEqual(reader.select(project,'draft-a',item,0,'process').referencePreview,first.referencePreview);
  assert.equal(reader.select(project,'draft-b',item,0,'process').referencePreview,undefined);
  assert.equal(reader.select(project,'draft-b',item,0,'work').referencePreview,undefined);
  pending[1].resolve(response(first));await nextTurn();
  assert.equal(reader.select(project,'draft-b',item,0,'work').referencePreview,undefined);
  pending[2].resolve(response({...first,basis:'work'}));await nextTurn();
  assert.equal(reader.select(project,'draft-b',item,0,'work').referencePreview,undefined);
  assert.equal(reader.select(project,'draft-a',item,0,'off').referencePreview,undefined);
});

test('a full queue is polled, and a model cooldown is kept for manual retry',async()=>{
  const {reader,pending,timers}=fixture();
  reader.select(project,'hash',item);
  pending[0].resolve(response({status:'busy'}));await nextTurn();
  assert.equal(timers.size,1);
  const poll=[...timers][0];timers.delete(poll);poll();
  pending[1].resolve(response({status:'unavailable',retryAfterMs:60000}));await nextTurn();
  assert.equal(reader.select(project,'hash',item).status,'unavailable');
  assert.ok(reader.remainingWait()>0 && reader.remainingWait()<=60000);
  reader.clear(); assert.equal(reader.remainingWait(),0);
});
