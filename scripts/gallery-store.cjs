'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const ledger=require('../dist/gallery-ledger.js');
const findings=require('../dist/work-findings.js');
function createGallery(directory,projectId){
  const file=path.join(directory,projectId+'.json');
  let state,queue=Promise.resolve();
  async function load(){
    if(state)return state;
    try{
      const data=JSON.parse(await fs.readFile(file,'utf8'));
      if(data.project!==projectId || !Number.isSafeInteger(data.gallery?.revision) || !Number.isSafeInteger(data.gallery.coins) ||
        !data.gallery.positions || !data.gallery.removed || !Array.isArray(data.gallery.upgrades))throw Error('invalid save');
      state=data.gallery;
    }catch(error){if(error.code!=='ENOENT')throw error;state=ledger.fresh();}
    return state;
  }
  function transact(work){
    const result=queue.then(work);queue=result.catch(()=>{});return result;
  }
  async function handle(req,res,getSnapshot,headers){
    const send=(status,data)=>{res.writeHead(status,{...headers,'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    try{
      if(req.method==='GET')return send(200,await transact(load));
      if(req.method!=='POST')return send(405,{error:'method'});
      if(req.headers['x-deepmine-client']!=='gallery'||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return send(403,{error:'client'});
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>16384)return send(413,{error:'size'});chunks.push(chunk);}
      const cmd=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const snap=await getSnapshot();
      const next=await transact(async()=>{
        const old=await load();
        const updated=ledger.command(old,cmd,snap,cmd?.action==='upgrade'?[]:findings.build(snap),snap.mining.excavatedDepth);
        await fs.mkdir(directory,{recursive:true});
        const temporary=file+'.'+randomUUID()+'.tmp';
        try{await fs.writeFile(temporary,JSON.stringify({project:projectId,gallery:updated}),{flag:'wx',mode:0o600});await fs.rename(temporary,file);}
        finally{await fs.unlink(temporary).catch(()=>{});}
        state=updated;return state;
      });
      send(200,next);
    }catch(error){
      const known=['stale','funds','invalid','unavailable'].includes(error.message);
      send(known?409:error instanceof SyntaxError?400:503,{error:known?error.message:'unavailable'});
    }
  }
  return {handle};
}
module.exports={createGallery};
