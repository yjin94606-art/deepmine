'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {start}=require('../scripts/server.cjs');
async function fixture(t,overrides={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'deepmine-v13-'));
  const project=path.join(root,'project');await fs.mkdir(path.join(project,'exports'),{recursive:true});await fs.writeFile(path.join(project,'exports','report.md'),'Synthetic exported report');
  const config={port:0,quiet:true,projectPath:project,scopePath:project,codexRoot:path.join(root,'none'),claudeRoot:path.join(root,'none-claude'),sources:{codex:false,claude:false,imports:false},outputDirs:['exports'],aiEnabled:false,dataDirectory:path.join(root,'data'),ingestionKey:'isolated-test-key',...overrides};
  const app=await start(config);const apps=[app];t.after(async()=>{for(const app of apps)if(app.server.listening)await new Promise(r=>app.server.close(r));const resolved=path.resolve(root);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(root).startsWith('deepmine-v13-'))throw new Error('Unsafe fixture cleanup');await fs.rm(root,{recursive:true,force:true});});
  return{...app,config,apps,project};
}
async function request(app,route,body,headers={}){const response=await fetch(`http://127.0.0.1:${app.port}${route}`,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json',...headers}:headers,body:body?JSON.stringify(body):undefined});const text=await response.text();let json;try{json=JSON.parse(text);}catch{}return{status:response.status,json,text};}
const miningHeaders={'X-Deepmine-Client':'mining'};
test('a matching earlier picture is served as the reference on an approved process card only',async t=>{
  const first=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+5RfcAAAAASUVORK5CYII=','base64');
  const last=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  const previous='exports/first.png',finished='exports/later.png';
  const fingerprint=require('node:crypto').createHash('sha256').update(first).digest('hex');
  const turns=[{operation:'edit',request:'把湖边的浮桥换成一座木桥。'}];
  Object.defineProperty(turns,'referenceImage',{value:{path:previous,fingerprint}});
  const app=await fixture(t,{sources:{codex:true,claude:false,imports:false},
    readNarrationProcess:async()=>turns,
    selectNarrationEvidence:async()=>({selections:[{turn:0,request:turns[0].request,reply:'',designBrief:''}]}),
    generateNarration:async material=>material.process.length?'那座桥换了一身木头衣裳，湖边也跟着安静下来。':'湖边的一小幅图，刚好装下一段午后。'});
  const stamp=new Date(Date.now()-3000).toISOString();
  await fs.writeFile(path.join(app.project,previous),first);
  await fs.writeFile(path.join(app.project,finished),last);
  const logs=path.join(app.config.codexRoot,'sessions');
  await fs.mkdir(logs,{recursive:true});
  await fs.writeFile(path.join(logs,'art.jsonl'),[
    {type:'session_meta',timestamp:stamp,payload:{id:'art',source:'cli',cwd:app.project}},
    {type:'response_item',timestamp:stamp,payload:{type:'image_generation_call',id:'image-call',status:'completed',saved_path:path.join(app.project,finished),result:last.toString('base64')}}
  ].map(row=>JSON.stringify(row)).join('\n')+'\n');
  const snapshot=(await request(app,'/api/snapshot')).json;
  const out=snapshot.outputs.find(o=>o.files.includes(finished));
  assert.ok(out.traces?.length);
  const item=require('../dist/work-findings.js').build(snapshot).find(f=>f.paths?.includes(finished));
  const headers={'X-Deepmine-Client':'work-narration'},body={itemId:item.id,memberKey:out.id+'|'+finished,locale:'zh-CN'};
  async function ready(includeProcess){
    await request(app,'/api/narration-settings',{enabled:true,includeProcess},headers);
    for(let i=0;i<50;i++){
      const {json}=await request(app,'/api/work-narration',body,headers);
      if(json.status==='ready')return json;
      assert.equal(json.status,'pending');
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.fail('Expected a finished image card');
  }
  const processCard=await ready(true);
  assert.equal(processCard.basis,'process');
  const preview=await fetch(new URL(processCard.referencePreview.url,`http://127.0.0.1:${app.port}`));
  assert.equal(preview.status,200);
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()),first);
  const workCard=await ready(false);
  assert.equal(workCard.basis,'work');
  assert.equal(workCard.referencePreview,undefined);
});
test('creation stories read matched dialogue only with separate consent and discard a lookup that crosses revocation',async t=>{
  let reads=0,blockRead=false,release,started;
  const held=new Promise(resolve=>{release=resolve;});
  const inLookup=new Promise(resolve=>{started=resolve;});
  const turns=[{request:'围巾想用橙色，颜色要更暖一点。',operation:'create'}];
  const app=await fixture(t,{sources:{codex:true,claude:false,imports:false},memoriesEnabled:false,
    readNarrationProcess:async()=>{reads++;if(blockRead){started();await held;}return turns;},
    selectNarrationEvidence:async material=>({selections:[{turn:0,request:material.process[0].request,reply:'',designBrief:''}]}),
    generateNarration:async material=>material.process?.length
      ?'那条围巾终于挑中了橙色，整幅画先暖和了起来。':'一页人物设定，衣架还得给它腾个空。'});
  const stamp=new Date(Date.now()-2000).toISOString(),name='exports/report.md',content='# 人物设定\n围巾是这个形象的重要配件。';
  await fs.writeFile(path.join(app.project,name),content);
  const logDir=path.join(app.config.codexRoot,'sessions');
  await fs.mkdir(logDir,{recursive:true});
  await fs.writeFile(path.join(logDir,'story.jsonl'),[
    {type:'session_meta',timestamp:stamp,payload:{id:'story',source:'cli',cwd:app.project}},
    {type:'event_msg',timestamp:stamp,payload:{type:'task_started',turn_id:'turn'}},
    {type:'response_item',timestamp:stamp,payload:{type:'message',role:'user',content:[{type:'input_text',text:turns[0].request}]}},
    {type:'event_msg',timestamp:stamp,payload:{type:'item_completed',thread_id:'story',turn_id:'turn',item:{type:'FileChange',id:'portrait',status:'completed',changes:{[name]:{type:'add',content}}}}}
  ].map(v=>JSON.stringify(v)).join('\n')+'\n');
  const prefs='/api/narration-settings',route='/api/work-narration',headers={'X-Deepmine-Client':'work-narration'};
  const snapshot=(await request(app,'/api/snapshot')).json;
  assert.ok(snapshot.outputs.some(o=>o.traces?.length));
  assert.ok(!JSON.stringify(snapshot).includes(turns[0].request));
  const item=require('../dist/work-findings.js').build(snapshot).find(f=>f.paths?.includes(name));
  const body={itemId:item.id,locale:'zh-CN'};
  async function ready(){
    for(let i=0;i<50;i++){
      const {json}=await request(app,route,body,headers);
      if(json.status==='ready')return json;
      assert.equal(json.status,'pending');
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.fail('story generation did not finish');
  }
  await request(app,prefs,{enabled:true},headers);
  assert.equal((await ready()).basis,'work');assert.equal(reads,0);
  assert.equal((await request(app,prefs,{enabled:true,includeProcess:true},headers)).json.memoriesEnabled,false);
  const story=await ready();assert.equal(story.basis,'process');assert.match(story.text,/橙色/);
  blockRead=true;
  const pending=request(app,route,body,headers);
  try{
    await Promise.race([inLookup,require('node:timers/promises').setTimeout(3000,null,{ref:false}).then(()=>{throw Error('Lookup did not start');})]);
    await request(app,prefs,{enabled:true,includeProcess:false},headers);
  }finally{release();}
  assert.equal((await pending).json.text,undefined);
  assert.equal((await ready()).basis,'work');
  assert.ok(!JSON.stringify((await request(app,'/api/snapshot')).json).includes(turns[0].request));
});
test('per-work narration only runs for a verified work after local consent, keeps consent on restart and respects disabling',async t=>{
  const title='河口的水鸟手册';
  let generated=0;
  const app=await fixture(t,{generateNarration:async()=>{generated++;return '这册水鸟手册给河口的羽毛住客逐个点名，想溜号的那只可得先收起长嘴。';}});
  await fs.writeFile(path.join(app.project,'exports','report.md'),'# '+title+'\n清晨在河口数水鸟。');
  const prefs='/api/narration-settings',route='/api/work-narration';
  const headers={'X-Deepmine-Client':'work-narration'};
  const live=(await request(app,'/api/snapshot')).json;
  const finding=require('../dist/work-findings.js').build(live).find(f=>f.paths?.includes('exports/report.md'));
  assert.ok(finding);
  const body={itemId:finding.id,locale:'zh-CN'};
  assert.deepEqual((await request(app,prefs)).json,{enabled:false,includeProcess:false,memoriesEnabled:false});
  assert.equal((await request(app,route,body,headers)).json.status,'disabled');
  assert.equal((await request(app,prefs,{enabled:true})).status,403);
  assert.equal((await request(app,prefs,{enabled:true},{...headers,Origin:'https://other.invalid'})).status,403);
  assert.equal((await request(app,prefs,{enabled:'yes'},headers)).status,400);
  assert.equal(generated,0);
  assert.deepEqual((await request(app,prefs,{enabled:true},headers)).json,{enabled:true,includeProcess:false,memoriesEnabled:false});
  assert.equal((await request(app,route,{...body,itemId:'missing'},headers)).status,404);
  const cacheHeaders={...headers,'X-Deepmine-Cache':'only'};
  assert.equal((await request(app,route,body,cacheHeaders)).json.status,'idle');
  assert.equal(generated,0);
  let pollId;
  for(let i=0;i<50;i++){
    const result=(await request(app,route,pollId?{pollId}:body,headers)).json;
    if(result.status==='ready'){assert.match(result.text,/河口/);break;}
    assert.equal(result.status,'pending');
    assert.match(result.pollId,/^[a-f0-9-]{36}$/);
    pollId=result.pollId;
    assert.ok(i<49,'expected a completed work narration');
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  assert.equal(generated,1);
  assert.equal((await request(app,route,{pollId},headers)).json.status,'expired');
  await new Promise(resolve=>app.server.close(resolve));
  const reopened=await start(app.config);app.apps.push(reopened);
  assert.deepEqual((await request(reopened,prefs)).json,{enabled:true,includeProcess:false,memoriesEnabled:false});
  assert.equal((await request(reopened,route,body,cacheHeaders)).json.status,'ready');
  assert.equal(generated,1);
  assert.deepEqual((await request(reopened,prefs,{enabled:false},headers)).json,{enabled:false,includeProcess:false,memoriesEnabled:false});
  assert.equal((await request(reopened,route,body,headers)).json.status,'disabled');
});
test('an SDK output receipt enriches a matching saved version, survives source loss and hides user words when disabled',async t=>{
  const app=await fixture(t,{memoriesEnabled:true});
  const before=(await request(app,'/api/snapshot')).json;
  const existing=before.outputs[0], now=new Date().toISOString();
  const event={schemaVersion:1,id:'output-with-receipt',source:'studio-bridge',projectPath:app.project,timestamp:now,sessionId:'local-run',kind:'output',
    output:{type:'document',title:'Field notebook',files:existing.files,fingerprint:existing.fingerprint,
      receipt:{status:'completed',operation:'create',path:existing.files[0],sha256:existing.fingerprint,sourceRef:'run:123',requestedAt:existing.timestamp,request:'请整理这次出行的笔记。'}}};
  assert.equal((await request(app,'/api/events',event,{'X-Deepmine-Key':app.config.ingestionKey})).status,200);
  const enriched=(await request(app,'/api/snapshot')).json;
  assert.equal(enriched.outputs.length,2);
  for(const output of enriched.outputs) {
    assert.equal(output.traces[0].sourceId,event.source);assert.equal(output.traces[0].request,event.output.receipt.request);
    assert.equal(output.traces[0].producedAt,now);
  }
  await new Promise(resolve=>app.server.close(resolve));
  const privateApp=await start({...app.config,memoriesEnabled:false,outputDirs:[]});app.apps.push(privateApp);
  const privateSnapshot=(await request(privateApp,'/api/snapshot')).json;
  assert.equal(privateSnapshot.outputs.length,2);
  assert.ok(privateSnapshot.outputs.every(o=>o.traces[0].sourceRef==='run:123'&&!('request' in o.traces[0])&&!('requestedAt' in o.traces[0])));
  assert.ok(!JSON.stringify(privateSnapshot).includes(event.output.receipt.request));
  assert.equal((await request(privateApp,'/api/events',event,{'X-Deepmine-Key':app.config.ingestionKey})).status,200);
  await new Promise(resolve=>privateApp.server.close(resolve));
  const resumed=await start({...app.config,memoriesEnabled:true});app.apps.push(resumed);
  assert.equal((await request(resumed,'/api/snapshot')).json.outputs[0].traces[0].request,event.output.receipt.request);
});
test('a logfile arriving after the observed file was deleted backfills its archived version, ambiguity revokes an earlier claim',async t=>{
  const app=await fixture(t,{memoriesEnabled:true}); const initial=(await request(app,'/api/snapshot')).json;
  const output=initial.outputs[0], name=output.files[0], timestamp=output.timestamp;
  await new Promise(resolve=>app.server.close(resolve));await fs.unlink(path.join(app.project,name));
  const cfg={...app.config,sources:{codex:true,claude:false,imports:false}}, log=path.join(cfg.codexRoot,'sessions','later.jsonl');
  const header={type:'session_meta',timestamp,payload:{id:'later',cwd:app.project,source:'cli'}};
  const receipt=id=>({type:'event_msg',timestamp,payload:{type:'item_completed',thread_id:'later',item:{type:'FileChange',id,status:'completed',changes:{[name]:{type:'add',content:'Synthetic exported report'}}}}});
  await fs.mkdir(path.dirname(log),{recursive:true});
  await fs.writeFile(log,[header,receipt('one')].map(r=>JSON.stringify(r)).join('\n')+'\n');
  const backfill=await start(cfg);app.apps.push(backfill);
  assert.equal((await request(backfill,'/api/snapshot')).json.outputs[0].traces[0].sourceId,'codex');
  await new Promise(resolve=>backfill.server.close(resolve));await fs.appendFile(log,JSON.stringify(receipt('two'))+'\n');
  const changed=await start(cfg);app.apps.push(changed);
  assert.equal((await request(changed,'/api/snapshot')).json.outputs[0].traces,undefined);
  await new Promise(resolve=>changed.server.close(resolve)); await fs.unlink(log);
  const offline=await start(cfg);app.apps.push(offline);
  assert.equal((await request(offline,'/api/snapshot')).json.outputs[0].traces,undefined);
});
test('new output day waits for explicit excavation and repeated starts cannot mint depth',async t=>{
  const app=await fixture(t);const first=(await request(app,'/api/snapshot')).json;assert.equal(first.mining.earnedDepth,30);assert.equal(first.mining.excavatedDepth,0);assert.equal(first.mining.active,false);assert.equal(first.days.at(-1).usage.totalTokens,null);
  let result=await request(app,'/api/mining',{action:'progress',depth:999999},miningHeaders);assert.equal(result.json.mining.excavatedDepth,0);
  const starts=await Promise.all(Array.from({length:8},()=>request(app,'/api/mining',{action:'start'},miningHeaders)));assert.ok(starts.every(result=>result.json.mining.earnedDepth===30&&result.json.mining.active));
  result=await request(app,'/api/mining',{action:'progress',depth:999999},miningHeaders);assert.equal(result.json.mining.excavatedDepth,30);assert.equal(result.json.mining.pendingDepth,0);assert.equal(result.json.mining.active,false);
  result=await request(app,'/api/mining',{action:'start'},miningHeaders);assert.equal(result.json.mining.active,false);assert.equal(result.json.mining.earnedDepth,30);
});
test('actual server restart restores excavation without replay or extra items',async t=>{
  const app=await fixture(t);await request(app,'/api/snapshot');await request(app,'/api/mining',{action:'start'},miningHeaders);await request(app,'/api/mining',{action:'progress',depth:5},miningHeaders);await new Promise(r=>app.server.close(r));
  const second=await start(app.config);app.apps.push(second);const snapshot=(await request(second,'/api/snapshot')).json;assert.equal(snapshot.mining.excavatedDepth,5);assert.equal(snapshot.mining.earnedDepth,30);assert.equal(snapshot.outputs.length,1);
});
test('event ingestion requires local authorization and stores referenced memory once',async t=>{
  const app=await fixture(t);const event={schemaVersion:1,id:'memory-1',source:'test-agent',projectPath:app.project,timestamp:new Date().toISOString(),sessionId:'conversation-1',kind:'memory',memory:{title:'直接记录的决定',summary:'采用每天结算与主动开挖的共同逻辑。',objectType:'memory',sourceRef:'message:1'}};
  assert.equal((await request(app,'/api/events',event)).status,403);
  const headers={'X-Deepmine-Key':'isolated-test-key'};
  assert.equal((await request(app,'/api/events',event,{...headers,Origin:'https://foreign.invalid'})).status,403);
  assert.equal((await request(app,'/api/events',event,headers)).json.status,'accepted');
  assert.equal((await request(app,'/api/events',event,headers)).json.status,'duplicate');
  const snapshot=(await request(app,'/api/snapshot')).json;assert.equal(snapshot.memories.length,1);assert.equal(snapshot.memories[0].summary,event.memory.summary);assert.equal(snapshot.memories[0].method,'agent-memory');assert.equal(snapshot.mining.earnedDepth,48);
  const diagnostics=(await request(app,'/api/connectors')).text;assert.ok(!diagnostics.includes('isolated-test-key'));assert.ok(!diagnostics.includes(app.project));
});
test('captured API response reaches persistent daily usage and is idempotent end to end',async t=>{
  const upstream=http.createServer((req,res)=>{req.resume();req.on('end',()=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'api-response-1',usage:{prompt_tokens:10000,prompt_tokens_details:{cached_tokens:3000},completion_tokens:2000,total_tokens:12000},choices:[{message:{content:'PRIVATE_RESPONSE_MUST_NOT_PERSIST'}}]}));});});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>upstream.close(r)));
  const app=await fixture(t,{captureProviders:{openai:{baseURL:`http://127.0.0.1:${upstream.address().port}/v1`}}});
  for(let i=0;i<2;i++){const r=await request(app,'/api/capture/openai/v1/chat/completions',{model:'fixture',messages:[{role:'user',content:'PRIVATE_REQUEST_MUST_NOT_PERSIST'}]},{Authorization:'Bearer NEVER_STORE_THIS_KEY'});assert.equal(r.status,200);}
  const snapshot=(await request(app,'/api/snapshot')).json;assert.equal(snapshot.days.at(-1).usage.totalTokens,12000);assert.equal(snapshot.days.at(-1).usage.cachedInputTokens,3000);assert.equal(snapshot.mining.earnedDepth,95);assert.ok(snapshot.days.at(-1).usageSourceIds.includes('event:api-openai'));
  const journalDir=path.join(app.config.dataDirectory,'events'),journal=await fs.readFile(path.join(journalDir,(await fs.readdir(journalDir))[0]),'utf8');for(const secret of ['PRIVATE_RESPONSE','PRIVATE_REQUEST','NEVER_STORE_THIS_KEY'])assert.ok(!journal.includes(secret));
});
test('mining rejects cross-origin, missing custom header and unknown action',async t=>{const app=await fixture(t);assert.equal((await request(app,'/api/mining',{action:'start'})).status,403);assert.equal((await request(app,'/api/mining',{action:'start'},{...miningHeaders,Origin:'https://foreign.invalid'})).status,403);assert.equal((await request(app,'/api/mining',{action:'invent'},miningHeaders)).status,400);});
test('a second server cannot race the same project history journal',async t=>{const app=await fixture(t);await assert.rejects(start(app.config),/already being synchronized/);assert.equal((await request(app,'/api/snapshot')).status,200);});

