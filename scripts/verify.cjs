'use strict';
const {readdirSync}=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');

function filesIn(directory,pattern){
  return readdirSync(path.join(root,directory),{withFileTypes:true})
    .filter(entry=>entry.isFile() && pattern.test(entry.name))
    .map(entry=>path.join(directory,entry.name)).sort();
}

function run(args){
  const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}

const [mode,...args]=process.argv.slice(2);
if(mode==='test'){
  const tests=filesIn('tests',/\.test\.cjs$/);
  if(!tests.length)throw Error('No unit tests found');
  run(['--test',...args,...tests]);
}else if(mode==='check'){
  for(const directory of ['dist','scripts','integrations','tests']){
    for(const file of filesIn(directory,/\.[cm]?js$/))run(['--check',file]);
  }
}else{
  throw Error('Choose test or check.');
}
