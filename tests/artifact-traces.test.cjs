'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {collectTraces,createProcessReader,createDeliveryReader}=require('../scripts/artifact-traces.cjs');

const start='2026-11-18T01:00:00Z';
const finish='2026-11-18T01:01:00Z';
const thereafter='2026-11-18T01:02:00Z';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+5RfcAAAAASUVORK5CYII=', 'base64');
const hash=text=>createHash('sha256').update(text).digest('hex');
async function setup(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'deepmine-trace-'));
  t.after(async()=>{
    if (path.dirname(root)!==path.resolve(os.tmpdir()) || !path.basename(root).startsWith('deepmine-trace-')) throw Error('Unexpected temporary directory');
    await fs.rm(root,{recursive:true,force:true});
  });
  const projectPath=path.join(root,'project');
  return {scopePath:projectPath,projectPath,codexRoot:path.join(root,'codex'),claudeRoot:path.join(root,'claude'),memoriesEnabled:true,now:new Date(thereafter),outputs:[]};
}
function output(id,name,bytes,type='document',timestamp=finish) {
  return {id,sourceId:'local-files',files:[name],type,timestamp,fingerprint:hash(bytes)};
}
async function file(name,rows) {
  await fs.mkdir(path.dirname(name),{recursive:true}); await fs.writeFile(name,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
}
const event=(type,p={},timestamp=start)=>({type:'event_msg',timestamp,payload:{type,...p}});
const turn=id=>event('task_started',{turn_id:id});
const message=(text,at=start)=>({type:'response_item',timestamp:at,payload:{type:'message',role:'user',content:[{type:'input_text',text}]}});
function completed(item,additional={}) {return event('item_completed',{thread_id:'main',turn_id:'turn',item,...additional},finish);}
async function codex(c,events,{id='main',source='cli',cwd=c.projectPath,filename='test.jsonl',area='sessions'}={}) {
  return file(path.join(c.codexRoot,area,filename),[{type:'session_meta',timestamp:start,payload:{id,source,cwd}},...events]);
}
const patch=(file,content,id='add')=>completed({type:'FileChange',id,status:'completed',changes:{[file]:{type:'add',content}}});
test('only a closed single-delivery Codex turn can price a matched file',async t=>{
  const c=await setup(t);
  const counter=n=>({total_tokens:n,input_tokens:n-1,output_tokens:1});
  const usage=(total,last)=>event('token_count',{info:{total_token_usage:counter(total),last_token_usage:counter(last)}},finish);
  const done=event('task_complete',{turn_id:'turn'},thereafter);
  const run=async(extra,end=true)=>{
    const name='design.md';
    c.outputs=[output('design',name,'unchanged bytes')];
    await codex(c,[turn('turn'),usage(140,140),patch(name,'unchanged bytes'),...extra,...(end?[done]:[])]);
    return (await collectTraces(c))[0]?.workTokens;
  };
  assert.equal(await run([usage(200,60),usage(200,60)]),200);
  assert.equal(await run([usage(200,50)]),undefined);
  assert.equal(await run([patch('unobserved.md','unrelated','add-b')]),undefined);
  assert.equal(await run([event('exec_command_begin',{call_id:'opaque'})]),undefined);
  assert.equal(await run([],false),undefined);
});
const imageItem=(extra={})=>({type:'Extension',kind:'image_gen.generation',id:'image-a',status:'completed',savedPath:'',revisedPrompt:'PRIVATE_REVISED_PROMPT',result:png.toString('base64'),...extra});

test('a final delivery joins only the observed version and the native parent request of a delegated turn',async t=>{
  const c=await setup(t),fileName='teaser.mp4',request='Prepare a release with screenshots and a trailer.';
  const versions=[output('v1',fileName,'before','video','2026-11-18T00:59:00Z'),
    output('v2',fileName,'draft','video','2026-11-18T01:00:30Z'),output('v3',fileName,'final','video',finish),
    output('v4',fileName,'later','video','2026-11-18T01:01:59Z')];
  const answer={type:'response_item',timestamp:'2026-11-18T01:01:30Z',payload:{type:'message',role:'assistant',phase:'final_answer',
    content:[{type:'output_text',text:'[English trailer](teaser.mp4)'}]}};
  await codex(c,[turn('root'),message(request)]);
  const source={subagent:{thread_spawn:{parent_thread_id:'main'}}};
  await codex(c,[{type:'session_meta',timestamp:start,payload:{id:'main',source:'cli',cwd:c.projectPath}},turn('root'),
    message('Inherited notes must not become requests.'),answer,
    event('task_started',{turn_id:'child-turn',root_turn_id:'root',turn_attribution:{parent_turn_id:'root',root_turn_id:'root'}}),
    message('Internal assignment from another agent'),answer],{id:'child',source,filename:'worker.jsonl'});
  const make=()=>({outputs:structuredClone(versions),collectedAt:thereafter});
  const s=await createDeliveryReader(c)(make());
  assert.deepEqual(s.outputs.map(v=>v.deliveries?.length||0),[0,0,1,0]);
  assert.deepEqual([s.outputs[2].deliveries[0].request,s.outputs[2].deliveries[0].label],[request,'English trailer']);
  assert.equal(s.outputs[2].traces,undefined);
  const off=await createDeliveryReader({...c,memoriesEnabled:false})(make());
  assert.equal(off.outputs[2].deliveries[0].request,undefined);
  assert.equal(off.outputs[2].deliveries[0].label,undefined);
  assert.equal(off.outputs[2].deliveries[0].sourceRef,s.outputs[2].deliveries[0].sourceRef);
});

test('a file mention, unrelated workspace, ambiguous digest or later feedback cannot claim the delivery',async t=>{
  const c=await setup(t);c.scopePath=path.dirname(c.projectPath);
  const reply=text=>({type:'response_item',timestamp:thereafter,payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text}]}});
  const linked='[Clip]('+path.join(c.projectPath,'clip.mp4').replace(/\\/g,'/')+')';
  await codex(c,[turn('old'),message('Fix the trailer'),reply('I inspected clip.mp4')]);
  await codex(c,[turn('other'),message('Discuss a different project'),reply(linked)],{id:'unrelated',cwd:path.join(c.scopePath,'neighbor'),filename:'other.jsonl'});
  const f=()=>({outputs:[output('clip','clip.mp4','video','video')],collectedAt:thereafter});
  const read=createDeliveryReader(c);
  assert.equal((await read(f())).outputs[0].deliveries,undefined);
  await codex(c,[event('task_started',{turn_id:'later'},thereafter),message('Explain this old clip',thereafter),reply(linked)],{id:'later',filename:'later.jsonl'});
  assert.equal((await read(f())).outputs[0].deliveries,undefined);
  await codex(c,[turn('valid'),message('Make a clip'),reply(linked)],{id:'valid',filename:'valid.jsonl'});
  const sameTime=f();sameTime.outputs.push(output('conflict','clip.mp4','different','video'));
  assert.ok((await read(sameTime)).outputs.every(o=>!o.deliveries));
});

