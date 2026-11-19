'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const C=require('../dist/evidence-core.js'),{createHistory,unknown}=require('../scripts/history-store.cjs');
const clone=value=>JSON.parse(JSON.stringify(value)),projectId='history-fixture';
test('the UTC survey counts confirmed positive manual progress across restarts and excludes local-midnight settlement',async t=>{
  const directory=fixture(t);let clock=new Date('2026-11-18T11:00:00Z');
  const config={directory,projectId,now:()=>clock};
  let history=createHistory(config);await history.reconcile(snapshot());await history.command({action:'start'});
  await history.command({action:'progress',depth:26});await history.command({action:'progress',depth:26});
  const day={day:'2026-11-18',meters:26};
  assert.deepEqual(await history.getSurvey(),{...day,stamps:[day]});
  assert.deepEqual(await history.getSurvey({includeStamps:false}),day);
  clock=new Date('2026-11-18T17:00:00Z');history=createHistory(config);
  await history.command({action:'pause'});assert.equal((await history.getSurvey()).meters,26);
  clock=new Date('2026-11-19T00:00:01Z');assert.deepEqual(await history.getSurvey(),{day:'2026-11-19',meters:0,stamps:[day]});
});

test('a saved generic function count upgrades in place when the same file can now explain its purpose',async t=>{
  const history=createHistory({directory:fixture(t),projectId}),fresh=snapshot();
  const file={id:'file:route',projectId,sourceId:'local-files',timestamp:'2026-11-18T02:00:00.000Z',type:'code',
    files:['exports/route.js'],fingerprint:'b'.repeat(64),contentVersion:1,title:'程序函数',summary:'这份代码把处理步骤写成函数。其中能读到 1 处函数定义。'};
  fresh.outputs=[file];fresh.outputSource={status:'connected',notes:[]};await history.reconcile(fresh);
  const revised={...file,title:'最短路线',summary:'程序里有专门用来在起点和终点之间寻找最短路线的函数。'};
  fresh.outputs=[revised];const {outputs}=await history.reconcile(fresh);
  assert.equal(outputs.length,1);assert.equal(outputs[0].title,revised.title);assert.equal(outputs[0].timestamp,file.timestamp);
});

test('rescanning the same recording enriches a duration-only save and keeps its discovery identity',async t=>{
  const history=createHistory({directory:fixture(t),projectId}),fresh=snapshot();
  const file={id:'file:bells',projectId,sourceId:'local-files',timestamp:'2026-11-18T03:00:00.000Z',type:'audio',
    files:['exports/bells.wav'],fingerprint:'c'.repeat(64),contentVersion:1,title:'Three bells',summary:'全长4 秒。'};
  fresh.outputs=[file];fresh.outputSource={status:'connected',notes:[]};await history.reconcile(fresh);
  const description='全长4 秒，声音明显响起三次，每次之间都轻了下来。';
  fresh.outputs=[{...file,summary:description}];const {outputs}=await history.reconcile(fresh);
  assert.equal(outputs.length,1);assert.equal(outputs[0].id,file.id);assert.equal(outputs[0].summary,description);
});

