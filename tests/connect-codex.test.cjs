'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {connect,discoverCodex}=require('../scripts/connect-codex.cjs');
const {diagnose}=require('../scripts/doctor.cjs');
const {projectIdentity}=require('../scripts/collector.cjs');

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'deepmine-codex-connect-'));
  t.after(async()=>{
    const safe=path.resolve(root);
    if(path.dirname(safe)!==path.resolve(os.tmpdir()) || !path.basename(safe).startsWith('deepmine-codex-connect-'))throw Error('Unsafe fixture path.');
    await fs.rm(safe,{force:true,recursive:true});
  });
  const project=path.join(root,'工作 project'),home=path.join(root,'user'),appRoot=path.join(root,'安装 Deepmine');
  await fs.mkdir(project);await fs.mkdir(home);await fs.mkdir(appRoot);
  const codexRoot=path.join(home,'.codex'),configPath=path.join(appRoot,'.deepmine','config.json');
  async function log(cwd=project,{id='chat1',archive=false,at='2026-10-04T04:15:00Z',source='cli',rootDir=codexRoot,filename=id+'.jsonl'}={}){
    const dir=path.join(rootDir,archive?'archived_sessions':'sessions','2026','10');
    await fs.mkdir(dir,{recursive:true});
    const row={type:'session_meta',timestamp:at,payload:{id,cwd,source,unrelated:'do not leak the contents'}};
    await fs.writeFile(path.join(dir,filename),[JSON.stringify(row),JSON.stringify({type:'response_item',payload:{text:'PRIVATE_SENTINEL'}})].join('\n'));
  }
  return {root,project,home,appRoot,codexRoot,configPath,log,options:{home,appRoot,env:{DEEPMINE_DATA_DIR:path.dirname(configPath)},interactive:false,write:()=>{}}};
}
test('discovers real project directories from active and archived headers, deduplicating session copies',async t=>{
  const f=await fixture(t),other=path.join(f.root,'second');await fs.mkdir(other);
  await f.log();await f.log(f.project,{archive:true});await f.log(other,{id:'recent',at:'2026-11-01T00:00:00Z'});
  await f.log(f.project,{id:'agent',source:{subagent:{thread_spawn:{}}}});
  await f.log(path.join(f.root,'moved'),{id:'missing',at:'2026-11-03T00:00:00Z'});
  const result=await discoverCodex(f.codexRoot);
  assert.deepEqual(result.projects.map(p=>[p.projectPath,p.sessions]),[[other,1],[f.project,1]]);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
});
test('a fresh noninteractive install lists its own projects and keeps selection explicit',async t=>{
  const f=await fixture(t);await f.log();
  const result=await connect(['--list'],f.options);
  assert.equal(result.projects[0].projectPath,f.project);
  await assert.rejects(connect([],f.options),/--project/);
  await assert.rejects(fs.access(f.configPath));
  await connect(['--latest','--setup-only'],f.options);
  const saved=JSON.parse(await fs.readFile(f.configPath));
  assert.equal(saved.projectPath,f.project);assert.deepEqual(saved.outputDirs,['.']);
  assert.equal(saved.codexRoot,f.codexRoot);assert.notEqual(saved.memories?.enabled,true);
});
test('an explicit CODEX_HOME and private data directory survive installation/working-directory differences',async t=>{
  const f=await fixture(t),custom=path.join(f.root,'Codex history'),data=path.join(f.root,'用户数据');
  await f.log(f.project,{rootDir:custom});
  const options={...f.options,env:{CODEX_HOME:custom,DEEPMINE_DATA_DIR:data}};
  let launched;
  await connect(['--latest','--memories','--port','4123'],{...options,launch:async value=>{launched=value;}});
  assert.equal(launched.port,4123);assert.equal(launched.dataDirectory,data);
  const cfg=JSON.parse(await fs.readFile(path.join(data,'config.json')));
  assert.equal(cfg.codexRoot,custom);assert.equal(cfg.memories.enabled,true);
  await assert.rejects(fs.access(f.configPath));
});
test('selecting the home folder does not implicitly observe personal files',async t=>{
  const f=await fixture(t);await f.log(f.home);
  await connect(['--latest','--setup-only'],f.options);
  assert.deepEqual(JSON.parse(await fs.readFile(f.configPath)).outputDirs,[]);
});
test('reconnecting preserves a user’s chosen source scope and a switch resets project-specific permissions',async t=>{
  const f=await fixture(t),outer=path.join(f.root,'b');await fs.mkdir(outer);
  await connect(['--project',f.project,'--outputs','art','--scope',f.root,'--memories','--setup-only'],f.options);
  await connect(['--project',f.project,'--setup-only'],f.options);
  let cfg=JSON.parse(await fs.readFile(f.configPath));
  assert.equal(cfg.scopePath,f.root);assert.deepEqual(cfg.outputDirs,['art']);assert.equal(cfg.memories.enabled,true);
  await connect(['--project',outer,'--setup-only'],f.options);
  cfg=JSON.parse(await fs.readFile(f.configPath));assert.equal(cfg.scopePath,outer);assert.deepEqual(cfg.outputDirs,['.']);assert.notEqual(cfg.memories?.enabled,true);
});
test('doctor checks both local Codex sessions and the identity of the project served on the chosen port',async t=>{
  const f=await fixture(t);await f.log();
  const config={projectPath:f.project,codexRoot:f.codexRoot},projectId=projectIdentity(f.project).id;
  const call=id=>diagnose(config,{port:4199,request:async url=>{
    assert.equal(url,'http://127.0.0.1:4199/api/connectors');
    return {ok:true,json:async()=>({projectId:id,usageSources:[{label:'Codex',status:'connected'}],capabilities:{persistentHistory:true}})};
  }});
  let checks=await call(projectId);
  assert.equal(checks.find(c=>c.label==='Codex chats in selected scope').status,'1');
  assert.equal(checks.find(c=>c.label==='Local server').status,'connected');
  checks=await call('unrelated');assert.match(checks.find(c=>c.label==='Local server').status,/wrong project/);
  assert.ok(!checks.some(c=>c.label==='Codex'));
});
test('scanning a selected workspace never ingests the mine’s own custom data directory inside it',async t=>{
  const f=await fixture(t),dataDirectory=path.join(f.project,'runtime data');
  await fs.mkdir(dataDirectory);await fs.writeFile(path.join(dataDirectory,'private.txt'),'saved user request');
  await fs.writeFile(path.join(f.project,'work.md'),'# A real project output');
  const result=await require('../scripts/output-files.cjs').collectFiles({projectPath:f.project,outputDirs:['.'],dataDirectory,timezone:'UTC'});
  assert.deepEqual(result.outputs.flatMap(r=>r.files),['work.md']);
});
test('an immediate save within a filesystem clock tick is observed without recording a future output',async t=>{
  const f=await fixture(t),now=new Date('2026-06-01T15:20:23.000Z');
  for(const [name,offset] of [['fresh.md',8],['future.md',5000]]){
    const file=path.join(f.project,name);
    await fs.writeFile(file,'# Timed output');
    await fs.utimes(file,now,new Date(now.getTime()+offset));
  }
  const result=await require('../scripts/output-files.cjs').collectFiles({projectPath:f.project,outputDirs:['.'],timezone:'UTC',now});
  assert.deepEqual(result.outputs.map(o=>[o.files[0],o.timestamp]),[['fresh.md',now.toISOString()]]);
});