test('opt-in conversation follows successful same-path turns up to the selected Codex version only',async t=>{
  const c=await setup(t),record=output('star','star.svg','new'),sibling=output('map','map.md','x');
  c.outputs=[record,sibling]; c.memoriesEnabled=false;
  const finishPatch=(id,turn_id,name,content)=>event('patch_apply_end',{call_id:id,turn_id,success:true,status:'completed',changes:{[name]:{type:'add',content}}},finish);
  const begin=(id,turn_id)=>event('patch_apply_begin',{call_id:id,turn_id});
  const answer=text=>({type:'response_item',timestamp:start,payload:{type:'message',role:'assistant',content:[{type:'output_text',text}]}});
  const receipt=finishPatch('b','second','star.svg','new');
  await codex(c,[turn('first'),message('画一颗淡黄色的星星。'),answer('我先画五个角。'),begin('a','first'),finishPatch('a','first','star.svg','old'),
    turn('side'),message('整理别的文件。'),begin('c','side'),finishPatch('c','side','map.md','x'),
    turn('second'),message('把颜色调成蓝色，角再圆一点。'),answer('我把尖角收圆。'),begin('b','second'),receipt,
    turn('too-late'),message('后来改成粉色。'),begin('d','too-late'),finishPatch('d','too-late','star.svg','later')]);
  const emitted=await collectTraces(c),trace=emitted.find(r=>r.path==='star.svg');
  assert(!JSON.stringify(emitted).includes('淡黄色'));assert(!('request' in trace));
  const member={record,trace,path:trace.path},reader=createProcessReader(c);
  assert.deepEqual(await reader({...member,trace:{...trace,operation:'edit'}}),[]);
  assert.deepEqual(await reader(member),[{request:'画一颗淡黄色的星星。',reply:'我先画五个角。',operation:'create'},
    {request:'把颜色调成蓝色，角再圆一点。',reply:'我把尖角收圆。',operation:'create'}]);
  assert.deepEqual(await reader({...member,record:{...record,fingerprint:hash('wrong')}}),[]);
  assert.deepEqual(await reader({...member,trace:{...trace,producedAt:start}}),[]);
  assert.deepEqual(await createProcessReader({...c,codexRoot:null})(member),[]);
  await fs.unlink(path.join(c.codexRoot,'sessions','test.jsonl'));
  assert.deepEqual(await reader(member),[]);
});

