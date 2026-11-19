'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), http = require('node:http'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { runHook, classify, safeRelative, MAX_FILE, MAX_INPUT } = require('../integrations/editor-hook.cjs');
const { createIngest, projectIdentity } = require('../scripts/event-ingest.cjs');
const { createEventStore } = require('../scripts/event-store.cjs');
const {identity,rememberRunning}=require('../scripts/open-mine.cjs');
const KEY = 'test-ingestion-key-never-persist-in-event';
const MTIME = new Date('2026-11-18T01:02:03.000Z'), NOW = new Date('2026-11-18T03:00:00Z');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deepmine-editor-hook-'));
  const appRoot = path.join(root, 'Deepmine App'), projectPath = path.join(root, 'My Project');
  await fs.mkdir(path.join(appRoot, '.deepmine'), { recursive: true });
  await fs.mkdir(projectPath);
  const configPath = path.join(appRoot, '.deepmine', 'config.json');
  await fs.writeFile(configPath, JSON.stringify({ projectPath }));
  await fs.writeFile(path.join(appRoot, '.deepmine', 'ingestion.key'), KEY);
  const servers = [];
  t.after(async () => {
    for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('deepmine-editor-hook-')) throw new Error('Unsafe test cleanup');
    await fs.rm(root, { recursive: true, force: true });
  });
  async function file(relative = 'src/game.js', content = 'PRIVATE_FILE_BODY') {
    const target = path.join(projectPath, relative);
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); await fs.utimes(target, MTIME, MTIME); return target;
  }
  const messages = [], headers = [];
  const storeOptions = { directory: path.join(root, 'events'), projectPath, projectId: projectIdentity(projectPath), now: () => NOW };
  let store = createEventStore(storeOptions);
  let ingest = createIngest({ projectPath, now: () => NOW, onEvent: event => store.append(event) });
  async function server(handler,identify=true) {
    const events = handler || (async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      headers.push(req.headers); messages.push(JSON.parse(Buffer.concat(chunks).toString()));
      assert.equal(req.url, '/api/events'); assert.equal(req.method, 'POST'); assert.equal(req.headers['x-deepmine-key'], KEY);
      const result = await ingest.ingest(messages.at(-1));
      res.writeHead(result.status === 'conflict' ? 409 : 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result));
    });
    const instance=http.createServer(async(req,res)=>{
      if(identify && req.url==='/api/instance'){
        assert.equal(req.headers['x-deepmine-key'],undefined);
        const config=JSON.parse(await fs.readFile(configPath,'utf8'));
        res.end(JSON.stringify(identity(path.dirname(configPath),projectIdentity(projectPath),config)));
        return;
      }
      await events(req,res);
    });
    await new Promise((resolve, reject) => { instance.once('error', reject); instance.listen(0, '127.0.0.1', resolve); }); servers.push(instance); return instance.address().port;
  }
  function input(file_path, extra = {}) { return { hook_event_name: 'afterFileEdit', conversation_id: 'conversation-01', generation_id: 'generation-01', file_path, ...extra }; }
  const options = port => ({ appRoot, port, now: NOW, env: {DEEPMINE_DATA_DIR:path.dirname(configPath)} });
  return { root, appRoot, projectPath, configPath, file, server, input, options, messages, headers,
    restart() { store = createEventStore(storeOptions); ingest = createIngest({ projectPath, now: () => NOW, onEvent: event => store.append(event) }); },
    stored: () => store.project(['2026-11-18'], 'Asia/Shanghai') };
}

test('official afterFileEdit payload becomes a real fingerprinted output without edits, transcripts, keys or usage', async t => {
  const f = await fixture(t), target = await f.file('图纸/矿井.svg'), port = await f.server();
  const result = await runHook(f.input(target, { edits: [{ old_string: 'PRIVATE_EDIT', new_string: 'PRIVATE_EDIT_NEW' }], transcript_path: '/PRIVATE_TRANSCRIPT', user_email: 'PRIVATE_EMAIL', apiKey: 'PRIVATE_INPUT_KEY', workspace_roots: ['/UNTRUSTED_ROOT'] }), f.options(port));
  assert.equal(result.status, 'accepted');
  const event = f.messages[0]; assert.equal(event.source, 'cursor-hook'); assert.equal(event.kind, 'output'); assert.equal(event.timestamp, MTIME.toISOString());
  assert.deepEqual(event.output.files, ['图纸/矿井.svg']); assert.equal(event.output.type, 'image');
  assert.equal(event.output.fingerprint, crypto.createHash('sha256').update('PRIVATE_FILE_BODY').digest('hex'));
  assert.equal(event.projectPath, f.projectPath); assert.equal(event.usage, undefined); assert.ok(!JSON.stringify(event).includes('PRIVATE')); assert.ok(!JSON.stringify(event).includes(KEY));
  const stored = await f.stored(); assert.equal(stored.outputs.length, 1); assert.equal(stored.outputs[0].projectPath, undefined); assert.equal(stored.outputs[0].sourceId, 'cursor-hook'); assert.deepEqual(stored.usage, []);
});

