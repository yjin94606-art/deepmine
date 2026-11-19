(function(){
  'use strict';
  const C=window.EvidenceCore,F=window.WorkFindings,I=window.DeepmineI18n,$=id=>document.getElementById(id),esc=C.escapeHTML;
  const EPS=.001,LOCALE_KEY='deepmine.locale.v1';
  const PACE_KEY='deepmine.dig-pace.v1';
  const hostedSample=document.documentElement.hasAttribute('data-hosted-sample');
  const sampleVisit=hostedSample || location.pathname==='/try';
  const projectSelection=hostedSample?'https://github.com/yjin94606-art/deepmine/releases/latest':sampleVisit?'/':'/projects';
  let timelineKey='',timelineSelected='';
  let override=null;try{override=I.normalize(localStorage.getItem(LOCALE_KEY));}catch(_){}
  if(hostedSample)override=I.normalize(new URLSearchParams(location.search).get('lang'))||override;
  let locale=I.resolve({override,languages:navigator.languages||[navigator.language]}),snapshot=null,projection=null,findings=[],mode='live',scene=null;
  let mining={earnedDepth:0,excavatedDepth:0,pendingDepth:0,active:false,lastSettledDate:null,revision:0};
  let visual={depth:0,status:'idle',mode:'follow'},viewDate='',activeScope='',generation=0,refreshing=false,failed=false,starting=false,scenePaused=false;
  let refreshController=null,miningController=null,progressTimer=null,progressBusy=false,queuedDepth=0,lastSavedDepth=0,lastProgressAt=0,toastTimer=null,hovered=null,detailId=null,hasSnapshot=false;
  const sound=window.DeepmineAudio?.create();
  const t=(key,values)=>I.t(locale,key,values);
  // The depth HUD updates during every descent. Reuse formatters between ticks.
  const numberFormats=new Map(),dateFormats=new Map();
  const num=(value,digits=0)=>{
    if(value==null||!Number.isFinite(Number(value)))return '—';
    const key=locale+':'+digits;
    if(!numberFormats.has(key))numberFormats.set(key,new Intl.NumberFormat(locale,{maximumFractionDigits:digits}));
    return numberFormats.get(key).format(Number(value));
  };
  let daysByDate=new Map();
  const finite=(value,fallback=0)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,value):fallback;
  // Presentation is transient: only genuine crossing events enter this queue.
  const motionPreference=window.matchMedia('(prefers-reduced-motion: reduce)');
  let revealFloor=0, revealSeen=new Set(), stageQueue=[], stageCurrent=null, stageFrame=0, stageLastTick=0, pace='normal';
  const stageStorageKey = 'deepmine.waiting-find.v1';
  let pageLeaving=false;
  const newsPreference='deepmine.optional-news.v1';
  let newsEnabled=false;
  try{newsEnabled=localStorage.getItem(newsPreference)==='on';}catch{}
  let news={date:'',items:[],status:'empty',slots:0,meters:0},newsLoading=false,newsClaiming=false,newsController=null,claimController=null,lastClaimAt=-Infinity,newsLoadedKey='';
  let findingIndex=new Map(), artFrame=0, artNamesChanged=false;
  const wallVersions=new Map(),appearances=new Map();
  const gallery=window.GalleryUI.create({
    context:()=>({mode,locale,snapshot,findings,depth:mining.excavatedDepth,where:id=>scene?.galleryPosition(id)}),
    changed:()=>{appearances.clear();if(snapshot){installScene(false);if(detailId&&$('detailDialog').open)renderDetail(detailId);}},
    begin:id=>{closeDialog('detailDialog');scene?.focusArtifact(id);syncPause();$('expeditionCanvas').focus({preventScroll:true});},
    end:close=>{if(close && $('detailDialog').open)closeDialog('detailDialog');syncPause();scene?.refreshWorkArt();}
  });
  const illustrations=new Map();
  const archivedSketches=window.WorkNarration.archivedSketches((url,options)=>fetch(url,options),scheduleArtRefresh);
  function rememberIllustration(key,pixels){
    if(illustrations.get(key)?.pixels===pixels)return;
    const canvas=window.WorkSketch.paint(pixels,()=>document.createElement('canvas'));
    if(!canvas)return;
    canvas.generatedSketch=true;
    illustrations.set(key,{pixels,canvas});
    if(illustrations.size>180){
      const oldest=illustrations.keys().next().value;
      illustrations.delete(oldest);archivedSketches.forget(oldest);
    }
    scheduleArtRefresh();
  }
  const sprites=window.WorkSprites.create({changed:scheduleArtRefresh});
  function appearance(item){
    const cached=appearances.get(item.id);
    if(cached && cached.locale===locale && cached.mode===narrationMode)return cached;
    const members=gallery.members(item,snapshot),key=wallVersions.get(item.id);
    const placed=gallery.position(item.id)?.edition;
    const member=(key && members.find(work=>memberKey(work)===key)) || (placed && members.find(work=>window.GalleryLedger.edition(item,work)===placed)) || members[0];
    const source=window.ItemStory.visualSource(item,snapshot,member) || window.WorkImprints.source(item,snapshot,member);
    const illustrationKey=source?.kind==='imprint'?window.WorkSketch.illustrationKey(item.id,memberKey(member),source.key,locale,narrationMode):null;
    const value={member,source,illustrationKey,locale,mode:narrationMode};
    appearances.set(item.id,value);
    return value;
  }
  function selectWallVersion(item,member){
    if(!member)return;
    const key=memberKey(member);
    if(wallVersions.get(item.id)===key)return;
    const changed=memberKey(appearance(item).member)!==key;
    wallVersions.set(item.id,key);
    if(!changed)return;
    appearances.delete(item.id);
    artNamesChanged=true;
    scheduleArtRefresh();
  }
  function workSprite(id,level='wall',priority=0){
    const item=findingIndex.get(id);
    if(!item)return null;
    const {source,member,illustrationKey}=appearance(item);
    if(!source || (level==='scene' && source.kind==='imprint'))return null;
    const canvas=sprites.get(source,level);
    if(!canvas)sprites.request(source,priority);
    if(canvas?.needsPersonalArt && mode==='live' && narrationMode && narrationMode!=='off'){
      const drawing=illustrations.get(illustrationKey);
      if(drawing)return drawing.canvas;
      if(!document.hidden && archivedSketches.needs(illustrationKey)){
        const payload={itemId:id,memberKey:member?memberKey(member):'',locale};
        archivedSketches.read(illustrationKey,payload,narrationMode,pixels=>rememberIllustration(illustrationKey,pixels));
      }
    }
    return canvas;
  }
  function scheduleArtRefresh(){
    if(!artFrame)artFrame=requestAnimationFrame(()=>{
      artFrame=0;
      if(artNamesChanged && scene && snapshot){
        artNamesChanged=false;
        installScene(false);
      }else scene?.refreshWorkArt();
      if(!snapshot || document.hidden)return;
      if(detailId && $('detailDialog').open)renderDetail(detailId);
      else if(stageCurrent && !stageBlocked())renderStage();
      else if(hovered)renderHover(hovered);
    });
  }
  function paintItemIcon(canvas,sprite,type,variant){
    const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
    ctx.clearRect(0,0,w,h);ctx.save();
    ctx.imageSmoothingEnabled=false;
    if(sprite){
      const fit=Math.min(w/sprite.width,h/sprite.height),sw=Math.max(1,Math.round(sprite.width*fit)),sh=Math.max(1,Math.round(sprite.height*fit));
      ctx.drawImage(sprite,Math.floor((w-sw)/2),Math.floor((h-sh)/2),sw,sh);
    }else{
      ctx.scale(w/32,h/32);window.OutputArt?.draw(ctx,16,31,type,variant||0);
    }
    ctx.restore();
  }
  function locateVersion(id){
    let target=findItem(id);
    if(!target)return;
    const previous=$('detailBody').querySelector('[data-draft-image="previous"]:not([hidden]) img');
    if(previous){
      const ref=new URL(previous.src,location.href),path=ref.searchParams.get('path'),digest=ref.searchParams.get('fingerprint');
      if(ref.origin===location.origin && ref.pathname==='/api/preview' && digest){
        for(const item of [target,...findings.filter(other=>other.id!==target.id && other.paths?.includes(path))]){
          if(item.pending || item.depth>mining.excavatedDepth+EPS)continue;
          const matched=window.ItemStory.works(item,snapshot).find(work=>work.path===path && work.record?.fingerprint===digest);
          if(matched){target=item;selectWallVersion(target,matched);break;}
        }
      }
    }
    closeDialog('detailDialog');
    if($('depthBoard').open)$('depthBoard').close();
    if(scene.focusArtifact?.(target.id) && mode==='live'){
      const url=new URL(location.href), selected=appearance(target).member;
      url.searchParams.set('view','mine');
      url.searchParams.set('find',target.id);
      if(selected)url.searchParams.set('workVersion',wallLinkKey(selected));
      else url.searchParams.delete('workVersion');
      history.replaceState(null,'',url);
    }
    $('expeditionCanvas').focus({preventScroll:true});
  }
  function requestStory(item,member,priority=0){
    if (mode!=='live') return;
    window.WorkReadings.request(window.ItemStory.contentSource(item,snapshot,member),priority);
    window.VisualReadings.request(window.ItemStory.visualSource(item,snapshot,member),priority);
  }
  function resetPresentation() {
    cancelAnimationFrame(stageFrame);
    stageFrame=0; stageQueue=[]; stageCurrent=null; revealSeen=new Set(); revealFloor=0;
    if ($('discoveryStage').open) $('discoveryStage').close();
    $('discoveryAnnouncement').textContent='';
    newsController?.abort(); claimController?.abort(); newsController=null; claimController=null;
    newsLoading=false; newsClaiming=false; lastClaimAt=-Infinity; newsLoadedKey='';
    news={date:'',items:[],status:'empty',slots:0,meters:0}; renderNews();
  }
  function saveStage() {
    if(sampleVisit||mode==='live')return;
    const tabKey=stageStorageKey+'.'+mode;
    const value=stageCurrent?JSON.stringify({project:snapshot.project.id,date:currentDate(),ids:[...stageCurrent.ids,...stageQueue.map(q=>q.id)],depth:stageCurrent.depth}):null;
    try {
      if(value)sessionStorage.setItem(tabKey,value);
      else sessionStorage.removeItem(tabKey);
    } catch { /* A tab with storage disabled still pauses and saves normal progress. */ }
  }
  function restoreStage() {
    if(sampleVisit||mode==='live')return;
    let saved;
    try{saved=JSON.parse(sessionStorage.getItem(stageStorageKey+'.'+mode));}catch{return;}
    if (!saved || saved.project!==snapshot.project.id || saved.date!==currentDate() || !Number.isFinite(saved.depth) || !Array.isArray(saved.ids)) return;
    const ids=[...new Set(saved.ids)].filter(id=>{const item=findItem(id);return item && item.date===saved.date && Math.abs(item.depth-saved.depth)<.01;});
    if (!ids.length) return;
    const scope=mode+':'+snapshot.project.id;
    stageCurrent={kind:'finding',ids:[ids[0]],depth:saved.depth,elapsed:900,breakMs:0};
    stageQueue=ids.slice(1).map(id=>({id,scope}));
    ids.forEach(id=>revealSeen.add(id));
    if (mode==='demo') {
      const delta=Math.max(0,saved.depth-mining.excavatedDepth);
      mining.excavatedDepth=Math.min(mining.earnedDepth,saved.depth);
      mining.pendingDepth=Math.max(0,mining.earnedDepth-mining.excavatedDepth); mining.active=mining.pendingDepth>EPS;
      mining.radio={date:saved.date,meters:delta,slots:[20,80,160].filter(m=>m<=delta).length,claimed:0};
      claimDemoNews();
    }
  }
  function stageBlocked(){return document.hidden||scenePaused||Boolean(document.querySelector('dialog[open]:not(#discoveryStage)'));}
  function safeNewsURL(value){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch(_){return null;}}
  function headline(item){return item.demo?t('demoBulletin'+(item.demoIndex+1)):item.title;}
  function newsMarkup(item){const url=safeNewsURL(item.url);return `<article class="radio-story"><small>${esc(item.demo?t('demoNewsSource'):item.source||t('newsUnknownSource'))} · ${esc(timeText(item.publishedAt))}</small><h3>${esc(headline(item))}</h3>${item.demo?'<p class="subtle">'+esc(t('demoNewsOnly'))+'</p>':''}${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(t('newsRead'))}</a>`:''}</article>`;}
  function updatePanelBody(body,markup){
    const focus=body.contains(document.activeElement)?document.activeElement:null;
    // Ordinary background refreshes should not restart keyboard navigation.
    if(body._lastMarkup===markup)return;
    body.innerHTML=markup;
    body._lastMarkup=markup;
    if(!focus)return;
    const action=['data-open-record','data-replay-source','data-refresh','data-demo','href'].find(name=>focus.hasAttribute(name));
    const next=action && Array.from(body.querySelectorAll('['+action+']')).find(el=>el.getAttribute(action)===focus.getAttribute(action));
    (next || body.closest('dialog')?.querySelector('[data-close]'))?.focus({preventScroll:true});
  }
  function renderNews(){$('newsToggle').checked=newsEnabled;$('newsBody').hidden=!newsEnabled;if(!newsEnabled)return;const empty=mode==='demo'?'newsDemo':news.status==='empty'&&(mining.radio?.slots||news.slots)>0?'newsUnavailable':['error','unavailable','disabled','empty-source','offline'].includes(news.status)?'newsUnavailable':'newsEmpty';updatePanelBody($('newsBody'),`<p class="radio-progress">${esc(t('newsSlots',{count:num(mining.radio?.slots||news.slots||0)}))}</p>${news.items.length?news.items.map(newsMarkup).join(''):`<p>${esc(t(empty))}</p>`}`);}
  function acceptNews(value){if(!value||typeof value.date!=='string'||value.date!==currentDate())return;let items=Array.isArray(value.items)?value.items.filter(item=>item&&typeof item.id==='string'&&typeof item.title==='string'&&typeof item.source==='string').slice(0,3).map(item=>({id:item.id,title:item.title.slice(0,500),url:safeNewsURL(item.url),source:item.source.slice(0,120),publishedAt:item.publishedAt,language:item.language,demo:item.demo===true&&mode==='demo',demoIndex:Math.max(0,Math.min(2,Number(item.demoIndex)||0))})):[];if(news.date===value.date)items=[...new Map([...news.items,...items].map(item=>[item.id,item])).values()].slice(0,3);news={date:value.date,items,status:String(value.status||'ready'),slots:Math.min(3,finite(value.slots)),meters:finite(value.meters)};if(mining.radio?.date===value.date){mining.radio.claimed=Math.max(mining.radio.claimed,items.length);mining.radio.slots=Math.max(mining.radio.slots,news.slots);}renderNews();}

  async function refreshNews(){if(!newsEnabled||mode!=='live'||!snapshot||newsLoading)return;const key=currentDate()+':'+(mining.radio?.claimed||0);if(newsLoadedKey===key)return;const epoch=generation,controller=new AbortController();newsController=controller;newsLoading=true;const timer=setTimeout(()=>controller.abort(),10000);try{const response=await fetch('/api/field-news',{cache:'no-store',credentials:'same-origin',signal:controller.signal});if(!response.ok)throw Error('News unavailable');const value=await response.json();if(!newsEnabled||newsController!==controller||epoch!==generation||mode!=='live')return;acceptNews(value);newsLoadedKey=key;}catch(_){if(newsEnabled&&newsController===controller&&epoch===generation){news.status='unavailable';renderNews();}}finally{clearTimeout(timer);if(newsController===controller){newsController=null;newsLoading=false;}}}
  async function claimNews(){const radio=mining.radio;if(!newsEnabled||mode!=='live'||!snapshot||!radio||radio.date!==currentDate()||radio.slots<=radio.claimed||newsClaiming||performance.now()-lastClaimAt<30000)return;lastClaimAt=performance.now();newsClaiming=true;const epoch=generation,controller=new AbortController();claimController=controller;const timer=setTimeout(()=>controller.abort(),12000);try{const response=await fetch('/api/field-news',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Deepmine-Client':'field-news'},body:JSON.stringify({action:'claim',date:radio.date}),signal:controller.signal});if(!response.ok)throw Error('News unavailable');const value=await response.json();if(!newsEnabled||claimController!==controller||epoch!==generation||mode!=='live')return;acceptNews(value);newsLoadedKey=currentDate()+':'+(mining.radio?.claimed||0);}catch(_){if(newsEnabled&&claimController===controller&&epoch===generation){news.status='unavailable';renderNews();}}finally{clearTimeout(timer);if(claimController===controller){claimController=null;newsClaiming=false;}}}
  function claimDemoNews(){const radio=mining.radio;if(!newsEnabled||mode!=='demo'||!radio||radio.slots<=radio.claimed)return;while(radio.slots>radio.claimed){const index=radio.claimed,item={id:'demo-radio:'+radio.date+':'+index,title:t('demoBulletin'+(index+1)),url:null,source:t('demoNewsSource'),publishedAt:snapshot.collectedAt,demo:true,demoIndex:index};radio.claimed++;acceptNews({date:radio.date,items:[...news.items,item],newItem:item,status:'demo',slots:radio.slots,meters:radio.meters});}}
  function reveal(event){
    const item=findItem(event.id);
    if (!mining.active || !item || item.pending || item.depth<=revealFloor+EPS || revealSeen.has(item.id) || visual.mode==='inspect') return;
    if(mode==='live'){
      scene.setDiscoveryHold(true);
      queuedDepth=Math.max(queuedDepth,item.depth);
      scheduleProgress(true);
      return;
    }
    revealSeen.add(item.id); stageQueue.push({id:item.id,scope:activeScope});
    scene.setDiscoveryHold(true);
    sound?.play({type:'artifact'}); pumpStage(); saveStage();
  }
  function reconcilePresentation(){
    const valid=new Set(findings.map(item=>item.id));
    stageQueue=stageQueue.filter(entry=>entry.scope===activeScope && valid.has(entry.id));
    if (stageCurrent && !valid.has(stageCurrent.ids[0])) finishStage();
    if (!mining.active) revealFloor=Math.max(revealFloor,mining.excavatedDepth);
    refreshNews(); claimNews(); syncPresentation();
  }
  function pumpStage(){
    if(stageCurrent) return;
    const next=stageQueue.shift();
    if(!next) return;
    const item=findItem(next.id);
    stageCurrent={kind:'finding',ids:[item.id],depth:item.depth,elapsed:0,breakMs:motionPreference.matches?0:700};
    hideHover(); renderStage(); syncPresentation(); renderHUD();
  }
  function renderStage(){
    if (!stageCurrent) return;
    const items=stageCurrent.ids.map(findItem).filter(Boolean), item=items[0];
    if (!item) return;
    const member=appearance(item).member;
    requestStory(item,member,15);
    const sprite=workSprite(item.id,'stage',15);
    const copy=introFor(item,member);
    const prose=narrationFor(item,member,'stage',copy);
    const context=mode==='demo'?t('sampleMineName')+' · ':'';
    $('stageEyebrow').textContent=context+t(item.memoryIds?.length?'rockNote':'discoveredObject')+' · '+(copy.when||dateText(item.date));
    const record=$('stageContent').firstElementChild, button=record.querySelector('button');
    record.dataset.preview=sprite?'ready':appearance(item).source?sprites.status(appearance(item).source):'icon';
    button.dataset.stageRecord=item.id;
    button.title=t('inspectDiscovery');
    button.textContent=copy.title;
    const caption=record.querySelector('p');
    caption.textContent=prose.text;
    caption.hidden=!prose.text;
    const pages=$('stageWorks'),members=gallery.members(item,snapshot);
    pages.hidden=members.length<2;
    const pageKey=locale+':'+members.length+':'+members.indexOf(member);
    if(pages.dataset.page!==pageKey){pages.innerHTML=pages.hidden?'':workPageButtons(members,member);pages.dataset.page=pageKey;}
    $('stageContinue').textContent=t(stageQueue.length?'takeNextFind':mining.earnedDepth-stageCurrent.depth>EPS?'continueDig':'findingEnd');
    drawStage(motionPreference.matches?900:Math.max(0,stageCurrent.elapsed-stageCurrent.breakMs));
  }
  function drawStage(elapsed){
    if(!stageCurrent) return;
    const item=findItem(stageCurrent.ids[0]); if(!item) return;
    const ctx=$('stageCanvas').getContext('2d'), quiet=motionPreference.matches;
    const u=quiet?1:Math.min(1,elapsed/420), phase=1-Math.pow(1-u,3), time=quiet?0:elapsed;
    ctx.clearRect(0,0,168,112); ctx.imageSmoothingEnabled=false;
    const pixel=(x,y,w,h,color,alpha=1)=>{ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),w,h);};
    const spark=(x,y,size,color,alpha)=>{
      pixel(x-size,y,2*size+1,1,color,alpha); pixel(x,y-size,1,2*size+1,color,alpha);
      if(size>2){pixel(x-1,y-1,3,3,color,alpha);}
    };
    // The lamps and sparks stay on either side of the artwork's silhouette.
    for(const side of [-1,1]){
      const shimmer=quiet ? .78 : .70+.22*Math.sin(time/1250+side);
      for(let j=0;j<3;j++){
        const dx=side*(56+j*4),rise=50-j*2;
        pixel(84+dx,rise,3,1,'#cfa770',shimmer*(.78-j*.17));
        pixel(84+dx,66+j*2,2,1,'#77bdc1',shimmer*(.7-j*.15));
      }
      for(let i=0;i<8;i++){
        const tick=(time/1200+i*.137)%1, x=84+side*(47+(i*17%30)+phase*3), y=18+(i*27%70)-tick*7;
        if(i===1||i===4) spark(x,y,i===1?3:2,i===1?'#f9d388':'#80cbc8',.58+.35*Math.sin(tick*Math.PI));
        else pixel(x,y,i%3?1:2,i%3?2:1,i%2?'#6bb2ba':'#dfb16c',.3+.38*Math.sin(tick*Math.PI));
      }
    }
    // Falling chips briefly mark the impact. Leave the shape unobstructed
    // once it settles, including the transparent gaps in its silhouette.
    if(!quiet && u<1){
      for(const side of [-1,1])for(let i=0;i<3;i++){
        const x=84+side*(22+i*5+(14+2*i)*u),y=87+8*u-4*u*(1-u)*(13+i*3);
        pixel(x,y,i===1?3:2,2,i===1?'#cf9765':'#7b7e78',1-u);
      }
    }
    const shadow=Math.round(34+phase*12);
    pixel(84-shadow/2,91,shadow,2,'#354d53',.62);
    pixel(84-shadow/3,93,Math.round(shadow*2/3),1,'#243840',.76);
    const artwork=workSprite(item.id,'stage',15);
    ctx.save();ctx.globalAlpha=1;ctx.translate(84,Math.round(89-(1-phase)*7));
    if(artwork){
      const fit=Math.min(118/artwork.width,80/artwork.height);
      const w=Math.max(1,Math.round(artwork.width*fit)),h=Math.max(1,Math.round(artwork.height*fit));
      ctx.drawImage(artwork,-Math.floor(w/2),-h,w,h);
    }else{
      ctx.scale(2,2);window.OutputArt?.draw(ctx,0,0,item.visualType||'file',item.variant||0);
    }
    ctx.restore();ctx.globalAlpha=1;
  }
  function stageTick(now){
    stageFrame=0;
    if(!stageCurrent || stageBlocked()){syncPresentation();return;}
    stageCurrent.elapsed+=Math.min(100,Math.max(0,now-stageLastTick));
    stageLastTick=now;
    showStageWhenReady();
    stageFrame=requestAnimationFrame(stageTick);
  }
  function showStageWhenReady() {
    if(!stageCurrent || stageCurrent.elapsed<stageCurrent.breakMs) return;
    const dialog=$('discoveryStage');
    if(!dialog.open){
      dialog.showModal(); $('stageContinue').focus({preventScroll:true});
      $('discoveryAnnouncement').textContent=introFor(findItem(stageCurrent.ids[0]),appearance(findItem(stageCurrent.ids[0])).member).title;
    }
    if(motionPreference.matches || !stageCurrent.lastPaint || stageCurrent.elapsed-stageCurrent.lastPaint>=48){
      drawStage(motionPreference.matches?900:stageCurrent.elapsed-stageCurrent.breakMs);
      stageCurrent.lastPaint=stageCurrent.elapsed;
    }
  }
  function syncPresentation(){
    if(!stageCurrent) return;
    if(stageBlocked()){
      cancelAnimationFrame(stageFrame); stageFrame=0;
      if($('discoveryStage').open) $('discoveryStage').close();
      return;
    }
    if(motionPreference.matches){stageCurrent.breakMs=0;cancelAnimationFrame(stageFrame);stageFrame=0;}
    showStageWhenReady();
    if(!motionPreference.matches && !stageFrame){stageLastTick=performance.now();stageFrame=requestAnimationFrame(stageTick);}
  }
  function finishStage(sync=true){
    if(!stageCurrent) return;
    const finishedId=stageCurrent.ids[0];
    releaseNarration('stage');
    stageCurrent=null;
    cancelAnimationFrame(stageFrame); stageFrame=0;
    if($('discoveryStage').open) $('discoveryStage').close();
    if(stageQueue.length) pumpStage();
    if(sync)saveStage(finishedId);
    if(!stageCurrent){
      if(visual.mode==='inspect') scene.returnToDrill?.();
      scene.setDiscoveryHold(false);
      $('expeditionCanvas').focus({preventScroll:true});
    }
    renderHUD();
  }
  let acknowledging=false,checkingHold=false;
  async function continueDig(){
    if(!$('discoveryStage').open || stageBlocked() || !stageCurrent)return;
    if(mode==='demo'){finishStage();return;}
    if(acknowledging)return;
    acknowledging=true;
    try{
      const result=await requestMining({action:'acknowledge',id:stageCurrent.ids[0]});
      if(result)applyMining(result);
    }catch{toast('saveFailed');}finally{acknowledging=false;}
  }
  function syncLiveStage(restoring=false){
    if(mode!=='live')return;
    const hold=mining.waitingFind;
    if(!hold){
      if(stageCurrent){stageQueue=[];finishStage(false);}
      return;
    }
    const item=findItem(hold.ids[0]);
    if(!item){scene.setDiscoveryHold(true);return;}
    const changed=stageCurrent?.ids[0]!==item.id;
    stageQueue=hold.ids.slice(1).map(id=>({id,scope:'live:'+snapshot.project.id}));
    if(changed){
      releaseNarration('stage');
      stageCurrent={kind:'finding',ids:[item.id],depth:hold.depth,elapsed:restoring?900:0,breakMs:restoring||motionPreference.matches?0:700};
      revealSeen.add(item.id);
      if(!restoring)sound?.play({type:'artifact'});
      hideHover();renderStage();
    }else stageCurrent.depth=hold.depth;
    scene.setDiscoveryHold(true);syncPresentation();
  }
  async function checkSharedHold(){
    if(checkingHold || mode!=='live' || !mining.waitingFind || document.hidden || pageLeaving)return;
    checkingHold=true;
    const epoch=generation;
    try{
      const response=await fetch('/api/mining',{cache:'no-store',headers:{'X-Deepmine-Client':'mining'},signal:AbortSignal.timeout(5000)});
      if(response.ok){const result=await response.json();if(epoch===generation && result.mining?.revision>mining.revision)applyMining(result.mining);}
    }catch{}finally{checkingHold=false;}
  }

  const currentDate=()=>snapshot?.history?.endDate||C.today(snapshot?.collectedAt||new Date(),snapshot?.timezone);
  function dateText(date,full=false){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return date||'—';
    const key=locale+':'+full;
    if(!dateFormats.has(key))dateFormats.set(key,new Intl.DateTimeFormat(locale,{timeZone:'UTC',year:full?'numeric':undefined,month:'2-digit',day:'2-digit'}));
    return dateFormats.get(key).format(new Date(date+'T12:00:00Z'));
  }
  function timeText(value){if(!Number.isFinite(Date.parse(value)))return'—';return new Intl.DateTimeFormat(locale,{timeZone:snapshot?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}
  function toast(key,values){$('toast').textContent=t(key,values);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3800);}
  function sourcesConnected(){return Boolean(snapshot&&(snapshot.sources?.git?.status==='connected'||['connected','partial'].includes(snapshot.sources?.codex?.status)||['connected','partial'].includes(snapshot.outputSource?.status)||['connected','partial'].includes(snapshot.memorySource?.status)||(snapshot.usageSources||[]).some(s=>['connected','partial'].includes(s.status))));}
  function normalizeMining(raw,fallback=projection?.depth||0){const earned=finite(raw?.earnedDepth,fallback),excavated=Math.min(earned,finite(raw?.excavatedDepth));return{earnedDepth:earned,excavatedDepth:excavated,pendingDepth:Math.max(0,earned-excavated),waitingFind:raw?.waitingFind||null,active:raw?.active===true&&earned-excavated>EPS,lastSettledDate:typeof raw?.lastSettledDate==='string'?raw.lastSettledDate:null,revision:finite(raw?.revision),radio:{date:typeof raw?.radio?.date==='string'?raw.radio.date:'',meters:finite(raw?.radio?.meters),slots:Math.min(3,finite(raw?.radio?.slots)),claimed:Math.min(3,finite(raw?.radio?.claimed))}};}
  function plainNote(value){return String(value||'').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/__([^_]+)__/g,'$1').replace(/`([^`]+)`/g,'$1');}
  function memberLabel(item,member,members,position=members.indexOf(member)){
    const title=introFor(item,member).title;
    return members.length>1 ? num(position+1)+'/'+num(members.length)+' · '+title : title;
  }
  function displayName(item){
    return memberLabel(item,appearance(item).member,gallery.members(item,snapshot));
  }
  const introCache=new WeakMap();
  function introFor(item,member) {
    const source=window.ItemStory.visualSource(item,snapshot,member), reading=window.VisualReadings.get(source);
    const content=window.WorkReadings.get(window.ItemStory.contentSource(item,snapshot,member));
    const cached=introCache.get(member||item);
    if(cached && cached.locale===locale && cached.reading===reading && cached.content===content)return cached.copy;
    const copy=window.ItemStory.card(item,snapshot,locale,member,reading,content);
    // A conversation title can itself be the first line of a player's message.
    if(item.memoryIds?.length && mode==='live'){
      copy.title=t('narrationMemory');
      copy.summary=window.ItemStory.memorySummary(item,snapshot,locale);
    }
    introCache.set(member||item,{locale,reading,content,copy});
    return copy;
  }
  const memberKey=member=>(member?.record?.id || member?.commit?.hash || '')+'|'+(member?.path || '');
  const wallLinkKey=member=>(member.record?.fingerprint||member.commit?.hash||'work')+'.'+C.stableHash(member.path).toString(36);
  const settingsSignal='deepmine.narration.preferences.v2';
  let narrationSurface='',narrationMode=null,settingsRevision=0,writingSettings=false,settingsFailed=false,checkAfterWrite=false;
  const narrator=window.WorkNarration.create({request:(url,init)=>fetch(url,init),changed:updateNarration});
  function refreshNarratedCard(){
    if(detailId && $('detailDialog').open)renderDetail(detailId);
    else if(stageCurrent && !stageBlocked())renderStage();
    else if(hovered)renderHover(hovered);
  }
  function updateNarration(){if(!document.hidden && mode==='live')refreshNarratedCard();}
  function releaseNarration(surface){
    if(surface!==narrationSurface)return;
    narrator.clear();
    narrationSurface='';
  }
  function narrationFor(item,selected,surface,copy){
    if(mode==='demo'){
      const example=window.DemoRecords.flavorFor(item,snapshot,locale,selected);
      return {text:example || (item.memoryIds?.length?t('narrationMemory'):copy.summary),status:'demo'};
    }
    // A note can take several seconds. The local description is already available.
    // Conversation finds keep raw excerpts in their source disclosure.
    const localText=copy.summary || storyLabel('这件作品在'+(copy.when||dateText(item.date))+'留下了一次文件记录。','This work was recorded on '+(copy.when||dateText(item.date))+'.',(copy.when||dateText(item.date))+'にこの作品のファイルが記録されました。');
    const waiting={status:'pending',text:localText};
    if(document.hidden || (surface==='stage' && stageBlocked()))return waiting;
    if(narrationMode===null)return settingsFailed ? {status:'unavailable',text:localText} : waiting;
    if(narrationMode==='off')return {status:'disabled',text:localText};
    const member=selected||window.ItemStory.works(item,snapshot)[0];
    const key=member?memberKey(member):'';
    const payload={itemId:item.id,memberKey:key,locale};
    const src=window.ItemStory.visualSource(item,snapshot,member);
    const read=window.VisualReadings.get(src);
    if(src && read?.id)payload.reading={key:src.key,id:read.id};
    const version=member?.record?.fingerprint||member?.commit?.hash||item.memoryIds?.join('|')||'';
    if(surface==='hover' && narrationSurface && narrationSurface!=='hover'){
      const saved=narrator.peek(snapshot.project.id,version,payload,narrationMode);
      return {...saved,text:saved.text||localText};
    }
    narrationSurface=surface;
    // A resting pointer may look up a previously written note on this machine.
    // Only inspecting the work or its discovery may start a new generation.
    const delay=surface==='hover'?420:src && !read?650:0;
    const result=narrator.select(snapshot.project.id,version,payload,delay,narrationMode,surface==='hover');
    if(result.pixels && (item.memoryIds?.length||copy.type==='document')){
      const current=appearance(item);
      const source=current.source;
      if(source?.kind==='imprint' && memberKey(current.member)===memberKey(member)){
        rememberIllustration(current.illustrationKey,result.pixels);
      }
    }
    return {...result,text:result.text||localText};
  }
  function forgetNarration(){
    narrator.reset();
    archivedSketches.reset();
    illustrations.clear();
    narrationMode=null;
    scheduleArtRefresh();
    refreshNarratedCard();
  }
  async function narrationSettings(change,conceal=false){
    const group=$('narrationSettings'),control=$('narrationMode'),status=$('narrationSettingsStatus');
    group.hidden=mode==='demo';
    if(group.hidden || !snapshot)return;
    if(writingSettings){if(conceal)checkAfterWrite=true;return;}
    const write=change!==undefined;
    const epoch=generation,revision=++settingsRevision;
    if(write)writingSettings=true;
    if(conceal || write){settingsFailed=false;forgetNarration();}
    if(write || narrationMode===null)control.disabled=true;
    status.textContent='';
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{
      const request={credentials:'same-origin',cache:'no-store',signal:controller.signal};
      if(write)Object.assign(request,{method:'POST',headers:window.WorkNarration.headers,
        body:JSON.stringify(window.WorkNarration.settingsFor(change))});
      const response=await fetch('/api/narration-settings',request);
      if(!response.ok)throw Error('Settings unavailable');
      const next=window.WorkNarration.modeOf(await response.json());
      if(epoch!==generation || revision!==settingsRevision)return;
      const changed=narrationMode!==next;
      if(changed){narrator.reset();archivedSketches.reset();illustrations.clear();}
      settingsFailed=false;
      narrationMode=control.value=next;
      control.disabled=false;
      if(changed){refreshNarratedCard();scheduleArtRefresh();}
      if(write){
        try{localStorage.setItem(settingsSignal,JSON.stringify([snapshot.project.id,Date.now(),next]));}catch{}
      }
    }catch{
      if(epoch===generation && revision===settingsRevision){
        settingsFailed=true;
        forgetNarration();
        control.disabled=true;
        status.textContent=t('narrationSettingError');
      }
    }finally{
      clearTimeout(timer);
      if(write){
        writingSettings=false;
        if(checkAfterWrite){checkAfterWrite=false;void narrationSettings(undefined,true);}
      }
    }
  }
  let sourceSelection=null,playback=null;
  let openCodexOnLoad=new URLSearchParams(location.search).get('source')==='codex';
  const findParams=new URLSearchParams(location.search);
  let linkedFind=findParams.get('find');
  function sourcePanel(){
    sourceSelection=null;
    if(mode!=='live' || !snapshot)return '';
    const provider=snapshot.usageSources?.find(source=>source.id==='codex');
    const overview=window.SourceReplay.overview(snapshot,findings,'codex',mining.excavatedDepth);
    sourceSelection=overview.work;
    const day=snapshot.days.find(day=>day.date===currentDate());
    const tokens=day?.sourceTokenTotals?.codex;
    const copy=sourceSelection && introFor(sourceSelection.item,sourceSelection.member);
    const opened=copy?`<strong>${esc(copy.title)}</strong><button type="button" data-replay-source>${esc(t('replayWork'))}</button>`:`<small>${esc(t('noSourceWork'))}</small>`;
    return `<section class="connection-proof"><h3>${esc(t('fromCodex'))} · ${esc(t(provider?.status||'missing'))}</h3>
      <p>${esc(t('todayScopeUsage'))} · ${typeof tokens==='number'?esc(num(tokens))+' Token':esc(t('unknown'))}</p>
      <p>${esc(t('verifiedWorks'))} · ${esc(num(overview.count))}</p>${opened}</section>`;
  }
  function endPlayback(showWork){
    if(!playback)return;
    const {stop,itemId,key}=playback;
    playback=null;
    stop?.();
    if($('sourcePlayback').open)closeDialog('sourcePlayback');
    const item=findItem(itemId);
    if(showWork && item && window.ItemStory.works(item,snapshot).some(m=>memberKey(m)===key)){
      scene.focusArtifact?.(item.id);
      renderDetail(item.id,key);
      showDialog('detailDialog');
    }
  }
  function replaySource(){
    if(!sourceSelection || mode!=='live' || playback)return;
    const {item,member}=sourceSelection;
    const title=introFor(item,member).title;
    closeDialog('sourceDialog');
    $('playbackLabel').textContent=t('sourcePlayback')+' · Codex · '+dateText(item.date,true);
    showDialog('sourcePlayback');
    playback={itemId:item.id,key:memberKey(member)};
    selectWallVersion(item,member);
    playback.stop=window.SourceReplay.play((canvas,options)=>window.ExpeditionScene.create(canvas,{...options,getWorkSprite:workSprite}),$('playbackCanvas'),{
      item,layers:layers(),locale,title,
      onDepth:depth=>{$('playbackDepth').textContent=num(Math.floor(depth))+' '+t('unit');},
      onReady:()=>endPlayback(true)
    });
  }
  let openMemberKey='';
  const storyLabel=(zh,en,ja)=>locale==='zh-CN'?zh:locale==='ja'?ja:en;
  function queueNearbyPictures() {
    if(mode!=='live')return;
    const front=visual.depth || snapshot.mining?.excavatedDepth || 0;
    const near=findings.filter(i=>i.paths?.length).sort((a,b)=>Math.abs(a.depth-front)-Math.abs(b.depth-front));
    for(const item of near.slice(0,12))requestStory(item);
  }
  window.addEventListener('work-image-read',()=>{
    if(!snapshot || mode!=='live')return;
    installScene(false);
    if(hovered)renderHover(hovered);
    if(detailId && $('detailDialog').open)renderDetail(detailId);
    if(stageCurrent)renderStage();
  });
  function sourceLabel(item){if(item.memoryIds?.length){const records=(snapshot?.memories||[]).filter(record=>item.memoryIds.includes(record.id));return t(records.length&&records.every(r=>r.method==='agent-memory')?'agentMemory':records.some(r=>r.method==='agent-memory')?'mixedMemories':'conversationExcerpt');}return t(item.source==='mixed-files'?'mixedFiles':item.source==='file-rules'?'gitFiles':item.source==='local-files'?'localFiles':item.visualType==='memory'||item.type==='memory'?'conversation':'source');}
  function usageSources(day){const sources=snapshot?.usageSources||[],name=id=>id==='codex'?'Codex':id==='claude'?'Claude Code':sources.find(s=>s.id===id)?.label||id;if(day?.usageSourceIds?.length)return day.usageSourceIds.map(name).join(' + ');const registered=sources.filter(s=>s.status!=='disabled').map(s=>name(s.id)).join(' + ')||(snapshot?.days.some(d=>d.usage.totalTokens!==null)||['connected','partial'].includes(snapshot?.sources?.codex?.status)?'Codex':'');return registered?t('coverageUnknown',{sources:registered}):t('sourceNone');}
  function localizedFindings(){return findings.filter(item=>!item.pending && gallery.available(item,snapshot)).map(item=>({...item,name:displayName(item)}));}
  function layers(){return(projection?.days||[]).map(day=>({...day,tokens:day.tokens??snapshot.days.find(d=>d.date===day.date)?.usage.totalTokens??null}));}
  function setLocale(value){override=value==='auto'?null:I.normalize(value);try{if(override)localStorage.setItem(LOCALE_KEY,override);else localStorage.removeItem(LOCALE_KEY);}catch(_){}locale=I.resolve({override,preference:snapshot?.preferences?.locale,languages:navigator.languages||[navigator.language]});localize();installScene(false);if(hovered)renderHover(hovered);if(detailId&&$('detailDialog').open)renderDetail(detailId);return locale;}
  function localize(){gallery.render();document.documentElement.lang=locale;document.title=t('appTitle');for(const el of document.querySelectorAll('[data-i18n]'))el.textContent=t(el.dataset.i18n);for(const el of document.querySelectorAll('[data-title]')){el.title=t(el.dataset.title);el.setAttribute('aria-label',t(el.dataset.title));}for(const el of document.querySelectorAll('[data-label]'))el.setAttribute('aria-label',t(el.dataset.label));$('localeSelect').value=override||'auto';renderTimeline();renderHUD();renderSettings();if($('sourceDialog').open)renderSources();renderNews();renderStage();}
  function syncPause(){scene?.setPaused(scenePaused||Boolean(gallery.editing())||Boolean(document.querySelector('dialog[open]:not(#discoveryStage)')));syncPresentation();}
  function showDialog(id){hideHover();const dialog=$(id);if(!dialog.open)dialog.showModal();syncPause();if(id==='settingsDialog')narrationSettings();}
  function closeDialog(id){$(id).close();if(id==='detailDialog')detailId=null;syncPause();}
  document.addEventListener('deepmine:panel-state',()=>{hideHover();syncPause();});
  function installScene(reset=false,revealStart=false){if(!scene)return;const scope=mode+':'+(snapshot?.project.id||'none');const changed=scope!==activeScope;activeScope=scope;const previous=scene.getState();const settled=mining.excavatedDepth>(Number(previous.depth)||0)+EPS;const lowered=mining.earnedDepth<(Number(previous.depth)||0)-EPS;scene.setState({depth:mining.earnedDepth,startDepth:mining.excavatedDepth,active:mining.active,scopeKey:scope,discoveryHold:Boolean(stageCurrent || (mode==='live' && mining.waitingFind)),reset:reset||changed||settled||lowered,preserveView:!reset&&!changed&&(settled||lowered),revealStart,instant:false,locale,layers:layers(),world:{workFindings:localizedFindings()}});syncPause();}
  function setDateTabStop(button){
    if(!button || button.tabIndex===0)return;
    const previous=$('timeline').querySelector('[tabindex="0"]');
    if(previous)previous.tabIndex=-1;
    button.tabIndex=0;
  }
  function renderTimeline(){
    const holder=$('timeline'),findingDates=new Set(findings.map(item=>item.date));
    const dateSet=new Set((projection?.days||[]).filter(day=>day.depthEnd>day.depthStart||findingDates.has(day.date)||day.date===currentDate()).map(day=>day.date));
    for(const date of findingDates)dateSet.add(date);
    const dates=[...dateSet].sort(),key=locale+'|'+dates.join('|');
    if(key===timelineKey)return;
    const focused=holder.contains(document.activeElement)?document.activeElement.dataset.date:null;
    timelineKey=key;timelineSelected='';
    holder.innerHTML=dates.map((date,index)=>`${index===0||date.slice(0,4)!==dates[index-1].slice(0,4)?'<small class="timeline-year">'+date.slice(0,4)+'</small>':''}<button data-date="${date}" tabindex="-1" aria-label="${esc(dateText(date,true))}" aria-current="${date===viewDate}">${esc(dateText(date))}</button>`).join('');
    const preferred=(focused && holder.querySelector('[data-date="'+focused+'"]')) || holder.querySelector('[aria-current=true]') || holder.querySelector('button:last-child');
    setDateTabStop(preferred);
    if(focused)preferred?.focus({preventScroll:true});
    if(preferred)holder.scrollTop=Math.max(0,preferred.offsetTop-holder.clientHeight*.55);
  }
  $('timeline').addEventListener('focusin',event=>setDateTabStop(event.target.closest('[data-date]')));
  $('timeline').addEventListener('keydown',event=>{
    const button=event.target.closest('[data-date]');
    if(!button || event.altKey || event.ctrlKey || event.metaKey)return;
    if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    event.preventDefault();
    const buttons=Array.from($('timeline').querySelectorAll('button')),index=buttons.indexOf(button);
    const target=event.key==='Home'?0:event.key==='End'?buttons.length-1:index+(event.key==='ArrowUp'?-1:1);
    buttons[Math.max(0,Math.min(buttons.length-1,target))]?.focus();
  });
  function renderHUD(){const depth=Math.max(0,Number(visual.depth)||0),remaining=Math.max(0,mining.earnedDepth-depth),working=mining.active&&remaining>EPS;
    window.DeepmineTreasure?.update(mode,snapshot?.project?.id,mining.radio,locale);
    $('projectName').textContent=mode==='demo'?t('sampleMineName'):snapshot?.project.label||'';$('demoNotice').hidden=mode!=='demo';$('depthValue').textContent=num(Math.floor(depth+EPS));$('earnedValue').textContent=t('earned',{depth:num(mining.earnedDepth,1)});
    $('digButton').textContent=t(stageCurrent?'drillHeld':starting?'loading':working?'mining':remaining>EPS?'mineAction':'upToDate');$('digButton').disabled=Boolean(stageCurrent)||starting||working||remaining<=EPS||!snapshot||mode==='live'&&failed;
    $('pendingLabel').textContent=scenePaused?t('animationPaused'):remaining>EPS?t('pending',{depth:num(remaining,1)}):mining.lastSettledDate?t('settledThrough',{date:dateText(mining.lastSettledDate)}):t('excavated',{depth:num(depth,1)});
    const date=viewDate||(snapshot?currentDate():''),day=snapshot&&daysByDate.get(date);$('viewDate').textContent=snapshot?dateText(date,true):'';$('viewUsage').textContent=day?t('totalTokens')+' '+(day.usage.totalTokens===null?t('unknown'):num(day.usage.totalTokens)):'';
    $('sourceStatus').textContent=t(refreshing&&!hasSnapshot?'connecting':failed?'offline':sourcesConnected()?'synced':'unconnected');$('freshness').textContent=failed?t('offline'):'';
    const hasWork=Boolean(snapshot&&(mining.earnedDepth>0||findings.length));
    $('touchHint').hidden=!hasWork || failed;
    const guide=mode==='live'&&!hasWork;
    $('connectionCard').hidden=!guide;
    $('digButton').hidden=guide;
    $('pendingLabel').hidden=guide;
    if(guide){
      const message=t(failed?'lostMine':snapshot?'emptyMine':'firstScan');
      if($('connectionMessage').textContent!==message)$('connectionMessage').textContent=message;
      $('connectionActions').hidden=!snapshot&&!failed;
      $('connectButton').textContent=t(failed?'retrySync':'sources');
      $('connectButton').disabled=failed&&refreshing;
    }
    $('refreshButton').disabled=refreshing;
    $('paceControl').hidden=!hasWork;
    $('zoomOutButton').disabled=visual.canZoomOut===false;$('zoomInButton').disabled=visual.canZoomIn===false;
    if(timelineSelected!==date){
      const rail=$('timeline');
      rail.querySelector('[aria-current=true]')?.setAttribute('aria-current','false');
      const selected=rail.querySelector('[data-date="'+date+'"]');
      selected?.setAttribute('aria-current','true');
      if(selected && !rail.contains(document.activeElement)){
        setDateTabStop(selected);
        const bounds=rail.getBoundingClientRect(),item=selected.getBoundingClientRect();
        if(item.top<bounds.top+10||item.bottom>bounds.bottom-10)rail.scrollTop+=item.top-bounds.top-rail.clientHeight*.45;
      }
      timelineSelected=date;
    }
    const canvas=$('expeditionCanvas');canvas.dataset.depth=depth.toFixed(3);canvas.dataset.target=String(mining.earnedDepth);canvas.dataset.pending=remaining.toFixed(3);canvas.dataset.motion=visual.status;canvas.dataset.view=visual.mode;canvas.dataset.locale=locale;
    $('soundToggle').checked=Boolean(sound?.getState().enabled);}
  function renderSettings(){renderNews();const start=snapshot?.history?.startDate||projection?.days[0]?.date,end=snapshot?.history?.endDate||projection?.days.at(-1)?.date;$('historyRange').textContent=start?t('allHistory',{from:dateText(start,true),to:dateText(end,true)}):t('noRecords');$('settledLabel').textContent=mining.lastSettledDate?t('settledThrough',{date:dateText(mining.lastSettledDate,true)}):'';$('timezoneLabel').textContent=t('timezone')+' · '+(snapshot?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone);$('pauseToggle').checked=scenePaused;}
  function usageMarkup(date){const day=snapshot?.days.find(d=>d.date===date);if(!day)return`<p>${esc(t('sourceNone'))}</p>`;return`<h3>${esc(t('usageSource'))}</h3><p>${esc(usageSources(day))}</p><dl><dt>${esc(t('totalTokens'))}</dt><dd>${num(day.usage.totalTokens)}</dd><dt>${esc(t('inputTokens'))}</dt><dd>${num(day.usage.inputTokens)}</dd><dt>${esc(t('cachedTokens'))}</dt><dd>${num(day.usage.cachedInputTokens)}</dd><dt>${esc(t('outputTokens'))}</dt><dd>${num(day.usage.outputTokens)}</dd></dl><p class="subtle">${esc(t('usageNote'))}</p>`;}
  function findItem(id){return findingIndex.get(id);}
  let hoverMarkup='',hoverSprite=null;
  function hideHover(){releaseNarration('hover');hovered=null;$('hoverCard').hidden=true;}
  function renderHover(payload) {
    if (!payload?.item || document.querySelector('dialog[open]')) { hideHover(); return; }
    const item = findItem(payload.item.id);
    if (!item) { hideHover(); return; }
    hovered = payload;
    const member=appearance(item).member;
    requestStory(item,member,8);
    const sprite=workSprite(item.id,'wall',10);
    const copy = introFor(item,member), card = $('hoverCard');
    const prose=narrationFor(item,member,'hover',copy);
    const day = snapshot.days.find(record => record.date === item.date);
    const dayUsage = day?.usage.totalTokens == null ? '' : ' · ' + t('totalTokens') + ' ' + num(day.usage.totalTokens);
    const markup=`<strong>${esc(displayName(item))}</strong>${prose.text?'<p class="item-intro">'+esc(prose.text)+'</p>':''}<small>${esc(dateText(item.date,true) + dayUsage)}</small><small>${esc(t('hoverHint'))}</small>`;
    if(markup!==hoverMarkup){
      card.innerHTML=markup;
      hoverMarkup=markup;hoverSprite=null;
    }
    if(sprite!==hoverSprite){
      const old=card.querySelector('.hover-work-art');
      if(sprite){
        const icon=old||document.createElement('canvas');icon.className='hover-work-art';icon.setAttribute('aria-hidden','true');
        icon.width=sprite.width;icon.height=sprite.height;icon.getContext('2d').drawImage(sprite,0,0);
        if(!old)card.prepend(icon);
      }else old?.remove();
      hoverSprite=sprite;
    }
    card.hidden = false;
    const rect = payload.rect || {left:payload.screenX || 0, right:payload.screenX || 0, top:payload.screenY || 0};
    const box = card.getBoundingClientRect(), gap = 14;
    let x = rect.right + gap;
    if (x + box.width > window.innerWidth - 12) x = rect.left - box.width - gap;
    card.style.left = Math.round(Math.max(12, Math.min(x,window.innerWidth-box.width-12))) + 'px';
    card.style.top = Math.round(Math.max(60, Math.min(rect.top,window.innerHeight-box.height-90))) + 'px';
  }

  function workPageButtons(members,selected){
    const position=members.indexOf(selected);
    return `<button type="button" data-work-step="-1" ${position<=0?'disabled':''}>${esc(storyLabel('上一件','Previous','前の作品'))}</button><span>${num(position+1)} / ${num(members.length)}</span><button type="button" data-work-step="1" ${position+1>=members.length?'disabled':''}>${esc(storyLabel('下一件','Next','次の作品'))}</button>`;
  }
  function renderDetail(id,requestedMember='') {
    const dialog = $('detailDialog'), body = $('detailBody');
    const same = detailId === id, scroll = same ? dialog.scrollTop : 0;
    const expanded = same && body.querySelector('.record-details')?.open;
    const focus = same && body.contains(document.activeElement) ? document.activeElement : null;
    const item = findItem(id);
    if (!item) {
      if (dialog.open) closeDialog('detailDialog');
      toast('recordRemoved');
      return;
    }

    detailId = id;
    const members = gallery.members(item,snapshot);
    const wanted=requestedMember || (same?openMemberKey:'');
    const selected = (wanted && members.find(member=>memberKey(member)===wanted)) || appearance(item).member;
    selectWallVersion(item,selected);
    openMemberKey = selected ? memberKey(selected) : '';
    gallery.detail(item,selected,Boolean(stageCurrent));
    const copy = introFor(item,selected);
    const prose=narrationFor(item,selected,'detail',copy);
    $('detailTitle').textContent = copy.title;
    showDetailPlayer(window.ItemStory.playbackSource(item,snapshot,selected),copy.title);
    const paths = selected ? [selected.path] : item.paths || [], pathSet=new Set(paths);
    const entries = (projection?.sourceEvidence || []).filter(entry=>entry.date===item.date && entry.hash===selected?.commit?.hash && entry.files.some(f=>pathSet.has(f.path)));
    const outputs = [...new Map([selected?.record,selected?.report,selected?.content].filter(Boolean).map(record=>[record.id,record])).values()];
    const memories = snapshot.memories.filter(memory=>item.memoryIds?.includes(memory.id));
    const type = memories.length ? 'memory' : copy.type;
    const cover = window.ItemStory.picture(item,snapshot,selected);
    requestStory(item,selected,10);
    const fileList = names => names.length ? '<ul class="file-list">' + names.map(name=>'<li>'+esc(name)+'</li>').join('') + '</ul>' : '';
    let art='';
    if(cover){
      const reference=prose.referencePreview;
      if(reference && reference.url!==cover.url && !cover.demo){
        const previousLabel=storyLabel('上一稿','Previous draft','前の稿');
        const currentLabel=storyLabel('本稿','This draft','この稿');
        const last=body.querySelector('.draft-comparison');
        const previous=same && last?.dataset.work===openMemberKey &&
          last.querySelector('[data-draft-image="previous"] img')?.getAttribute('src')===reference.url &&
          last.querySelector('[data-show-draft="previous"]')?.getAttribute('aria-pressed')==='true';
        art=`<div class="draft-comparison" data-work="${esc(openMemberKey)}">
          <div class="draft-choices" role="group" aria-label="${esc(storyLabel('画稿','Artwork versions','原稿の切り替え'))}">
            <button type="button" data-show-draft="previous" aria-pressed="${Boolean(previous)}">${esc(previousLabel)}</button>
            <button type="button" data-show-draft="current" aria-pressed="${!previous}">${esc(currentLabel)}</button>
          </div>
          <figure class="preview" data-draft-image="previous" ${previous?'':'hidden'}><img src="${esc(reference.url)}" alt="${esc(previousLabel)}"></figure>
          <figure class="preview" data-draft-image="current" ${previous?'hidden':''}><img src="${esc(cover.url)}" alt="${esc(copy.title)}"></figure>
        </div>`;
      }else art=`<figure class="preview${cover.demo?' sample-preview':''}"><img src="${esc(cover.url)}" alt="${esc(copy.title)}"></figure>`;
    }
    const sprite=workSprite(item.id,'stage',16);
    if(!cover && sprite){
      const credit=sprite.generatedSketch?'<figcaption class="subtle">'+storyLabel('根据这件作品绘制的游戏插画','Game illustration drawn from this work','作品の内容をもとに描いたゲーム内の挿絵')+'</figcaption>':'';
      art='<figure class="work-imprint-preview"><canvas id="detailImprint" width="144" height="90" role="img" aria-label="'+esc(copy.title)+'"></canvas>'+credit+'</figure>';
    }
    const facts=[copy.duration,prose.status==='ready' && copy.summary!==prose.text && copy.summary].filter(Boolean);
    const factsOpen=same && body.querySelector('.work-facts')?.open;
    const navigation = members.length>1 ? '<nav class="work-pages">'+workPageButtons(members,selected)+'</nav>' : '';
    const requestedTime=copy.requestedAt ? timeText(copy.requestedAt):'';
    const timeLabel = {
      create:storyLabel('生成于','Created','生成日時'),edit:storyLabel('修改于','Edited','編集日時'),
      file:storyLabel('文件记录于','File recorded','ファイル記録日時'),commit:storyLabel('提交于','Committed','コミット日時'),
      conversation:storyLabel('聊于','Conversation','会話日時'),delivery:storyLabel('交付于','Delivered','共有日時')
    }[copy.timeKind];
    const requestLabel=copy.demo ? storyLabel('演示中的请求','Demo request','デモの依頼') : storyLabel('写入文件时所在轮次的用户消息','User message from the turn that wrote the file','ファイルを保存したターンのユーザーメッセージ');
    const demoDialogue=copy.demoDiscussion?.map(([question,answer]) =>
      `<small>${esc(requestLabel)}</small><blockquote>${esc(question)}</blockquote><small>${esc(copy.author)}</small><p>${esc(answer)}</p>`
    ).join('');
    const requestLine=demoDialogue || (copy.request ? `<small>${esc(requestLabel)}${requestedTime?' · '+esc(requestedTime):''}</small><blockquote>${esc(copy.request)}</blockquote>` : '');
    const resultLine=copy.output ? `<small>${esc(storyLabel('产出','Result','できたもの'))}</small><p>${esc(copy.output)}</p>` : '';
    const delivery=selected?.delivery;
    const deliveryRequest=delivery?.request && delivery.request!==copy.request ? `<small>${esc(storyLabel('这次交付对应的请求','Request for this delivery','この共有に対応する依頼'))}${delivery.requestedAt?' · '+esc(timeText(delivery.requestedAt)):''}</small><blockquote>${esc(delivery.request)}</blockquote>` : '';
    const deliveryLine=delivery ? `<small>${esc(storyLabel('交付记录','Delivery record','共有記録'))} · ${esc(timeText(delivery.deliveredAt))}</small><p>${esc(copy.delivered)} ${esc(delivery.label||'')}</p><code>${esc(delivery.sourceRef)}</code>` : '';
    const descriptionSource=copy.contextSource ? `<small>${esc(storyLabel('作品说明来源','Source of the work description','作品説明の出典'))}</small><code>${esc(copy.contextSource)}</code>` : '';
    const basisLabel=prose.basis==='process' ? (memories.length ? storyLabel('小记取材于本条对话笔记','Based on this conversation note','この会話メモをもとに記述') : storyLabel('小记取材于这件作品的创作对话','Based on the creative discussion for this work','この作品の制作に関する会話をもとに記述')) :
      prose.basis==='design' ? storyLabel('小记取材于 AI 制作这件作品时的设计说明','Based on the AI’s design notes for this work','この作品を作った際の AI の設計メモをもとに記述') :
      prose.basis==='delivery' ? storyLabel('小记取材于交付这件作品时的对话','Based on the conversation when this work was delivered','この作品の受け渡し時の会話をもとに記述') :
      prose.basis==='work' ? storyLabel('小记取材于作品本身','Based on the work itself','作品の内容をもとに記述') : '';
    const story = [basisLabel && '<small>'+esc(basisLabel)+'</small>',requestLine,resultLine,deliveryRequest,deliveryLine,descriptionSource].filter(Boolean).join('');
    const citations = entries.map(entry => `<article class="evidence-entry"><strong>${esc(entry.title)}</strong><time>${esc(timeText(entry.timestamp))}</time><code>${esc(entry.hash)}</code>${fileList(entry.files.filter(file => pathSet.has(file.path)).map(file => file.path))}</article>`).join('');
    const files = outputs.map(output => `<article class="evidence-entry"><strong>${esc(output.title)}</strong><time>${esc(t('modifiedAt'))} · ${esc(timeText(output.timestamp))}</time><p>${esc(output.summary || '')}</p><code>SHA-256 ${esc(output.fingerprint)}</code></article>`).join('');
    const quotes = memories.map(record => `<article class="evidence-entry"><strong>${esc(plainNote(record.title || record.sourceId || ''))}</strong><time>${esc(t(record.method === 'agent-memory' ? 'agentMemory' : 'conversationExcerpt'))} · ${esc(timeText(record.timestamp))}</time><p class="memory-copy">${esc(plainNote(record.summary))}</p><code>${esc(record.sourceRef || record.sourceId || '')}</code></article>`).join('');

    body.innerHTML = `
      <div class="record-type"><canvas id="detailSprite" width="64" height="64" aria-hidden="true"></canvas><small>${esc(t(type))} · ${esc(timeLabel)} ${esc(copy.when || dateText(item.date,true))}</small></div>
      ${navigation}<p class="item-intro" data-narration-status="${prose.status}"${prose.text?'':' hidden'}>${esc(prose.text)}</p>
      ${facts.length?'<details class="work-facts"'+(factsOpen?' open':'')+'><summary>'+esc(t('narrationFacts'))+'</summary>'+facts.map(fact=>'<p>'+esc(fact)+'</p>').join('')+'</details>':''}
      ${art}
      ${item.pending || item.depth>Math.max(mining.excavatedDepth,Number(visual.depth)||0)+EPS ? '<p>' + esc(t('unexcavated')) + '</p>' : '<button data-locate="' + esc(item.id) + '">↓ ' + esc(t('locate')) + '</button>'}
      <details class="record-details"${expanded ? ' open' : ''}><summary>${esc(t('recordSources'))}</summary>
        ${copy.originalTitle||copy.originalSummary?'<section class="evidence-entry"><small>'+esc(storyLabel('作品说明原文','Original work description','元の作品説明'))+'</small>'+(copy.originalTitle?'<strong>'+esc(copy.originalTitle)+'</strong>':'')+(copy.originalSummary?'<p>'+esc(copy.originalSummary)+'</p>':'')+'</section>':''}
        ${prose.status==='unavailable'?'<small>'+esc(t('narrationUnavailable'))+'</small> <button type="button" data-retry-narration>'+esc(t('narrationRetry'))+'</button>':''}
        ${story ? '<section class="work-origin">'+story+'</section>' : ''}
        ${prose.status==='disabled'?'<button type="button" data-narration-settings>'+esc(storyLabel('设置 AI 创作小记','Set up AI creation notes','AI 制作メモの設定'))+'</button>':''}
        <p class="subtle">${esc(sourceLabel(item))}</p>
        ${paths.length ? '<h3>' + esc(t('files')) + '</h3>' + fileList(paths) : ''}
        ${selected?.trace ? '<p class="subtle">'+esc(selected.trace.sourceId)+' · '+esc(selected.trace.sourceRef)+'</p>' : ''}
        ${quotes}
        ${entries.length ? '<h3>' + esc(t('commits')) + '</h3>' + citations : ''}
        ${files}${usageMarkup(item.date)}
      </details>`;
    paintItemIcon($('detailSprite'),workSprite(item.id,'wall',16),type,item.variant);
    if($('detailImprint'))paintItemIcon($('detailImprint'),sprite,type,item.variant);
    for(const image of body.querySelectorAll('img'))image.addEventListener('error',()=>{
      const pair=image.closest('.draft-comparison');
      if(!pair){image.closest('figure')?.remove();return;}
      const current=pair.querySelector('[data-draft-image="current"]');
      if(!current || current.contains(image)){pair.remove();return;}
      current.hidden=false;
      pair.replaceWith(current);
    },{once:true});
    if(focus?.matches('[data-show-draft]'))body.querySelector('[data-show-draft="'+focus.dataset.showDraft+'"]')?.focus({preventScroll:true});
    if (focus?.matches('summary')) body.querySelector(focus.closest('.work-facts')?'.work-facts > summary':'.record-details > summary')?.focus({preventScroll:true});
    if (focus?.matches('[data-locate]')) body.querySelector('[data-locate]')?.focus({preventScroll:true});
    if (focus?.matches('[data-work-step]')) body.querySelector('[data-work-step="'+focus.dataset.workStep+'"]:not(:disabled)')?.focus({preventScroll:true});
    dialog.scrollTop = scroll;
  }
  $('detailBody').addEventListener('click',event=>{
    const draft=event.target.closest('[data-show-draft]');
    if(draft){
      const pair=draft.closest('.draft-comparison');
      for(const button of pair.querySelectorAll('[data-show-draft]'))button.setAttribute('aria-pressed',String(button===draft));
      for(const figure of pair.querySelectorAll('[data-draft-image]'))figure.hidden=figure.dataset.draftImage!==draft.dataset.showDraft;
      return;
    }
    if(event.target.closest('[data-retry-narration]') && detailId){
      if(narrationMode===null){void narrationSettings(undefined,true);return;}
      const wait=narrator.remainingWait();
      if(wait>0){toast('narrationCooldown',{seconds:num(Math.ceil(wait/1000))});return;}
      narrator.clear();renderDetail(detailId);return;
    }
    if(event.target.closest('[data-narration-settings]')){showDialog('settingsDialog');return;}
    const step=event.target.closest('[data-work-step]'); if(!step || !detailId) return;
    const item=findItem(detailId); if(!item)return;
    const members=gallery.members(item,snapshot),index=members.findIndex(member=>memberKey(member)===openMemberKey);
    const next=members[index+Number(step.dataset.workStep)]; if(!next) return;
    openMemberKey=memberKey(next);renderDetail(detailId);
    $('detailBody').querySelector('[data-work-step="'+step.dataset.workStep+'"]:not(:disabled)')?.focus({preventScroll:true});
  });
  function showDetailPlayer(source,title) {
    const holder=$('detailPlayer');
    if (!holder) return;
    const key=source ? source.key+'|'+locale : '';
    if ((holder.dataset.key||'')===key) return;
    holder.querySelector('video,audio')?.pause();
    holder.replaceChildren();
    holder.hidden=!source;
    holder.dataset.key=key;
    if (!source) return;
    const button=document.createElement('button');
    button.type='button';
    button.textContent=source.kind==='video' ? storyLabel('播放这段视频','Play this video','動画を再生') : storyLabel('听这段录音','Play this audio','音声を再生');
    holder.append(button);
    button.addEventListener('click',()=>{
      const player=document.createElement(source.kind);
      player.controls=true;
      player.setAttribute('playsinline','');
      player.setAttribute('aria-label',title);
      holder.replaceChildren(player);
      player.addEventListener('error',()=>{
        if (!holder.contains(player))return;
        const note=document.createElement('small');
        note.setAttribute('role','status');
        note.textContent=storyLabel('当前浏览器无法播放这个版本。','This version cannot be played here.','このバージョンは再生できません。');
        holder.replaceChildren(note);
      },{once:true});
      player.src=source.url;
      player.focus({preventScroll:true});
      player.play().catch(()=>{ /* Native controls allow another explicit play attempt. */ });
    },{once:true});
  }
  function inspect(payload){const id=typeof payload==='string'?payload:payload?.item?.id;if(!id||!findItem(id))return;renderDetail(id);showDialog('detailDialog');}
  function renderSources(){const rows=[];const usage=snapshot?.usageSources?.length?snapshot.usageSources:[{id:'codex',label:'Codex',status:snapshot?.sources?.codex?.status||'missing',notes:snapshot?.sources?.codex?.notes||[]}];for(const source of usage)rows.push({name:source.id==='codex'?'Codex':source.id==='claude'?'Claude Code':/import/.test(source.id)?t('importedUsage'):source.label,status:source.status,notes:source.notes});rows.push({name:'Git',status:snapshot?.sources?.git?.status||'missing',notes:snapshot?.sources?.git?.notes||[]});rows.push({name:t('localFiles'),status:snapshot?.outputSource?.status||'disabled',notes:snapshot?.outputSource?.notes||[]});
    if(snapshot?.memories?.length)rows.push({name:t('conversation'),status:'observed',notes:[t('memorySourceNote')]});
updatePanelBody($('sourceBody'),`${sourcePanel()}${mode==='demo'?`<p>${esc(t('fictional'))}</p>`:''}${rows.map(row=>`<div class="source-row"><strong>${esc(row.name)}</strong><span class="source-state">${esc(t(row.status||'unknown'))}</span>${row.notes?.length?`<small>${row.notes.map(esc).join('<br>')}</small>`:''}</div>`).join('')}${snapshot?`<p class="subtle">${esc(t('project'))} · ${esc(snapshot.project.label)}<br>${esc(t('lastSync'))} · ${esc(timeText(snapshot.collectedAt))}</p>`:''}${findings.some(item=>item.pending)?`<h3>${esc(t('pendingRecords',{count:num(findings.filter(item=>item.pending).length)}))}</h3><ul class="file-list">${findings.filter(item=>item.pending).map(item=>`<li><button data-open-record="${esc(item.id)}">${esc(displayName(item))}</button></li>`).join('')}</ul>`:''}<p class="subtle">${esc(t('openLauncher'))}</p><div class="source-actions"><button data-refresh>${esc(t('refresh'))}</button><button data-demo>${esc(t('demo'))}</button></div>`);}
  function onProgress(value){if(value.scopeKey&&value.scopeKey!==activeScope)return;const previousMode=visual.mode;visual={...visual,...value};if(value.pace)pace=value.pace;if(previousMode!==visual.mode)syncPresentation();const date=value.viewDate||value.visibleLayerDate||value.currentLayerDate;if(date)viewDate=date;renderHUD();if(mode==='live'&&snapshot&&mining.active&&visual.depth>lastSavedDepth+EPS){queuedDepth=Math.max(queuedDepth,Math.min(mining.earnedDepth,visual.depth));scheduleProgress(visual.depth>=mining.earnedDepth-EPS);}else if(mode==='demo'&&mining.active){const previous=mining.excavatedDepth;mining.excavatedDepth=Math.min(mining.earnedDepth,visual.depth);mining.radio.date=currentDate();mining.radio.meters+=Math.max(0,mining.excavatedDepth-previous);mining.radio.slots=[20,80,160].filter(m=>mining.radio.meters>=m).length;claimDemoNews();mining.pendingDepth=Math.max(0,mining.earnedDepth-mining.excavatedDepth);if(mining.pendingDepth<=EPS)mining.active=false;renderHUD();}}
  function applyMining(raw,reset=false,revealStart=false){
    const next=normalizeMining(raw);
    if(next.revision<mining.revision&&!reset)return;
    mining=next;
    lastSavedDepth=Math.max(reset?0:lastSavedDepth,mining.excavatedDepth);
    queuedDepth=mining.waitingFind?lastSavedDepth:Math.max(lastSavedDepth,Math.min(queuedDepth,mining.earnedDepth));
    syncLiveStage();installScene(reset,revealStart);renderHUD();renderSettings();
  }
  function applySnapshot(value,incomingMode='live'){const clean=C.validateSnapshot(value);if(incomingMode==='live'&&clean.mode==='demo')throw new Error('Demo is not a live source');const changed=mode!==incomingMode||snapshot?.project.id!==clean.project.id;if(changed){resetPresentation();generation++;progressTimer&&clearTimeout(progressTimer);progressTimer=null;queuedDepth=0;lastSavedDepth=0;miningController?.abort();miningController=null;progressBusy=false;hideHover();if($('detailDialog').open)closeDialog('detailDialog');}
    snapshot=clean;daysByDate=new Map(clean.days.map(day=>[day.date,day]));snapshot.preferences=clean.preferences||{locale:I.normalize(value.preferences?.locale)};mode=incomingMode;projection=C.project(clean);findings=F.build(clean);findingIndex=new Map(findings.map(item=>[item.id,item]));appearances.clear();hasSnapshot=true;failed=false;
    if(changed){wallVersions.clear();sprites.reset();window.VisualReadings.clearPending();narrator.reset();narrationMode=null;if(mode==='live')void narrationSettings();}
    gallery.sync(mode,snapshot.project.id);
    queueNearbyPictures();
    const rawMining=clean.mining?{...clean.mining,radio:clean.mining.radio||value.mining?.radio}:value.mining;
    const past=projection.days.filter(day=>day.date<currentDate()).at(-1);
    let demoFront=clean.history?.enabled?past?.depthEnd||0:0;
    if(sampleVisit && incomingMode==='demo'){
      const firstImage=findings.find(item=>item.date===currentDate() && !item.pending && item.visualType==='image');
      if(firstImage)demoFront=Math.max(demoFront,firstImage.depth-2.7);
    }
    const next=incomingMode==='demo'?normalizeMining(rawMining||{earnedDepth:projection.depth,excavatedDepth:demoFront,active:false,lastSettledDate:clean.history?.enabled?past?.date||null:null,revision:0}):normalizeMining(rawMining,projection.depth);
    if(changed||next.revision>=mining.revision)mining=next;lastSavedDepth=Math.max(changed?0:lastSavedDepth,mining.excavatedDepth);queuedDepth=Math.max(lastSavedDepth,Math.min(queuedDepth,mining.earnedDepth));
    locale=I.resolve({override,preference:clean.preferences?.locale||value.preferences?.locale,languages:navigator.languages||[navigator.language]});if(changed){viewDate=currentDate();restoreStage();}if(changed)revealFloor=mining.excavatedDepth;localize();syncLiveStage(changed);installScene(changed);reconcilePresentation();if(detailId&&$('detailDialog').open){if(findItem(detailId))renderDetail(detailId);else closeDialog('detailDialog');}if(hovered)renderHover(hovered);
    if(linkedFind && mode==='live'){
      const item=findItem(linkedFind),key=findParams.get('workVersion');
      linkedFind=null;
      const matches=item&&key?gallery.members(item,snapshot).filter(member=>wallLinkKey(member)===key||memberKey(member)===key):[];
      if(item && !item.pending && item.depth<=mining.excavatedDepth+EPS && (key===null || matches.length===1)){
        if(key)selectWallVersion(item,matches[0]);
        scene.focusArtifact?.(item.id);
        if(findParams.get('view')!=='mine'){renderDetail(item.id,key?memberKey(matches[0]):'');showDialog('detailDialog');}
        openCodexOnLoad=false;
      }
    }
    if(openCodexOnLoad && mode==='live'){
      openCodexOnLoad=false;
      renderSources();showDialog('sourceDialog');
    }
  }
  async function refresh(){
    if(mode!=='live'||refreshing)return;
    refreshing=true;
    const epoch=generation,controller=new AbortController();
    refreshController=controller;
    const timeout=setTimeout(()=>controller.abort(),hasSnapshot?25000:60000);
    renderHUD();
    try{
      const response=await fetch('/api/snapshot',{cache:'no-store',credentials:'same-origin',signal:controller.signal});
      if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('Snapshot unavailable');
      const value=await response.json();
      if(epoch===generation&&mode==='live')applySnapshot(value,'live');
    }catch{
      if(epoch===generation&&mode==='live')failed=true;
    }finally{
      clearTimeout(timeout);
      if(refreshController===controller){refreshing=false;refreshController=null;renderHUD();}
    }
  }
  async function requestMining(body){const epoch=generation,controller=new AbortController();miningController=controller;const timer=setTimeout(()=>controller.abort(),10000);try{const response=await fetch('/api/mining',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Deepmine-Client':'mining'},body:JSON.stringify(body),signal:controller.signal});if(!response.ok)throw new Error('Mining request failed');const result=await response.json();if(epoch!==generation||mode!=='live')return null;if(!result.mining||!Number.isFinite(result.mining.earnedDepth)||!Number.isFinite(result.mining.excavatedDepth))throw new Error('Invalid mining response');if(result.mining.surveyStamp)window.DeepmineSurvey?.award(result.mining.surveyStamp);return result.mining;}finally{clearTimeout(timer);if(miningController===controller)miningController=null;}}
  function scheduleProgress(immediate=false){if(progressBusy||progressTimer||mode!=='live')return;const delay=immediate?0:Math.max(0,1000-(performance.now()-lastProgressAt));progressTimer=setTimeout(()=>{progressTimer=null;flushProgress();},delay);}
  async function flushProgress(){if(pageLeaving||progressBusy||mode!=='live'||!snapshot||queuedDepth<=lastSavedDepth+EPS)return;progressBusy=true;const epoch=generation,depth=Math.min(queuedDepth,mining.earnedDepth);lastProgressAt=performance.now();try{const result=await requestMining({action:'progress',depth});if(result&&epoch===generation){lastSavedDepth=Math.max(lastSavedDepth,result.excavatedDepth);applyMining(result);claimNews();}}catch(_){if(!pageLeaving&&epoch===generation){toast('saveFailed');progressTimer=setTimeout(()=>{progressTimer=null;flushProgress();},3000);}}finally{if(epoch===generation){progressBusy=false;if(!pageLeaving&&!progressTimer&&queuedDepth>lastSavedDepth+EPS)scheduleProgress();}}}
  async function startMining(){if(starting||!snapshot||mining.active||mining.earnedDepth-(Number(visual.depth)||0)<=EPS)return false;starting=true;renderHUD();try{if(mode==='demo'){revealFloor=Math.max(mining.excavatedDepth,Number(visual.depth)||0);scene.returnToDrill?.();mining.active=true;installScene(false,true);toast('started');return true;}if(failed){toast('miningUnavailable');return false;}const result=await requestMining({action:'start'});if(result){revealFloor=Math.max(mining.excavatedDepth,Number(visual.depth)||0);scene.returnToDrill?.();applyMining(result,false,true);toast('started');return true;}return false;}catch(_){toast('requestFailed');return false;}finally{starting=false;renderHUD();}}
  function resetTransport(){wallVersions.clear();appearances.clear();findingIndex.clear();sprites.reset();narrator.reset();archivedSketches.reset();illustrations.clear();narrationSurface='';narrationMode=null;resetPresentation();generation++;refreshController?.abort();refreshController=null;refreshing=false;miningController?.abort();miningController=null;clearTimeout(progressTimer);progressTimer=null;progressBusy=false;queuedDepth=0;lastSavedDepth=0;starting=false;}
  function enterDemo(){resetTransport();for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();detailId=null;const demo=window.DemoRecords?.create()||window.ExpeditionWorld.demoSnapshot();applySnapshot(demo,'demo');scene.returnToDrill?.();syncPause();}
  function enterLive(){if(sampleVisit){location.assign(projectSelection);return;}const url=new URL(location.href);url.searchParams.delete('demo');history.replaceState(null,'',url);resetTransport();snapshot=null;projection=null;findings=[];mode='live';mining=normalizeMining(null,0);hasSnapshot=false;failed=false;viewDate='';detailId=null;for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();hideHover();localize();installScene(true);refresh();}
  scene=window.ExpeditionScene.create($('expeditionCanvas'),{gallery,getWorkSprite:workSprite,pauseAtFindings:true,onHover:renderHover,onInspect:inspect,onArtifact:inspect,onProgress,onImpact:event=>sound?.play(event),onReveal:reveal});
  $('stageContinue').addEventListener('click',continueDig);
  $('sourceBody').addEventListener('click',event=>{if(event.target.closest('[data-replay-source]'))replaySource();});
  $('leavePlayback').addEventListener('click',()=>endPlayback(false));
  $('seePlaybackWork').addEventListener('click',()=>endPlayback(true));
  $('sourcePlayback').addEventListener('cancel',event=>{event.preventDefault();endPlayback(false);});
  window.addEventListener('pagehide',()=>endPlayback(false));
  $('stageContinue').addEventListener('keydown',event=>{
    if(event.key==='Enter' || event.key===' '){
      event.preventDefault();
      if(!event.repeat) continueDig();
    }
  });
  $('discoveryStage').addEventListener('cancel',event=>event.preventDefault());
  $('stageContent').addEventListener('click',event=>{const target=event.target.closest('[data-stage-record]');if(target)inspect(target.dataset.stageRecord);});
  $('stageWorks').addEventListener('click',event=>{
    const step=event.target.closest('[data-work-step]'),item=stageCurrent&&findItem(stageCurrent.ids[0]);
    if(!step||!item)return;
    const members=gallery.members(item,snapshot);
    const member=members[members.indexOf(appearance(item).member)+Number(step.dataset.workStep)];
    if(member){selectWallVersion(item,member);renderStage();}
    $('stageWorks').querySelector('[data-work-step="'+step.dataset.workStep+'"]:not(:disabled)')?.focus({preventScroll:true});
  });
  function setNewsEnabled(enabled){
    if(enabled===newsEnabled)return;
    newsEnabled=enabled;
    if(newsEnabled){lastClaimAt=-Infinity;refreshNews();claimNews();claimDemoNews();}
    else{
      newsController?.abort();claimController?.abort();
      newsController=null;claimController=null;newsLoading=false;newsClaiming=false;newsLoadedKey='';
    }
    renderNews();
  }
  $('newsToggle').addEventListener('change',()=>{
    setNewsEnabled($('newsToggle').checked);
    try{localStorage.setItem(newsPreference,newsEnabled?'on':'off');}catch{}
  });

  const paceSelect=$('paceSelect');
  try{
    const savedPace=localStorage.getItem(PACE_KEY);
    if(scene.setPace(savedPace))paceSelect.value=savedPace;
  }catch{}
  paceSelect.addEventListener('change',()=>{
    const choice=paceSelect.value;
    if(scene.setPace(choice)){
      try{localStorage.setItem(PACE_KEY,choice);}catch{}
    }
  });
  motionPreference.addEventListener('change',syncPresentation);
  $('digButton').addEventListener('click',startMining);$('followButton').addEventListener('click',()=>scene.returnToDrill?.());
  $('zoomInButton').addEventListener('click',()=>scene.stepZoom(1));$('zoomOutButton').addEventListener('click',()=>scene.stepZoom(-1));
  $('sourceButton').addEventListener('click',()=>{renderSources();showDialog('sourceDialog');});$('connectButton').addEventListener('click',()=>{if(failed){refresh();return;}renderSources();showDialog('sourceDialog');});$('settingsButton').addEventListener('click',()=>{renderSettings();showDialog('settingsDialog');});$('localeSelect').addEventListener('change',event=>setLocale(event.target.value));
  $('soundToggle').addEventListener('change',async()=>{if(sound){const enabled=await sound.setEnabled($('soundToggle').checked);if(enabled)sound.play({type:'mineral'});renderHUD();}});$('pauseToggle').addEventListener('change',event=>{scenePaused=event.target.checked;syncPause();renderHUD();});
  $('refreshButton').addEventListener('click',refresh);$('demoButton').addEventListener('click',enterDemo);$('settingsDemoButton').addEventListener('click',enterDemo);$('exitDemoButton').addEventListener('click',enterLive);
  document.addEventListener('click',event=>{const close=event.target.closest('[data-close]');if(close){closeDialog(close.dataset.close);return;}const record=event.target.closest('[data-open-record]');if(record){closeDialog('sourceDialog');inspect(record.dataset.openRecord);return;}const date=event.target.closest('[data-date]');if(date){if(scene.jumpToDate?.(date.dataset.date)){viewDate=date.dataset.date;renderHUD();}else toast('unexcavated');return;}const locate=event.target.closest('[data-locate]');if(locate){locateVersion(locate.dataset.locate);return;}if(event.target.closest('[data-refresh]'))refresh();if(event.target.closest('[data-demo]'))enterDemo();});
  for(const dialog of document.querySelectorAll('dialog:not(#discoveryStage)'))dialog.addEventListener('close',()=>{
    if(dialog.id==='detailDialog' && !dialog.open){
      const url=new URL(location.href);
      if(url.searchParams.has('find') && url.searchParams.get('view')!=='mine'){
        url.searchParams.delete('find');url.searchParams.delete('workVersion');
        history.replaceState(history.state,'',url);
      }
      detailId=null;releaseNarration('detail');showDetailPlayer(null);
    }
    syncPause();
    if(!document.hidden && !document.querySelector('dialog[open]:not(#discoveryStage)') && stageCurrent)renderStage();
  });
  $('narrationMode').addEventListener('change',event=>narrationSettings(event.target.value));
  window.addEventListener('focus',()=>{if(!document.hidden && mode==='live' && snapshot)void narrationSettings();});
  window.addEventListener('storage',event=>{
    if(event.key===settingsSignal && mode==='live')void narrationSettings(undefined,true);
    if(event.key===newsPreference || event.key===null)setNewsEnabled(event.newValue==='on');
  });
  const poll=setInterval(()=>{if(!document.hidden){refresh();void narrationSettings();}},20000);
  const holdPoll=setInterval(checkSharedHold,1000);
  document.addEventListener('visibilitychange',()=>{
    // WebKit may dispatch hidden after pagehide. The final save is already in flight.
    if(pageLeaving)return;
    if(document.hidden){hideHover();narrator.clear();flushProgress();}
    else{void narrationSettings(undefined,true);refresh();}
    syncPresentation();
  });
  window.addEventListener('resize',hideHover);
  window.addEventListener('pagehide',event=>{
    pageLeaving=true;
    if(mode==='live' && snapshot && mining.active && visual.depth>lastSavedDepth+EPS){
      fetch('/api/mining',{method:'POST',credentials:'same-origin',keepalive:true,
        headers:{'Content-Type':'application/json','X-Deepmine-Client':'mining'},
        body:JSON.stringify({action:'progress',depth:Math.min(visual.depth,mining.earnedDepth)})}).catch(()=>{});
    }
    if(event.persisted){scene.setPaused(true);return;}
    clearInterval(poll);clearInterval(holdPoll);resetPresentation();motionPreference.removeEventListener('change',syncPresentation);
    clearTimeout(progressTimer);clearTimeout(toastTimer);refreshController?.abort();miningController?.abort();
    archivedSketches.reset();cancelAnimationFrame(artFrame);sprites.reset();scene.destroy();sound?.destroy();
  });
  window.addEventListener('pageshow',event=>{
    if(event.persisted){pageLeaving=false;syncPause();void narrationSettings(undefined,true);refresh();}
  });
  function getWorkday(){
    if(!snapshot||mode!=='live')return null;
    const date=currentDate(),day=daysByDate.get(date);
    const works=findings.filter(item=>item.date===date&&item.paths?.length);
    const files=new Set(works.flatMap(item=>item.paths));
    const observed=files.size>0||['connected','partial'].includes(snapshot.outputSource?.status)||snapshot.sources.git.status==='connected';
    const entries=works.flatMap(item=>{
      const members=gallery.members(item,snapshot);
      return members.map((member,position)=>{
        const edition=window.GalleryLedger.edition(item,member);
        return {title:memberLabel(item,member,members,position),open(){
          const current=findItem(item.id);
          if(mode!=='live'||!current)return;
          const chosen=gallery.members(current,snapshot).find(work=>window.GalleryLedger.edition(current,work)===edition);
          if(!chosen)return;
          renderDetail(current.id,memberKey(chosen));showDialog('detailDialog');
        }};
      });
    });
    return {projectId:snapshot.project.id,date,timezone:snapshot.timezone,tokens:day?.usage.totalTokens??null,
      workFiles:observed?files.size:null,activeMeters:mining.radio.date===date?Math.floor(mining.radio.meters):null,
      entries,titles:entries.map(entry=>entry.title)};
  }
  window.DeepmineApp=Object.freeze({getWorkday,getState:()=>Object.freeze({mode,locale,projectId:snapshot?.project.id,ready:Boolean(snapshot),earnedDepth:mining.earnedDepth,excavatedDepth:mining.excavatedDepth,pendingDepth:mining.pendingDepth,visualDepth:Number(visual.depth)||0,active:mining.active,findings:findings.length,viewDate,pace,presentation:stageCurrent?{kind:stageCurrent.kind,ids:stageCurrent.ids||[stageCurrent.item.id],queued:stageQueue.length}:null,newsCount:news.items.length,radio:{...mining.radio},historyStart:snapshot?.history?.startDate||projection?.days[0]?.date,historyEnd:currentDate()}),refresh,startMining,setLocale,enterDemo,enterLive});
  $('projectName').href=projectSelection;
  $('settingsProjectButton').addEventListener('click',()=>location.assign(projectSelection));
  if(hostedSample){
    $('settingsProjectButton').dataset.i18n='downloadDeepmine';
    $('projectName').dataset.title='downloadDeepmine';
    $('chooseAfterFind').href=projectSelection;
    $('chooseAfterFind').dataset.i18n='downloadDeepmine';
  }
  if(sampleVisit){
    $('exitDemoButton').dataset.i18n=hostedSample?'downloadDeepmine':'chooseProject';
    $('chooseAfterFind').hidden=false;
  }
  localize();installScene(true);
  const launch=new URLSearchParams(location.search);
  if (sampleVisit) {
    enterDemo();
    void startMining();
  } else if (launch.get('demo')==='1') {
    enterDemo();
    const kind=launch.get('work');
    const example=kind && findings.filter(f=>f.depth<=mining.excavatedDepth && (kind==='portrait'
      ? f.paths?.some(path=>path.endsWith('/sample-02.png')) : f.visualType===kind && f.paths?.length)).at(-1);
    if(example){scene.focusArtifact?.(example.id);inspect(example.id);}
  } else refresh();
})();