test('large sessions use only a bounded window and require fresh in-scope Codex turn context after a partial row',async t=>{
  const c=await setup(t),record=output('map','map.md','new map');
  c.outputs=[record]; c.memoriesEnabled=false;
  const context=id=>({type:'turn_context',timestamp:start,payload:{cwd:c.projectPath,turn_id:id}});
  const filler=event('ignored',{note:'x'.repeat(9000)});
  const end=event('patch_apply_end',{call_id:'map',turn_id:'recent',success:true,changes:{'map.md':{type:'add',content:'new map'}}},finish);
  const write=async events=>{await codex(c,events);const [trace]=await collectTraces(c);
    return {record,trace,path:trace.path};};
  const read=createProcessReader({...c,processByteBudget:1500});
  const receipt=await write([context('first'),message('这段话很旧。'),filler,context('recent'),message('给车站加个指北针。'),end]);
  assert.deepEqual(await read(receipt),[{request:'给车站加个指北针。',operation:'create'}]);
  read.clear();
  const incomplete=await write([context('recent'),filler,message('这句话缺少可核实的工作目录。'),end]);
  assert.deepEqual(await read(incomplete),[]);
});

test('for a Claude edit only verified creation requests in the actual parent chain contribute to its story',async t=>{
  const c=await setup(t),record=output('new','star.md','gold star'),target=path.join(c.projectPath,'star.md');
  c.outputs=[record];c.memoriesEnabled=false;
  const msg=(type,uuid,parentUuid,content,extra={})=>({sessionId:'claude1',cwd:c.projectPath,timestamp:type==='user'&&Array.isArray(content)?finish:start,type,uuid,parentUuid,message:{role:type,content},...extra});
  const write=(id,body)=>[{type:'text',text:'我先把形状记下来。'},{type:'tool_use',name:'Write',id,input:{file_path:target,content:body}}];
  const done=id=>[{type:'tool_result',tool_use_id:id,content:'File created successfully at: '+target}];
  const edit=[{type:'tool_use',name:'Edit',id:'edit1',input:{file_path:target}}];
  await file(path.join(c.claudeRoot,'projects','one','c.jsonl'),[
    msg('user','ask1',null,'画一颗红星。'),msg('assistant','tool1','ask1',write('a','red star')),msg('user','result1','tool1',done('a')),
    msg('user','otherask','result1','让它变成一只猫。'),msg('assistant','other','otherask',write('b','cat')),msg('user','resB','other',done('b')),
    msg('user','ask2','result1','把它改成金色。'),msg('assistant','tool2','ask2',edit),
    msg('user','res2','tool2',done('edit1'),{toolUseResult:{filePath:target,originalFile:'red star',oldString:'red',newString:'gold'}})]);
  const [trace]=await collectTraces(c);
  assert.deepEqual(await createProcessReader(c)({record,path:trace.path,trace}),[
    {request:'画一颗红星。',reply:'我先把形状记下来。',operation:'create'},{request:'把它改成金色。',operation:'edit'}]);
});

test('archived Codex add bytes describe only the observed version at the same path, independently of requests',async t=>{
  const c=await setup(t),name='exports/001.md',body='# 潮汐日志\n每天早晨在湾口观察涨潮的时刻。';
  const large=body+'\n'+'x'.repeat(2*1024*1024);
  c.outputs=[output('archived',name,body),output('other','exports/002.md',body),output('revision',name,'different'),
    output('big','exports/big.md',large),{...output('sdk',name,body),sourceId:'my-tool'}];
  await codex(c,[turn('turn'),message('写一篇海湾旅行的故事。'),patch(name,body),patch('exports/big.md',large,'big-call')]);
  const hits=await collectTraces({...c,memoriesEnabled:false});
  assert.deepEqual(hits.map(h=>h.outputId).sort(),['archived','big','sdk']);
  const valid=hits.find(h=>h.outputId==='archived');
  assert.deepEqual(valid.contentIntro,{title:'潮汐日志',summary:'每天早晨在湾口观察涨潮的时刻。'});
  assert.equal(valid.request,undefined);
  assert.ok(hits.filter(h=>h!==valid).every(h=>!h.contentIntro));
});

