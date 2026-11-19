(function(root) {
  'use strict';
  // Versioned summaries stay in this tab. A newer file at the same path has
  // a different cache key and must pass the server's hash check.
  const results=new Map(), pending=new Map(), retry=new Map();
  let active=0;
  function pump(){
    if(document.hidden)return;
    while(active<2 && pending.size){
      const next=[...pending.values()].filter(entry=>!entry.started).sort((a,b)=>b.priority-a.priority)[0];
      if(!next)break;
      next.started=true; active++;
      fetch(next.url,{credentials:'same-origin',signal:AbortSignal.timeout(12000)}).then(async response=>{
        if(!response.ok)throw Error('Version unavailable');
        const copy=await response.json();
        if (copy && (typeof copy.title!=='string'||typeof copy.summary!=='string'))throw Error('Invalid description');
        results.set(next.key,copy);
        if(results.size>1200)results.delete(results.keys().next().value);
        if(copy)window.dispatchEvent(new CustomEvent('work-image-read',{detail:next.key}));
      }).catch(()=>{
        retry.set(next.key,Date.now()+60000);
        if(retry.size>1200)retry.delete(retry.keys().next().value);
      }).finally(()=>{pending.delete(next.key);active--;pump();});
    }
  }
  function request(src,priority=0){
    if(!src || results.has(src.key) || retry.get(src.key)>Date.now())return;
    const existing=pending.get(src.key);
    if(existing)existing.priority=Math.max(existing.priority,priority);
    else if(priority || pending.size<20)pending.set(src.key,{...src,priority,started:false});
    pump();
  }
  document.addEventListener('visibilitychange',pump);
  root.WorkReadings={get:src=>src && results.get(src.key),request};
})(globalThis);
