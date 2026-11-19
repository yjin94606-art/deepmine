'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const execFile=require('node:util').promisify(require('node:child_process').execFile);
const {openMine,rememberRunning}=require('../scripts/open-mine.cjs');
const {start}=require('../scripts/server.cjs');
const {userDataDirectory,settingsDirectory}=require('../scripts/data-directory.cjs');

test('desktop data uses the platform user directory independent of the install path',()=>{
  assert.equal(userDataDirectory({LOCALAPPDATA:'C:\\User Files\\Local'},'win32'),'C:\\User Files\\Local\\Deepmine');
  assert.equal(userDataDirectory({USERPROFILE:'D:\\用户'},'win32'),'D:\\用户\\AppData\\Local\\Deepmine');
  assert.equal(userDataDirectory({HOME:'/Users/画 家'},'darwin'),'/Users/画 家/Library/Application Support/Deepmine');
  assert.equal(userDataDirectory({HOME:'/home/artist',XDG_DATA_HOME:'/data/工作'},'linux'),'/data/工作/deepmine');
  assert.equal(userDataDirectory({HOME:'/home/artist',XDG_DATA_HOME:'./relative'},'linux'),'/home/artist/.local/share/deepmine');
});

test('moving a clean install keeps the user save; a portable configuration and explicit override retain precedence',async t=>{
  const f=await fixture(t),portable=path.join(f.dir,'.deepmine');
  const env={HOME:f.dir,USERPROFILE:f.dir,LOCALAPPDATA:path.join(f.dir,'Local'),XDG_DATA_HOME:path.join(f.dir,'local data')};
  const userPath=userDataDirectory(env);
  assert.equal(settingsDirectory(f.dir,env),userPath);
  assert.equal(settingsDirectory(path.join(f.dir,'新版 folder'),env),userPath);
  await fs.mkdir(portable);await fs.writeFile(path.join(portable,'config.json'),'{}');
  assert.equal(settingsDirectory(f.dir,env),portable);
  assert.equal(settingsDirectory(f.dir,{...env,DEEPMINE_DATA_DIR:f.data}),f.data);
});

async function fixture(t,configured=true){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'deepmine-opener-'));
  const data=path.join(dir,'存档 with spaces'),project=path.join(dir,'我的项目');
  const config={projectPath:project,codexRoot:path.join(dir,'codex'),sources:{claude:false}};
  const env={...process.env,DEEPMINE_DATA_DIR:data,CODEX_HOME:config.codexRoot};
  const handles=[];
  t.after(async()=>{
    for(const instance of handles)await instance.close();
    await fs.rm(dir,{recursive:true,force:true});
  });
  await fs.mkdir(project);await fs.mkdir(data);
  const file=path.join(data,'config.json');
  if(configured)await fs.writeFile(file,JSON.stringify(config));
  async function open(port=0){
    const instance=await openMine({env,port});
    handles.push(instance);return instance;
  }
  return {dir,data,env,config,file,open};
}

test('the launcher prints diagnostics before project selection without creating a save',async t=>{
  const f=await fixture(t,false);
  const run=await execFile(process.execPath,[require.resolve('../scripts/open-mine.cjs'),'--diagnostics'],{env:f.env});
  const report=JSON.parse(run.stdout);
  assert.equal(report.configuration,'not-configured');
  assert.equal(report.deepmine,require('../package.json').version);
  assert.deepEqual(await fs.readdir(f.data),[]);
  await fs.writeFile(f.file,'not JSON');
  const damaged=await require('../scripts/doctor.cjs').shareableReport(f.data);
  assert.equal(damaged.configuration,'unreadable');
});

test('a public report contains only fixed connection statuses even with private source names or paths',async t=>{
  const f=await fixture(t);
  await f.open();
  const id=require('../scripts/collector.cjs').projectIdentity(f.config.projectPath).id;
  const report=await require('../scripts/doctor.cjs').shareableReport(f.data,{request:async()=>({
    ok:true,json:async()=>({projectId:id,usageSources:[
      {id:'codex',label:'CUSTOM PRIVATE LABEL',status:'connected'},
      {id:'claude-code',label:f.config.projectPath,status:'unexpected personal string'},
      {id:'import/private',status:'connected'}],outputSource:{status:'missing'},notes:['private record']})
  })});
  assert.deepEqual(report,{deepmine:require('../package.json').version,system:process.platform,arch:process.arch,
    node:process.versions.node,configuration:'configured',projectFolder:'available',service:'connected',
    sources:{codex:'connected',claudeCode:'unknown',files:'missing'}});
});

