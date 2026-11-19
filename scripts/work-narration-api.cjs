'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createNarrator}=require('./work-narrator.cjs');
const {narrationEvidence}=require('./work-narration-evidence.cjs');

const settingsRoute='/api/narration-settings', workRoute='/api/work-narration';
function projectDirectory(dataDirectory,projectId){return path.join(dataDirectory,'narration',projectId);}
async function saveNarrationEnabled(dataDirectory,projectId,enabled,includeProcess=false){
  const directory=projectDirectory(dataDirectory,projectId),tmp=path.join(directory,randomUUID()+'.tmp');
  await fs.mkdir(directory,{recursive:true});
  try{
    await fs.writeFile(tmp,JSON.stringify({enabled,includeProcess:enabled&&includeProcess}),{flag:'wx',mode:0o600});
    await fs.rename(tmp,path.join(directory,'preferences.json'));
  }finally{await fs.unlink(tmp).catch(()=>{});}
}
async function readBody(req){
  let size=0;
  const chunks=[];
  for await(const chunk of req){
    size+=chunk.length;
    if(size>8192)throw Object.assign(Error('Request too large'),{statusCode:413});
    chunks.push(chunk);
  }
  try{
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(value&&typeof value==='object'&&!Array.isArray(value))return value;
  }catch{}
  throw Object.assign(Error('Invalid request'),{statusCode:400});
}

async function createNarrationApi({dataDirectory,projectId,snapshot,codexPath,model,generate,selectEvidence,readProcess,memoriesEnabled=false}){
  const directory=projectDirectory(dataDirectory,projectId);
  const settingsFile=path.join(directory,'preferences.json');
  let enabled=false,includeProcess=false,revision=0,closed=false,worker=null,changes=Promise.resolve();
  const polls=new Map();
  const settings=()=>({enabled,includeProcess,memoriesEnabled});
  try{
    const saved=JSON.parse(await fs.readFile(settingsFile,'utf8'));
    enabled=saved.enabled===true;
    includeProcess=enabled&&saved.includeProcess===true;
  }
  catch(e){if(e.code!=='ENOENT')console.warn('Deepmine could not read the work narration preference.');}
  function setEnabled(value,withProcess){
    const save=changes.then(async()=>{
      if(value===enabled&&withProcess===includeProcess)return;
      await saveNarrationEnabled(dataDirectory,projectId,value,withProcess);
      revision++;
      polls.clear();
      enabled=value;
      includeProcess=withProcess;
      if(worker){const old=worker;worker=null;await old.close();}
      readProcess?.clear?.();
    });
    changes=save.catch(()=>{});
    return save;
  }
  async function handle(req,res,pathname,port,headers){
    if(pathname!==settingsRoute&&pathname!==workRoute)return false;
    function send(code,value){
      res.writeHead(code,{...headers,'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify(value));return true;
    }
    if(pathname===settingsRoute&&req.method==='GET'){await changes;return send(200,settings());}
    if(req.method!=='POST')return send(405,{error:'method'});
    if(req.headers['x-deepmine-client']!=='work-narration'||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return send(403,{error:'origin'});
    try{
      const body=await readBody(req);
      if(pathname===settingsRoute){
        if(Object.keys(body).some(k=>!['enabled','includeProcess'].includes(k))||typeof body.enabled!=='boolean'||
          ('includeProcess' in body&&typeof body.includeProcess!=='boolean')||(!body.enabled&&body.includeProcess===true))return send(400,{error:'invalid'});
        await setEnabled(body.enabled,body.includeProcess===true);return send(200,settings());
      }
      await changes;
      if(!enabled||closed)return send(200,{status:'disabled'});
      const epoch=revision;
      const cacheOnly=req.headers['x-deepmine-cache']==='only';
      let evidence;
      if(Object.hasOwn(body,'pollId')){
        if(Object.keys(body).length!==1 || typeof body.pollId!=='string')return send(400,{error:'invalid'});
        const saved=polls.get(body.pollId);
        if(!saved || Date.now()>saved.expires){polls.delete(body.pollId);return send(200,{status:'expired'});}
        evidence=saved.evidence;
      }else{
        const current=await snapshot();
        if(epoch!==revision||closed)return send(200,{status:enabled?'pending':'disabled'});
        evidence=await narrationEvidence(current,body,{includeProcess,readProcess:includeProcess?readProcess:undefined,readContent:async source=>{
          // Only an address derived from this snapshot may access the existing
          // version-checked introduction endpoint. Never accept a caller's URL.
          const origin='http://127.0.0.1:'+port,target=new URL(source.url,origin);
          if(target.origin!==origin||target.pathname!=='/api/work-intro')return null;
          try{
            const result=await fetch(target,{redirect:'error',signal:AbortSignal.timeout(5500)});
            return result.ok?await result.json():null;
          }catch{return null;}
        }});
      }
      if(epoch!==revision||closed)return send(200,{status:enabled?'pending':'disabled'});
      worker ||=createNarrator({directory:path.join(directory,'works'),codexPath,model,generate,selectEvidence});
      const result=await worker.get(evidence,{generate:!cacheOnly});
      if(epoch!==revision||closed)return send(200,{status:enabled?'pending':'disabled'});
      if(!cacheOnly && ['pending','busy'].includes(result.status)){
        const pollId=body.pollId || randomUUID();
        if(!polls.has(pollId) && polls.size>=32)polls.delete(polls.keys().next().value);
        polls.set(pollId,{evidence,expires:Date.now()+120000});
        return send(200,{...result,pollId});
      }
      if(body.pollId && !['pending','busy'].includes(result.status))polls.delete(body.pollId);
      if(result.status==='ready' && includeProcess && ['process','design'].includes(result.basis) && evidence.referencePreview){
        return send(200,{...result,referencePreview:evidence.referencePreview});
      }
      return send(200,result);
    }catch(error){
      const code=[400,404,413].includes(error.statusCode)?error.statusCode:503;
      return send(code,{status:'unavailable',reason:code===404?'missing_work':code===503?'unavailable':'invalid_request'});
    }
  }
  async function close(){closed=true;polls.clear();await changes;if(worker)await worker.close();readProcess?.clear?.();}
  return {handle,close};
}
module.exports={createNarrationApi,saveNarrationEnabled};
