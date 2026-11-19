'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('../dist/evidence-core.js');
const A = require('./source-adapters.cjs');
const {LEGACY_FILE_NOTE}=require('./output-files.cjs');
const {pinDiscoveries, radioForDay, radioProgress} = require('./expedition-pacing.cjs');

const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function unknown() { return { inputTokens:null,cachedInputTokens:null,outputTokens:null,totalTokens:null,reasoningOutputTokens:null,cacheWriteInputTokens:null,sessions:null,quality:'unavailable' }; }
function meaningful(day) { return day.evidence.length || (day.usage.totalTokens !== null && day.usage.totalTokens > 0); }
function olderScannerCopy(record) {
  if (record.type==='audio' && record.contentVersion===1 && /\.wav$/i.test(record.files[0]) &&
      /^全长(?:不到 )?\d+ (?:秒|分钟(?: \d+ 秒)?)。$/.test(record.summary))return true;
  if (record.type==='code' && record.contentVersion===1 && record.title==='程序函数' &&
      /^这份代码把处理步骤写成函数。其中能读到 \d+ 处函数定义。$/.test(record.summary))return true;
  if (record.contentVersion) return false;
  if (record.summary===LEGACY_FILE_NOTE) return record.title===path.posix.basename(record.files[0]).slice(0,160);
  return ['这份文档','这个网页','这幅图'].some(start=>record.summary===start+'的标题是「'+record.title+'」。') ||
    ['A document','A web page','An illustration'].some(start=>record.summary===start+' titled “'+record.title+'”.') ||
    ['文書','ページ','イラスト'].some(end=>record.summary==='「'+record.title+'」という題の'+end+'です。') ||
    /^(?:这张表按「.{1,130}」分栏。|The table has columns for .{1,180}\.|.{1,150}の列がある表です。)$/.test(record.summary);
}

// The same version may be observed by a file scanner and an authenticated SDK
// event. Locate it by project-relative path AND digest across both records.
function bindReceipts(outputs, fresh, matches, conflicts) {
  const key = (fingerprint,path) => fingerprint+'\0'+path;
  const byVersion = new Map();
  const recovered = new Map();
  function add(output, trace) {
    const id=key(output.fingerprint,trace.path);
    if (!output.files.includes(trace.path) || conflicts.has(id)) return;
    const previous=byVersion.get(id);
    if (previous && (previous.sourceId!==trace.sourceId || previous.sourceRef!==trace.sourceRef ||
        previous.operation!==trace.operation || (previous.request && trace.request && previous.request!==trace.request))) {
      byVersion.delete(id); conflicts.add(id);
    } else byVersion.set(id,{...previous,...trace});
  }
  for (const item of outputs.values()) for (const trace of item.traces||[]) add(item,trace);
  for (const item of fresh) {
    const saved=outputs.get(item.id);
    if (saved.fingerprint===item.fingerprint) for (const trace of item.traces||[]) add(saved,trace);
  }
  for (const match of matches) {
    const {outputId,fingerprint,contentIntro,...trace}=match, saved=outputs.get(outputId);
    if (saved?.fingerprint!==fingerprint) continue;
    add(saved,trace);
    if (contentIntro && saved.sourceId==='local-files' && saved.files.length===1 && saved.files[0]===trace.path &&
        olderScannerCopy(saved) && typeof contentIntro.title==='string' && typeof contentIntro.summary==='string') {
      recovered.set(outputId,{sourceRef:trace.sourceRef,title:contentIntro.title,summary:contentIntro.summary});
    }
  }
  for (const [id,item] of outputs) {
    // A second source can report identical bytes much later. It cannot
    // explain a file that was already present before that tool operation.
    const traces=item.files.map(path=>byVersion.get(key(item.fingerprint,path)))
      .filter(trace=>trace && Date.parse(trace.producedAt)<=Date.parse(item.timestamp)+5000);
    if (traces.length || item.traces) {
      const {traces:previous,...base}=item;
      const content=recovered.get(id);
      if(content && traces.some(trace=>trace.sourceRef===content.sourceRef)){
        base.title=content.title; base.summary=content.summary; base.contentVersion=1;
      }
      outputs.set(id,traces.length?{...base,traces}:base);
    }
  }
}

/** One project, one persisted journal. Reconciliation replaces observed dates;
 * temporary source outages retain explicitly archived observations. A click is
 * never evidence. All mutations are serialized and atomically replaced. */
