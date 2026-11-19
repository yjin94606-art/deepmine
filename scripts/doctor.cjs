'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {settingsDirectory}=require('./setup.cjs');
const {projectIdentity,inScope}=require('./collector.cjs');
const {defaults}=require('./source-adapters.cjs');
const {discoverCodex}=require('./connect-codex.cjs');

// A public issue can be copied verbatim. Build it from a closed set of fields,
// never from private diagnostic text, filenames, record counts or provider labels.
async function shareableReport(directory=settingsDirectory(),{request=fetch}={}) {
  const report={deepmine:require('../package.json').version,system:process.platform,arch:process.arch,
    node:process.versions.node,configuration:'unreadable',projectFolder:'unknown',service:'unknown'};
  let config;
  try{config=JSON.parse(await fs.readFile(path.join(directory,'config.json'),'utf8'));}
  catch(error){if(error.code==='ENOENT')report.configuration='not-configured';return report;}
  if(typeof config?.projectPath!=='string' || !path.isAbsolute(config.projectPath))return report;
  report.configuration='configured';
  try{report.projectFolder=(await fs.stat(config.projectPath)).isDirectory()?'available':'missing';}
  catch(error){report.projectFolder=error.code==='ENOENT'?'missing':'unavailable';}
  report.service='not-connected';
  try{
    const port=await require('./open-mine.cjs').runningMinePort(directory,config,undefined,Number(process.env.PORT));
    if(!port)return report;
    const response=await request('http://127.0.0.1:'+port+'/api/connectors',{signal:AbortSignal.timeout(20000),redirect:'error'});
    if(!response.ok)return report;
    const info=await response.json();
    if(info.projectId!==projectIdentity(config.projectPath).id)return report;
    report.service='connected';
    const states=new Set(['connected','partial','missing','disabled','unavailable','empty','observed']);
    const status=value=>states.has(value)?value:'unknown';
    const sourceStatus=id=>status(info.usageSources?.find(source=>source.id===id)?.status);
    report.sources={codex:sourceStatus('codex'),claudeCode:sourceStatus('claude-code'),files:status(info.outputSource?.status)};
  }catch{/* Keep the fixed status when a service is unavailable. */}
  return report;
}

async function diagnose(config,{port=4173,env=process.env,home,request=fetch}={}) {
  if(port!==null && (!Number.isInteger(port)||port<1||port>65535))throw Error('Port must be 1–65535.');
  const checks=[];
  async function folder(label,dir) {
    try { if(!(await fs.stat(dir)).isDirectory())throw Error();checks.push({label,status:'readable'});}
    catch {checks.push({label,status:'missing'});}
  }
  await folder('Project',config.projectPath);
  for(const dir of config.outputDirs||[])await folder('Output '+dir,path.join(config.projectPath,dir));
  if(config.sources?.codex!==false) {
    const root=path.resolve(config.codexRoot||defaults(home,env).codexRoot);
    const {projects,partial}=await discoverCodex(root);
    const sessions=projects.filter(p=>inScope(p.projectPath,config.scopePath||config.projectPath)).reduce((sum,p)=>sum+p.sessions,0);
    checks.push({label:'Codex home',status:root},{label:'Codex chats in selected scope',status:String(sessions)+(partial?' (partial scan)':'')});
  }
  try{
    if(port===null)throw Error('No matching mine');
    const response=await request('http://127.0.0.1:'+port+'/api/connectors',{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error();
    const info=await response.json();
    if(info.projectId!==projectIdentity(config.projectPath).id){
      checks.push({label:'Local server',status:'wrong project or older server; restart Deepmine for this project'});
    }else{
      checks.push({label:'Local server',status:'connected'});
      for(const source of info.usageSources)checks.push({label:source.label,status:source.status});
      checks.push({label:'API capture',status:(info.capture?.enabledProviders||[]).join(', ')||'disabled'});
      checks.push({label:'History',status:info.capabilities.persistentHistory?'enabled':'unavailable'});
    }
  } catch {checks.push({label:'Local server',status:'unreachable; run npm start'});}
  return checks;
}
async function main(args=process.argv.slice(2)) {
  if(args.length===1 && args[0]==='--share'){console.log(JSON.stringify(await shareableReport(),null,2));return;}
  if(args.includes('--help')){console.log('npm run doctor -- [--port 4173]\nnpm run doctor -- --share   Print a support report without local paths or usage records.');return;}
  if(args.length && !(args.length===2 && args[0]==='--port'))throw Error('Use --port PORT.');
  const root=path.resolve(__dirname,'..');
  const directory=settingsDirectory(root);
  let config;
  try {config=JSON.parse(await fs.readFile(path.join(directory,'config.json'),'utf8'));}
  catch(e) {if(e.code!=='ENOENT')throw Error('Configuration is unreadable.');console.log('Run npm run connect:codex first.');process.exitCode=1;return;}
  const port=await require('./open-mine.cjs').runningMinePort(directory,config,args[1]===undefined?undefined:Number(args[1]),Number(process.env.PORT));
  const checks=await diagnose(config,{port});
  for(const check of checks)console.log(check.label+': '+check.status);
  if(checks.some(c=>c.label==='Project'&&c.status!=='readable'||c.label==='Local server'&&c.status!=='connected'))process.exitCode=1;
}
module.exports={diagnose,shareableReport};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