test('duplicate hooks are idempotent concurrently and after persistence restart', async t => {
  const f = await fixture(t), target = await f.file(), port = await f.server(), input = f.input(target);
  const results = await Promise.all([runHook(input, f.options(port)), runHook(input, f.options(port))]);
  assert.deepEqual(results.map(value => value.status).sort(), ['accepted', 'duplicate']); assert.equal((await f.stored()).count, 1);
  f.restart(); assert.equal((await runHook(input, f.options(port))).status, 'accepted'); assert.equal((await f.stored()).count, 1);
  assert.deepEqual(f.messages[0], f.messages[2]);
});

test('changed contents create a new revision; unknown file types remain file and never imply completed work', async t => {
  const f = await fixture(t), target = await f.file('exports/result.unknown', 'first'), port = await f.server();
  assert.equal((await runHook(f.input(target), f.options(port))).status, 'accepted');
  await f.file('exports/result.unknown', 'second'); assert.equal((await runHook(f.input(target), f.options(port))).status, 'accepted');
  assert.notEqual(f.messages[0].id, f.messages[1].id); assert.equal(f.messages[1].output.type, 'file'); assert.match(f.messages[1].output.summary, /不证明任务完成/); assert.equal((await f.stored()).count, 2);
});

test('project selection controls scope; sibling prefixes, input workspace roots, relative and foreign OS paths cannot expand it', async t => {
  const f = await fixture(t), outside = path.join(f.root, 'My Project-other', 'report.md'); await fs.mkdir(path.dirname(outside)); await fs.writeFile(outside, 'PRIVATE');
  for (const target of [outside, '../report.md', process.platform === 'win32' ? '/elsewhere/report.md' : 'C:\\Elsewhere\\report.md']) {
    const result = await runHook(f.input(target, { workspace_roots: [f.root], projectPath: f.root }), f.options(1)); assert.equal(result.status, 'skipped');
  }
});

test('symlinks/junctions and hard links cannot publish an external or aliased file', async t => {
  const f = await fixture(t), outside = path.join(f.root, 'private'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'image.png'), 'PRIVATE');
  await fs.symlink(outside, path.join(f.projectPath, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await runHook(f.input(path.join(f.projectPath, 'linked', 'image.png')), f.options(1))).code, 'linked-file-excluded');
  const target = await f.file('src/original.js'); await fs.link(target, path.join(f.projectPath, 'alias.js'));
  assert.equal((await runHook(f.input(path.join(f.projectPath, 'alias.js')), f.options(1))).code, 'linked-file-excluded');
});

test('hidden, dependency, credential and configuration paths are excluded before posting', async t => {
  const f = await fixture(t);
  for (const relative of ['.env', '.deepmine/config.json', 'node_modules/a.js', 'auth/login.js', 'config/local.json', 'keys/api-key.txt', 'exports/passwords.csv', 'private.pem', 'app.config.json']) {
    const target = await f.file(relative); assert.equal((await runHook(f.input(target), f.options(1))).code, 'file-excluded', relative);
  }
  assert.equal(safeRelative('docs/plan.md'), true); assert.equal(safeRelative('../escape.js'), false); assert.equal(safeRelative('src/main.js:alternate'), false);
});

test('missing selection, malformed config, missing key and unrecognized hook are safe skips', async t => {
  const f = await fixture(t), target = await f.file(), options = f.options(1);
  assert.equal((await runHook(f.input(target, { hook_event_name: 'beforeReadFile' }), options)).code, 'hook-input-invalid');
  assert.equal((await runHook(f.input(target, { generation_id: '' }), options)).code, 'hook-input-invalid');
  await fs.unlink(f.configPath); assert.equal((await runHook(f.input(target), options)).code, 'configuration-missing');
  await fs.writeFile(f.configPath, 'broken PRIVATE_CONFIG'); assert.equal((await runHook(f.input(target), options)).code, 'configuration-invalid');
  await fs.writeFile(f.configPath, '{}'); assert.equal((await runHook(f.input(target), options)).code, 'project-not-configured');
  await fs.writeFile(f.configPath, JSON.stringify({ projectPath: f.projectPath })); await fs.unlink(path.join(f.appRoot, '.deepmine', 'ingestion.key'));
  assert.equal((await runHook(f.input(target), options)).code, 'ingestion-key-missing');
});

test('local config key is supported; stdin credentials and destination fields have no authority', async t => {
  const f = await fixture(t), target = await f.file(), port = await f.server();
  await fs.writeFile(f.configPath, JSON.stringify({ projectPath: f.projectPath, ingestionKey: KEY })); await fs.unlink(path.join(f.appRoot, '.deepmine', 'ingestion.key'));
  assert.equal((await runHook(f.input(target, { ingestionKey: 'ATTACKER', url: 'https://example.invalid/', port: 1 }), f.options(port))).status, 'accepted');
  assert.equal(f.headers[0]['x-deepmine-key'], KEY); assert.equal(f.headers[0].authorization, undefined);
});