test('simultaneous opens share a single listener and keep the saved selection',async t=>{
  const f=await fixture(t);
  const services=await Promise.all(Array.from({length:4},()=>f.open()));
  assert.equal(new Set(services.map(s=>s.url)).size,1);
  assert.equal(services.filter(s=>!s.reused).length,1);
  const url=services[0].url;
  const info=await (await fetch(url+'api/instance')).json();
  assert.equal(info.app,'deepmine');assert.match(info.projectId,/^[0-9a-f]{16}$/);
  assert.equal(JSON.stringify(info).includes(f.dir),false);
  assert.equal((await fetch(url+'api/instance',{headers:{Origin:'https://elsewhere.invalid'}})).status,403);
  assert.equal((await fetch(url+'api/instance',{method:'POST'})).status,405);
  assert.deepEqual(JSON.parse(await fs.readFile(f.file)),f.config);
});

test('an occupied port belonging to another application is skipped, and the alternate is reused',async t=>{
  const f=await fixture(t);
  const other=http.createServer((_,res)=>{res.writeHead(200);res.end('{"app":"deepmine","instance":"different","projectId":null}');});
  await new Promise(resolve=>other.listen(0,'127.0.0.1',resolve));
  try{
    const occupied=other.address().port;
    const game=await f.open(occupied);
    assert.notEqual(game.port,occupied);
    assert.equal((await f.open(occupied)).url,game.url);
    await game.close();
    const tomorrow=await f.open(occupied);
    assert.equal(tomorrow.url,game.url);
    assert.equal(tomorrow.reused,false);
  }finally{await new Promise(resolve=>other.close(resolve));}
});

test('an existing collector on a custom port is reused only for the same settings',async t=>{
  const f=await fixture(t);
  const old=await start({dataDirectory:f.data,port:0,quiet:true});
  try{
    await rememberRunning(f.data,old.port);
    const reopened=await f.open();
    assert.equal(reopened.port,old.port);assert.equal(reopened.reused,true);
    await fs.writeFile(f.file,JSON.stringify({...f.config,locale:'ja'}));
    await assert.rejects(f.open(),/previous Deepmine service/);
  }finally{
    old.server.closeAllConnections();
    await new Promise(resolve=>old.server.close(resolve));
  }
  const restarted=await f.open();
  assert.equal(restarted.reused,false);
});

test('doctor and event recorder locate the selected mine after a port conflict',async t=>{
  const f=await fixture(t),requests=[];
  const other=http.createServer((req,res)=>{
    requests.push([req.url,req.headers['x-deepmine-key']]);res.end('{}');
  });
  await new Promise(resolve=>other.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>other.close(resolve)));
  const busy=other.address().port, game=await f.open(busy);
  assert.notEqual(game.port,busy);
  const env={...f.env,PORT:String(busy)},event=path.join(f.dir,'event.json');
  await fs.writeFile(event,JSON.stringify({schemaVersion:1,id:'call-1',source:'test',sessionId:'session',
    timestamp:new Date().toISOString(),kind:'usage',usage:{inputTokens:12,cachedInputTokens:0,outputTokens:3,totalTokens:15}}));
  const run=(tool,...args)=>execFile(process.execPath,[path.resolve(__dirname,'../scripts/'+tool+'.cjs'),...args],{env,windowsHide:true});
  assert.match((await run('doctor')).stdout,/Local server: connected/);
  assert.equal(JSON.parse((await run('record','--file',event)).stdout).status,'accepted');
  await assert.rejects(run('record','--file',event,'--port',String(busy)),/Open the mine/);
  assert.ok(requests.length>0);
  assert.ok(requests.every(([url,key])=>url==='/api/instance' && key===undefined));
});

test('a fresh installation and a missing saved project open the picker without starting a collector',async t=>{
  const f=await fixture(t,false);
  const first=await f.open();
  assert.equal((await (await fetch(first.url+'api/instance')).json()).projectId,null);
  assert.equal((await f.open()).url,first.url);
  await assert.rejects(fs.access(f.file),{code:'ENOENT'});
  await first.close();
  const moved={...f.config,projectPath:path.join(f.dir,'moved')};
  await fs.writeFile(f.file,JSON.stringify(moved));
  const again=await f.open();
  assert.equal((await (await fetch(again.url+'api/instance')).json()).projectId,null);
  assert.deepEqual(JSON.parse(await fs.readFile(f.file)),moved);
});

test('a malformed preference file stays intact and produces an actionable error',async t=>{
  const f=await fixture(t);
  await fs.writeFile(f.file,'damaged');
  await assert.rejects(f.open(),/Cannot read the saved configuration/);
  assert.equal(await fs.readFile(f.file,'utf8'),'damaged');
});
