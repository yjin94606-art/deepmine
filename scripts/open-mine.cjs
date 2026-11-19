'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {createHash,randomUUID} = require('node:crypto');
const {setTimeout:delay} = require('node:timers/promises');
const {settingsDirectory} = require('./setup.cjs');
const {projectIdentity} = require('./collector.cjs');
const {canonical} = require('./source-adapters.cjs');
const ROOT = path.resolve(__dirname,'..');

function identity(dataDirectory,projectId,config={}) {
  const instance=createHash('sha256').update(JSON.stringify([
    require('../package.json').version,canonical(ROOT),canonical(path.resolve(dataDirectory)),projectId?config:null
  ])).digest('hex');
  return {app:'deepmine',instance,projectId};
}

// A short startup gate serializes simultaneous double-clicks, even on first
// run when there is no saved port to probe. A process killed during startup
// leaves an abandoned slot. Skip it instead of racing to remove another lock.
async function withStartupGate(base,work) {
  const deadline=Date.now()+18000;
  let slot=0;
  while(Date.now()<deadline){
    const file=base+'.'+slot+'.lock';
    try{await fs.writeFile(file,String(process.pid),{flag:'wx',mode:0o600});}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      try {
        const owner=Number(await fs.readFile(file,'utf8'));
        if(Number.isSafeInteger(owner)&&owner>0){
          try{process.kill(owner,0);}catch(e){if(e.code==='ESRCH'){slot++;continue;}}
        }else if(Date.now()-(await fs.stat(file)).mtimeMs>5000){slot++;continue;}
      }catch(e){if(e.code==='ENOENT')continue;throw e;}
      await delay(90);
      continue;
    }
    try{return await work();}finally{await fs.unlink(file);}
  }
  throw Error('深矿正在启动，请稍后再打开。Deepmine is still starting. Try again in a moment.');
}

function isPort(port){return Number.isInteger(port)&&port>0&&port<=65535;}
function matchesService(port,expected){
  if(!isPort(port))return Promise.resolve(false);
  return new Promise(resolve=>{
    const req=http.get({hostname:'127.0.0.1',port,path:'/api/instance',agent:false},res=>{
      const chunks=[];
      let size=0;
      if(res.statusCode!==200){res.destroy();resolve(false);return;}
      res.on('error',()=>resolve(false));
      res.on('data',chunk=>{size+=chunk.length;if(size>1024){res.destroy();resolve(false);}else chunks.push(chunk);});
      res.on('end',()=>{
        try{
          const item=JSON.parse(Buffer.concat(chunks).toString());
          resolve(item.app===expected.app && item.instance===expected.instance && item.projectId===expected.projectId);
        }catch{resolve(false);}
      });
    });
    const timer=setTimeout(()=>{req.destroy();resolve(false);},700);
    req.on('error',()=>resolve(false));
    req.on('close',()=>clearTimeout(timer));
  });
}

