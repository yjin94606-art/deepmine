'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');

// Copy only the game shell's assets and its two fictional illustrations.
// Saved projects, collectors and the local vision runtime live outside this bundle.
async function buildSample(destination){
  const source=path.resolve(__dirname,'../dist');
  const html=await fs.readFile(path.join(source,'index.html'),'utf8');
  const assets=new Set(['image-decode.mjs','demo-assets/garden.png','demo-assets/sample-02.png']);
  for(const [,file] of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)){
    if(!/^[a-z0-9-]+\.(?:js|css|svg)$/.test(file))throw Error('Unexpected game asset: '+file);
    assets.add(file);
  }
  await fs.mkdir(destination,{recursive:true});
  if((await fs.readdir(destination)).length)throw Error('Choose an empty output directory for the public sample.');
  for(const file of assets){
    const input=path.join(source,file),output=path.join(destination,file);
    if(!(await fs.lstat(input)).isFile())throw Error('Expected a regular game asset: '+file);
    await fs.mkdir(path.dirname(output),{recursive:true});
    await fs.copyFile(input,output);
  }
  const policy="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; worker-src 'none'; base-uri 'none'; form-action 'none'";
  const shell=html.replace('<html lang="en">','<html lang="en" data-hosted-sample>')
    .replace('<meta charset="utf-8">','<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+policy+'"><meta name="referrer" content="no-referrer">');
  if(!shell.includes('data-hosted-sample') || !shell.includes(policy))throw Error('Game shell markers changed.');
  await fs.writeFile(path.join(destination,'index.html'),shell,{flag:'wx'});
}
module.exports={buildSample};
if(require.main===module){
  const target=process.argv[2];
  if(!target){console.error('Usage: node scripts/build-sample.cjs OUTPUT_DIRECTORY');process.exitCode=1;}
  else buildSample(path.resolve(target)).catch(error=>{console.error(error.message);process.exitCode=1;});
}