test('Claude path-only Write receipts recover the original call, while Edit introduces only the verified resulting version',async t=>{
  const c=await setup(t),name='exports/001.md',filePath=path.join(c.projectPath,name);
  const body='# 海边周记\n周末在岸边看见了三只白鹭。',newText=body.replace('三只','两只');
  c.outputs=[output('old',name,body),output('new',name,newText),output('wrong','exports/clone.md',body)];
  const record=(type,id,items,extra={})=>({sessionId:'s',cwd:c.projectPath,timestamp:type==='assistant'?start:finish,
    type,uuid:id,message:{role:type,content:items},...extra});
  const rows=[record('assistant','write',[{type:'tool_use',name:'Write',id:'add',input:{file_path:filePath,content:body}}]),
    record('user','write-receipt',[{type:'tool_result',tool_use_id:'add',content:'File created successfully at: '+filePath}]),
    record('assistant','edit',[{type:'tool_use',name:'Edit',id:'revise',input:{file_path:filePath}}]),
    record('user','edit-receipt',[{type:'tool_result',tool_use_id:'revise',content:'ok'}],
      {toolUseResult:{filePath,originalFile:body,oldString:'三只',newString:'两只',replaceAll:false}})];
  await file(path.join(c.claudeRoot,'projects','one','write.jsonl'),rows);
  const hits=await collectTraces(c);
  assert.equal(hits.length,2);
  assert.match(hits.find(h=>h.outputId==='old').contentIntro.summary,/三只/);
  assert.match(hits.find(h=>h.outputId==='new').contentIntro.summary,/两只/);
});

test('desktop image generation matches actual returned bytes to a unique copied project PNG and the original request',async t=>{
  const c=await setup(t);
  c.outputs=[output('image','exports/avatar.png',png,'image'),output('other-version','exports/avatar.png','later image','image')];
  const rows=[turn('turn'),message('请画一个戴草帽的角色。'),completed(imageItem({savedPath:path.join(c.codexRoot,'generated_images','unique.png')}))];
  await codex(c,rows); await codex(c,rows,{area:'archived_sessions'});
  const result=await collectTraces(c);
  assert.equal(result.length,1);const trace=result[0];
  assert.equal(trace.outputId,'image');assert.equal(trace.sourceId,'codex');assert.equal(trace.request,'请画一个戴草帽的角色。');
  assert.equal(trace.producedAt,new Date(finish).toISOString());assert.match(trace.sourceRef,/^trace:[0-9a-f]{64}$/);
  assert.equal(trace.path,'exports/avatar.png');assert.equal(trace.fingerprint,hash(png));assert.ok(!trace.title);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_REVISED_PROMPT'));
  const privateResult=await collectTraces({...c,memoriesEnabled:false});
  assert.equal(privateResult.length,1);assert.equal(privateResult[0].request,undefined);assert.equal(privateResult[0].requestedAt,undefined);
});
test('matching a filename or requested image subject cannot attribute a different version, failed result or a sibling project',async t=>{
  const c=await setup(t);c.outputs=[output('image','exports/avatar.png',png,'image')];
  await codex(c,[turn('turn'),message('画一个角色'),completed(imageItem({result:'',savedPath:path.join(c.projectPath,'exports/avatar.png')})),completed(imageItem({status:'failed'}))]);
  await codex(c,[turn('turn'),completed(imageItem())],{cwd:path.join(path.dirname(c.scopePath),'other'),filename:'outside.jsonl'});
  assert.deepEqual(await collectTraces(c),[]);
});