test('per-provider daily totals separate mixed usage, include observed zero, preserve unknown and survive a restart',async t=>{
  const directory=fixture(t), history=createHistory({directory,projectId}), s=snapshot(), date=s.days[0].date;
  const withTokens=n=>({inputTokens:n,cachedInputTokens:0,outputTokens:0,totalTokens:n,reasoningOutputTokens:0,cacheWriteInputTokens:0,sessions:n?1:0,quality:'observed'});
  const provider=(id,total)=>({source:{id,label:id,method:'fixture',notes:[],status:total===null?'missing':'connected'},
    days:[{date,usage:total===null?unknown():withTokens(total)}]});
  s.providerUsage=[provider('codex',100),provider('event:studio',40),provider('idle',0),provider('offline',null)];
  const first=await history.reconcile(s), day=first.days.find(d=>d.date===date);
  assert.deepEqual(day.sourceTokenTotals,{codex:100,'event:studio':40,idle:0,offline:null});
  assert.equal(day.usage.totalTokens,140);
  const legacy=clone(first);for(const d of legacy.days)delete d.sourceTokenTotals;
  assert.equal(C.project(legacy).depth,C.project(first).depth);
  assert.equal(C.validateSnapshot(legacy).days.find(d=>d.date===date).sourceTokenTotals,undefined);
  const restart=createHistory({directory,projectId});
  s.providerUsage=[provider('codex',null),provider('event:studio',50)];
  const next=await restart.reconcile(s);
  assert.deepEqual(next.days.find(d=>d.date===date).sourceTokenTotals,{codex:100,'event:studio':50,idle:0,offline:null});
  const invalid=clone(next);
  invalid.days.find(d=>d.date===date).sourceTokenTotals.codex=1000;
  assert.throws(()=>C.validateSnapshot(invalid));
});
test('an archived receipt can upgrade its scanner entry without copying content into provenance or into other records',async t=>{
  const history=createHistory({directory:fixture(t),projectId}),fresh=snapshot(),timestamp='2026-11-18T02:00:00Z';
  const file={id:'file:past',projectId,sourceId:'local-files',timestamp,type:'document',title:'001.md',files:['exports/001.md'],
    summary:require('../scripts/output-files.cjs').LEGACY_FILE_NOTE, fingerprint:'a'.repeat(64)};
  const custom={...file,id:'file:custom',title:'手写的标题',summary:'我的简介'};
  const earlier={...file,id:'file:earlier',timestamp:'2026-11-18T01:00:00Z'};
  const sdk={...file,id:'event:source',sourceId:'my-editor'};
  fresh.outputs=[file,custom,earlier,sdk,{...file,id:'file:other',files:['elsewhere/001.md']}];fresh.outputSource={status:'connected',notes:[]};
  const initial=await history.reconcile(fresh);
  fresh.outputs=[];
  const match={outputId:file.id,path:file.files[0],fingerprint:file.fingerprint,sourceRef:'receipt:same',sourceId:'codex',
    operation:'create',producedAt:'2026-11-18T01:59:59Z',contentIntro:{title:'海边周记',summary:'周末在岸边看见了三只白鹭。'}};
  const enriched=await history.reconcile(fresh,{matches:[match,...[custom,sdk,earlier].map(o=>({...match,outputId:o.id}))]});
  const saved=enriched.outputs.find(o=>o.id===file.id);
  assert.equal(saved.contentVersion,1);assert.equal(saved.title,match.contentIntro.title);assert.equal(saved.summary,match.contentIntro.summary);
  assert.equal(saved.traces[0].request,undefined);assert.equal(saved.traces[0].contentIntro,undefined);
  assert.equal(saved.timestamp,new Date(timestamp).toISOString());
  assert.equal(enriched.mining.earnedDepth,initial.mining.earnedDepth);
  for(const record of enriched.outputs.filter(o=>o.id!==file.id))assert.equal(record.contentVersion,undefined);
  assert.equal(enriched.outputs.find(o=>o.id===custom.id).title,'手写的标题');
});
test('legacy file observations gain a same-version title without changing timestamp, source, or mining depth',async t=>{
  const history=createHistory({directory:fixture(t),projectId});
  const fresh=snapshot(),note=require('../scripts/output-files.cjs').LEGACY_FILE_NOTE;
  const file={id:'file:legacy',projectId,sourceId:'local-files',timestamp:'2026-11-18T02:00:00Z',type:'document',title:'note.md',files:['exports/note.md'],summary:note,fingerprint:'b'.repeat(64)};
  fresh.outputs=[file,{...file,id:'file:custom',title:'原来的工作名称',summary:'手工描述'},
    {...file,id:'event:else',sourceId:'editor-hook:example'}];
  fresh.outputSource={status:'connected',notes:[]};
  const first=await history.reconcile(fresh);
  fresh.outputs=fresh.outputs.map(item=>({...item,title:'温室里的花',summary:'这份文档的标题是「温室里的花」。',timestamp:'2026-11-18T06:00:00Z'}));
  const enriched=await history.reconcile(fresh),stored=enriched.outputs.find(item=>item.id==='file:legacy');
  assert.equal(stored.title,'温室里的花');assert.equal(stored.timestamp,new Date(file.timestamp).toISOString());
  assert.equal(enriched.outputs.find(item=>item.id==='file:custom').title,'原来的工作名称');
  assert.equal(enriched.outputs.find(item=>item.id==='event:else').summary,note);
  assert.equal(enriched.mining.earnedDepth,first.mining.earnedDepth);assert.equal(enriched.outputs.length,3);
});
test('late older evidence shifts today as a whole and does not earn radio meters twice', async t => {
  const history = createHistory({directory:fixture(t), projectId, now:() => new Date('2026-11-18T11:00:00Z')});
  const fresh = snapshot(), initial = await history.reconcile(fresh);
  await history.command({action:'start'});
  await history.command({action:'progress', depth:21});
  fresh.days.unshift(snapshot('2026-11-17').days[0]);
  const later = await history.reconcile(fresh);
  const past = C.project(later).days[0].depthEnd;
  assert.ok(past > 0);
  assert.equal(later.mining.excavatedDepth, past + 21);
  assert.equal(later.mining.pendingDepth, initial.mining.earnedDepth - 21);
  assert.equal(later.mining.radio.meters, 21);
  assert.deepEqual(later.days[1].placements, initial.days[0].placements);
});
test('a new calendar day settles yesterday and waits for a new active trip', async t => {
  let now = new Date('2026-11-18T11:00:00Z');
  const history = createHistory({directory:fixture(t), projectId, now:() => now});
  const first = await history.reconcile(snapshot());
  await history.command({action:'start'});
  await history.command({action:'progress', depth:21});
  now = new Date('2026-11-19T11:00:00Z');
  const next = await history.reconcile(snapshot('2026-11-19'));
  assert.equal(next.mining.excavatedDepth, first.mining.earnedDepth);
  assert.ok(next.mining.pendingDepth > 0);
  assert.equal(next.mining.active, false);
  assert.deepEqual(next.mining.radio, {date:'2026-11-19', meters:0, slots:0, claimed:0});
});
test('a failed progress write can be retried without silently awarding meters', async t => {
  const history = createHistory({directory:fixture(t), projectId, now:() => new Date('2026-11-18T11:00:00Z')});
  await history.reconcile(snapshot());
  await history.command({action:'start'});
  const temporary = history.filename + '.' + process.pid + '.tmp';
  fs.mkdirSync(temporary);
  await assert.rejects(history.command({action:'progress', depth:20}));
  assert.equal((await history.getRadio()).meters, 0);
  fs.rmdirSync(temporary);
  assert.equal((await history.command({action:'progress', depth:20})).radio.meters, 20);
});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'deepmine-history-'));t.after(()=>{if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(dir).startsWith('deepmine-history-'))throw new Error('Unsafe fixture cleanup');fs.rmSync(dir,{recursive:true,force:true});});return dir;}
function snapshot(date='2026-11-18'){const s=C.demoSnapshot(date+'T10:00:00Z');s.mode='live';s.project.id=projectId;s.days=[s.days[1]];s.days[0].evidence[0].id='git:'+date;s.days[0].evidence[0].hash=Buffer.from(date).toString('hex').padEnd(40,'0');s.days[0].evidence[0].shortHash=s.days[0].evidence[0].hash.slice(0,8);return s;}
test('upgrade keeps old layers and revealed positions, then adds an interval for a later output',async t=>{
  const directory=fixture(t), day='2026-11-18', now=()=>new Date(day+'T11:00:00Z');
  const legacy=snapshot(day); legacy.history={enabled:true,revision:1};
  legacy.days.unshift(snapshot('2026-11-17').days[0]);
  const original=C.project(legacy);
  legacy.mining={earnedDepth:original.depth,excavatedDepth:original.depth,pendingDepth:0,active:false,revision:1,lastSettledDate:'2026-11-17'};
  fs.writeFileSync(path.join(directory,projectId+'.json'),JSON.stringify({schemaVersion:1,timezone:legacy.timezone,projectId,revision:1,snapshot:legacy,mining:legacy.mining}));
  const history=createHistory({directory,projectId,now}), findings=require('../dist/work-findings.js');
  const upgraded=await history.reconcile(legacy);
  assert.equal(C.project(upgraded).days[0].depthEnd,original.days[0].depthEnd);
  assert.equal(upgraded.mining.excavatedDepth,original.depth);
  assert.ok(upgraded.mining.earnedDepth>original.depth);
  assert.deepEqual(findings.build(upgraded).map(item=>item.depth),findings.build(legacy).map(item=>item.depth));
  await history.command({action:'start'});await history.command({action:'progress',depth:upgraded.mining.earnedDepth});
  legacy.days[1].evidence[0].files.push({path:'report.md',kind:'document'});
  const next=await history.reconcile(legacy), extra=findings.build(next).find(item=>item.date===day&&item.key==='document');
  assert.ok(extra.depth>upgraded.mining.earnedDepth+9);
  assert.equal(next.mining.radio.meters,upgraded.mining.earnedDepth-original.depth);
});
test('start/progress are idempotent and bounded by earned records; pause cannot mint depth',async t=>{const history=createHistory({directory:fixture(t),projectId,now:()=>new Date('2026-11-18T11:00:00Z')});const value=await history.reconcile(snapshot()),earned=value.mining.earnedDepth;assert.ok(earned>0);assert.equal(value.mining.excavatedDepth,0);await history.command({action:'start'});await history.command({action:'start'});assert.equal((await history.command({action:'progress',depth:5})).excavatedDepth,5);assert.equal((await history.command({action:'progress',depth:2})).excavatedDepth,5);await history.command({action:'pause'});assert.equal((await history.command({action:'progress',depth:10000})).excavatedDepth,5);await history.command({action:'start'});const final=await history.command({action:'progress',depth:10000});assert.equal(final.excavatedDepth,earned);assert.equal(final.earnedDepth,earned);assert.equal(final.pendingDepth,0);});
test('refresh time alone does not rewrite journal or increment revision, while source changes persist',async t=>{const history=createHistory({directory:fixture(t),projectId}),s=snapshot();const first=await history.reconcile(s),bytes=fs.readFileSync(history.filename,'utf8');s.collectedAt='2026-11-18T11:00:00Z';const next=await history.reconcile(s);assert.equal(next.history.revision,first.history.revision);assert.equal(fs.readFileSync(history.filename,'utf8'),bytes);assert.equal(next.collectedAt,new Date(s.collectedAt).toISOString());s.sources.codex.notes.push('New source coverage diagnostic');await history.reconcile(s);assert.notEqual(fs.readFileSync(history.filename,'utf8'),bytes);});
test('past work settles across local midnight and after a stopped process restarts without earning extra depth',async t=>{const directory=fixture(t);let clock=new Date('2026-11-18T11:00:00Z');let history=createHistory({directory,projectId,now:()=>clock});const first=await history.reconcile(snapshot());await history.command({action:'start'});await history.command({action:'progress',depth:3});clock=new Date('2026-11-18T16:01:00Z');history=createHistory({directory,projectId,now:()=>clock});const settled=await history.command({action:'pause'});assert.equal(settled.earnedDepth,first.mining.earnedDepth);assert.equal(settled.excavatedDepth,first.mining.earnedDepth);assert.equal(settled.lastSettledDate,'2026-11-18');});
test('persistent history retains records older than 14 days and marks source outages as retained observations',async t=>{const history=createHistory({directory:fixture(t),projectId});await history.reconcile(snapshot('2026-10-01'));let latest=await history.reconcile(snapshot());assert.ok(latest.days.some(day=>day.date==='2026-10-01'));const offline=clone(latest);offline.sources.git.status='missing';offline.sources.git.head=null;offline.sources.codex.status='missing';offline.days=offline.days.map(day=>({...day,evidence:[],usage:unknown()}));latest=await history.reconcile(offline);assert.ok(latest.days.some(day=>day.evidence.length));assert.ok(latest.warnings.some(note=>note.includes('上次观测')));assert.equal(latest.sources.git.status,'missing');});
test('same output content saved again retains its first date and does not earn another daily output reward',async t=>{const history=createHistory({directory:fixture(t),projectId}),s=snapshot();s.days[0].evidence=[];s.days[0].usage=unknown();s.sources.codex.status='missing';s.outputSource={status:'connected',notes:[]};s.outputs=[{id:'file:same-content',projectId,sourceId:'local-files',timestamp:'2026-11-18T02:00:00Z',type:'image',title:'map.png',files:['exports/map.png'],summary:'Observed file',fingerprint:'a'.repeat(64)}];const first=await history.reconcile(s);const next=clone(s);next.collectedAt='2026-11-19T10:00:00Z';next.days=[{...next.days[0],date:'2026-11-19'}];next.outputs[0].timestamp='2026-11-19T02:00:00Z';const result=await history.reconcile(next);assert.equal(result.outputs.length,1);assert.equal(result.outputs[0].timestamp,new Date(s.outputs[0].timestamp).toISOString());assert.equal(result.mining.earnedDepth,first.mining.earnedDepth);});
test('corrupt journals and changed project timezone are preserved instead of overwritten',async t=>{const directory=fixture(t),history=createHistory({directory,projectId});await history.reconcile(snapshot());const bytes=fs.readFileSync(history.filename,'utf8');const changed=createHistory({directory,projectId,timezone:'America/Los_Angeles'});await assert.rejects(changed.reconcile(snapshot()),/timezone/);assert.equal(fs.readFileSync(history.filename,'utf8'),bytes);fs.writeFileSync(history.filename,'{BROKEN');await assert.rejects(createHistory({directory,projectId}).reconcile(snapshot()),/preserved/);assert.equal(fs.readFileSync(history.filename,'utf8'),'{BROKEN');});
test('one missing provider retains its own archive while another provider can keep growing across restart',async t=>{
  const directory=fixture(t);let history=createHistory({directory,projectId});const s=snapshot();s.days[0].evidence=[];
  const usage=n=>({inputTokens:n,cachedInputTokens:0,outputTokens:0,totalTokens:n,reasoningOutputTokens:null,cacheWriteInputTokens:null,sessions:1,quality:'observed'});
  const provider=(id,n,status='connected')=>({source:{id,label:id,status,method:'fixture',notes:[]},days:[{date:s.days[0].date,usage:n===null?unknown():usage(n)}]});
  s.providerUsage=[provider('codex',100),provider('claude-code',200)];s.usageSources=s.providerUsage.map(item=>item.source);s.days[0].usage=usage(300);s.days[0].usageSourceIds=['codex','claude-code'];
  assert.equal((await history.reconcile(s)).days[0].usage.totalTokens,300);
  history=createHistory({directory,projectId});s.providerUsage=[provider('codex',150),provider('claude-code',null,'missing')];s.usageSources=s.providerUsage.map(item=>item.source);s.days[0].usage=usage(150);s.days[0].usageSourceIds=['codex'];
  const result=await history.reconcile(s);assert.equal(result.days[0].usage.totalTokens,350);assert.deepEqual(result.days[0].usageSourceIds,['claude-code','codex']);assert.ok(result.warnings.some(note=>note.includes('上次观测')));
  assert.equal(result.providerUsage,undefined);
  s.providerUsage=[provider('codex',170)];s.usageSources=s.providerUsage.map(item=>item.source);assert.equal((await history.reconcile(s)).days[0].usage.totalTokens,370);
});
test('unknown usage for a newly observed date does not become zero because another date has archived provider data',async t=>{
  const history=createHistory({directory:fixture(t),projectId}),s=snapshot();s.days[0].evidence=[];s.days[0].usage=unknown();s.sources.codex.status='missing';
  const archived={inputTokens:100,cachedInputTokens:0,outputTokens:10,totalTokens:110,reasoningOutputTokens:null,cacheWriteInputTokens:null,sessions:1,quality:'observed'};
  s.providerUsage=[{source:{id:'codex',label:'Codex',status:'missing',method:'fixture',notes:[]},days:[{date:'2026-11-17',usage:archived},{date:'2026-11-18',usage:unknown()}]}];
  const result=await history.reconcile(s);assert.equal(result.days.find(day=>day.date==='2026-11-18').usage.totalTokens,null);assert.equal(result.days.find(day=>day.date==='2026-11-17').usage.totalTokens,110);
});
