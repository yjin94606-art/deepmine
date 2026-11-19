(function(root) {
  'use strict';
  // Cache only semantic results keyed by the exact file version. Pixel buffers
  // stay inside the worker. Never persist transport failures as classifications.
  const slot = 'deepmine.visual.clip32.v2', limit = 1200;
  const pending = new Map(), delayed = new Map();
  let stored;
  try { stored = JSON.parse(localStorage.getItem(slot) || '[]'); } catch {}
  const cache = new Map(Array.isArray(stored) ? stored.filter(entry=>Array.isArray(entry)&&typeof entry[0]==='string').slice(-limit) : []);
  let worker, active, timer, controller, idle;
  const attempts=new Map();
  const cacheKey=picture=>picture.kind==='video'?'video/'+picture.key:picture.key;
  function releaseWorker(){
    clearTimeout(idle);
    if(worker){worker.onmessage=null;worker.onerror=null;worker.terminate();worker=null;}
  }
  function finish(value,ok) {
    clearTimeout(timer);
    if (!active) return;
    const key=active.key,publicKey=active.publicKey;
    controller?.abort();controller=null;
    active=null;
    if (ok) {
      cache.set(key,value);
      if (cache.size>limit) cache.delete(cache.keys().next().value);
      try { localStorage.setItem(slot,JSON.stringify([...cache])); } catch {}
      window.dispatchEvent(new CustomEvent('work-image-read',{detail:publicKey}));
    } else delayed.set(key,Date.now()+60000);
    pump();
    if(!active)idle=setTimeout(releaseWorker,90000);
  }
  async function pump() {
    if (active || !pending.size || document.hidden || !window.Worker) return;
    const task = [...pending.values()].sort((a,b)=>b.priority-a.priority)[0];
    pending.delete(task.key);
    active=task;
    clearTimeout(idle);
    let ownedFrame=null;
    try {
      let input={key:task.key,url:task.url},transfer=[];
      controller=new AbortController();
      timer=setTimeout(()=>{releaseWorker();finish(null,false);},60000);
      if(task.kind==='video'){
        attempts.set(task.key,(attempts.get(task.key)||0)+1);
        const {extractVideoFrame}=await import('./video-frame.mjs');
        if(active!==task)return;
        const result=await extractVideoFrame(task.url,controller.signal,{transfer:true});
        if(active!==task){result?.frame.close();return;}
        if(!result){finish(null,true);return;}
        ownedFrame=result.frame;
        input={...input,kind:'video',...result};
        transfer=[result.frame];
      }
      if (!worker) {
        worker = new Worker('vision-worker.mjs',{type:'module'});
        worker.onmessage = ({data})=>{ if (data.key===active?.key) finish(data.reading,data.ok); };
        worker.onerror = () => {releaseWorker();finish(null,false);};
      }
      worker.postMessage(input,transfer);
      ownedFrame=null;
    } catch { ownedFrame?.close();if(active===task)finish(null,false); }
  }
  function request(picture,priority=0) {
    if (!picture || picture.demo) return;
    // Pixel artwork is independent of classification. Only start the local
    // vision model when this browser can actually run its worker pipeline.
    if(typeof root.Worker!=='function' || typeof root.OffscreenCanvas!=='function' ||
       typeof root.createImageBitmap!=='function' || typeof root.WebAssembly!=='object')return;
    const device=root.navigator;
    if(priority<=0 && (device?.connection?.saveData ||
       (device?.deviceMemory>0 && device.deviceMemory<=4)))return;
    const key=cacheKey(picture);
    if(cache.has(key) || active?.key===key || delayed.get(key)>Date.now() || attempts.get(key)>=2) return;
    const waiting=pending.get(key);
    if (waiting) waiting.priority=Math.max(priority,waiting.priority);
    else if (pending.size<60 || priority>0) pending.set(key,{...picture,key,publicKey:picture.key,priority});
    pump();
  }
  document.addEventListener('visibilitychange',pump);
  window.addEventListener('pagehide',()=>{
    pending.clear();active=null;controller?.abort();controller=null;
    clearTimeout(timer);releaseWorker();
  });
  root.VisualReadings=Object.freeze({get:picture=>picture && cache.get(cacheKey(picture)), request, clearPending:()=>pending.clear()});
})(globalThis);