test('large, future-dated and disappeared files never create output records', async t => {
  const f = await fixture(t), target = await f.file('exports/large.png'); await fs.truncate(target, MAX_FILE + 1);
  assert.equal((await runHook(f.input(target), f.options(1))).code, 'file-too-large');
  const future = await f.file('exports/future.md'); await fs.utimes(future, new Date('2099-01-01'), new Date('2099-01-01'));
  assert.equal((await runHook(f.input(future), f.options(1))).code, 'file-time-invalid');
  await fs.unlink(future); assert.equal((await runHook(f.input(future), f.options(1))).code, 'file-unavailable');
});

test('offline, slow, rejected and redirect responses stay bounded and never copy server error text', async t => {
  const f = await fixture(t), target = await f.file(), input = f.input(target);
  const offline = await f.server((_req, res) => res.end());
  // Close this listener before trying it; use a real closed ephemeral port rather than assuming one.
  const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const closedPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
  assert.equal((await runHook(input, f.options(closedPort))).code, 'service-unavailable');
  const slow = await f.server(() => {}); assert.equal((await runHook(input, { ...f.options(slow), timeoutMs: 30 })).code, 'service-timeout');
  const denied = await f.server((_req, res) => { res.writeHead(403); res.end('PRIVATE_SERVER_ERROR'); });
  assert.deepEqual(await runHook(input, f.options(denied)), { status: 'skipped', code: 'service-unauthorized' });
  const redirect = await f.server((_req, res) => { res.writeHead(302, { Location: 'https://example.invalid/secret' }); res.end('PRIVATE_REDIRECT'); });
  assert.equal((await runHook(input, f.options(redirect))).code, 'event-not-saved');
  assert.equal((await runHook(input, f.options(offline))).code, 'service-response-invalid');
});

function cli(script, input, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject); child.stdin.on('error', () => {}); child.on('close', code => resolve({ code, stdout, stderr })); child.stdin.end(input);
  });
}
test('a hook uses its registered alternate port and sends no event to an unrelated listener',async t=>{
  const f=await fixture(t),target=await f.file(),port=await f.server();
  const probes=[];
  const unrelated=await f.server((req,res)=>{probes.push([req.url,req.headers['x-deepmine-key']]);res.end('{}');},false);
  await rememberRunning(path.dirname(f.configPath),port,projectIdentity(f.projectPath));
  const options=f.options();
  options.env.PORT=String(unrelated);
  assert.equal((await runHook(f.input(target),options)).status,'accepted');
  assert.equal((await runHook(f.input(target),{...options,port:unrelated})).code,'service-unavailable');
  assert.deepEqual(probes,[['/api/instance',undefined]]);
});
test('actual CLI emits empty JSON and exit 0 for missing config, malformed or oversized stdin, and offline service', async t => {
  const f = await fixture(t), target = await f.file(), script = path.resolve(__dirname,'../integrations/editor-hook.cjs');
  const env={...process.env,...f.options().env};
  await fs.unlink(f.configPath);
  for (const input of [JSON.stringify(f.input(target)), '{PRIVATE_MALFORMED', JSON.stringify({ huge: 'PRIVATE'.repeat(Math.ceil(MAX_INPUT / 7)) })]) {
    const result = await cli(script, input, [],env); assert.equal(result.code, 0); assert.deepEqual(JSON.parse(result.stdout), {}); assert.ok(result.stderr.length < 150); assert.ok(!result.stderr.includes('PRIVATE')); assert.ok(!result.stderr.includes(f.projectPath));
  }
  await fs.writeFile(f.configPath, JSON.stringify({ projectPath: f.projectPath }));
  const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const result = await cli(script, JSON.stringify(f.input(target)), ['--port', String(port)],env);
  assert.equal(result.code, 0); assert.equal(result.stdout, '{}\n'); assert.match(result.stderr, /service-unavailable/);
});

test('copyable Cursor config names only the observer and contains no private configuration', async () => {
  const example = JSON.parse(await fs.readFile(path.resolve(__dirname, '../integrations/cursor-hooks.example.json'), 'utf8'));
  assert.equal(example.version, 1); assert.deepEqual(Object.keys(example.hooks), ['afterFileEdit']); assert.match(example.hooks.afterFileEdit[0].command, /editor-hook\.cjs/); assert.equal(example.hooks.afterFileEdit[0].timeout, 5);
  for (const [file, type] of [['plan.md', 'document'], ['scene.HTML', 'web'], ['music.wav', 'audio'], ['clip.mp4', 'video'], ['slides.pptx', 'slides'], ['table.csv', 'table'], ['app.tsx', 'code'], ['data.unknown', 'file']]) assert.equal(classify(file), type);
});
