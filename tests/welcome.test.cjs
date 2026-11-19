'use strict';
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const {startWelcome} = require('../scripts/welcome.cjs');

async function fixture(t, startGame = async () => ({url:'http://127.0.0.1:4271/'}), recover = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deepmine-welcome-'));
  const home = path.join(root, '用户 Home'), project = path.join(root, '作品 project');
  const appRoot = path.join(root, 'installation');
  await Promise.all([home,project,appRoot].map(p => fs.mkdir(p)));
  const dataDir = path.join(root, 'state');
  const config = path.join(dataDir, 'config.json');
  const codexRoot = recover ? path.join(root,'alternate Codex') : path.join(home,'.codex');
  if (recover) {
    await fs.mkdir(dataDir);
    await fs.writeFile(config,JSON.stringify({projectPath:path.join(root,'moved project'),codexRoot}));
  }
  const env = {DEEPMINE_DATA_DIR:dataDir};
  const identity = {app:'deepmine',instance:'a'.repeat(64),projectId:null};
  const app = await startWelcome({appRoot, env, home, startGame, identity});
  t.after(async () => {
    await app.close();
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('deepmine-welcome-')) throw Error('Unexpected fixture location');
    await fs.rm(root,{force:true,recursive:true});
  });
  async function log(name='first',cwd=project) {
    const directory = path.join(codexRoot,'sessions','2026');
    await fs.mkdir(directory,{recursive:true});
    const header = {type:'session_meta',timestamp:'2026-11-01T01:00:00Z',payload:{id:name,cwd,source:'cli'}};
    await fs.writeFile(path.join(directory,name+'.jsonl'),JSON.stringify(header)+'\n'+JSON.stringify({type:'response_item',text:'PRIVATE_DIALOGUE'}));
  }
  const call = (route,options) => fetch(new URL(route, app.url),options);
  const choose = (choice,headers={}) => call('api/connect',{method:'POST',
    headers:{Origin:new URL(app.url).origin,'X-Deepmine-Client':'welcome','Content-Type':'application/json',...headers},
    body:JSON.stringify(choice)});
  return {app,config,project,home,codexRoot,log,call,choose,identity};
}
test('fresh welcome shell serves the actual local art and form, even when no Codex projects exist', async t => {
  const f = await fixture(t);
  const shell = await f.call('/'), html = await shell.text();
  assert.equal(shell.status,200); assert.match(html,/id="setup"/); assert.match(html,/id="folder"/);
  const files = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map(match=>match[1]);
  for(const file of files) assert.equal((await f.call(file,{method:'HEAD'})).status,200,file);
  assert.deepEqual(await (await f.call('api/instance')).json(),f.identity);
  assert.deepEqual((await (await f.call('api/projects')).json()).projects,[]);
  await assert.rejects(fs.access(f.config));
  await f.log();
  const scanned = await (await f.call('api/projects')).json();
  assert.equal(scanned.projects[0].path,f.project);
  assert.ok(!JSON.stringify(scanned).includes('PRIVATE_DIALOGUE'));
  await assert.rejects(fs.access(f.config));
});
test('the sample mine serves the game and its fictional art before setup',async t=>{
  const f=await fixture(t,()=>assert.fail('sample must not start a collector'));
  const response=await f.call('/try'),html=await response.text();
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-security-policy'),/connect-src http:\/\/127\.0\.0\.1:\d+\/demo-assets\//);
  assert.match(html,/id="discoveryStage"/);
  for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){
    assert.equal((await f.call(new URL(match[1],new URL('try',f.app.url)),{method:'HEAD'})).status,200,match[1]);
  }
  for(const image of ['garden.png','sample-02.png']){
    assert.equal((await f.call('/demo-assets/'+image)).headers.get('content-type'),'image/png');
  }
  for(const url of ['/api/snapshot','/api/preview','/demo-assets/unknown.png','/config.json']){
    assert.equal((await f.call(url)).status,404,url);
  }
  await assert.rejects(fs.access(f.config),{code:'ENOENT'});
});
test('duplicate submissions save the selected project once and both arrive at the same game', async t => {
  let starts=0;
  const f = await fixture(t, async () => { starts++; await new Promise(resolve=>setTimeout(resolve,30)); return 'http://127.0.0.1:49123/'; });
  await f.log();
  const id=(await (await f.call('api/projects')).json()).projects[0].id;
  const a=f.choose({id,memories:false}), b=f.choose({id,memories:false});
  for(const response of await Promise.all([a,b])) {
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{url:'http://127.0.0.1:49123/'});
  }
  const saved=JSON.parse(await fs.readFile(f.config));
  assert.equal(saved.projectPath,f.project); assert.equal(saved.memories.enabled,false); assert.deepEqual(saved.outputDirs,['.']);
  assert.equal(starts,1);
  const previous=await f.call('/',{redirect:'manual'});
  assert.equal(previous.status,303); assert.equal(previous.headers.get('location'),'http://127.0.0.1:49123/');
});
test('only a local browser choice can write setup and different or invalid choices stay distinct', async t => {
  const f=await fixture(t);
  const choice={folder:f.project,memories:false};
  assert.equal((await f.choose(choice,{Origin:'http://other.invalid'})).status,403);
  assert.equal((await f.choose(choice,{Origin:''})).status,403);
  assert.equal((await f.choose({id:'unknown',memories:false})).status,400);
  assert.equal((await f.choose({folder:'relative',memories:true})).status,400);
  assert.equal((await f.choose({folder:path.join(f.project,'missing'),memories:false})).status,400);
  await assert.rejects(fs.access(f.config));
  assert.equal((await f.choose(choice)).status,200);
  assert.equal((await f.choose({...choice,memories:true})).status,409);
});
test('a folder with no Codex log can open, with explicit memory consent and retry after a startup failure',async t=>{
  let attempts=0;
  const f=await fixture(t,async()=>{if(++attempts===1)throw Error('Not yet');return {url:'http://127.0.0.1:49261/'};});
  const choice={folder:f.project,memories:true};
  const first=await f.choose(choice);
  assert.equal(first.status,503); assert.equal((await first.json()).error,'start-failed');
  assert.equal((await f.choose(choice)).status,200);
  assert.equal(JSON.parse(await fs.readFile(f.config)).memories.enabled,true);assert.equal(attempts,2);
});

