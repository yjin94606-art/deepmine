'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');

function shareMetadata(siteUrl){
  const site=new URL(siteUrl);
  if(site.protocol!=='https:' || site.username || site.password || site.search || site.hash)throw Error('Expected a public HTTPS Pages base URL.');
  if(!site.pathname.endsWith('/'))site.pathname+='/';
  const title='Play Deepmine — Dig through a day of AI work';
  const description='Try the pixel-art mine in your browser and dig up a portrait of a botanist whose leaf-shaped hair clip took two revisions to get right.';
  const alt='A yellow-scarfed botanist and a brass drill in the mine beside the words “Dig through a day of AI work.”';
  const image=new URL('social-en.png',site).href;
  const tags={
    description,'og:type':'website','og:title':title,'og:description':description,'og:url':site.href,
    'og:image':image,'og:image:type':'image/png','og:image:width':'1280','og:image:height':'640','og:image:alt':alt,
    'twitter:card':'summary_large_image','twitter:title':title,'twitter:description':description,'twitter:image':image,'twitter:image:alt':alt
  };
  return Object.entries(tags).map(([key,value])=>{
    const attribute=key.startsWith('og:')?'property':'name';
    return '<meta '+attribute+'="'+key+'" content="'+value.replaceAll('&','&amp;').replaceAll('"','&quot;')+'">';
  }).join('\n');
}

// Publish the fictional sample and its self-contained, optional film.
async function buildSample(destination,siteUrl='https://yjin94606-art.github.io/deepmine/'){
  const source=path.resolve(__dirname,'../dist');
  const meta=shareMetadata(siteUrl);
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
  await fs.copyFile(path.resolve(__dirname,'../docs/launch/social-en.png'),path.join(destination,'social-en.png'));
  const policy="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; worker-src 'none'; base-uri 'none'; form-action 'none'";
  const shell=html.replace('<html lang="en">','<html lang="en" data-hosted-sample>')
    .replace('<meta charset="utf-8">','<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+policy+'"><meta name="referrer" content="no-referrer">\n'+meta);
  if(!shell.includes('data-hosted-sample') || !shell.includes(policy))throw Error('Game shell markers changed.');
  await fs.writeFile(path.join(destination,'index.html'),shell,{flag:'wx'});
  const watchSource=path.resolve(__dirname,'../docs/launch/watch');
  const watchOutput=path.join(destination,'watch');
  const baseUrl=siteUrl.endsWith('/')?siteUrl:siteUrl+'/';
  for(const languagePath of ['','zh/']){
    const input=path.join(watchSource,languagePath),output=path.join(watchOutput,languagePath);
    await fs.mkdir(output,{recursive:true});
    const extra=languagePath?['captions.srt']:['watch.css'];
    for(const file of ['deepmine.mp4','poster.jpg','share.jpg','captions.vtt',...extra]){
      await fs.copyFile(path.join(input,file),path.join(output,file));
    }
    const watchUrl=new URL('watch/'+languagePath,baseUrl).href.replaceAll('&','&amp;').replaceAll('"','&quot;');
    const watchHtml=await fs.readFile(path.join(input,'index.html'),'utf8');
    await fs.writeFile(path.join(output,'index.html'),watchHtml.replaceAll('{{watchUrl}}',watchUrl),{flag:'wx'});
  }
}
module.exports={buildSample};
if(require.main===module){
  const target=process.argv[2];
  if(!target){console.error('Usage: node scripts/build-sample.cjs OUTPUT_DIRECTORY');process.exitCode=1;}
  else buildSample(path.resolve(target),process.env.DEEPMINE_PAGES_URL).catch(error=>{console.error(error.message);process.exitCode=1;});
}
