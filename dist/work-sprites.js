(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(globalThis);
  else root.WorkSprites=factory(root);
})(globalThis,function(root){
  'use strict';
  const imageTypes=new Set(['image/png','image/jpeg','image/webp','image/gif']);
  const byteLimit=8*1024*1024;

  function preview(source,origin){
    if(!source?.url?.startsWith('/'))return null;
    const url=new URL(source.url,origin);
    if(url.origin!==origin || url.hash)return null;
    if(source.demo){
      if(url.search || !['/demo-assets/sample-02.png','/demo-assets/garden.png'].includes(url.pathname))return null;
      return {url,version:null};
    }
    if(url.pathname!=='/api/preview')return null;
    const q=url.searchParams, path=q.get('path')||'';
    if([...q].length!==2 || q.getAll('path').length!==1 || !path || path!==source.path ||
       path.split('/').some(s=>!s||s.startsWith('.')) || /[\\:\x00-\x1f]/.test(path))return null;
    if(/^[a-f0-9]{64}$/.test(q.get('fingerprint')||''))return {url,version:'verified-fingerprint'};
    if(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(q.get('commit')||''))return {url,version:'commit-blob'};
    return null;
  }

  async function readSource(source,signal){
    if(source.kind==='imprint')return root.WorkImprints.load(source,signal);
    const verified=preview(source,root.location.origin);
    if(!verified)throw Error('Unknown work image');
    if(source.kind==='video'){
      const {extractVideoFrame}=await import('./video-frame.mjs');
      if(signal.aborted)return null;
      return (await extractVideoFrame(source.url,signal))?.frame;
    }
    const response=await fetch(verified.url,{signal,credentials:'same-origin',redirect:'error'});
    const type=response.headers.get('Content-Type')?.split(';')[0];
    if(!response.ok || !imageTypes.has(type) || Number(response.headers.get('Content-Length'))>byteLimit ||
       (verified.version&&response.headers.get('X-Deepmine-Preview')!==verified.version)){
      await response.body?.cancel();
      throw Error('Work preview unavailable');
    }
    const blob=await response.blob();
    if(signal.aborted||blob.size>byteLimit)throw Error('Unavailable image');
    const {decodeImage}=await import('./image-decode.mjs');
    return decodeImage(blob,signal);
  }

  // Use the work's own colors. Splitting the occupied RGB space keeps
  // small bright details (lamps, eyes, annotations) as well as the background.
  function paletteFor(data,limit){
    const buckets=new Map();
    for(let i=0;i<data.length;i+=4){
      const alpha=data[i+3];
      if(!alpha)continue;
      const key=(data[i]>>3)*1024+(data[i+1]>>3)*32+(data[i+2]>>3);
      let bin=buckets.get(key);
      if(!bin){bin=[0,0,0,0];buckets.set(key,bin);}
      for(let c=0;c<3;c++)bin[c]+=data[i+c]*alpha;
      bin[3]+=alpha;
    }
    if(!buckets.size)return [];
    const colors=[...buckets.values()];
    for(const bin of colors)for(let c=0;c<3;c++)bin[c]/=bin[3];
    function box(bins){
      const lo=[255,255,255],hi=[0,0,0];let count=0;
      for(const bin of bins){
        count+=bin[3];
        for(let c=0;c<3;c++){lo[c]=Math.min(lo[c],bin[c]);hi[c]=Math.max(hi[c],bin[c]);}
      }
      const range=hi.map((v,c)=>v-lo[c]),axis=range.indexOf(Math.max(...range));
      return {bins,count,axis,score:range[axis]*Math.sqrt(count)};
    }
    const boxes=[box(colors)];
    while(boxes.length<limit){
      let next=0;
      for(let i=1;i<boxes.length;i++)if(boxes[i].score>boxes[next].score)next=i;
      const {bins,count,axis,score}=boxes[next];
      if(!score)break;
      bins.sort((a,b)=>a[axis]-b[axis]);
      let n=0,sum=0;
      while(n<bins.length-1&&sum<count/2)sum+=bins[n++][3];
      boxes.splice(next,1,box(bins.slice(0,n)),box(bins.slice(n)));
    }
    return boxes.map(({bins,count})=>{
      const rgb=[0,0,0];
      for(const bin of bins)for(let c=0;c<3;c++)rgb[c]+=bin[c]*bin[3];
      return [...rgb.map(v=>Math.round(v/count)),count];
    });
  }

  function accent(palette){
    let best=null,bestScore=-1;
    const total=palette.reduce((n,bin)=>n+bin[3],0);
    for(const bin of palette){
      const [r,g,b,count]=bin;
      const light=.25*r+.6*g+.15*b;
      const chroma=Math.max(r,g,b)-Math.min(r,g,b);
      // Saturation and brightness win over sheer area. Discount isolated noise.
      const score=(light*.55+chroma*.9)*Math.min(1,Math.sqrt(count/(total*.014)));
      if(score>bestScore){best=bin;bestScore=score;}
    }
    return best?.slice(0,3)||null;
  }

  function rasterize(image,makeCanvas=()=>document.createElement('canvas'),includeScene=true){
    let width=image?.naturalWidth||image?.width,height=image?.naturalHeight||image?.height;
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return null;
    let left=0,top=0;
    const cutout=image.pixelArtwork===true&&width===96&&height===80;
    if(cutout){
      const {data}=image.getContext('2d').getImageData(0,0,width,height);
      let minX=width,minY=height,maxX=-1,maxY=-1;
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        if(!data[(y*width+x)*4+3])continue;
        minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      }
      if(maxX<0)return null;
      left=Math.max(0,minX-1);top=Math.max(0,minY-1);
      width=Math.min(width,maxX+2)-left;height=Math.min(height,maxY+2)-top;
    }
    function sample(limit){
      const canvas=makeCanvas(),scale=Math.min(1,limit/Math.max(width,height));
      canvas.width=Math.max(1,Math.round(width*scale));
      canvas.height=Math.max(1,Math.round(height*scale));
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx)throw Error('Canvas unavailable');
      ctx.imageSmoothingEnabled=image.pixelArtwork!==true;ctx.imageSmoothingQuality='high';
      if(cutout)ctx.drawImage(image,left,top,width,height,0,0,canvas.width,canvas.height);
      else ctx.drawImage(image,0,0,canvas.width,canvas.height);
      return {canvas,ctx,pixels:ctx.getImageData(0,0,canvas.width,canvas.height)};
    }
    const stage=sample(112),wall=sample(48);
    const palette=paletteFor(stage.pixels.data,40),light=accent(palette);
    function paint({canvas,ctx,pixels},colors,nearest){
      const data=pixels.data;
      for(let i=0;i<data.length;i+=4){
        if(!data[i+3])continue;
        const key=(data[i]>>2)*4096+(data[i+1]>>2)*64+(data[i+2]>>2);
        let chosen=nearest.get(key);
        if(!chosen){
          let distance=Infinity;
          for(const bin of colors){
            const dr=data[i]-bin[0],dg=data[i+1]-bin[1],db=data[i+2]-bin[2];
            const d=dr*dr*2+dg*dg*3+db*db;
            if(d<distance){distance=d;chosen=bin;}
          }
          nearest.set(key,chosen);
        }
        for(let c=0;c<3;c++)data[i+c]=chosen[c];
      }
      ctx.putImageData(pixels,0,0);
      canvas.lightColor=light;
      if(image.needsPersonalArt===true)canvas.needsPersonalArt=true;
    }
    const nearest=new Map();
    paint(stage,palette,nearest);paint(wall,palette,nearest);
    let scene=stage.canvas;
    if(includeScene&&Math.max(width,height)>112){
      const landscape=sample(288);
      paint(landscape,paletteFor(landscape.pixels.data,64),new Map());
      scene=landscape.canvas;
    }
    return {wall:wall.canvas,stage:stage.canvas,scene,light};
  }

  async function loadSprites(source,signal){
    const image=await readSource(source,signal);
    try{return signal.aborted?null:rasterize(image,undefined,source.kind!=='imprint');}
    finally{image?.close?.();}
  }

  function create({changed=()=>{},load=loadSprites,timeoutMs=24000}={}){
    const cache=new Map(),pending=new Map(),active=new Map(),failed=new Map();
    const keyFor=s=>s?.key&&JSON.stringify([s.kind||'image',s.key,s.url]);
    function remember(map,key,value,limit){
      map.delete(key);map.set(key,value);
      if(map.size>limit)map.delete(map.keys().next().value);
    }
    function pump(){
      while(active.size<2 && pending.size){
        const job=[...pending.values()].reduce((a,b)=>b.priority>a.priority?b:a);
        pending.delete(job.key);
        const controller=new AbortController();
        active.set(job.key,controller);
        const signal=controller.signal;
        const timeout=setTimeout(()=>controller.abort(),timeoutMs);
        let onAbort;
        const aborted=new Promise((_,reject)=>{
          onAbort=()=>reject(Error('Sprite request ended'));
          signal.addEventListener('abort',onAbort,{once:true});
        });
        // Some native image decoders cannot be interrupted. Release their
        // queue slot at the deadline even when the decode promise is still open.
        const decoded=Promise.resolve().then(()=>signal.aborted?null:load(job.source,signal));
        Promise.race([aborted,decoded]).then(sprites=>{
          if(active.get(job.key)!==controller)return;
          if(!sprites||controller.signal.aborted)throw Error('No sprite');
          remember(cache,job.key,sprites,48);
          changed(job.source.key);
        }).catch(()=>{
          if(active.get(job.key)===controller){
            remember(failed,job.key,Date.now()+45000,96);
            changed(job.source.key);
          }
        }).finally(()=>{
          clearTimeout(timeout);
          signal.removeEventListener('abort',onAbort);
          if(active.get(job.key)===controller)active.delete(job.key);
          pump();
        });
      }
    }
    function request(source,priority=0){
      const key=keyFor(source);
      if(!key||cache.has(key)||active.has(key)||failed.get(key)>Date.now())return;
      const waiting=pending.get(key);
      if(waiting){waiting.priority=Math.max(waiting.priority,priority);return;}
      if(pending.size>=24){
        const last=[...pending.values()].reduce((a,b)=>a.priority<=b.priority?a:b);
        if(last.priority>=priority)return;
        pending.delete(last.key);
      }
      pending.set(key,{source,key,priority});pump();
    }
    function get(source,level='wall'){
      const key=keyFor(source),sprites=cache.get(key);
      if(!sprites)return null;
      // Repeatedly visible works survive a long shaft scroll.
      remember(cache,key,sprites,48);
      if(level==='scene')return sprites.scene||sprites.stage;
      return level==='stage'?sprites.stage:sprites.wall;
    }
    function reset(){
      pending.clear();cache.clear();failed.clear();
      for(const controller of active.values())controller.abort();
      active.clear();
    }
    function status(source){
      const key=keyFor(source);
      if(cache.has(key))return 'ready';
      if(failed.get(key)>Date.now())return 'failed';
      return active.has(key)||pending.has(key)?'loading':'idle';
    }
    return {request,get,status,getAccent:source=>cache.get(keyFor(source))?.light||null,reset};
  }
  return Object.freeze({create,preview,rasterize});
});
