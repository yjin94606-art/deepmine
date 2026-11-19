(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(require('./evidence-core.js'));else root.WorkFindings=factory(root.EvidenceCore);})(typeof globalThis!=='undefined'?globalThis:this,function(C){
  'use strict';
  if(!C||typeof C.project!=='function')throw new Error('请先加载 evidence-core.js。');
  const MAX_PER_DAY=6,METHOD='file-types-v2',METHOD_LABEL='文件类型归类 · 非 AI 解读';
  const LIMITATIONS='仅依据文件类型、路径与来源记录归类，不读取正文，不证明工作完成或测试通过，不为单件产出分摊 Token。';
  const DEFINITIONS=[
    {key:'web',label:'网页',recipeId:'projector'}, {key:'document',label:'文档',recipeId:'archive'},
    {key:'image',label:'图片',recipeId:'prism'}, {key:'audio',label:'音频',recipeId:'musicbox'},
    {key:'video',label:'视频',recipeId:'projector'}, {key:'slides',label:'演示文稿',recipeId:'observatory'},
    {key:'table',label:'表格',recipeId:'compass'}, {key:'code',label:'代码模块',recipeId:'engine'}, {key:'file',label:'文件',recipeId:'archive'}, {key:'memory',label:'对话记忆',recipeId:'archive'}
  ];
  const byType=new Map(DEFINITIONS.map(d=>[d.key,d])),types=DEFINITIONS.map(d=>d.key);
  const compare=(a,b)=>a<b?-1:a>b?1:0;
  const {stableHash,classify} = C;
  function group(type){return{type,paths:new Set(),evidenceIds:new Set(),outputIds:new Set(),sourceIds:new Set()};}
  function combine(to,from){for(const key of ['paths','evidenceIds','outputIds','sourceIds'])for(const item of from[key])to[key].add(item);}
  function capGroups(groups){
    let selected=[...groups.values()];
    if(selected.length>MAX_PER_DAY){
      // Keep documents visible; retain all overflow provenance in a plain-file group.
      const ranked=selected.filter(g=>g.type!=='file').sort((a,b)=>(a.type==='document'?-1:b.type==='document'?1:0)||b.paths.size-a.paths.size||types.indexOf(a.type)-types.indexOf(b.type));
      const keep=ranked.slice(0,MAX_PER_DAY-1),kept=new Set(keep.map(g=>g.type)),rest=group('file');
      for(const g of selected)if(!kept.has(g.type))combine(rest,g);selected=[...keep,rest];
    }
    return selected.sort((a,b)=>types.indexOf(a.type)-types.indexOf(b.type));
  }
  function basename(paths){
    const names=paths.map(path=>path.split('/').pop());
    const meaningful=names.find(name=>!/^(?:index|main|app|package|config|settings|readme)(?:\.|$)/i.test(name))||names[0]||'本地文件';
    return meaningful.length>54?meaningful.slice(0,51)+'…':meaningful;
  }
  function freezeFinding(item){for(const key of ['paths','evidenceIds','outputIds','sourceIds'])Object.freeze(item[key]);return Object.freeze(item);}
  function build(input){
    const snapshot=C.validateSnapshot(input),projection=C.project(snapshot),end=C.today(snapshot.collectedAt,snapshot.timezone),startDate=new Date(end+'T12:00:00Z');startDate.setUTCDate(startDate.getUTCDate()+1-C.PERIOD_DAYS);const start=snapshot.history?.enabled?snapshot.history.startDate:startDate.toISOString().slice(0,10);
    const projectedDays=new Map(projection.days.map(day=>[day.date,day])),days=new Map(snapshot.days.filter(day=>day.date>=start&&day.date<=end).map(day=>[day.date,day]));
    const outputsByDay=new Map();
    for(const output of snapshot.outputs||[]){
      const date=C.today(output.timestamp,snapshot.timezone);if(date<start||date>end||output.projectId!==snapshot.project.id)continue;
      if(!outputsByDay.has(date))outputsByDay.set(date,[]);outputsByDay.get(date).push(output);
    }
    const findings=[];
    for(const date of [...new Set([...days.keys(),...outputsByDay.keys()])].sort(compare)){
      const day=days.get(date),groups=new Map(),gitPaths=new Set();
      const add=type=>{if(!groups.has(type))groups.set(type,group(type));return groups.get(type);};
      if(snapshot.history?.enabled||snapshot.sources.git.status==='connected')for(const entry of day?.evidence||[])for(const file of entry.files){const g=add(classify(file.path,file.kind));g.paths.add(file.path);g.evidenceIds.add(entry.hash);gitPaths.add(file.path);}
      const local=(outputsByDay.get(date)||[]).slice().sort((a,b)=>compare(b.timestamp,a.timestamp)||compare(a.id,b.id)),pathTypes=new Map();
      for(const output of local)for(const path of output.files)if(!gitPaths.has(path)){
        if(!pathTypes.has(path))pathTypes.set(path,byType.has(output.type)?output.type:'file');
        const g=add(pathTypes.get(path));g.paths.add(path);g.outputIds.add(output.id);g.sourceIds.add(output.sourceId);
      }
      const selected=snapshot.history?.enabled?[...groups.values()].sort((a,b)=>types.indexOf(a.type)-types.indexOf(b.type)):capGroups(groups);if(!selected.length)continue;
      let projected=projectedDays.get(date);
      if(!projected){const previous=projection.days.filter(d=>d.date<date).at(-1)?.depthEnd||0;projected={depthStart:previous,depthEnd:previous};}
      const span=projected.depthEnd-projected.depthStart;
      selected.forEach((g,index)=>{
        const definition=byType.get(g.type),paths=[...g.paths].sort(compare),evidenceIds=[...g.evidenceIds].sort(compare),outputIds=[...g.outputIds].sort(compare),sourceIds=[...g.sourceIds].sort(compare);
        const source=evidenceIds.length?(outputIds.length?'mixed-files':'file-rules'):'local-files';
        const sourceLabel=source==='mixed-files'?'Git 与本地输出':source==='file-rules'?'Git 提交文件':'本地输出文件';
        const fraction=selected.length===1?.58:.24+.68*index/(selected.length-1),prefix=snapshot.mode==='demo'?'虚构示例：':'';
        const provenance=source==='file-rules'?'当天 Git 提交中的变更':source==='local-files'?'按文件修改时间记录的本地输出':'当天 Git 变更与本地输出观察';
        findings.push(freezeFinding({
          id:`${snapshot.project.id}/${date}/finding/${g.type}`,projectId:snapshot.project.id,date,mode:snapshot.mode,
          kind:'work-finding',key:g.type,source,sourceLabel,semantic:false,visualType:g.type,recipeId:definition.recipeId,
          name:`${definition.label} · ${basename(paths)}${paths.length>1?' 等 '+paths.length+' 项':''}`,
          meaning:`${definition.label}文件，来自${sourceLabel}。`,
          description:`${prefix}${provenance}，涉及 ${paths.length} 个不同文件。按文件类型展示，不表示工作已经完成或测试通过。`,
          paths,evidenceIds,outputIds,sourceIds,fileCount:paths.length,
          depth:span>0?projected.depthStart+span*fraction:projected.depthEnd,pending:span<=0,
          variant:stableHash(JSON.stringify([g.type,paths]))%3,method:METHOD,methodLabel:METHOD_LABEL,limitations:LIMITATIONS
        }));
      });
    }
    const memoryGroups=new Map();
    for(const memory of snapshot.memories||[]){const date=C.today(memory.timestamp,snapshot.timezone);if(date<start||date>end||!projectedDays.has(date))continue;const slot=stableHash(memory.id)%3,key=date+'/'+slot;if(!memoryGroups.has(key))memoryGroups.set(key,{date,slot,items:[]});memoryGroups.get(key).items.push(memory);}
    for(const{date,slot,items}of memoryGroups.values()){
      items.sort((a,b)=>compare(a.timestamp,b.timestamp)||compare(a.id,b.id));const memory=items[0],day=projectedDays.get(date),span=day.depthEnd-day.depthStart;
      findings.push(Object.freeze({id:`${snapshot.project.id}/${date}/memory/${slot}`,projectId:snapshot.project.id,date,mode:snapshot.mode,kind:'work-finding',key:'memory',source:'conversation',sourceLabel:memory.method==='agent-memory'?'AI 记录':'对话节选',semantic:items.every(item=>item.method==='agent-memory'),visualType:items.length===1?memory.objectType||'memory':'memory',recipeId:'archive',name:memory.title+(items.length>1?' · '+items.length:''),meaning:memory.summary,description:memory.summary,paths:Object.freeze([]),evidenceIds:Object.freeze([]),outputIds:Object.freeze([]),sourceIds:Object.freeze([...new Set(items.map(item=>item.sourceId))]),memoryIds:Object.freeze(items.map(item=>item.id)),fileCount:0,depth:day.depthStart+span*(.18+.26*slot),pending:span<=0,variant:slot,method:memory.method,methodLabel:memory.method,limitations:'保留带来源的对话记录，不等于成果已完成。'}));
    }
    const ordered = findings.sort((a,b)=>a.depth-b.depth||compare(a.id,b.id));
    if (!snapshot.history?.pacingFrom) return Object.freeze(ordered);
    const layers = new Map();
    for (const item of ordered) {
      if (!layers.has(item.date)) layers.set(item.date, []);
      layers.get(item.date).push(item);
    }
    const placed = [];
    for (const [date, items] of layers) {
      if (date < snapshot.history.pacingFrom) { placed.push(...items); continue; }
      const {depthStart, depthEnd} = projectedDays.get(date);
      const offsets = days.get(date)?.placements || {};
      const span = depthEnd - depthStart;
      items.forEach((item, index) => {
        const key = item.id.split('/').slice(-2).join('/');
        const fallback = span * (index + 0.85) / (items.length + 0.35);
        const offset = Math.min(span, offsets[key] ?? fallback);
        placed.push(Object.freeze({...item, depth: depthStart + offset}));
      });
    }
    return Object.freeze(placed.sort((a,b)=>a.depth-b.depth||compare(a.id,b.id)));
  }
  const catalog=Object.freeze(DEFINITIONS.map(d=>Object.freeze({key:d.key,visualType:d.key,recipeId:d.recipeId,name:d.label})));
  return Object.freeze({build,classify,catalog,MAX_PER_DAY,METHOD,METHOD_LABEL,LIMITATIONS});
});
