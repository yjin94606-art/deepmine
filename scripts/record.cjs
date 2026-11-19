'use strict';
// Local hook bridge. Input is a structured event, never a raw transcript.
const fs=require('node:fs/promises'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const {settingsDirectory}=require('./data-directory.cjs');
async function main(args=process.argv.slice(2)){
  if(args.includes('--help')){console.log('node scripts/record.cjs [--file event.json] [--port 4173]\nOtherwise reads one JSON event from stdin. Project path and the local ingestion key come from this app configuration.');return;}
  const directory=settingsDirectory(ROOT);
  const config=JSON.parse(await fs.readFile(path.join(directory,'config.json'),'utf8'));
  const key=config.ingestionKey || (await fs.readFile(path.join(directory,'ingestion.key'),'utf8')).trim();
  const flag=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
  let text='';const file=flag('--file');
  if(file){const stat=await fs.stat(file);if(stat.size>65536)throw new Error('Event exceeds 64 KiB');text=await fs.readFile(file,'utf8');}
  else{for await(const chunk of process.stdin){text+=chunk.toString('utf8');if(Buffer.byteLength(text)>65536)throw new Error('Event exceeds 64 KiB');}}
  const body={...JSON.parse(text),projectPath:config.projectPath};
  const preferred=args.includes('--port')?Number(flag('--port')):undefined;
  const port=await require('./open-mine.cjs').runningMinePort(directory,config,preferred,Number(process.env.PORT));
  if(port===null)throw Error('Open the mine for this project, then retry the event.');
  const response=await fetch(`http://127.0.0.1:${port}/api/events`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-Deepmine-Key':key},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const result=await response.json();if(!response.ok)throw new Error(result.code||result.error||'Event rejected');console.log(JSON.stringify(result));
}
module.exports={main};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