function nativeRender(id,bytes,brief,options='',shown=bytes){
  const call_id='wrapper-'+id,content='const prompt = '+JSON.stringify(brief)+';\n'+
    'const result = await tools.image_gen__imagegen({prompt'+options+',transparent_background:false});generatedImage(result);';
  return [
    {type:'response_item',timestamp:start,payload:{type:'custom_tool_call',name:'exec',call_id,input:content}},
    event('item_completed',{turn_id:id,item:imageItem({id,savedPath:'',result:bytes.toString('base64'),revisedPrompt:brief})},finish),
    {type:'response_item',timestamp:finish,payload:{type:'custom_tool_call_output',call_id,
      output:[{type:'input_image',image_url:'data:image/png;base64,'+shown.toString('base64')}]}}
  ];
}
async function comparedImages(t,{extra=[],options=',num_last_images_to_include:1',firstDisplay=png,changed=false,withRequest=true}={}){
  const c=await setup(t),other=Buffer.concat([png,Buffer.from('\x01')]);
  const first=output('first','first.png',png,'image'),second=output('revised','latest.png',other,'image');
  c.outputs=[first,second];c.memoriesEnabled=false;
  await fs.mkdir(c.projectPath,{recursive:true});
  await fs.writeFile(path.join(c.projectPath,'first.png'),changed?other:png);
  await codex(c,[turn('one'),message('画一座云上的邮局。'),...nativeRender('one',png,'A mountain of letters above the clouds.','',firstDisplay),
    ...extra,turn('two'),...(withRequest?[message('只留下几封信，再给猫留扇门。')]:[]),
    ...nativeRender('two',other,'Edit the post office to have a cat flap and just a few letters.',options)]);
  const found=await collectTraces(c);
  assert(!JSON.stringify(found).includes('mountain of letters'));
  assert(!JSON.stringify(found).includes('猫留扇门'));
  const trace=found.find(r=>r.outputId===second.id);
  return createProcessReader(c)({record:second,path:trace.path,trace});
}
test('distinct image outputs link only through the displayed image, native tool prompt and matching return bytes',async t=>{
  const story=await comparedImages(t);
  assert.deepEqual(story.map(row=>[row.operation,row.request]),[
    ['create','画一座云上的邮局。'],['edit','只留下几封信，再给猫留扇门。']]);
  assert.match(story[0].designBrief,/mountain of letters/);
  assert.match(story[1].designBrief,/cat flap/);
  assert.deepEqual(story.referenceImage,{path:'first.png',fingerprint:hash(png)});
  assert.equal(Object.prototype.propertyIsEnumerable.call(story,'referenceImage'),false);
  assert(!JSON.stringify(story).includes('first.png'));
  for(const options of [
    {extra:[{type:'response_item',timestamp:start,payload:{type:'message',role:'user',content:[{type:'input_image',image_url:'unavailable'}]}}]},
    {extra:[completed({type:'UserMessage',content:[{type:'LocalImage',path:'another.png'}]})]},
    {firstDisplay:Buffer.concat([png,Buffer.from('?')])},
    {options:',num_last_images_to_include:2'},
    {options:''}
  ]){
    const only=await comparedImages(t,options);
    assert.equal(only.length,1);
    assert.equal(only[0].operation,'create');
    assert.equal(only.referenceImage,undefined);
  }
  const designOnly=await comparedImages(t,{withRequest:false,options:''});
  assert.equal(designOnly[0].request,undefined);assert.match(designOnly[0].designBrief,/cat flap/);
  const repainted=await comparedImages(t,{changed:true});
  assert.equal(repainted.length,2);assert.equal(repainted.referenceImage,undefined);
});
test('an explicit project image reference requires the earlier receipt and unchanged project bytes',async t=>{
  const options=',referenced_image_paths:["first.png"]';
  assert.equal((await comparedImages(t,{options})).length,2);
  assert.equal((await comparedImages(t,{options,changed:true})).length,1);
});
test('identical cached renders refuse an ambiguous copy, explicit matching path resolves only its own output',async t=>{
  const c=await setup(t);c.outputs=[output('a','exports/a.png',png,'image'),output('b','exports/b.png',png,'image')];
  await codex(c,[turn('turn'),completed(imageItem())]);
  assert.deepEqual(await collectTraces(c),[]);
  await codex(c,[turn('turn'),completed(imageItem({savedPath:path.join(c.projectPath,'exports/a.png')}))]);
  assert.deepEqual((await collectTraces(c)).map(r=>r.outputId),['a']);
});
test('interleaved turn IDs and tool calls retain the instruction at call start; failed and partial file changes are skipped',async t=>{
  const c=await setup(t); c.outputs=[output('adoc','exports/a.md','A\n'),output('bdoc','exports/b.md','B\n')];
  await codex(c,[
    turn('turn'),message('先帮我整理读书清单。'),event('patch_apply_begin',{call_id:'add-a',turn_id:'turn'}),
    turn('another'),message('请记下周五的路线。','2026-11-18T01:00:20Z'),
    event('patch_apply_end',{call_id:'add-a',turn_id:'turn',success:true,status:'completed',changes:{'exports/a.md':{type:'add',content:'A\n'}}},finish),
    completed({type:'FileChange',id:'add-b',status:'completed',changes:{'exports/b.md':{type:'add',content:'B\n'}}},{turn_id:'another'}),
    completed({type:'FileChange',id:'unverified',status:'failed',changes:{'exports/a.md':{type:'add',content:'A\n'}}}),
    completed({type:'FileChange',id:'update',status:'completed',changes:{'exports/a.md':{type:'update',unified_diff:'@@ -1 +1 @@\n-old\n+A'}}}),
    completed({type:'FileChange',id:'forged',status:'completed',changes:{'exports/a.md':{type:'add',content:'A\n'}}},{thread_id:'some-other-thread'})
  ]);
  const trace=await collectTraces(c);
  assert.deepEqual(trace.map(r=>[r.outputId,r.request]).sort(),[['adoc','先帮我整理读书清单。'],['bdoc','请记下周五的路线。']]);
});
test('different calls producing identical bytes for the same path are ambiguous; scoped worker files never export their internal tasks',async t=>{
  const c=await setup(t);c.outputs=[output('a','a.md','A'),output('b','b.md','B')];
  await codex(c,[turn('turn'),message('PRIVATE_WORKER_INSTRUCTIONS'),patch('a.md','A','first'),patch('a.md','A','second'),patch('b.md','B')],{source:{subagent:{thread_spawn:{}}}});
  const hits=await collectTraces(c);assert.equal(hits.length,1);assert.equal(hits[0].outputId,'b');assert.equal(hits[0].request,undefined);
});
test('a control message does not replace the human prompt and a sensitive newer prompt is never replaced by the older one',async t=>{
  const c=await setup(t);c.outputs=[output('a','a.md','A'),output('b','b.md','B')];
  await codex(c,[turn('turn'),message('帮我写一份说明。'),message('<environment_context>PRIVATE</environment_context>'),
    event('patch_apply_begin',{call_id:'first',turn_id:'turn'}),
    message('api_key: PRIVATE_VALUE'),event('patch_apply_begin',{call_id:'second',turn_id:'turn'}),
    patch('a.md','A','first'),patch('b.md','B','second')]);
  const hits=await collectTraces(c);
  assert.equal(hits.find(r=>r.outputId==='a').request,'帮我写一份说明。');
  assert.equal(hits.find(r=>r.outputId==='b').request,undefined);
});
test('Claude Write uses the matching tool use and branch, never the latest text in an unrelated branch',async t=>{
  const c=await setup(t); c.outputs=[output('a','a.md','first'),output('b','b.md','edited'),output('c','c.md','nope')];
  const f=(type,uuid,parentUuid,content,extra={})=>({sessionId:'session',cwd:c.projectPath,timestamp:type==='user'&&Array.isArray(content)?finish:start,type,uuid,parentUuid,message:{role:type,content},...extra});
  const tool=(id,file,data)=>[{type:'tool_use',name:'Write',id,input:{file_path:path.join(c.projectPath,file),content:data}}];
  const result=(id,text,error=false)=>[{type:'tool_result',tool_use_id:id,content:text,is_error:error}];
  const rows=[f('user','ask-a',null,'请帮我起草第一份说明。'),f('user','ask-b',null,'帮我改一改第二份。'),
    f('assistant','tool-a','ask-a',tool('a','a.md','first')), f('assistant','tool-b','ask-b',tool('b','b.md','edited')),
    f('user','result-b','tool-b',result('b','ack'),{toolUseResult:{type:'update',filePath:path.join(c.projectPath,'b.md'),content:'edited'}}),
    f('user','result-a','tool-a',result('a','File created successfully at: '+path.join(c.projectPath,'a.md'))),
    f('assistant','tool-c','ask-a',tool('c','c.md','nope')),f('user','failed','tool-c',result('c','Access denied',true))];
  await file(path.join(c.claudeRoot,'projects','one','session.jsonl'),rows);
  const hits=await collectTraces(c);assert.equal(hits.length,2);
  assert.equal(hits.find(r=>r.outputId==='a').request,'请帮我起草第一份说明。');
  assert.equal(hits.find(r=>r.outputId==='b').request,'帮我改一改第二份。');
  assert.equal(hits.find(r=>r.outputId==='b').operation,'edit');assert.ok(hits.every(h=>h.sourceId==='claude-code'));
});
test('explicit image receipt metadata only supports the matching observed path and hash',async t=>{
  const c=await setup(t);c.outputs=[output('image','exports/portrait.png',png,'image')];
  const item={type:'McpToolCall',id:'gen',server:'image_gen',tool:'imagegen',status:'completed',result:{structuredContent:{path:'exports/portrait.png',sha256:hash(png),title:'机器人肖像'}}};
  await codex(c,[turn('turn'),message('画一幅肖像。'),completed(item)]);
  const hits=await collectTraces(c);assert.equal(hits.length,1);assert.equal(hits[0].title,'机器人肖像');
  await codex(c,[turn('turn'),completed({...item,result:{structuredContent:{sha256:hash(png)}}})]);
  assert.deepEqual(await collectTraces(c),[]);
});
test('native response image can be recognized after a byte-identical project copy; a picture predating the operation is excluded',async t=>{
  const c=await setup(t);c.outputs=[output('result','exports/copy.png',png,'image')];
  await codex(c,[turn('turn'),message('画出雨后的街道。'),{type:'response_item',timestamp:finish,payload:{type:'image_generation_call',id:'ig_a',status:'completed',saved_path:path.join(c.projectPath,'temp','render.png'),result:png.toString('base64')}}]);
  assert.equal((await collectTraces(c))[0].request,'画出雨后的街道。');
  c.outputs[0].timestamp=start;assert.deepEqual(await collectTraces(c),[]);
});
test('a bounded scan resumes a large session without losing the earlier request and open tool call',async t=>{
  const c=await setup(t);c.outputs=[output('book','book.md','A')];
  const filler=Array.from({length:30},()=>event('ignored',{note:'x'.repeat(140)}));
  await codex(c,[turn('turn'),message('写一份读书笔记。'),event('patch_apply_begin',{call_id:'book',turn_id:'turn'}),
    ...filler,patch('book.md','A','book')]);
  const limited={...c,scanByteBudget:1500};
  assert.deepEqual(await collectTraces(limited),[]);
  let matches=[];
  for(let i=0;i<15&&!matches.length;i++) matches=await collectTraces(limited);
  assert.equal(matches.length,1);assert.equal(matches[0].request,'写一份读书笔记。');
  assert.deepEqual(await collectTraces(limited),matches);
});
test('Claude Edit reconstructs the actual bytes only where the receipt proves a unique replacement or replace-all',async t=>{
  const c=await setup(t);c.outputs=[output('yes','a.md','a bear'),output('all','b.md','xx'),output('ambiguous','c.md','xa')];
  const cwd=c.projectPath, rows=[{sessionId:'s',cwd,timestamp:start,type:'user',uuid:'prompt',message:{content:'帮我改一下文字。'}}];
  for (const [file,originalFile,oldString,newString,replaceAll] of [
    ['a.md','a pear','pear','bear',false],['b.md','aa','a','x',true],['c.md','aa','a','x',false]
  ]) {
    const filePath=path.join(cwd,file);
    rows.push({sessionId:'s',cwd,timestamp:start,type:'assistant',uuid:'call-'+file,parentUuid:'prompt',
      message:{content:[{type:'tool_use',name:'Edit',id:file,input:{file_path:filePath,old_string:oldString,new_string:newString}}]}},
    {sessionId:'s',cwd,timestamp:finish,type:'user',parentUuid:'call-'+file,
      message:{content:[{type:'tool_result',tool_use_id:file,is_error:false,content:'ack'}]},
      toolUseResult:{filePath,originalFile,oldString,newString,replaceAll}});
  }
  await file(path.join(c.claudeRoot,'projects','one','session.jsonl'),rows);
  const found=await collectTraces(c);
  assert.deepEqual(found.map(x=>x.outputId).sort(),['all','yes']);
  assert.ok(found.every(x=>x.operation==='edit' && x.request==='帮我改一下文字。'));
});
