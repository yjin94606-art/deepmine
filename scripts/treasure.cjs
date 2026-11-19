'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const execFile=require('node:util').promisify(require('node:child_process').execFile);

const SOURCE='https://github.com/trending?since=daily';
const DISTANCE=12;
const isoDay=/^\d{4}-\d{2}-\d{2}$/;
const slug=/^[a-z\d](?:[a-z\d-]{0,38})\/[\w.-]{1,100}$/i;

function plain(html=''){
  const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  return html.replace(/<[^>]*>/g,' ').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,code)=>{
    if(code[0]!=='#')return entities[code.toLowerCase()]||' ';
    const n=code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):Number(code.slice(1));
    return n>=32&&n<=0x10ffff?String.fromCodePoint(n):' ';
  }).replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/g,' ').trim();
}
function parseTrending(html){
  // Use the first repository card on GitHub's daily, all-languages list.
  // A markup change must never silently promote a different repository.
  const card=/<article\b[^>]*class=["'][^"']*\bBox-row\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1];
  const heading=/<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(card||'')?.[1];
  const name=/<a\b[^>]*?\shref=["']\/([^"'?#]+)["']/i.exec(heading||'')?.[1];
  if(!name || !slug.test(name) || name.split('/').some(p=>p==='.'||p==='..'))throw Error('Trending format unavailable');
  const description=plain(/<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(card)?.[1]).slice(0,600);
  const language=plain(/<span\b[^>]*itemprop=["']programmingLanguage["'][^>]*>([^<]*)<\/span>/i.exec(card)?.[1]).slice(0,60);
  return {name,description,language};
}
// Windows browsers inherit the system proxy; Node's fetch does not. This child
// receives only constant code and reads a fixed public page, never project data.
const WINDOWS_FETCH=`
$ErrorActionPreference='Stop'
$u=[Uri]'https://github.com/trending?since=daily'
$proxy=[Net.WebRequest]::DefaultWebProxy
if(-not $proxy -or $proxy.IsBypassed($u)){exit 3}
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$request=[Net.HttpWebRequest]::Create($u)
$request.Proxy=$proxy
$request.AllowAutoRedirect=$false
$request.UserAgent='Deepmine-Treasure-Map/1.0'
$request.Accept='text/html'
$request.Timeout=6500
$request.ReadWriteTimeout=5000
$request.AutomaticDecompression=[Net.DecompressionMethods]'GZip, Deflate'
$response=$request.GetResponse()
try {
  if([int]$response.StatusCode -ne 200 -or $response.ContentType -notmatch '^text/html(?:;|$)'){exit 4}
  $stream=$response.GetResponseStream()
  $out=[Console]::OpenStandardOutput()
  $buffer=New-Object byte[] 16384
  $total=0
  while(($count=$stream.Read($buffer,0,$buffer.Length)) -gt 0){
    $total+=$count
    if($total -gt 2097152){exit 4}
    $out.Write($buffer,0,$count)
  }
} finally {$response.Close()}
`;
async function fetchTop(){
  if(process.platform==='win32'){
    const windows=process.env.SystemRoot||'C:\\Windows';
    try{
      const shell=path.join(windows,'System32','WindowsPowerShell','v1.0','powershell.exe');
      const {stdout}=await execFile(shell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(WINDOWS_FETCH,'utf16le').toString('base64')],
        {windowsHide:true,timeout:9000,maxBuffer:2*1024*1024,encoding:'buffer'});
      return parseTrending(stdout.toString('utf8'));
    }catch{/* No configured system route, or it was unavailable. Try the direct connection. */}
  }
  const result=await fetch(SOURCE,{redirect:'error',signal:AbortSignal.timeout(12000),
    headers:{Accept:'text/html','User-Agent':'Deepmine-Treasure-Map/1.0'}});
  if(!result.ok||!result.body||!result.headers.get('content-type')?.includes('text/html'))throw Error('GitHub unavailable');
  const chunks=[];let bytes=0;
  for await(const chunk of result.body){bytes+=chunk.length;if(bytes>2*1024*1024)throw Error('Trending page too large');chunks.push(chunk);}
  return parseTrending(Buffer.concat(chunks).toString('utf8'));
}
function createTreasure({directory,getRadio,readTop=fetchTop,now=()=>new Date()}){
  const inFlight=new Map();
  let retryAt=0;
  const filename=(date,suffix)=>path.join(directory,date+suffix);
  async function lookup(date){
    if(!isoDay.test(date||''))return null;
    try{
      const map=JSON.parse(await fs.readFile(filename(date,'.json'),'utf8'));
      if(map.date!==date || !slug.test(map.name)||typeof map.description!=='string'||typeof map.language!=='string')throw Error('Invalid map file');
      return map;
    }catch(error){if(error.code==='ENOENT')return null;throw error;}
  }
  async function state(selected){
    const radio=await getRadio();
    let names=[];
    try{names=await fs.readdir(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
    const marked=new Set(names.filter(n=>n.endsWith('.filed')).map(n=>n.slice(0,-6)));
    const entries=names.filter(n=>/^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().reverse()
      .map(n=>({date:n.slice(0,10),filed:marked.has(n.slice(0,10))}));
    return {date:radio.date,meters:Math.floor(radio.meters),distance:DISTANCE,entries,
      map:await lookup(selected||radio.date)};
  }
  async function decode(date){
    const radio=await getRadio();
    if(radio.date!==date || radio.meters<DISTANCE)return {status:'locked'};
    const cached=await lookup(date);
    if(cached)return {status:'ready',map:cached};
    if(inFlight.has(date))return inFlight.get(date);
    if(Number(now())<retryAt)return {status:'offline'};
    const work=(async()=>{
      let top;
      try{top=await readTop();}catch{retryAt=Number(now())+15000;return {status:'offline'};}
      if((await getRadio()).date!==date)return {status:'expired'};
      const map={date,...top,observedAt:now().toISOString()};
      await fs.mkdir(directory,{recursive:true});
      const tmp=filename(date,'.'+randomUUID()+'.tmp');
      try{
        await fs.writeFile(tmp,JSON.stringify(map),{flag:'wx',mode:0o600});
        // The mark for filing is separate and cannot be undone by another reader.
        try{await fs.link(tmp,filename(date,'.json'));}
        catch(error){
          if(error.code==='EEXIST')return {status:'ready',map:await lookup(date)};
          if(!['EPERM','ENOSYS','ENOTSUP','EACCES'].includes(error.code))throw error;
          await fs.rename(tmp,filename(date,'.json'));
        }
      }finally{await fs.unlink(tmp).catch(()=>{});}
      return {status:'ready',map};
    })();
    inFlight.set(date,work);
    try{return await work;}finally{inFlight.delete(date);}
  }
  async function file(date){
    if(!await lookup(date))return {status:'missing'};
    try{await fs.writeFile(filename(date,'.filed'),'',{flag:'wx',mode:0o600});}
    catch(error){if(error.code!=='EEXIST')throw error;}
    return {status:'filed'};
  }
  async function handle(req,res,headers){
    const send=(code,value)=>{res.writeHead(code,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    try{
      if(req.method==='GET'){
        const date=new URL(req.url,'http://localhost').searchParams.get('date');
        if(date!==null&&!isoDay.test(date))return send(400,{status:'invalid'});
        return send(200,await state(date));
      }
      if(req.method!=='POST')return send(405,{status:'invalid'});
      if(req.headers['x-deepmine-client']!=='treasure'||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return send(403,{status:'invalid'});
      const chunks=[];let size=0;
      for await(const chunk of req){if((size+=chunk.length)>512)return send(413,{status:'invalid'});chunks.push(chunk);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{status:'invalid'});}
      if(!isoDay.test(body?.date||'')||!['decode','file'].includes(body?.action))return send(400,{status:'invalid'});
      return send(200,body.action==='file'?await file(body.date):await decode(body.date));
    }catch{return send(503,{status:'unavailable'});}
  }
  return {state,decode,file,handle};
}
module.exports={SOURCE,DISTANCE,parseTrending,fetchTop,createTreasure};