test('daily radio unlocks local skill stories once from saved manual progress, independently from work', async t => {
  let remoteRequests = 0;
  const app = await fixture(t, {fieldNews:{fetchImpl:async () => { remoteRequests++; throw new Error('Offline fixture'); }}});
  const state = (await request(app, '/api/snapshot')).json;
  const date = state.history.endDate;
  const timestamp = new Date().toISOString();
  const article = {id:'example', title:'A dated bulletin for the fixture', url:'https://example.org/bulletin', publishedAt:timestamp};
  const feed = {schemaVersion:1, date, timezone:state.timezone, generatedAt:timestamp,
    source:{id:'sample-skill', label:'Sample skill', url:'https://example.org/', language:'en'}, items:[article]};
  await fs.writeFile(path.join(app.config.dataDirectory, 'field-news.json'), JSON.stringify(feed));
  const headers = {'X-Deepmine-Client':'field-news'};
  const claim = () => request(app, '/api/field-news', {action:'claim', date}, headers);
  assert.equal((await claim()).json.status, 'locked');
  await request(app, '/api/mining', {action:'start'}, miningHeaders);
  await request(app, '/api/mining', {action:'progress',depth:19}, miningHeaders);
  assert.equal((await claim()).json.items.length, 0);
  await request(app, '/api/mining', {action:'progress',depth:21}, miningHeaders);
  const batch = await Promise.all([claim(), claim()]);
  assert.equal(batch.filter(response => response.json.newItem).length, 1);
  assert.equal((await request(app, '/api/field-news')).json.items[0].source, 'Sample skill');
  const after = (await request(app, '/api/snapshot')).json;
  assert.equal(after.mining.earnedDepth, state.mining.earnedDepth);
  assert.equal(after.mining.radio.meters, 21);
  assert.equal(after.mining.radio.claimed, 1);
  assert.deepEqual(after.outputs, state.outputs);
  assert.equal(remoteRequests, 0);
  await new Promise(resolve => app.server.close(resolve));
  const restarted = await start(app.config); app.apps.push(restarted);
  assert.equal((await request(restarted, '/api/field-news')).json.items[0].title, article.title);
});
test('disabled field radio stays explicit before and after an eligible day with zero news requests', async t => {
  let requests = 0;
  const app = await fixture(t, {fieldNews:{enabled:false, fetchImpl:async () => { requests++; throw new Error('Unexpected request'); }}});
  const state = (await request(app, '/api/snapshot')).json;
  const radio = '/api/field-news';
  assert.equal((await request(app, radio)).json.status, 'disabled');
  await request(app, '/api/mining', {action:'start'}, miningHeaders);
  await request(app, '/api/mining', {action:'progress',depth:22}, miningHeaders);
  const result = (await request(app, radio, {action:'claim',date:state.history.endDate}, {'X-Deepmine-Client':'field-news'})).json;
  assert.equal(result.slots, 1);
  assert.equal(result.claimed, 0);
  assert.equal(result.status, 'disabled');
  assert.equal(requests, 0);
});