async function savedInstance(file){
  try{return JSON.parse(await fs.readFile(file,'utf8'));}
  catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return null;throw error;}
}
async function rememberPort(file,port,projectId){
  const temporary=file+'.'+randomUUID()+'.tmp';
  try{await fs.writeFile(temporary,JSON.stringify({port,projectId}),{mode:0o600,flag:'wx'});await fs.rename(temporary,file);}
  finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
function launcherBase(directory){return path.join(directory,'launcher-'+identity(directory,null).instance.slice(0,16));}
function rememberRunning(directory,port,projectId){return rememberPort(launcherBase(directory)+'.json',port,projectId);}
// Connectors must verify the listener before sending an event or its local key.
// The saved listener can differ from the requested launch port if it was busy.
async function runningMinePort(directory,config,preferred,fallback=4173) {
  if(!config?.projectPath || !path.isAbsolute(config.projectPath))return null;
  if(preferred!==undefined && !isPort(preferred))throw Error('Port must be 1–65535.');
  const projectId=projectIdentity(config.projectPath).id;
  const expected=identity(directory,projectId,config);
  if(preferred!==undefined)return await matchesService(preferred,expected)?preferred:null;
  const saved=await savedInstance(launcherBase(directory)+'.json');
  const last=saved && (!saved.projectId || saved.projectId===projectId) ? saved.port : null;
  for(const candidate of new Set([last,fallback,4173])){
    if(await matchesService(candidate,expected))return candidate;
  }
  return null;
}
async function selectedProject(directory) {
  let config;
  try{config=JSON.parse(await fs.readFile(path.join(directory,'config.json'),'utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw Error('无法读取现有配置，请检查 config.json。Cannot read the saved configuration.');}
  if(typeof config?.projectPath!=='string'||!path.isAbsolute(config.projectPath))throw Error('项目配置缺少有效路径。Invalid saved project path.');
  try{return (await fs.stat(config.projectPath)).isDirectory()?{id:projectIdentity(config.projectPath).id,config}:null;}
  catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')return null;throw error;}
}

async function openMine({env=process.env,port:explicitPort}={}) {
  const port=explicitPort??Number(env.PORT||4173);
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Port must be 0–65535.');
  const directory=settingsDirectory(ROOT,env);
  await fs.mkdir(directory,{recursive:true});
  const base=launcherBase(directory);
  const registry=base+'.json',owned=new Set();
  async function close(){
    await Promise.all([...owned].map(server=>new Promise(resolve=>{
      server.close(resolve);server.closeAllConnections();
    })));
  }
  async function ready(){
    return withStartupGate(base,async()=>{
      const project=await selectedProject(directory);
      const expected=identity(directory,project?.id||null,project?.config);
      const previous=await savedInstance(registry);
      for(const candidate of new Set([previous?.port,port])){
        if(await matchesService(candidate,expected))return {port:candidate,reused:true};
      }
      let running;
      if(project){
        const {start}=require('./server.cjs');
        // An origin stores the player's language, sound and other browser
        // preferences. Keep the last game port when reopening this project.
        const last=previous?.projectId===project.id && isPort(previous.port)?previous.port:null;
        const choices=explicitPort===undefined && !env.PORT?[last,port,0]:[port,last,0];
        for(const target of new Set(choices)){
          if(target===null)continue;
          try{running=await start({dataDirectory:directory,port:target,quiet:true});break;}
          catch(error){
            if(error.code==='EADDRINUSE' && target!==0)continue;
            if(error.message.includes('already being synchronized'))throw Error('这个项目已在另一服务中运行。请关闭旧的深矿窗口再打开。Close the previous Deepmine service for this project, then reopen.');
            throw error;
          }
        }
      }else{
        const {startWelcome}=require('./welcome.cjs');
        running=await startWelcome({appRoot:ROOT,env,port:0,identity:expected,startGame:async()=>{
          const game=await ready();
          return {url:localUrl(game.port)};
        }});
      }
      owned.add(running.server);
      running.server.once('close',()=>owned.delete(running.server));
      await rememberPort(registry,running.port,expected.projectId);
      return {port:running.port,reused:false};
    });
  }
  try{
    const result=await ready();
    return {...result,url:localUrl(result.port),close};
  }catch(error){await close();throw error;}
}

function localUrl(port){return 'http://127.0.0.1:'+port+'/';}
async function openBrowser(url){
  const command=process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open';
  const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:'ignore',windowsHide:true,detached:true});
    child.once('error',reject);
    child.once('exit',code=>code===0?resolve():reject(Error('Browser opener exited '+code)));
    child.unref();
  });
}
async function main(args) {
  if(args.length===1 && args[0]==='--diagnostics'){
    console.log(JSON.stringify(await require('./doctor.cjs').shareableReport(),null,2));
    return;
  }
  let open=true,port;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--no-open')open=false;
    else if(args[i]==='--port'&&/^\d+$/.test(args[i+1]||''))port=Number(args[++i]);
    else if(args[i]==='--help'){console.log('Open Deepmine in your browser. Options: --no-open, --port 0–65535. Use --diagnostics alone for a shareable support report.');return;}
    else throw Error('Unknown option. Use --help.');
  }
  const instance=await openMine({port});
  if(!instance.reused){
    process.once('SIGINT',instance.close);
    process.once('SIGTERM',instance.close);
    if(process.platform==='win32')process.once('SIGBREAK',instance.close);
  }
  console.log('Deepmine: '+instance.url);
  if(!instance.reused)console.log('保留此窗口即可使用深矿，按 Ctrl+C 可退出。Keep this window open while using Deepmine.');
  if(open)await openBrowser(instance.url).catch(()=>console.warn('请在浏览器打开上方地址。Open the address above in your browser.'));
}
module.exports={openMine,identity,rememberRunning,runningMinePort};
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
