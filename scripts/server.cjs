'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { collect, projectIdentity } = require('./collector.cjs');
const crypto = require('node:crypto');
const syncFS = require('node:fs');
const execFile = require('node:util').promisify(require('node:child_process').execFile);
const C = require('../dist/evidence-core.js');
const { createService } = require('./daily-artifact-ai.cjs');
const {createNarrationApi}=require('./work-narration-api.cjs');
const Adapters = require('./source-adapters.cjs');
const { collectFiles } = require('./output-files.cjs');
const {describeBytes,publicPath,planFor} = require('./work-content.cjs');
const {projectMediaNote,mediaFile}=require('./media-notes.cjs');
const {projectImprint,supportsImprint}=require('./work-imprint.cjs');
const { collectTraces,createProcessReader,createDeliveryReader } = require('./artifact-traces.cjs');
const { createHistory } = require('./history-store.cjs');
const FieldNews = require('./field-news.cjs');
const {createTreasure}=require('./treasure.cjs');
const {settingsDirectory}=require('./setup.cjs');
const { collectConversations } = require('./conversation-records.cjs');
const { createEventStore } = require('./event-store.cjs');
const { createIngest } = require('./event-ingest.cjs');
const { createCapture } = require('./api-capture.cjs');
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function sendPlayable(req,res,headers,bytes,size){
  const mediaHeaders={...headers,'Accept-Ranges':'bytes','Content-Length':size};
  // No validators are advertised. Ignore conditional, unknown and multipart
  // ranges and send the whole representation. HEAD describes the full GET.
  const spec=req.method==='GET' && !req.headers['if-range'] &&
    /^bytes=(\d*)-(\d*)$/i.exec(req.headers.range||'');
  if(spec && (spec[1]||spec[2]) && !(spec[1]&&spec[2]&&Number(spec[1])>Number(spec[2]))){
    const first=spec[1]?Number(spec[1]):Math.max(0,size-Number(spec[2]));
    const last=spec[1]&&spec[2]?Math.min(size-1,Number(spec[2])):size-1;
    if(first>last){
      res.writeHead(416,{...mediaHeaders,'Content-Range':'bytes */'+size,'Content-Length':0});res.end();return;
    }
    res.writeHead(206,{...mediaHeaders,'Content-Range':`bytes ${first}-${last}/${size}`,'Content-Length':last-first+1});
    res.end(bytes.subarray(first,last+1));return;
  }
  res.writeHead(200,mediaHeaders);res.end(req.method==='HEAD'?undefined:bytes);
}