test('a first visit saves story input separately from saving raw conversation memories',async t=>{
  const f=await fixture(t);
  const choice={folder:f.project,memories:false,narration:true,includeProcess:true};
  assert.equal((await f.choose({...choice,narration:false})).status,400);
  assert.equal((await f.choose({...choice,includeProcess:'yes'})).status,400);
  assert.equal((await f.choose(choice)).status,200);
  const {projectIdentity}=require('../scripts/collector.cjs');
  const prefs=path.join(path.dirname(f.config),'narration',projectIdentity(f.project).id,'preferences.json');
  assert.deepEqual(JSON.parse(await fs.readFile(prefs)),{enabled:true,includeProcess:true});
  assert.equal(JSON.parse(await fs.readFile(f.config)).memories.enabled,false);
  assert.equal((await f.choose({...choice,includeProcess:false})).status,409);
});

test('recovering a moved project discovers and connects through the saved custom Codex home',async t=>{
  const f=await fixture(t,undefined,true);
  await f.log();
  const {projects}=await (await f.call('api/projects')).json();
  assert.equal(projects[0].path,f.project);
  assert.equal((await f.choose({id:projects[0].id,memories:false})).status,200);
  assert.equal(JSON.parse(await fs.readFile(f.config)).codexRoot,f.codexRoot);
});

test('Claude Code projects can be selected on first use and a shared Codex workspace appears once',async t=>{
  const f=await fixture(t), root=path.join(f.home,'.claude','projects','encoded-folder');
  await fs.mkdir(root,{recursive:true});
  const turn={type:'user',cwd:f.project,sessionId:'one',timestamp:'2026-11-02T00:00:00Z',message:{content:'PRIVATE_CLAUDE'}};
  await fs.writeFile(path.join(root,'chat.jsonl'),JSON.stringify({type:'file-history-snapshot',padding:'x'.repeat(8225)})+'\n'+JSON.stringify(turn));
  await fs.writeFile(path.join(root,'copy.jsonl'),JSON.stringify(turn));
  const side=path.join(root,'nested','subagents');
  await fs.mkdir(side,{recursive:true});
  await fs.writeFile(path.join(side,'agent.jsonl'),JSON.stringify({...turn,cwd:f.home}));
  const scan=async()=> (await f.call('api/projects')).json();
  const first=await scan();
  assert.equal(first.projects.length,1);
  assert.deepEqual(first.projects[0].sources,['Claude Code']);
  assert.equal(first.projects[0].sessions,1);
  assert.equal(first.projects[0].path,f.project);
  assert.equal(JSON.stringify(first).includes('PRIVATE_CLAUDE'),false);
  await f.log('first',process.platform==='win32'?f.project.toUpperCase():f.project);
  const both=await scan();
  assert.equal(both.projects.length,1);
  assert.equal(both.projects[0].id,first.projects[0].id);
  assert.deepEqual(both.projects[0].sources,['Codex','Claude Code']);
  assert.equal(both.projects[0].sessions,2);
  assert.equal((await f.choose({id:first.projects[0].id,memories:false})).status,200);
  assert.equal(JSON.parse(await fs.readFile(f.config)).claudeRoot,path.join(f.home,'.claude'));
});

test('pasted desktop paths and quoted home-relative paths work with spaces and Unicode',async t=>{
  const f=await fixture(t), project=path.join(f.home,'作品 folder');
  await fs.mkdir(project);
  for (const input of ['~somebody/secret','"relative-folder"']) {
    assert.equal((await f.choose({folder:input,memories:false})).status,400);
  }
  for (const input of ['"~/作品 folder"',' "'+project+'" ']) {
    assert.equal((await f.choose({folder:input,memories:false})).status,200);
  }
  assert.equal(JSON.parse(await fs.readFile(f.config)).projectPath,project);
});

