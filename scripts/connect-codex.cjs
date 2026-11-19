'use strict';
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const readline=require('node:readline/promises');
const {defaults,canonical}=require('./source-adapters.cjs');
const {parseMetadata}=require('./collector.cjs');
const {configure,settingsDirectory}=require('./setup.cjs');

const HELP=[
  'Connect Deepmine to Codex on this computer (Node.js 20+).',
  'npm run connect:codex                          Choose a recorded project and start the mine',
  'npm run connect:codex -- --list                 List local Codex workspaces without saving anything',
  'npm run connect:codex -- --project "/path"      Connect an explicit project',
  'npm run connect:codex -- --latest               Use the most recently started local Codex workspace',
  '  --setup-only     Save settings without starting a server',
  '  --outputs DIRS   Read artifacts from these project directories (default: selected project)',
  '  --memories       Keep a short original request when a matching receipt is available',
  '  --codex-root DIR Override CODEX_HOME or the current user’s .codex directory',
  '  --port PORT      Set the listening port for this run (default: 4173)',
  'Other project settings are available with npm run setup -- --help.'
].join('\n');

async function metadata(filename) {
  const handle=await fs.open(filename,'r');
  try {
    const limit=2*1024*1024, chunks=[];
    let bytes=0;
    while(bytes<limit){
      const buffer=Buffer.allocUnsafe(Math.min(8192,limit-bytes));
      const {bytesRead}=await handle.read(buffer,0,buffer.length,bytes);
      if(!bytesRead)break;
      const piece=buffer.subarray(0,bytesRead),end=piece.indexOf(10);
      chunks.push(end<0?piece:piece.subarray(0,end));
      bytes+=bytesRead;
      if(end>=0)break;
      if(bytes===limit)return null;
    }
    const row=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const cwd=row?.payload?.cwd;
    if(typeof cwd!=='string'||!path.isAbsolute(cwd)||/[\x00-\x1f\x7f]/.test(cwd))return null;
    const info=parseMetadata(row,cwd);
    if(!info || info.excluded || info.kind==='worker')return null;
    return {id:info.id,projectPath:path.resolve(cwd),startedAt:info.createdAt};
  } finally {await handle.close();}
}

async function discoverCodex(codexRoot) {
  const projects=new Map(), files=[];
  let partial=false,scannedFolders=0;
  async function walk(dir,depth) {
    if(depth>8 || ++scannedFolders>12000 || files.length>=8000){partial=true;return;}
    let children;
    try{children=await fs.readdir(dir,{withFileTypes:true});}
    catch(e){if(e.code!=='ENOENT')partial=true;return;}
    children.sort((a,b)=>b.name.localeCompare(a.name));
    for(const entry of children){
      if(files.length>=8000){partial=true;break;}
      const file=path.join(dir,entry.name);
      if(entry.isDirectory())await walk(file,depth+1);
      else if(entry.isFile() && entry.name.endsWith('.jsonl'))files.push(file);
    }
  }
  await walk(path.join(codexRoot,'sessions'),0);
  await walk(path.join(codexRoot,'archived_sessions'),0);
  for(let i=0;i<files.length;i+=12){
    const found=await Promise.allSettled(files.slice(i,i+12).map(metadata));
    for(const entry of found){
      if(entry.status==='rejected'){partial=true;continue;}
      const item=entry.value;if(!item)continue;
      const key=canonical(item.projectPath);
      let p=projects.get(key);
      if(!p){p={projectPath:item.projectPath,startedAt:item.startedAt,sessions:new Set()};projects.set(key,p);}
      if(Date.parse(item.startedAt)>Date.parse(p.startedAt))p.startedAt=item.startedAt;
      p.sessions.add(item.id);
    }
  }
  const existing=[];
  for(const p of projects.values()){
    try{if((await fs.stat(p.projectPath)).isDirectory())existing.push({...p,sessions:p.sessions.size});}catch{/* A moved or deleted project is not a usable default. */}
  }
  return {projects:existing.sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt)||a.projectPath.localeCompare(b.projectPath)),partial};
}