async function start(options = {}) {
  const dataDirectory = path.resolve(options.dataDirectory || settingsDirectory(ROOT));
  let local = {};
  try { local = JSON.parse(await fs.readFile(path.join(dataDirectory, 'config.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') console.warn('Local configuration unavailable; using explicit/default paths.'); }
  const args = process.argv.slice(2);
  function arg(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }
  const port = Number(options.port ?? arg('--port') ?? process.env.PORT ?? 4173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port.');
  const projectPath = path.resolve(options.projectPath || arg('--project') || local.projectPath || ROOT);
  const sameProject=local.projectPath && Adapters.canonical(local.projectPath)===Adapters.canonical(projectPath);
  const scopePath = path.resolve(options.scopePath || arg('--scope') || (sameProject && local.scopePath) || projectPath);
  const defaultRoots = Adapters.defaults();
  const codexRoot = path.resolve(options.codexRoot || arg('--codex-root') || local.codexRoot || defaultRoots.codexRoot);
  const claudeRoot = path.resolve(options.claudeRoot || arg('--claude-root') || local.claudeRoot || defaultRoots.claudeRoot);
  const usageImports = options.usageImports || (arg('--usage-import') ? arg('--usage-import').split(',') : local.usageImports || []);
  const outputDirs = options.outputDirs || (arg('--outputs') ? arg('--outputs').split(',') : local.outputDirs || []);
  const sources = { ...(local.sources || {}), ...(options.sources || {}) };
  const timezone = options.timezone || local.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const historyDays = Number(options.historyDays || local.historyDays || 365);
  const memoriesEnabled = options.memoriesEnabled ?? (args.includes('--memories') || local.memories?.enabled === true);
  const projectId = projectIdentity(projectPath).id;
  const instanceIdentity = require('./open-mine.cjs').identity(dataDirectory,projectId,local);
  const history = createHistory({directory:path.join(dataDirectory,'history'),projectId,timezone});
  const treasure=createTreasure({directory:path.join(dataDirectory,'treasure',projectId),getRadio:history.getRadio,readTop:options.treasureReadTop});
  const gallery=require('./gallery-store.cjs').createGallery(path.join(dataDirectory,'gallery'),projectId);
  const personalSurvey=require('./personal-survey.cjs').personalSurveyRoute({projectId,history});
  const newsConfig = options.fieldNews || local.fieldNews || {};
  const news = FieldNews.createService({
    ...newsConfig,
    enabled: newsConfig.enabled !== false,
    timezone,
    configDirectory: dataDirectory,
    feedPath: newsConfig.feedPath || 'field-news.json'
  });
  const eventStore = createEventStore({directory:path.join(dataDirectory,'events'),projectPath,projectId,allowTraceRequests:memoriesEnabled});
  let ingestionKey = options.ingestionKey || local.ingestionKey || null;
  if(!ingestionKey){
    const tokenPath=path.join(dataDirectory,'ingestion.key');
    try{ingestionKey=(await fs.readFile(tokenPath,'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;ingestionKey=crypto.randomBytes(32).toString('hex');await fs.mkdir(dataDirectory,{recursive:true});try{await fs.writeFile(tokenPath,ingestionKey,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;ingestionKey=(await fs.readFile(tokenPath,'utf8')).trim();}}
  }
  if (args.includes('--no-codex')) sources.codex = false;
  if (args.includes('--no-claude')) sources.claude = false;
  if (args.includes('--no-imports')) sources.imports = false;
  const aiEnabled = options.aiEnabled ?? (!args.includes('--no-ai') && (args.includes('--ai') || local.ai?.enabled === true));
  const ai = options.aiService || (aiEnabled ? createService({ projectPath, cachePath: path.join(dataDirectory, 'ai'), codexPath: options.codexPath || local.ai?.codexPath, model: options.aiModel || local.ai?.model }) : null);
  let cached = null, cachedAt = 0, pending = null;
  const acceptEvent = async event => {await eventStore.append(event);cachedAt=0;};
  const ingest = createIngest({projectPath,projectId,onEvent:acceptEvent,allowTraceRequests:memoriesEnabled});
  const capture = createCapture({projectPath,projectId,providers:options.captureProviders || local.capture?.providers || {},onEvent:acceptEvent});
  const attachDeliveries=createDeliveryReader({projectPath,scopePath,codexRoot:sources.codex===false?null:codexRoot,
    claudeRoot:sources.claude===false?null:claudeRoot,historyDays,memoriesEnabled});
  const readProcess=options.readNarrationProcess||createProcessReader({projectPath,scopePath,
    codexRoot:sources.codex===false?null:codexRoot,claudeRoot:sources.claude===false?null:claudeRoot});
  const narration=await createNarrationApi({dataDirectory,projectId,snapshot,codexPath:options.codexPath||local.ai?.codexPath,
    model:options.aiModel||local.ai?.model,generate:options.generateNarration,selectEvidence:options.selectNarrationEvidence,memoriesEnabled,readProcess});
  function snapshot() {
    if (cached && Date.now() - cachedAt < 5000) return Promise.resolve(cached);
    if (!pending) pending = collect({ projectPath, scopePath, codexRoot, claudeRoot, usageImports, sources,timezone,historyDays }).then(async value => {
      const [files,conversation,events] = await Promise.all([
        collectFiles({ projectPath, projectId: value.project.id, outputDirs, dataDirectory, now: new Date(value.collectedAt),timezone,historyDays }),
        collectConversations({codexRoot:sources.codex===false?null:codexRoot,claudeRoot:sources.claude===false?null:claudeRoot,scopePath,projectId,enabled:memoriesEnabled,localeOnly:true,now:new Date(value.collectedAt),timezone,historyDays}),
        eventStore.project(value.days.map(day=>day.date),timezone)
      ]);
      value.outputs = files.outputs; value.outputSource = { status: files.status, notes: files.notes };
      value.memories=[...conversation.memories,...events.memories];
      value.preferences={locale:local.locale || conversation.locale || null};
      value.outputs.push(...events.outputs);
      if(events.outputs.length)value.outputSource.status=files.status==='partial'?'partial':'connected';
      if(events.usage.length){
        value.providerUsage=[...(value.providerUsage||[]),...events.usage];
        const combined=Adapters.combineUsage([{source:value.sources.codex,days:value.days},...events.usage],value.days.map(day=>day.date));
        value.days=value.days.map((day,index)=>({...day,usage:combined[index].usage,usageSourceIds:[...(day.usageSourceIds||[]),...events.usage.filter(item=>item.days.some(record=>record.date===day.date&&record.usage.totalTokens>0)).map(item=>item.source.id)]}));
        value.usageSources.push(...events.usage.map(item=>item.source));
        value.sources.codex={...value.sources.codex,status:events.usage.some(item=>item.source.status==='partial')||value.sources.codex.status==='partial'?'partial':'connected',sessions:value.sources.codex.sessions+events.usage.reduce((sum,item)=>sum+(item.sessions||0),0),events:value.sources.codex.events+events.usage.reduce((sum,item)=>sum+(item.events||0),0),method:'Observed local logs and explicit API/hook events; see usageSources for coverage.'};
      }
      value.history={enabled:true,revision:0};
      let matches=[];
      const ambiguous=[];
      if (sources.codex!==false || sources.claude!==false) {
        const versions=new Map((await history.outputVersions()).map(output=>[output.id,output]));
        for (const output of value.outputs) if (!versions.has(output.id)) versions.set(output.id,output);
        try {
          matches=await collectTraces({projectPath,scopePath,outputs:[...versions.values()],memoriesEnabled,historyDays,
            now:new Date(value.collectedAt),codexRoot:sources.codex===false?null:codexRoot,
            claudeRoot:sources.claude===false?null:claudeRoot,onAmbiguous:entry=>ambiguous.push(entry)});
        } catch { value.warnings.push('部分产出来源暂时不可读，已保存的回执会保留。'); }
      }
      const visible = await history.reconcile(value,{matches,ambiguous,includeTraceRequests:memoriesEnabled});
      // Rebuild delivery references on the visible snapshot. Old saves benefit on
      // refresh; switching off local excerpts does not leave new quotes in the journal.
      await attachDeliveries(visible).catch(()=>visible.warnings.push('部分作品的对话交付记录暂时不可读。'));
      cached = visible; cachedAt = Date.now(); return cached;
    }).finally(() => { pending = null; });
    return pending;
  }
  const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const visionAssets = new Map([
    ['ort.wasm.min.mjs','text/javascript'], ['ort-wasm-simd-threaded.mjs','text/javascript'],
    ['ort-wasm-simd-threaded.wasm','application/wasm'], ['clip-vision.onnx','application/octet-stream'],
    ['subjects.f32','application/octet-stream'], ['subjects.json','application/json']
  ]);
  let hostedPicker;
  const server = http.createServer(async (req, res) => {
    const actualPort = server.address()?.port || port;
    const allowedHosts = new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`]);
    if (!allowedHosts.has(req.headers.host)) { res.writeHead(403); res.end('Local host required'); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${actualPort}`).pathname); } catch { res.writeHead(400); res.end('Invalid path'); return; }
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', 'Referrer-Policy': 'no-referrer' };
    if(pathname==='/projects'){
      if(req.method!=='GET' || req.headers['sec-fetch-site']==='cross-site'){
        res.writeHead(req.method==='GET'?403:405,headers);res.end();return;
      }
      try{
        let url;
        if(options.openPicker)url=await options.openPicker();
        else{
          hostedPicker??=require('./open-mine.cjs').openMine({chooseProject:true,env:{...process.env,DEEPMINE_DATA_DIR:dataDirectory}})
            .catch(error=>{hostedPicker=null;throw error;});
          url=(await hostedPicker).url;
        }
        res.writeHead(303,{...headers,Location:url});res.end();
      }catch{res.writeHead(503,headers);res.end('Could not open the project picker. Reopen Deepmine and try again.');}
      return;
    }
    if (pathname.startsWith('/vision/')) {
      const name = pathname.slice(8);
      if (!['GET','HEAD'].includes(req.method) || !visionAssets.has(name)) { res.writeHead(404,headers); res.end(); return; }
      const asset = path.join(ROOT,'vision',name);
      try {
        const stat = await fs.stat(asset), tag = '"' + stat.size + '-' + Math.trunc(stat.mtimeMs) + '"';
        const cache = {...headers,'Cache-Control':'private, no-cache',ETag:tag};
        if (req.headers['if-none-match'] === tag) { res.writeHead(304,cache); res.end(); return; }
        res.writeHead(200,{...cache,'Content-Length':stat.size,'Content-Type':visionAssets.get(name)});
        if (req.method === 'HEAD') { res.end(); return; }
        const stream = syncFS.createReadStream(asset);
        res.once('close', () => stream.destroy());
        stream.on('error', () => res.destroy()).pipe(res);
      } catch { if (!res.headersSent) res.writeHead(404,headers); res.end(); }
      return;
    }
    if (pathname.startsWith('/api/')) {
      const origin = req.headers.origin;
      const sameOrigin = !origin || [`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`].includes(origin);
      if (!sameOrigin || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403, headers); res.end('Same-origin access only'); return; }
      if(pathname==='/api/instance'){
        if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{...headers,Allow:'GET, HEAD'});res.end();return;}
        res.writeHead(200,{...headers,'Content-Type':'application/json'});
        res.end(req.method==='HEAD'?undefined:JSON.stringify(instanceIdentity));return;
      }
      if(pathname==='/api/daily-depth'){await personalSurvey(req,res,headers);return;}
      if(await narration.handle(req,res,pathname,actualPort,headers))return;
      if(pathname==='/api/treasure'){await treasure.handle(req,res,headers);return;}
      if(pathname==='/api/gallery'){await gallery.handle(req,res,snapshot,headers);return;}
      if(await capture.handle(req,res))return;
      if (pathname === '/api/field-news') {
        const send = (status, data) => {
          res.writeHead(status, {...headers, 'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify(data));
        };
        try {
          const radio = await history.getRadio();
          if (req.method === 'GET') {
            send(200, {...radio, status: newsConfig.enabled === false ? 'disabled' : radio.items.length ? 'ready' : radio.slots ? 'available' : 'locked'});
            return;
          }
          if (req.method !== 'POST') { send(405, {error: 'GET or POST required'}); return; }
          if (req.headers['x-deepmine-client'] !== 'field-news' || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
            send(403, {error:'Local application request required'}); return;
          }
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            if ((size += chunk.length) > 1024) { send(413, {error:'Request too large'}); return; }
            chunks.push(chunk);
          }
          let claim;
          try { claim = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { send(400, {error:'Invalid claim'}); return; }
          if (claim?.action !== 'claim' || claim.date !== radio.date) { send(400, {error:'Invalid claim date or action'}); return; }
          if (newsConfig.enabled === false) { send(200, {...radio, status:'disabled'}); return; }
          if (radio.slots <= radio.claimed) { send(200, {...radio, status:'locked'}); return; }
          const feed = await news.get({date:radio.date, unlocked:true});
          const candidates = feed.items.map(item => ({...item, source:feed.source.label}));
          const result = await history.claimNews(radio.date, radio.claimed, candidates);
          // A progress request may already have advanced the local projection.
          // Update only its claimed count; never replace newer excavation state.
          if (cached?.mining.radio?.date === result.date) cached.mining.radio.claimed = result.claimed;
          send(200, {...result, status:result.newItem ? 'ready' : feed.status === 'ready' ? 'empty' : feed.status});
        } catch { send(503, {status:'error',items:[]}); }
        return;
      }
      if(pathname==='/api/mining'||pathname==='/api/events'){
        if(pathname==='/api/mining' && req.method==='GET' && req.headers['x-deepmine-client']==='mining'){
          if(!cached)await snapshot();
          const mining=await history.getMining();
          res.writeHead(200,{...headers,'Content-Type':'application/json'});res.end(JSON.stringify({mining}));return;
        }
        if(req.method!=='POST'){res.writeHead(405,{...headers,Allow:'POST'});res.end('POST required');return;}
        const authorized=pathname==='/api/mining'?req.headers['x-deepmine-client']==='mining':typeof req.headers['x-deepmine-key']==='string'&&req.headers['x-deepmine-key'].length===ingestionKey.length&&crypto.timingSafeEqual(Buffer.from(req.headers['x-deepmine-key']),Buffer.from(ingestionKey));
        if(!authorized||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){res.writeHead(403,headers);res.end('Local application authorization required');return;}
        try{
          const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>65536)throw new Error('Request too large');chunks.push(chunk);}
          const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if(pathname==='/api/mining'){
            if(!input||Object.keys(input).some(key=>!['action',input.action==='acknowledge'?'id':'depth'].includes(key)))throw new Error('Invalid action');
            await snapshot();const mining=await history.command(input);cached={...cached,mining};res.writeHead(200,{...headers,'Content-Type':'application/json'});res.end(JSON.stringify({mining}));
          }else{const result=await ingest.ingest(input);res.writeHead(result.accepted||result.status==='duplicate'?200:result.status==='conflict'?409:400,{...headers,'Content-Type':'application/json'});res.end(JSON.stringify(result));}
        }catch{res.writeHead(400,{...headers,'Content-Type':'application/json'});res.end(JSON.stringify({error:'Invalid local event or action; no additional work was minted.'}));}return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { ...headers,Allow: 'GET, HEAD' }); res.end('Read-only endpoint'); return; }
      if (!['/api/snapshot', '/api/daily-artifacts', '/api/connectors', '/api/preview', '/api/work-intro', '/api/work-imprint'].includes(pathname)) { res.writeHead(404, headers); res.end('Unknown endpoint'); return; }
      try {
        if (pathname === '/api/connectors') {
          const data = await snapshot();
          const result = { projectId:data.project.id, usageSources: data.usageSources, outputSource: data.outputSource, capture:capture.diagnostics(),events:ingest.diagnostics(),capabilities: { codex: true, claudeCode: true, genericUsageImport: true, localOutputFiles: true, currentImagePreview: true, apiCapture:true,structuredEvents:true,persistentHistory:true,conversationMemories:true,automaticAllApps: false }, configured: { codex: sources.codex !== false, claude: sources.claude !== false, imports: sources.imports !== false && usageImports.length > 0, outputDirectories: outputDirs.length, aiInterpretation: Boolean(aiEnabled),memories:memoriesEnabled,timezone,historyDays }, importSchema: { schemaVersion: 1, id: 'unique-call-id', source: 'your-tool', projectPath: 'absolute-project-path-on-this-computer', timestamp: '2026-11-18T12:00:00+08:00', sessionId: 'session-id', usage: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, totalTokens: 120 } } };
          res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(req.method === 'HEAD' ? undefined : JSON.stringify(result)); return;
        }
        if (pathname === '/api/preview' || pathname === '/api/work-intro' || pathname === '/api/work-imprint') {
          const intro = pathname === '/api/work-intro';
          const imprint = pathname === '/api/work-imprint';
          const data = await snapshot(), requested = new URL(req.url, `http://127.0.0.1:${actualPort}`).searchParams.get('path');
          const allowed = new Set([...data.days.flatMap(day => day.evidence.flatMap(entry => entry.files.map(file => file.path))), ...(data.outputs || []).flatMap(output => output.files)]);
          const imageMime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
          const videoMime={'.mp4':'video/mp4','.m4v':'video/mp4','.webm':'video/webm','.mov':'video/quicktime'};
          const ext=requested && path.extname(requested).toLowerCase();
          const audioMime={'.wav':'audio/wav','.mp3':'audio/mpeg','.m4a':'audio/mp4','.ogg':'audio/ogg','.oga':'audio/ogg','.opus':'audio/ogg','.flac':'audio/flac'};
          const playable=videoMime[ext] || audioMime[ext], contentType=intro||imprint?'application/json; charset=utf-8':imageMime[ext] || playable;
          const limit=(intro||imprint||playable?16:8)*1024*1024;
          if (!requested || !contentType || !allowed.has(requested) || !publicPath(requested) || (intro && !planFor(requested,0)) || (imprint && !supportsImprint(requested))) { res.writeHead(404, headers); res.end(); return; }
          async function sendVersion(bytes,origin,commit,fingerprint,size=bytes?.length) {
            const responseHeaders={...headers,'Content-Type':contentType,'X-Deepmine-Preview':origin};
            if(playable&&!intro&&!imprint){sendPlayable(req,res,responseHeaders,bytes,size);return;}
            let content=bytes;
            if (bytes && req.method!=='HEAD' && (intro||imprint)) {
              let description=imprint?await projectImprint(requested,bytes,{projectPath,allowed,outputs:data.outputs,commit,fingerprint}):describeBytes(requested,bytes);
              if (intro && mediaFile.test(requested)) {
                const note=await projectMediaNote(requested,{projectPath,allowed,outputs:data.outputs,commit});
                if(note)description={title:description?.title || '',...note};
              }
              content=JSON.stringify(description);
            }
            res.writeHead(200,responseHeaders);
            res.end(req.method==='HEAD'?undefined:content);
          }
          try {
            const query = new URL(req.url,'http://localhost').searchParams;
            const commit = query.get('commit'), fingerprint = query.get('fingerprint');
            if (commit && fingerprint) { res.writeHead(400,headers); res.end(); return; }
            if ((intro || imprint || playable) && !commit && !fingerprint) {res.writeHead(400,headers);res.end();return;}
            if (commit) {
              const observed = /^[a-f0-9]{40,64}$/.test(commit) && data.days.some(day =>
                day.evidence.some(entry => entry.hash === commit && entry.files.some(file => file.path === requested)));
              if (!observed) { res.writeHead(404,headers); res.end(); return; }
              // The collector records paths relative to the selected directory,
              // which can be a subdirectory of the Git worktree.
              const spec = commit + ':./' + requested;
              const gitOptions = {cwd:projectPath, timeout:5000, windowsHide:true};
              const size = Number((await execFile('git',['cat-file','-s',spec],gitOptions)).stdout.trim());
              if (!Number.isSafeInteger(size) || size > limit) { res.writeHead(413,headers); res.end(); return; }
              const bytes = req.method === 'HEAD' ? undefined : (await execFile('git',['cat-file','blob',spec],{...gitOptions,encoding:'buffer',maxBuffer:limit})).stdout;
              await sendVersion(bytes,'commit-blob',commit,null,size); return;
            }
            const projectReal = await fs.realpath(projectPath), target = await fs.realpath(path.join(projectPath, requested)), relative = path.relative(projectReal, target);
            if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) { res.writeHead(403, headers); res.end('Outside project'); return; }
            const file = await fs.open(target, 'r');
            try {
              const stat = await file.stat();
              if (!stat.isFile() || stat.size > limit) { res.writeHead(413, headers); res.end('Preview unavailable'); return; }
              const content = req.method === 'HEAD' && !fingerprint ? undefined : await file.readFile();
              if (content && content.length > limit) { res.writeHead(413, headers); res.end('Preview unavailable'); return; }
              if (fingerprint && (!data.outputs.some(o => o.fingerprint === fingerprint && o.files.includes(requested)) ||
                  crypto.createHash('sha256').update(content).digest('hex') !== fingerprint)) { res.writeHead(409, headers); res.end(); return; }
              await sendVersion(content,fingerprint?'verified-fingerprint':'current-file-not-commit-snapshot',null,fingerprint); return;
            } finally { await file.close(); }
          } catch { res.writeHead(404, headers); res.end('Current file unavailable'); return; }
        }
        if (pathname === '/api/daily-artifacts') {
          if (req.headers['x-deepmine-client'] !== 'daily-ai') { res.writeHead(403, headers); res.end('Application request required'); return; }
          if (req.method === 'HEAD') { res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(); return; }
          if (!aiEnabled || !ai) { res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ status: 'disabled', items: [], message: 'AI 解读已关闭，保留基础藏品。' })); return; }
          const data = await snapshot(), query = new URL(req.url, `http://127.0.0.1:${actualPort}`), date = query.searchParams.get('date') || C.today(data.collectedAt,timezone);
          const period = C.project(data).days;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !period.some(day => day.date === date)) { res.writeHead(400, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: '请选择采集范围内的日期。' })); return; }
          const result = await ai.get(data, date);
          res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(result)); return;
        }
        const data = await snapshot();
        res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data));
      } catch { res.writeHead(503, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: '采集暂时失败，请检查项目路径和本地日志是否可读。' })); }
      return;
    }
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{...headers,Allow:'GET, HEAD'});res.end('Read-only endpoint');return;}
    const target = path.resolve(DIST, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(DIST + path.sep)) { res.writeHead(403, headers); res.end('Outside static root'); return; }
    try {
      const content = await fs.readFile(target); res.writeHead(200, { ...headers, 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' }); res.end(req.method === 'HEAD' ? undefined : content);
    } catch { res.writeHead(404, headers); res.end('Not found'); }
  });
  const lockDirectory=path.join(dataDirectory,'locks'),lockFile=path.join(lockDirectory,projectId+'.lock'),lockToken=crypto.randomBytes(16).toString('hex');
  syncFS.mkdirSync(lockDirectory,{recursive:true});
  try{syncFS.writeFileSync(lockFile,JSON.stringify({pid:process.pid,token:lockToken}),{flag:'wx',mode:0o600});}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    let previous;try{previous=JSON.parse(syncFS.readFileSync(lockFile,'utf8'));}catch{throw new Error('Unrecognized project lock; no history was modified.');}
    let alive=true;try{process.kill(previous.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
    if(alive)throw new Error('This project is already being synchronized by another local server.');
    syncFS.unlinkSync(lockFile);syncFS.writeFileSync(lockFile,JSON.stringify({pid:process.pid,token:lockToken}),{flag:'wx',mode:0o600});
  }
  function releaseLock(){try{if(JSON.parse(syncFS.readFileSync(lockFile,'utf8')).token===lockToken)syncFS.unlinkSync(lockFile);}catch{}}
  const syncTimer=setInterval(()=>snapshot().catch(()=>{}),30000);syncTimer.unref();
  server.once('close',()=>{hostedPicker?.then(instance=>instance.close()).catch(()=>{});});
  server.once('close', () => { clearInterval(syncTimer);releaseLock();capture.close();news.close();narration.close().catch(()=>{});if (ai) Promise.resolve(ai.close()).catch(() => {}); });
  try{await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });}catch(error){clearInterval(syncTimer);releaseLock();capture.close();if(ai)await ai.close().catch(()=>{});throw error;}
  const address = server.address();
  if (!options.quiet) console.log(`DEEPMINE local collector: http://127.0.0.1:${address.port}\nRead-only project scope: ${scopePath}\n${aiEnabled ? 'Optional AI interpretation is enabled for selected-day Git titles and relative paths.' : 'Local evidence mode. Optional AI interpretation is disabled.'}`);
  return { server, snapshot, ai, port: address.port, projectId };
}
async function launchServer(options) {
  const instance=await start(options);
  await require('./open-mine.cjs').rememberRunning(options?.dataDirectory || settingsDirectory(ROOT),instance.port,instance.projectId)
    .catch(()=>console.warn('Deepmine could not save this port for the desktop launcher.'));
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; try { if (instance.ai) await instance.ai.close(); } finally { instance.server.closeAllConnections(); instance.server.close(() => { process.exitCode = 0; }); } };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return instance;
}
async function main(args) {
  if(!args.includes('--project') && !syncFS.existsSync(path.join(settingsDirectory(ROOT),'config.json')))
    return require('./connect-codex.cjs').connect(args);
  return launchServer();
}
module.exports = { start,launchServer };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
