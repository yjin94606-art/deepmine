'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { defaults, canonical, listClaude } = require('./source-adapters.cjs');
const { discoverCodex, connect } = require('./connect-codex.cjs');
const { settingsDirectory } = require('./setup.cjs');
const {projectIdentity}=require('./collector.cjs');
const {saveNarrationEnabled}=require('./work-narration-api.cjs');

const assets = new Map([
  ['/', ['welcome.html', 'text/html; charset=utf-8']],
  ['/try', ['index.html', 'text/html; charset=utf-8']],
  ['/mine-icon.svg', ['mine-icon.svg', 'image/svg+xml']],
  ['/welcome.css', ['welcome.css', 'text/css; charset=utf-8']],
  ['/mine-ui.css', ['mine-ui.css', 'text/css; charset=utf-8']],
  ['/treasure.css', ['treasure.css','text/css; charset=utf-8']],
  ['/treasure.js', ['treasure.js','text/javascript; charset=utf-8']],
  ['/daily-depth-art.js', ['daily-depth-art.js','text/javascript; charset=utf-8']],
  ['/daily-depth.css', ['daily-depth.css','text/css; charset=utf-8']],
  ['/daily-depth.js', ['daily-depth.js','text/javascript; charset=utf-8']],
  ['/image-decode.mjs', ['image-decode.mjs', 'text/javascript; charset=utf-8']],
  ...['welcome', 'evidence-core', 'demo-records', 'daily-artifact-core', 'expedition-world', 'work-findings',
    'drill-art', 'expedition-art', 'cavern-geology', 'cavern-lighting', 'expedition-life', 'output-art',
    'descent-scene', 'expedition-audio', 'item-intro', 'item-story', 'source-replay', 'visual-readings',
    'work-readings', 'work-subjects', 'work-objects', 'work-imprints', 'work-sprites', 'work-sketch', 'work-narration', 'i18n', 'gallery-ledger', 'gallery-ui', 'gallery-art', 'expedition-app'].map(name =>
    ['/' + name + '.js', [name + '.js', 'text/javascript; charset=utf-8']]),
  ...['garden.png','sample-02.png'].map(name=>['/demo-assets/'+name,['demo-assets/'+name,'image/png']])
]);

function pastedFolder(input, home) {
  if (typeof input !== 'string' || input.length > 4096 || /[\x00-\x1f\x7f]/.test(input)) return null;
  let folder = input.trim();
  if (folder.length > 1 && ['"', "'"].includes(folder[0]) && folder.at(-1) === folder[0]) folder = folder.slice(1, -1);
  if (folder === '~') folder = home;
  else if (folder.startsWith('~/') || (process.platform === 'win32' && folder.startsWith('~\\'))) folder = path.join(home,folder.slice(2));
  return path.isAbsolute(folder) ? path.normalize(folder) : null;
}

// Find the first user/assistant turn that names its workspace. Claude can
// prepend housekeeping records, so its first line is not a session header.
async function claudeWorkspace(filename) {
  const handle = await fs.open(filename, 'r');
  try {
    const page = Buffer.allocUnsafe(8192);
    let pending = Buffer.alloc(0);
    for (let n=0; n<8; n++) {
      const {bytesRead} = await handle.read(page,0,page.length,null);
      const bytes = Buffer.concat([pending,page.subarray(0,bytesRead)]);
      let start = 0;
      while (start < bytes.length) {
        const newline = bytes.indexOf(10,start);
        if (newline < 0 && bytesRead === page.length) break;
        const end = newline < 0 ? bytes.length : newline;
        let row;
        try { row = JSON.parse(bytes.toString('utf8',start,end)); } catch { /* A later turn may have intact metadata. */ }
        if (['user','assistant'].includes(row?.type) && row.isSidechain !== true && typeof row.cwd === 'string' &&
            !/[\x00-\x1f\x7f]/.test(row.cwd) && path.isAbsolute(row.cwd) && typeof row.sessionId === 'string' &&
            row.sessionId.length > 0 && row.sessionId.length <= 160 && Number.isFinite(Date.parse(row.timestamp))) {
          return {id:row.sessionId, projectPath:path.resolve(row.cwd), startedAt:new Date(row.timestamp).toISOString()};
        }
        start = end + 1;
      }
      if (bytesRead < page.length) return null;
      pending = bytes.subarray(start);
    }
    throw Error('Session header exceeds discovery limit');
  } finally { await handle.close(); }
}