test('manual folder browsing requires a local user gesture request and lists only immediate visible directories',async t=>{
  const f=await fixture(t), chosen=path.join(f.home,'作品 folders'), nested=path.join(chosen,'第二层');
  await fs.mkdir(nested,{recursive:true});
  await fs.mkdir(path.join(f.home,'.private'));
  await fs.writeFile(path.join(f.home,'private.txt'),'PRIVATE_FILE');
  const junction=path.join(f.home,'cycle');
  await fs.symlink(f.home,junction,process.platform==='win32'?'junction':'dir');
  const origin=new URL(f.app.url).origin;
  const browse=(folder,headers={})=>f.call('/api/folders',{method:'POST',
    headers:{Origin:origin,'Content-Type':'application/json','X-Deepmine-Client':'welcome',...headers},body:JSON.stringify({folder})});
  assert.equal((await f.call('/api/folders')).status,404);
  for(const bad of [{Origin:'http://example.invalid'},{Origin:''},{'X-Deepmine-Client':'other'},{'Sec-Fetch-Site':'cross-site'}]) {
    assert.equal((await browse('',bad)).status,403);
  }
  const homeView=await (await browse('')).json();
  assert.equal(homeView.current,await fs.realpath(f.home));
  assert.deepEqual(homeView.children,[{name:'作品 folders',path:await fs.realpath(chosen)}]);
  const next=await (await browse(homeView.children[0].path)).json();
  assert.equal(next.parent,homeView.current);
  assert.deepEqual(next.children,[{name:'第二层',path:await fs.realpath(nested)}]);
  assert.equal((await browse(path.join(f.home,'private.txt'))).status,400);
  assert.equal((await browse('relative/path')).status,400);
  await assert.rejects(fs.access(f.config));
  assert.equal((await f.choose({folder:next.current,memories:false})).status,200);
  assert.equal(JSON.parse(await fs.readFile(f.config)).projectPath,await fs.realpath(chosen));
});

test('the drive chooser probes only the selected letter and keeps the original folder on offline, missing and denied drives',async()=>{
  const source=await fs.readFile(path.join(__dirname,'../dist/welcome.js'),'utf8');
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  for(const windowsDrives of [true,false]){
    const requests=[], elements=new Map();
    class Element {
      constructor(){this.value='';this.handlers={};this.textContent='';this.hidden=false;}
      addEventListener(name,fn){(this.handlers[name]||=[]).push(fn);}
      async fire(name){for(const fn of this.handlers[name]||[])await fn({});await tick();}
      setAttribute(){} focus(){} replaceChildren(){} add(){}
    }
    function get(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);}
    const home=windowsDrives?'C:\\Users\\Player':'/home/player', delays=new Map();
    get('picker').hidden=get('pickerDrives').hidden=true;
    const reply=value=>({ok:true,json:async()=>value});
    async function fetch(url,opts){
      if(url==='/api/projects')return reply({projects:[],windowsDrives});
      const target=JSON.parse(opts.body).folder;
      requests.push(target);
      if(target==='X:\\')return new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(Error('Offline'))));
      if(target==='Z:\\' || target==='A:\\')return {ok:false,status:400};
      return reply({current:target||home,parent:target?null:'parent',children:[],windowsDrives});
    }
    const context={document:{getElementById:get,documentElement:{},querySelectorAll:()=>[]},window:{},navigator:{language:'en'},
      Option:class {},fetch,AbortController,localStorage:{getItem:()=>null},
      setTimeout:(fn,ms)=>{const id=Symbol();delays.set(id,{ms,fn});return id;},clearTimeout:id=>delays.delete(id)};
    require('node:vm').runInNewContext(source,context);
    await tick();
    assert.deepEqual(requests,[]);
    await get('browse').fire('click');
    assert.deepEqual(requests,['']);
    assert.equal(get('pickerDrives').hidden,!windowsDrives);
    get('driveLetter').value='D';await get('driveLetter').fire('change');
    assert.deepEqual(requests,['']);
    if(!windowsDrives){await get('openDrive').fire('click');assert.deepEqual(requests,['']);continue;}
    for(const letter of ['Z','A','X']){
      get('driveLetter').value=letter;await get('openDrive').fire('click');
      if(letter==='X'){const timer=[...delays.values()][0];assert.equal(timer.ms,6000);timer.fn();await tick();}
      assert.equal(get('pickerLocation').textContent,home);
      assert.equal(get('useFolder').disabled,false);
      assert.match(get('pickerStatus').textContent,/drive is unavailable/i);
    }
    get('driveLetter').value='D';await get('openDrive').fire('click');
    assert.deepEqual(requests,['','Z:\\','A:\\','X:\\','D:\\']);
    assert.equal(get('pickerLocation').textContent,'D:\\');
    assert.equal(get('pickerDrives').open,true);
    await get('useFolder').fire('click');
    assert.equal(get('folder').value,'D:\\');
  }
});