function createHistory({ directory, projectId, timezone = 'Asia/Shanghai', now = () => new Date() }) {
  const filename = path.join(directory, projectId + '.json');
  let state = null, loaded = false, queue = Promise.resolve();
  // Observation refresh time is sent to the UI but does not rewrite history.
  function persistedContent(value) {
    if(!value)return null;
    const copy=clone(value);delete copy.snapshot.collectedAt;
    if(copy.snapshot.history)delete copy.snapshot.history.endDate;
    return digest(copy);
  }
  async function load() {
    if (loaded) return;
    try {
      const stat = await fs.stat(filename); if (stat.size > 128*1024*1024) throw new Error('History exceeds supported size');
      const data = JSON.parse(await fs.readFile(filename,'utf8'));
      if (data.schemaVersion !== 1 || data.projectId !== projectId || data.timezone !== timezone) throw new Error('History project or timezone differs');
      C.validateSnapshot(data.snapshot); state = data;
    } catch (error) { if (error.code !== 'ENOENT') throw new Error('Stored history could not be validated; original file was preserved. ' + error.message); }
    loaded = true;
  }
  async function save() {
    await fs.mkdir(directory,{recursive:true});
    const temporary = filename + '.' + process.pid + '.tmp';
    await fs.writeFile(temporary,JSON.stringify(state),'utf8');
    await fs.rename(temporary,filename);
  }
  function serialize(operation) { const run = queue.then(operation); queue = run.catch(()=>{}); return run; }
  function discoveryAt(snapshot, projection, date, from, to, atFront=false) {
    const placements=snapshot.days.find(day=>day.date===date)?.placements;
    const layer=projection.days.find(day=>day.date===date);
    if(!placements || !layer || layer.depthEnd<=layer.depthStart)return null;
    const stops=Object.entries(placements).map(([key,offset])=>({id:projectId+'/'+date+'/'+key,depth:layer.depthStart+offset}))
      .filter(item=>atFront ? Math.abs(item.depth-from)<1e-7 : item.depth>from && item.depth<=to)
      .sort((a,b)=>a.depth-b.depth || a.id.localeCompare(b.id));
    if(!stops.length)return null;
    return {date,depth:stops[0].depth,ids:stops.filter(item=>item.depth===stops[0].depth).map(item=>item.id)};
  }
  function mining(snapshot, previousSnapshot, projection=C.project(snapshot)) {
    const today = C.today(snapshot.collectedAt,timezone);
    const settled = projection.days.filter(day=>day.date<today).at(-1)?.depthEnd || 0;
    const old = state?.mining || {};
    let front = Number(old.excavatedDepth) || 0;
    if (previousSnapshot) {
      const previousSettled = C.project(previousSnapshot).days.filter(day => day.date < today).at(-1)?.depthEnd || 0;
      front = settled + Math.max(0, front - previousSettled);
    }
    let excavatedDepth = Math.min(projection.depth,Math.max(settled,front));
    let waitingFind = old.waitingFind||null;
    if(waitingFind){
      const layer=projection.days.find(day=>day.date===waitingFind.date);
      const placements=snapshot.days.find(day=>day.date===waitingFind.date)?.placements||{};
      const ids=waitingFind.ids.filter(id=>Object.hasOwn(placements,id.split('/').slice(-2).join('/')));
      if(layer && ids.length){
        excavatedDepth=layer.depthStart+placements[ids[0].split('/').slice(-2).join('/')];
        waitingFind={date:waitingFind.date,depth:excavatedDepth,ids};
      }else waitingFind=null;
    }else if(old.active && !Object.hasOwn(old,'waitingFind')){
      // Old installations saved the stop only in browser storage. Recover a
      // still-active drill resting exactly on a real, pinned discovery once.
      waitingFind=discoveryAt(snapshot,projection,today,excavatedDepth,excavatedDepth,true);
    }
    const sameDay = !previousSnapshot || C.today(previousSnapshot.collectedAt, timezone) === today;
    return { earnedDepth:projection.depth, excavatedDepth, pendingDepth:Math.max(0,projection.depth-excavatedDepth), active:Boolean(sameDay && old.active && excavatedDepth<projection.depth), lastSettledDate:projection.days.filter(day=>day.date<today).at(-1)?.date || null, waitingFind, revision:old.revision||0 };
  }
  function outputVersions() {
    return serialize(async () => {
      await load();
      return (state?.snapshot.outputs||[]).map(({id,fingerprint,files,type,timestamp,sourceId})=>({id,fingerprint,files:[...files],type,timestamp,sourceId}));
    });
  }
  async function reconcile(fresh, {matches=[],ambiguous=[],includeTraceRequests=false}={}) {
    return serialize(async()=>{
      await load();
      const input = clone(fresh); input.history={enabled:true,revision:state?.revision||0};
      const value = C.validateSnapshot(input);
      if(value.project.id!==projectId || value.timezone!==timezone) throw new Error('History scope mismatch');
      const before=persistedContent(state),old = state?.snapshot, merged = new Map((old?.days||[]).map(day=>[day.date,day]));
      let stale = false;
      let providerUsage=state?.providerUsage;
      if(Array.isArray(fresh.providerUsage)){
        const providers=new Map((providerUsage||[]).map(provider=>[provider.source.id,clone(provider)])),seenProviders=new Set();
        for(const provider of fresh.providerUsage){
          if(!provider?.source||typeof provider.source.id!=='string'||seenProviders.has(provider.source.id)||!Array.isArray(provider.days))throw new Error('Invalid provider history');
          seenProviders.add(provider.source.id);
          const verified=C.validateSnapshot({...value,days:provider.days.map(day=>({...day,evidence:[]})),outputs:[],memories:[],usageSources:[provider.source]});
          const previous=providers.get(provider.source.id),byDate=new Map((previous?.days||[]).map(day=>[day.date,day]));
          for(const day of verified.days){
            const prior=byDate.get(day.date);
            if(day.usage.quality==='unavailable'&&prior?.usage.quality!=='unavailable'&&prior?.usage){if(prior.usage.totalTokens>0)stale=true;continue;}
            byDate.set(day.date,{date:day.date,usage:day.usage});
          }
          if(['missing','error','disabled'].includes(provider.source.status)&&previous?.days.some(day=>day.usage.totalTokens>0))stale=true;
          providers.set(provider.source.id,{source:verified.usageSources[0],days:[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date))});
        }
        for(const[id,provider]of providers)if(!seenProviders.has(id)){
          provider.source={...provider.source,status:'missing',notes:[...new Set([...(provider.source.notes||[]),'当前来源未提供计量，历史已观测值保留。'])]};
          if(provider.days.some(day=>day.usage.totalTokens>0))stale=true;
        }
        providerUsage=[...providers.values()];
        const byProviderDate=providerUsage.map(provider=>new Map(provider.days.map(day=>[day.date,day.usage])));
        const freshDays=new Map(value.days.map(day=>[day.date,day])),allDates=[...new Set([...merged.keys(),...freshDays.keys(),...providerUsage.flatMap(provider=>provider.days.map(day=>day.date))])].sort();
        value.days=A.combineUsage(providerUsage,allDates).map(day=>{
          const sourceTokenTotals=Object.create(null), usageSourceIds=[];
          for (const [i,provider] of providerUsage.entries()) {
            const usage=byProviderDate[i].get(day.date);
            if (!usage) continue;
            sourceTokenTotals[provider.source.id]=usage.totalTokens;
            if (usage.quality!=='unavailable') usageSourceIds.push(provider.source.id);
          }
          const base=freshDays.get(day.date)||merged.get(day.date)||{date:day.date,evidence:[]};
          return {...base,usage:day.usage,usageSourceIds:usageSourceIds.sort(),sourceTokenTotals};
        });
        const sourcesById=new Map(value.usageSources.map(source=>[source.id,source]));
        for(const provider of providerUsage)if(!sourcesById.has(provider.source.id))sourcesById.set(provider.source.id,provider.source);
        value.usageSources=[...sourcesById.values()];
      }
      for(const day of value.days){
        const previous=merged.get(day.date);
        const evidence=value.sources.git.status==='connected'?day.evidence:(previous?.evidence||day.evidence);
        const usage=day.usage.quality==='unavailable'&&previous?.usage.quality!=='unavailable'&&previous?.usage ? previous.usage : day.usage;
        if(previous && ((usage!==day.usage && meaningful(previous)) || (evidence!==day.evidence && evidence.length))) stale=true;
        const daily={...day,usage,evidence,usageSourceIds:usage!==day.usage?(previous?.usageSourceIds||[]):day.usageSourceIds||[]};
        if(usage!==day.usage){
          if(previous.sourceTokenTotals)daily.sourceTokenTotals=previous.sourceTokenTotals;
          else delete daily.sourceTokenTotals;
        }
        merged.set(day.date,daily);
      }
      // Output revisions are permanent observations, including subsequently removed
      // files. Same content/path ids are idempotent. Previews remain current files.
      const outputs=new Map((old?.outputs||[]).map(item=>[item.id,item]));
      for(const item of value.outputs){
        const prior=outputs.get(item.id);
        if(!prior){outputs.set(item.id,item);continue;}
        if(prior.sourceId==='local-files' && item.sourceId==='local-files' && prior.fingerprint===item.fingerprint &&
          prior.files.length===1 && item.files.length===1 && prior.files[0]===item.files[0] &&
          item.summary && item.summary!==LEGACY_FILE_NOTE && olderScannerCopy(prior)){
          outputs.set(item.id,{...prior,title:item.title,summary:item.summary,...(item.contentVersion?{contentVersion:item.contentVersion}:{}),...(item.byteLength!==undefined?{byteLength:item.byteLength}:{})});
        }
      }
      const traceConflicts=new Set(state?.traceConflicts||[]);
      for (const {fingerprint,path} of ambiguous) traceConflicts.add(fingerprint+'\0'+path);
      bindReceipts(outputs,value.outputs,matches,traceConflicts);
      const memories=new Map((old?.memories||[]).map(item=>[item.id,item]));
      for(const item of value.memories)if(!memories.has(item.id))memories.set(item.id,item);
      const end=C.today(value.collectedAt,timezone);
      const artifactDates=new Set([...outputs.values(),...memories.values()].map(item=>C.today(item.timestamp,timezone)));
      for(const date of artifactDates)if(!merged.has(date))merged.set(date,{date,usage:unknown(),evidence:[]});
      value.days=[...merged.values()].filter(day=>day.date<=end&&(meaningful(day)||artifactDates.has(day.date)||day.date===end)).map(day=>({...day})).sort((a,b)=>a.date.localeCompare(b.date));
      value.outputs=[...outputs.values()].sort((a,b)=>a.timestamp.localeCompare(b.timestamp)||a.id.localeCompare(b.id));
      value.memories=[...memories.values()].sort((a,b)=>a.timestamp.localeCompare(b.timestamp)||a.id.localeCompare(b.id));
      if(stale)value.warnings=[...new Set([...value.warnings,'暂不可读的来源保留上次观测记录；历史记录不代表当前连接正常。'])];
      value.history={enabled:true,revision:state?.revision||0,capturedAt:old?.history?.capturedAt||value.collectedAt};
      value.history.pacingFrom = old?.history?.pacingFrom || (old ? end : '1970-01-01');
      pinDiscoveries(value, old);
      const radio = radioForDay(state?.radio, end);
      const fingerprint=digest({days:value.days,outputs:value.outputs,memories:value.memories,timezone});
      const changed=fingerprint!==state?.fingerprint;
      const nextMining=mining(value,old);
      const previousState = state;
      const survey=state?.survey||{};
      state={schemaVersion:1,projectId,timezone,revision:(state?.revision||0)+(changed?1:0),fingerprint,snapshot:value,mining:nextMining,radio,...(providerUsage?{providerUsage}:{}),...(traceConflicts.size?{traceConflicts:[...traceConflicts].sort()}:{})};
      state.survey=survey;
      state.mining.radio = radioProgress(radio);
      state.snapshot.history.revision=state.revision;
      if(changed || JSON.stringify(previousState?.mining)!==JSON.stringify(state.mining))state.mining.revision++;
      state.snapshot.mining=state.mining;
      try {
        state.snapshot=C.validateSnapshot(state.snapshot);
        if(persistedContent(state)!==before)await save();
      } catch (error) { state = previousState; throw error; }
      const visible=clone(state.snapshot);
      if (!includeTraceRequests) for(const item of visible.outputs) for(const trace of item.traces||[]) {
        delete trace.request; delete trace.requestedAt;
      }
      return visible;
    });
  }
  async function command({action,depth,id}={}) {
    return serialize(async()=>{
      await load(); if(!state)throw new Error('No synchronized records yet');
      if (!['start','pause','progress','acknowledge'].includes(action)) throw new TypeError('Unknown mining action');
      if (action === 'progress' && (!Number.isFinite(depth) || depth < 0)) throw new TypeError('Invalid excavation progress');
      if (action === 'acknowledge' && (typeof id!=='string' || !id.length || id.length>512))throw new TypeError('Invalid discovery ID');
      const previousState = state, before=persistedContent(state);
      state = {...state, snapshot:{...state.snapshot}};
      const clock=new Date(now());
      if(clock.getTime()>=Date.parse(state.snapshot.collectedAt))state.snapshot.collectedAt=clock.toISOString();
      const projection=C.project(state.snapshot);
      state.mining=mining(state.snapshot,undefined,projection);
      const currentDate = C.today(state.snapshot.collectedAt, timezone);
      state.radio = {...radioForDay(state.radio, currentDate)};
      const beforeDepth = state.mining.excavatedDepth;
      let stamp=0;
      if(action==='start')state.mining.active=state.mining.pendingDepth>0;
      else if(action==='pause')state.mining.active=false;
      else if(action==='acknowledge'){
        const waiting=state.mining.waitingFind;
        if(waiting?.ids[0]===id)state.mining.waitingFind=waiting.ids.length>1?{...waiting,ids:waiting.ids.slice(1)}:null;
      }
      else if(action==='progress'){
        if(state.mining.active && !state.mining.waitingFind){
          const target=Math.min(state.mining.earnedDepth,Math.max(beforeDepth,depth));
          const waiting=discoveryAt(state.snapshot,projection,currentDate,beforeDepth,target);
          state.mining.waitingFind=waiting;
          state.mining.excavatedDepth=waiting?.depth??target;
          state.mining.pendingDepth=state.mining.earnedDepth-state.mining.excavatedDepth;
          if(!state.mining.pendingDepth)state.mining.active=false;
        }
      }
      if (action === 'progress' && state.mining.excavatedDepth>beforeDepth) {
        const advanced=state.mining.excavatedDepth-beforeDepth;
        state.radio.meters+=advanced;
        const day=clock.toISOString().slice(0,10);
        const prior=state.survey?.[day]||0;
        state.survey={...state.survey,[day]:prior+advanced};
        for(const [i,mark] of [25,100,250].entries())if(prior<mark && prior+advanced>=mark)stamp=i+1;
      }
      state.mining.radio = radioProgress(state.radio);
      if(JSON.stringify(previousState.mining)!==JSON.stringify(state.mining))state.mining.revision++;
      state.snapshot.mining=state.mining;
      try { if(persistedContent(state)!==before)await save(); }
      catch (error) { state = previousState; throw error; }
      return {...clone(state.mining),...(stamp?{surveyStamp:stamp}:{})};
    });
  }
  function getRadio() {
    return serialize(async () => {
      await load();
      const radio = radioForDay(state?.radio, C.today(now(), timezone));
      return {...radioProgress(radio), items: clone(radio.items)};
    });
  }
  function claimNews(date, expectedClaimed, candidates) {
    return serialize(async () => {
      await load();
      const radio = radioForDay(state?.radio, C.today(now(), timezone));
      const progress = radioProgress(radio);
      let newItem;
      if (state && radio.date === date && expectedClaimed === progress.claimed && progress.slots > progress.claimed) {
        newItem = candidates.find(item => !radio.items.some(saved => saved.id === item.id || saved.url === item.url));
        if (newItem) {
          const next = {...radio, items: [...radio.items, clone(newItem)]};
          const old = state.radio;
          state.radio = next;
          state.snapshot.mining.radio = state.mining.radio = radioProgress(next);
          try { await save(); }
          catch (error) { state.radio = old; state.snapshot.mining.radio = state.mining.radio = progress; throw error; }
          return {...radioProgress(next), items: clone(next.items), newItem};
        }
      }
      return {...progress, items: clone(radio.items)};
    });
  }
  function getSurvey({includeStamps=true}={}){
    return serialize(async()=>{
      await load();
      const day=new Date(now()).toISOString().slice(0,10);
      const today={day,meters:Math.floor(state?.survey?.[day]||0)};
      if(!includeStamps)return today;
      const stamps=Object.entries(state?.survey||{}).filter(([date,meters])=>date<=day && meters>=25)
        .sort(([a],[b])=>b.localeCompare(a)).map(([date,meters])=>({day:date,meters:Math.floor(meters)}));
      return {...today,stamps};
    });
  }
  function getMining(){return serialize(async()=>{await load();return state?clone(state.mining):null;});}
  return {reconcile,command,getMining,getRadio,getSurvey,claimNews,outputVersions,filename};
}
module.exports={createHistory,unknown};