async function discoverClaude(root) {
  const listed = await listClaude(root), byPath = new Map();
  let partial = listed.partial;
  const files = listed.files.filter(file => path.relative(path.join(root,'projects'),file).split(path.sep).length === 2);
  for (let offset=0; offset<files.length; offset+=8) {
    const group = await Promise.allSettled(files.slice(offset,offset+8).map(claudeWorkspace));
    for (const result of group) {
      if (result.status === 'rejected') { partial=true; continue; }
      if (!result.value) continue;
      const {projectPath, startedAt, id} = result.value;
      const key = canonical(projectPath);
      if (!key) continue;
      const entry = byPath.get(key) || {projectPath, startedAt, sessions:new Set()};
      if (startedAt > entry.startedAt) entry.startedAt = startedAt;
      entry.sessions.add(id);
      byPath.set(key,entry);
    }
  }
  const projects = [];
  for (const entry of byPath.values()) {
    const stat = await fs.stat(entry.projectPath).catch(() => null);
    if (stat?.isDirectory()) projects.push({...entry,sessions:entry.sessions.size});
  }
  return {projects, partial};
}

async function readPayload(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw Error('too-large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readChoice(req) {
  const choice = await readPayload(req);
  if (!choice || typeof choice !== 'object' || Array.isArray(choice) ||
      Object.keys(choice).some(key => !['id', 'folder', 'memories','narration','includeProcess'].includes(key)) ||
      ('narration' in choice && typeof choice.narration!=='boolean') ||
      ('includeProcess' in choice && (typeof choice.includeProcess!=='boolean'||(choice.includeProcess && choice.narration!==true))) ||
      typeof choice.memories !== 'boolean' || ('id' in choice) === ('folder' in choice)) throw Error('invalid');
  return choice;
}

async function childFolders(folder,signal) {
  const current = await fs.realpath(folder), children = [];
  signal.throwIfAborted();
  const dir = await fs.opendir(current);
  let inspected = 0, truncated = false;
  for await (const entry of dir) {
    signal.throwIfAborted();
    if (++inspected > 4096 || children.length >= 200) { truncated = true; break; }
    if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.') && !/[\x00-\x1f\x7f]/.test(entry.name)) {
      children.push({name:entry.name, path:path.join(current,entry.name)});
    }
  }
  children.sort((a,b)=>a.name.localeCompare(b.name));
  const parent = path.dirname(current);
  return {current, parent:parent === current ? null : parent, children, truncated, windowsDrives:process.platform==='win32'};
}

