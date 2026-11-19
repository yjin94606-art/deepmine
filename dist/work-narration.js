(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory();
  else root.WorkNarration=factory();
})(globalThis,function(){
  'use strict';
  const pending=Object.freeze({status:'pending'});
  const unavailable=Object.freeze({status:'unavailable'});
  const headers={'Content-Type':'application/json','X-Deepmine-Client':'work-narration'};
  function modeOf(settings){
    if(typeof settings?.enabled!=='boolean')throw Error('Invalid narration setting');
    if(!settings.enabled)return 'off';
    return settings.includeProcess===true?'process':'work';
  }
  const settingsFor=mode=>({enabled:mode==='work' || mode==='process',includeProcess:mode==='process'});
  function verifiedPreview(value){
    const url=value?.url;
    if(typeof url!=='string' || url.length>3000 || !url.startsWith('/api/preview?') || /[\\#\u0000-\u0020]/u.test(url))return null;
    const params=new URLSearchParams(url.slice('/api/preview?'.length));
    const file=params.get('path');
    if(!file || /[\\:\u0000-\u001f]/u.test(file) || file.split('/').some(part=>!part||part==='.'||part==='..') ||
       !/\.(?:png|jpe?g|gif|webp)$/i.test(file) || [...params].length!==2 || params.getAll('path').length!==1)return null;
    const version=params.get('fingerprint'),commit=params.get('commit');
    if(!/^[a-f0-9]{64}$/.test(version||'') && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit||''))return null;
    return {url:'/api/preview?'+params.toString()};
  }

  // Only the work the player is reading may start or poll a generation job.
  function create({request,changed=()=>{},schedule=setTimeout,cancel=clearTimeout}){
    const cache=new Map(),tickets=new Map();
    let active=null;
    function clear(){
      if(!active)return;
      const old=active;
      active=null;
      cancel(old.timer);
      old.controller?.abort();
    }
    function remember(key,result){
      cache.delete(key);
      cache.set(key,result);
      if(cache.size>300)cache.delete(cache.keys().next().value);
    }
    async function read(work){
      if(work!==active)return;
      const controller=new AbortController();
      work.controller=controller;
      const deadline=setTimeout(()=>controller.abort(),15000);
      let result;
      try{
        const response=await request('/api/work-narration',{method:'POST',credentials:'same-origin',
          cache:'no-store',headers:work.cacheOnly?{...headers,'X-Deepmine-Cache':'only'}:headers,
          body:JSON.stringify(work.pollId?{pollId:work.pollId}:work.payload),signal:controller.signal});
        const value=await response.json();
        if(typeof value.pollId==='string')work.pollId=value.pollId;
        if(value.status==='disabled')result={status:'disabled'};
        else if(work.cacheOnly && value.status!=='ready')result={status:'idle'};
        else if(work.pollId && value.status==='expired'){tickets.delete(work.key);work.pollId=null;result=pending;}
        else if(value.status==='busy' || (response.ok && value.status==='pending'))result=pending;
        else if(response.ok && value.status==='ready' && typeof value.text==='string' && value.text.trim() &&
                (value.basis===undefined || value.basis==='work' ||
                 (work.mode==='process' && ['process','design','delivery'].includes(value.basis)))){
          result={status:'ready',text:value.text.trim(),basis:value.basis||'work'};
          if(Array.isArray(value.pixels))result.pixels=value.pixels;
          if(work.mode==='process' && ['process','design'].includes(result.basis)){
            const preview=verifiedPreview(value.referencePreview);
            if(preview)result.referencePreview=preview;
          }
        }
        else if(value.status==='unavailable' && Number.isFinite(value.retryAfterMs) && value.retryAfterMs>0)
          result={status:'unavailable',retryAt:Date.now()+Math.min(24*60*60*1000,value.retryAfterMs)};
        else result=unavailable;
      }catch{result=unavailable;}
      finally{clearTimeout(deadline);}
      if(work!==active)return;
      work.controller=null;
      work.result=result;
      if(result.status==='pending'){
        if(work.pollId){
          tickets.set(work.key,{id:work.pollId,until:Date.now()+115000});
          if(tickets.size>32)tickets.delete(tickets.keys().next().value);
        }
        const waits=[450,1050,1800];
        const count=work.polls||0;
        work.polls=count+1;
        work.timer=schedule(()=>read(work),waits[count]||2600);
      }else{
        if(!work.cacheOnly)tickets.delete(work.key);
        if(result.status==='ready')remember(work.key,result);
        changed();
      }
    }
    function peek(project,version,payload,mode='work'){
      if(mode!=='process' && mode!=='work')return {status:'disabled'};
      return cache.get(JSON.stringify([project,version,payload,mode])) || {status:'idle'};
    }
    function select(project,version,payload,delay=0,mode='work',cacheOnly=false){
      if(mode!=='process' && mode!=='work'){reset();return {status:'disabled'};}
      const key=JSON.stringify([project,version,payload,mode]);
      const scope=JSON.stringify([project,version,payload.itemId,payload.memberKey,payload.locale,mode]);
      // A local image reading can finish while the provider is already writing.
      // Keep this open card's job; the verified visual cue is available the
      // next time the player opens it. A cue arriving during the short initial
      // delay can still improve the very first prompt.
      if(active?.scope===scope && active.key!==key && !cacheOnly && !active.cacheOnly && !active.deferred &&
          !active.payload.reading && payload.reading && ['ready','pending'].includes(active.result.status))return active.result;
      if(active?.key===key && !(active.cacheOnly && !cacheOnly && active.result.status!=='ready')){
        // Opening the detail card may promote a delayed hover immediately.
        if(delay===0 && active.deferred){cancel(active.timer);active.deferred=false;void read(active);}
        return active.result;
      }
      clear();
      const cached=cache.get(key);
      const ticket=tickets.get(key);
      if(ticket && ticket.until<=Date.now())tickets.delete(key);
      active={key,scope,payload,mode,cacheOnly,pollId:tickets.get(key)?.id,result:cached||(cacheOnly?{status:'idle'}:pending)};
      if(!cached){
        const current=active;
        if(delay>0){
          current.deferred=true;
          current.timer=schedule(()=>{current.deferred=false;void read(current);},delay);
        }else void read(current);
      }
      return active.result;
    }
    function reset(){clear();cache.clear();tickets.clear();}
    function remainingWait(){return Math.max(0,(active?.result.retryAt||0)-Date.now());}
    return {select,peek,clear,reset,remainingWait};
  }
  // Scrolling past a find may restore an existing drawing, but can never start a writer.
  function archivedSketches(request,changed){
    const checked=new Map();
    let active=null;
    const needs=key=>!active && (checked.get(key)||0)<=Date.now();
    async function read(key,payload,mode,restore){
      if(!needs(key))return;
      const controller=new AbortController();
      active=controller;
      const timer=setTimeout(()=>controller.abort(),10000);
      let retryAt=Date.now()+60000;
      try{
        const response=await request('/api/work-narration',{method:'POST',credentials:'same-origin',cache:'no-store',
          headers:{...headers,'X-Deepmine-Cache':'only'},body:JSON.stringify(payload),signal:controller.signal});
        if(!response.ok)return;
        const result=await response.json();
        if(controller!==active||controller.signal.aborted)return;
        if(result.status==='ready' && Array.isArray(result.pixels) &&
          (result.basis==='work' || mode==='process' && ['design','delivery','process'].includes(result.basis)))restore(result.pixels);
        if(result.status==='ready' || result.status==='idle')retryAt=Infinity;
      }catch{/* Existing local artwork remains available during a service restart. */}
      finally{
        clearTimeout(timer);
        if(controller===active){
          active=null;checked.set(key,retryAt);
          if(checked.size>300)checked.delete(checked.keys().next().value);
          changed();
        }
      }
    }
    function reset(){active?.abort();active=null;checked.clear();}
    return {needs,read,reset,forget:key=>checked.delete(key)};
  }
  return Object.freeze({create,headers,modeOf,settingsFor,archivedSketches});
});
