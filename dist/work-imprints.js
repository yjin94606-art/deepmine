(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory(globalThis);
  else root.WorkImprints=factory(root);
})(globalThis,function(root){
  'use strict';
  const supported=/\.(?:svg|[cm]?jsx?|tsx?|py|rb|go|rs|java|kt|c|cpp|cc|h|hpp|cs|swift|lua|gd|php|sh|bash|ps1|css|scss|sass|less|vue|svelte|sql|r|html?|md|mdx|markdown|txt|rst|rtf|csv|tsv|docx|pptx|xlsx|odt|odp|ods|pdf|wav|mp3|flac|ogg|oga|opus|m4a|glb|gltf|obj|zip|json|ipynb|geojson|srt|vtt|ics)$/i;
  function safePath(file){
    return typeof file==='string' && !/[\\:\x00-\x1f]/.test(file) && file.length<2048 &&
      file.split('/').every(part=>part && !part.startsWith('.') && !/^(?:node_modules|vendor|__pycache__)$/i.test(part)) &&
      !/credential|secret|password|api[_-]?key|auth[_-]?token/i.test(file);
  }
  function excerpt(record){
    if(typeof record?.title!=='string'||typeof record.summary!=='string')return null;
    const label=record.title.replace(/\s+/g,' ').trim(),text=record.summary.replace(/\s+/g,' ').trim();
    if(!text || /https?:\/\/|[A-Z]:\\|[^\s@]+@[^\s@]+\.[^\s@]+|(?:password|authorization|bearer|api[_ -]?key|密钥|密码)\s*[:=： ]\s*\S+|(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*KEY/i.test(label+' '+text))return null;
    return {kind:'excerpt',label:label.slice(0,94),text:text.slice(0,240)};
  }
  function source(item,snapshot,member){
    const project=snapshot?.project?.id;
    if(!item||!project)return null;
    if(item.memoryIds?.length && snapshot.mode==='live'){
      const id=item.memoryIds[0],note=snapshot.memories?.find(m=>m.id===id && m.projectId===project);
      const literal=excerpt(note);
      return literal?{kind:'imprint',key:JSON.stringify([project,'note',id,note.timestamp,literal]),type:'memory',literal}:null;
    }
    if(snapshot.mode==='demo'){
      const sample=root.DemoRecords?.describeSample(item,snapshot,snapshot.preferences?.locale||root.document?.documentElement?.lang||'en');
      const literal=excerpt(sample);
      return literal?{kind:'imprint',key:JSON.stringify(['demo',item.id,literal.label]),type:member?.record?.type||item.visualType||'file',literal}:null;
    }
    const path=member?.path;
    if(snapshot.mode!=='live'||!safePath(path)||!supported.test(path))return null;
    const hash=member.record?.fingerprint,commit=member.commit?.hash;
    const local=typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash);
    if(!local&&(!commit||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)))return null;
    const param=local?'fingerprint':'commit',version=local?hash:commit;
    const query=new URLSearchParams({path,[param]:version});
    const fallback=local&&member.content?.contentVersion&&member.content?.fingerprint===hash&&member.content.files?.includes(path)?excerpt(member.content):null;
    const type=member.record?.type||root.EvidenceCore?.classify(path)||item.visualType||'file';
    return {kind:'imprint',key:JSON.stringify([project,path,param,version]),type,path,url:'/api/work-imprint?'+query,...(fallback?{fallback}:{})};
  }
  function urlFor(src,origin){
    if(!src?.url?.startsWith('/api/work-imprint?'))return null;
    const u=new URL(src.url,origin),q=u.searchParams;
    if(u.origin!==origin||u.hash||u.pathname!=='/api/work-imprint'||[...q].length!==2||
      q.get('path')!==src.path||!safePath(src.path)||!supported.test(src.path))return null;
    if(/^[a-f0-9]{64}$/.test(q.get('fingerprint')||''))return {url:u,version:'verified-fingerprint'};
    if(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(q.get('commit')||''))return {url:u,version:'commit-blob'};
    return null;
  }
  function objectArt(info,src){
    const canvas=root.document.createElement('canvas');
    canvas.width=96;canvas.height=80;canvas.pixelArtwork=true;
    const ctx=canvas.getContext('2d');
    if(!ctx)return null;
    ctx.imageSmoothingEnabled=false;
    const model={...info,type:src.type||info.kind,path:src.path||''};
    if(info.kind==='web')model.text=(info.blocks||[]).map(block=>block.text).join(' ');
    if((info.kind==='excerpt'||info.kind==='web')&&root.WorkSubjects?.draw(ctx,model))return canvas;
    root.WorkObjects.draw(ctx,model);
    if(info.kind==='excerpt' && ['document','memory'].includes(model.type))canvas.needsPersonalArt=true;
    return canvas;
  }
  function vectorArt(info){
    const canvas=root.document.createElement('canvas');
    const [w,h]=info.size,scale=288/Math.max(w,h);
    canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
    const ctx=canvas.getContext('2d');
    if(!ctx||typeof root.Path2D!=='function')return null;
    const [x,y,vw,vh]=info.view,k=Math.min(canvas.width/vw,canvas.height/vh);
    ctx.setTransform(k,0,0,k,(canvas.width-vw*k)/2-x*k,(canvas.height-vh*k)/2-y*k);
    for(const shape of info.shapes){
      const path=new root.Path2D(shape.d);
      if(shape.fill!=='none'){ctx.fillStyle=shape.fill;ctx.fill(path,shape.rule);}
      if(shape.stroke!=='none'&&shape.line>0){
        ctx.strokeStyle=shape.stroke;ctx.lineWidth=shape.line;ctx.lineCap=shape.cap;ctx.lineJoin=shape.join;
        ctx.stroke(path);
      }
    }
    return canvas;
  }
  async function load(src,signal){
    let info=src.literal;
    if(!info){
      const versioned=urlFor(src,root.location.origin);
      if(!versioned)return null;
      try{
        const res=await root.fetch(versioned.url,{signal,credentials:'same-origin',redirect:'error'});
        if(res.ok && res.headers.get('X-Deepmine-Preview')===versioned.version &&
            res.headers.get('Content-Type')?.startsWith('application/json'))info=await res.json();
        else await res.body?.cancel();
      }catch(error){if(signal.aborted)throw error;}
      if(!info)info=src.fallback;
    }
    if(signal.aborted||!info)return null;
    if(info.kind==='vector')return vectorArt(info);
    if(info.kind==='cover'){
      if(!['image/jpeg','image/png'].includes(info.type)||typeof info.data!=='string'||info.data.length>524288)return null;
      const bytes=Uint8Array.from(root.atob(info.data),c=>c.charCodeAt(0));
      const {decodeImage}=await import('./image-decode.mjs');
      return decodeImage(new Blob([bytes],{type:info.type}),signal);
    }
    return ['code','web','wave','colors','table','excerpt'].includes(info.kind)?objectArt(info,src):null;
  }
  return {source,load};
});