async function startWelcome({ port = 0, appRoot = path.resolve(__dirname, '..'), env = process.env,
  home = os.homedir(), startGame, identity } = {}) {
  if (typeof startGame !== 'function') throw TypeError('The welcome page requires a local game launcher.');
  let previous;
  try { previous = JSON.parse(await fs.readFile(path.join(settingsDirectory(appRoot, env), 'config.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw Error('Existing settings could not be read.'); }
  const roots = defaults(home,env);
  const codexRoot = path.resolve(previous?.codexRoot || roots.codexRoot);
  const claudeRoot = path.resolve(previous?.claudeRoot || roots.claudeRoot);
  const salt = crypto.randomBytes(24);
  let choices = new Map(), scan, opening, destination, closeTimer;
  async function projects() {
    const [codex,claude] = await Promise.all([discoverCodex(codexRoot),
      previous?.sources?.claude === false ? {projects:[],partial:false} : discoverClaude(claudeRoot)]);
    const combined = new Map();
    for (const [source,result] of [['Codex',codex],['Claude Code',claude]]) {
      for (const project of result.projects) {
        const key = canonical(project.projectPath);
        if (!key) continue;
        const entry = combined.get(key) || {...project,sessions:0,sources:[]};
        entry.sessions += project.sessions;
        if (Date.parse(project.startedAt)>Date.parse(entry.startedAt)) entry.startedAt=project.startedAt;
        entry.sources.push(source);
        combined.set(key,entry);
      }
    }
    const sorted = [...combined.values()].sort((a,b) => Date.parse(b.startedAt)-Date.parse(a.startedAt) || a.projectPath.localeCompare(b.projectPath));
    const entries = sorted.map(project => {
      const id = crypto.createHmac('sha256', salt).update(canonical(project.projectPath)).digest('hex');
      return { id, name: path.basename(project.projectPath) || project.projectPath, path: project.projectPath,
        sessions: project.sessions, startedAt: project.startedAt, sources: project.sources };
    });
    choices = new Map(entries.map(entry => [entry.id, entry.path]));
    return { projects: entries, partial: codex.partial || claude.partial, windowsDrives:process.platform==='win32' };
  }

  async function launch(project, memories,narration,includeProcess) {
    await connect(['--project', project, '--codex-root', codexRoot, '--claude-root', claudeRoot, '--setup-only', memories ? '--memories' : '--no-memories'],
      { appRoot, env, home, interactive: false, write: () => {} });
    if(narration!==undefined)await saveNarrationEnabled(settingsDirectory(appRoot,env),projectIdentity(project).id,narration,includeProcess);
    const started = await startGame();
    const game = new URL(typeof started === 'string' ? started : started.url);
    if (game.protocol !== 'http:' || game.hostname !== '127.0.0.1' || !game.port || game.username || game.password)
      throw Error('Invalid local game address.');
    destination = game.href;
    closeTimer = setTimeout(() => server.close(), 12000);
    closeTimer.unref();
    return destination;
  }

  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'" };
  const server = http.createServer(async (req, res) => {
    function json(status, value) {
      res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    }
    try {
      const activePort = server.address().port;
      if (![`127.0.0.1:${activePort}`, `localhost:${activePort}`].includes(req.headers.host))
        return json(403, { error: 'origin' });
      const origin = 'http://' + req.headers.host;
      const route = new URL(req.url, origin).pathname;
      if (route.startsWith('/api/') && (req.headers['sec-fetch-site'] === 'cross-site' ||
          (req.headers.origin && req.headers.origin !== origin))) return json(403, { error: 'origin' });
      if (req.method === 'GET' && route === '/api/instance') return json(200, identity || { app: 'deepmine', projectId: null });
      if (req.method === 'GET' && route === '/api/projects') {
        if (!scan) scan = projects().finally(() => { scan = null; });
        return json(200, await scan);
      }
      if (req.method === 'POST' && ['/api/folders','/api/connect'].includes(route)) {
        if (req.headers.origin !== origin || req.headers['x-deepmine-client'] !== 'welcome' ||
            !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return json(403, {error: 'origin'});
        if (route === '/api/folders') {
          let input;
          try { input = await readPayload(req); }
          catch (error) { return json(error.message === 'too-large' ? 413 : 400, {error:'invalid'}); }
          if (!input || Object.keys(input).length !== 1 || typeof input.folder !== 'string') return json(400,{error:'invalid'});
          const folder = input.folder === '' ? home : pastedFolder(input.folder,home);
          if (!folder) return json(400,{error:'invalid'});
          const controller=new AbortController();
          const cancel=()=>controller.abort();
          res.once('close',cancel);
          const timeout=setTimeout(()=>{
            cancel();
            if(!res.destroyed)json(503,{error:'unreadable-folder'});
          },5000);
          try {
            const view=await childFolders(folder,controller.signal);
            if(!controller.signal.aborted)return json(200,view);
          } catch {
            if(!controller.signal.aborted)return json(400,{error:'unreadable-folder'});
          } finally {
            clearTimeout(timeout);
            res.removeListener('close',cancel);
          }
          return;
        }
        let choice;
        try { choice = await readChoice(req); }
        catch (error) { return json(error.message === 'too-large' ? 413 : 400, {error: 'invalid'}); }
        const folder = pastedFolder(choice.folder,home);
        const project = 'folder' in choice ? folder : choices.get(choice.id);
        if (!project) return json(400, {error: 'invalid'});
        const key = JSON.stringify([path.resolve(project), choice.memories,choice.narration,choice.includeProcess===true]);
        if (opening && opening.key !== key) return json(409, {error: 'in-use'});
        if (!opening) {
          opening = {key, promise: (async () => {
            const stat = await fs.stat(project).catch(() => null);
            if (!stat?.isDirectory()) throw Error('missing-folder');
            return launch(project, choice.memories,choice.narration,choice.includeProcess===true);
          })()};
        }
        try { return json(200, {url: await opening.promise}); }
        catch (error) {
          opening = null;
          return json(error.message === 'missing-folder' ? 400 : 503,
            {error: error.message === 'missing-folder' ? 'missing-folder' : 'start-failed'});
        }
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, {error:'method'});
      if (route === '/' && destination) {
        res.writeHead(303, {...headers, Location: destination}); return res.end();
      }
      const asset = assets.get(route);
      if (!asset) return json(404, {error:'missing'});
      const bytes = await fs.readFile(path.join(__dirname, '..', 'dist', asset[0]));
      // The standalone demo only fetches its two packaged illustrations.
      const pageHeaders=route==='/try'?{...headers,'Content-Security-Policy':headers['Content-Security-Policy']+
        "; img-src 'self' blob:; connect-src "+origin+"/demo-assets/"}:headers;
      res.writeHead(200, {...pageHeaders, 'Content-Type': asset[1], 'Content-Length': bytes.length});
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { if (!res.headersSent) json(503, {error:'unavailable'}); else res.end(); }
  });
  server.on('close', () => clearTimeout(closeTimer));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const actualPort = server.address().port;
  return { server, port: actualPort, url: 'http://127.0.0.1:' + actualPort + '/',
    close: () => new Promise(resolve => server.close(resolve)) };
}

module.exports = { startWelcome };