async function connect(args,options={}) {
  const {appRoot=path.resolve(__dirname,'..'),env=process.env,home=os.homedir(),interactive=Boolean(process.stdin.isTTY && process.stdout.isTTY),write=console.log}=options;
  if(args.includes('--help')||args.includes('-h')){write(HELP);return;}
  const selectedArgs=[],get=key=>{const i=selectedArgs.indexOf(key);return i<0?undefined:selectedArgs[i+1];};
  let list=false,latest=false,setupOnly=false,port;
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--list')list=true;
    else if(arg==='--latest')latest=true;
    else if(arg==='--setup-only')setupOnly=true;
    else if(arg==='--port'){
      const raw=args[++i];
      if(!raw || !/^\d+$/.test(raw) || Number(raw)>65535)throw Error('Port must be 0–65535.');
      port=Number(raw);
    }else selectedArgs.push(arg);
  }
  if(get('--project') && latest)throw Error('Choose either --project or --latest.');
  const directory=settingsDirectory(appRoot,env);
  let previous={};
  try{previous=JSON.parse(await fs.readFile(path.join(directory,'config.json'),'utf8'));}
  catch(e){if(e.code!=='ENOENT')throw Error('Existing configuration is unreadable.');}
  const codexRoot=path.resolve(get('--codex-root')||previous.codexRoot||defaults(home,env).codexRoot);
  let project=get('--project'),terminal;
  try{
    if(!project || list){
      const {projects,partial}=await discoverCodex(codexRoot);
      write('Codex · '+codexRoot);
      for(const [i,p] of projects.entries())write(`${i+1}. ${p.projectPath}  (${p.sessions} chats · ${p.startedAt})`);
      if(partial)write('Some session headers were unavailable. An explicit --project path also works.');
      if(!projects.length)write('No local Codex workspace with readable session headers and an existing folder was found. Start a local Codex chat, set --codex-root, or pass --project.');
      if(list)return {projects};
      if(!projects.length)throw Error('Choose an existing project with --project.');
      if(latest)project=projects[0].projectPath;
      else{
        if(!interactive)throw Error('Choose a project with --project "/path" or --latest.');
        terminal=readline.createInterface({input:process.stdin,output:process.stdout});
        const answer=(await terminal.question('选择要连接的 Codex 项目 / Project number [1]: ')).trim() || '1';
        const chosen=/^\d+$/.test(answer) && projects[Number(answer)-1];
        if(!chosen)throw Error('Unknown project number.');
        project=chosen.projectPath;
      }
      selectedArgs.push('--project',project);
    }
    project=path.resolve(project);
    const sameProject=previous.projectPath && canonical(previous.projectPath)===canonical(project);
    if(!get('--outputs') && !(sameProject && Array.isArray(previous.outputDirs))){
      const real=await fs.realpath(project);
      const userHome=await fs.realpath(home).catch(()=>path.resolve(home));
      const installation=await fs.realpath(appRoot);
      if(canonical(real)===canonical(installation))write('This is the Deepmine installation. Use --outputs with your own artifact folders to include uncommitted work.');
      else if(canonical(real)!==canonical(userHome) && real!==path.parse(real).root)selectedArgs.push('--outputs','.');
      else write('This workspace is a home or drive root. To include uncommitted files, pass --outputs with specific subfolders.');
    }
    // Preserve an explicitly configured scope on reconnect to the same project.
    if(sameProject && previous.scopePath && !get('--scope'))selectedArgs.push('--scope',previous.scopePath);
    if(!get('--codex-root'))selectedArgs.push('--codex-root',codexRoot);
    if(selectedArgs.includes('--no-codex'))throw Error('Use npm run setup to configure other sources with Codex disabled.');
    selectedArgs.push('--codex');
    write('Project · '+project);
    write('Output directories · '+(get('--outputs')|| (sameProject && previous.outputDirs?.join(', ')) || 'none'));
    if(get('--outputs')==='.' || (sameProject && !get('--outputs') && previous.outputDirs?.includes('.')))
      write('读取此项目中的作品文件，跳过隐藏目录、node_modules 和符号链接。 / Reads project artifacts; skips hidden folders, node_modules and symlinks.');
    await configure(selectedArgs,{appRoot,env});
    write('Config saved · '+path.join(directory,'config.json'));
    if(setupOnly)return {configured:true,projectPath:project};
    return await (options.launch || require('./server.cjs').launchServer)({dataDirectory:directory,port});
  } finally {terminal?.close();}
}
module.exports={connect,discoverCodex};
if(require.main===module)connect(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
