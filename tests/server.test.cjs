'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { start } = require('../scripts/server.cjs');

function request(port, pathname, { method = 'GET', headers = {}, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers, setHost: !Object.keys(headers).some(key => key.toLowerCase() === 'host') }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: binary ? bytes : bytes.toString('utf8') });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Fixture request timed out')));
    req.end();
  });
}

async function fixture(t, setup) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'deepmine-http-'));
  const projectPath = path.join(temp, 'project');
  const codexRoot = path.join(temp, 'codex-fixture');
  fs.mkdirSync(projectPath);
  const config = { port: 0, quiet: true, dataDirectory: path.join(temp, 'app-data'), projectPath, scopePath: projectPath, codexRoot, aiEnabled: false };
  if (setup) await setup(config);
  const instance = await start(config);
  t.after(async () => {
    if (instance.server.listening) await new Promise((resolve, reject) => instance.server.close(error => error ? reject(error) : resolve()));
    // The fixture path is created by this test under the system temp directory.
    // It never includes the user's project, Codex logs, or local configuration.
    const resolved = path.resolve(temp), allowed = path.resolve(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(allowed) || !path.basename(resolved).startsWith('deepmine-http-')) throw new Error('Unexpected fixture cleanup path');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { ...instance, config };
}

function syntheticLog(config) {
  const timestamp = new Date(Date.now() - 1000).toISOString();
  const directory = path.join(config.codexRoot, 'sessions', 'fixture');
  fs.mkdirSync(directory, { recursive: true });
  const counters = { input_tokens: 100, cached_input_tokens: 60, output_tokens: 10, total_tokens: 110, reasoning_output_tokens: 2, cache_write_input_tokens: 0 };
  const rows = [
    { timestamp, ordinal: 0, type: 'session_meta', payload: { id: 'isolated-fixture', cwd: config.projectPath, source: 'vscode', instructions: 'PRIVATE_PROMPT_SENTINEL' } },
    { timestamp, ordinal: 1, type: 'response_item', payload: { type: 'message', text: 'PRIVATE_PROMPT_SENTINEL' } },
    { timestamp, ordinal: 2, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: counters, last_token_usage: counters } } }
  ];
  fs.writeFileSync(path.join(directory, 'fixture.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
}

const dailyHeaders = { 'X-Deepmine-Client': 'daily-ai' };
function fakeAI(respond = { status: 'pending', items: [] }) {
  const calls = { get: [], close: 0 };
  return {
    calls,
    async get(snapshot, date) {
      calls.get.push({ snapshot, date });
      return typeof respond === 'function' ? respond(snapshot, date, calls.get.length) : respond;
    },
    async close() { calls.close++; }
  };
}

test('connector diagnostics disclose capabilities and statuses without local absolute paths', async t => {
  const { port, config } = await fixture(t);
  const result = await request(port, '/api/connectors'); assert.equal(result.status, 200);
  const data = JSON.parse(result.body); assert.equal(data.capabilities.claudeCode, true); assert.equal(data.capabilities.automaticAllApps, false);
  assert.ok(data.usageSources.some(source => source.id === 'codex')); assert.ok(data.usageSources.some(source => source.id === 'claude-code'));
  assert.equal(data.importSchema.schemaVersion, 1); assert.equal(data.configured.aiInterpretation, false);
  assert.ok(!result.body.includes(config.projectPath)); assert.ok(!result.body.includes(config.codexRoot));
  assert.equal((await request(port, '/api/connectors', { headers: { Origin: 'https://external.invalid' } })).status, 403);
  assert.equal((await request(port, '/api/connectors', { method: 'POST' })).status, 405);
});

test('preview serves only current observed images and labels them as current rather than commit snapshots', async t => {
  const { port } = await fixture(t, async config => {
    config.outputDirs = ['exports']; const dir = path.join(config.projectPath, 'exports'); fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'diagram.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    fs.writeFileSync(path.join(dir, 'vector.svg'), '<svg/>'); fs.writeFileSync(path.join(config.projectPath, 'private.png'), 'not observed');
  });
  const snapshot = JSON.parse((await request(port, '/api/snapshot')).body); assert.equal(snapshot.outputSource.status, 'connected'); assert.ok(snapshot.outputs.some(item => item.files.includes('exports/diagram.png')));
  const response = await request(port, '/api/preview?path=exports%2Fdiagram.png'); assert.equal(response.status, 200); assert.equal(response.headers['content-type'], 'image/png'); assert.equal(response.headers['x-deepmine-preview'], 'current-file-not-commit-snapshot');
  assert.equal((await request(port, '/api/preview?path=exports%2Fdiagram.png', { method: 'HEAD' })).body, '');
  for (const filename of ['private.png', 'exports/vector.svg', '../outside.png', 'C:/private.png']) assert.equal((await request(port, '/api/preview?path=' + encodeURIComponent(filename))).status, 404);
  assert.equal((await request(port, '/api/preview?path=exports%2Fdiagram.png', { headers: { Origin: 'https://external.invalid' } })).status, 403);
});

test('preview refuses oversize current files even when their output metadata was observed', async t => {
  const { port } = await fixture(t, async config => { config.outputDirs = ['exports']; fs.mkdirSync(path.join(config.projectPath, 'exports')); fs.writeFileSync(path.join(config.projectPath, 'exports/large.png'), Buffer.alloc(9 * 1024 * 1024)); });
  assert.equal((await request(port, '/api/preview?path=exports%2Flarge.png')).status, 413);
});

function pixelGif(rgb) {
  // A one-pixel GIF with a two-color palette. Every color has the same file length.
  return Buffer.from('47494638396101000100800000' + rgb + 'ffffff2c00000000010001000002024401003b', 'hex');
}

test('fingerprint previews verify the selected bytes for both GET and HEAD, including after a same-size replacement', async t => {
  const original = pixelGif('de3047'), replacement = pixelGif('387ac1');
  const name = 'exports/portrait.gif';
  const { port, config } = await fixture(t, config => {
    config.outputDirs = ['exports'];
    config.sources = { codex: false, claude: false, imports: false };
    fs.mkdirSync(path.join(config.projectPath, 'exports'));
    fs.writeFileSync(path.join(config.projectPath, name), original);
  });
  const snapshot = JSON.parse((await request(port, '/api/snapshot')).body);
  const version = snapshot.outputs.find(output => output.files.includes(name));
  assert.equal(version?.fingerprint, createHash('sha256').update(original).digest('hex'));
  const preview = '/api/preview?' + new URLSearchParams({ path: name, fingerprint: version.fingerprint });
  for (const method of ['GET', 'HEAD']) {
    const response = await request(port, preview, { method, binary: true });
    assert.equal(response.status, 200, method);
    assert.equal(response.headers['content-type'], 'image/gif');
    assert.equal(response.headers['x-deepmine-preview'], 'verified-fingerprint');
    assert.deepEqual(response.body, method === 'GET' ? original : Buffer.alloc(0));
  }
  fs.writeFileSync(path.join(config.projectPath, name), replacement);
  for (const method of ['GET', 'HEAD']) {
    const response = await request(port, preview, { method });
    assert.equal(response.status, 409, method);
    assert.equal(response.headers['x-deepmine-preview'], undefined);
    assert.notEqual(response.headers['content-type'], 'image/gif');
  }
});

for (const nested of [false, true]) {
  test('Git previews read the observed commit blob for a ' + (nested ? 'nested project' : 'repository root'), async t => {
    const original = pixelGif('c03f36'), changed = pixelGif('24aa87');
    let portraitCommit, mapCommit;
    const { port } = await fixture(t, config => {
      const repo = config.projectPath;
      config.sources = { codex: false, claude: false, imports: false };
      config.outputDirs = [];
      if (nested) {
        config.projectPath = config.scopePath = path.join(repo, 'game');
        fs.mkdirSync(config.projectPath);
        fs.writeFileSync(path.join(repo, 'portrait.gif'), pixelGif('001133'));
      }
      const date = new Date(Date.now() - 60000).toISOString();
      const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(repo, 'no-global-config'),
        GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_DATE: date };
      const git = (...args) => execFileSync('git', ['-C', repo, ...args], { windowsHide: true, encoding: 'utf8', env }).trim();
      git('init', '--quiet');
      fs.writeFileSync(path.join(config.projectPath, 'portrait.gif'), original);
      git('add', '.');
      git('commit', '-qm', 'Draw a portrait');
      portraitCommit = git('rev-parse', 'HEAD');
      fs.writeFileSync(path.join(config.projectPath, 'map.gif'), changed);
      git('add', '.');
      git('commit', '-qm', 'Draw a map');
      mapCommit = git('rev-parse', 'HEAD');
      fs.writeFileSync(path.join(config.projectPath, 'portrait.gif'), changed);
    });
    const snapshot = JSON.parse((await request(port, '/api/snapshot')).body);
    const evidence = snapshot.days.flatMap(day => day.evidence);
    assert.ok(evidence.find(item => item.hash === portraitCommit)?.files.some(file => file.path === 'portrait.gif'));
    assert.deepEqual(evidence.find(item => item.hash === mapCommit)?.files.map(file => file.path), ['map.gif']);
    const url = commit => '/api/preview?' + new URLSearchParams({ path: 'portrait.gif', commit });
    for (const method of ['GET', 'HEAD']) {
      // The portrait exists in the second commit's tree too, but was only observed as a change in the first commit.
      assert.equal((await request(port, url(mapCommit), { method })).status, 404, method);
      const ambiguous = url(portraitCommit) + '&fingerprint=' + createHash('sha256').update(original).digest('hex');
      assert.equal((await request(port, ambiguous, { method })).status, 400, method);
      const response = await request(port, url(portraitCommit), { method, binary: true });
      assert.equal(response.status, 200, method);
      assert.equal(response.headers['content-type'], 'image/gif');
      assert.equal(response.headers['x-deepmine-preview'], 'commit-blob');
      assert.deepEqual(response.body, method === 'GET' ? original : Buffer.alloc(0));
    }
  });
}

test('the local vision runtime serves only its listed assets, with module and WebAssembly MIME types', async t => {
  const { port } = await fixture(t);
  const module = await request(port, '/vision/ort-wasm-simd-threaded.mjs');
  assert.equal(module.status, 200);
  assert.match(module.headers['content-type'], /^text\/javascript\b/);
  assert.ok(module.body.length > 0);
  const wasm = await request(port, '/vision/ort-wasm-simd-threaded.wasm', { method: 'HEAD' });
  assert.equal(wasm.status, 200);
  assert.equal(wasm.headers['content-type'], 'application/wasm');
  assert.ok(Number(wasm.headers['content-length']) > 8);
  assert.equal(wasm.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(wasm.body, '');
  for (const pathname of ['/vision/', '/vision/ORT-LICENSE.txt', '/vision/.deepmine/config.json', '/vision/..%2fpackage.json']) {
    assert.equal((await request(port, pathname)).status, 404, pathname);
  }
  assert.ok([404, 405].includes((await request(port, '/vision/ort.wasm.min.mjs', { method: 'POST' })).status));
  assert.equal((await request(port, '/vision/ort.wasm.min.mjs', { headers: { Host: 'remote.invalid' } })).status, 403);
});

test('preview rechecks realpath after collection and rejects a replaced directory that escapes the project', async t => {
  const { port, config } = await fixture(t, async config => { config.outputDirs = ['exports']; fs.mkdirSync(path.join(config.projectPath, 'exports')); fs.writeFileSync(path.join(config.projectPath, 'exports/image.png'), Buffer.from('89504e470d0a1a0a', 'hex')); });
  await request(port, '/api/snapshot');
  const dir = path.join(config.projectPath, 'exports'), outside = path.join(path.dirname(config.projectPath), 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'image.png'), 'PRIVATE_IMAGE_SENTINEL');
  fs.renameSync(dir, path.join(config.projectPath, 'exports-original'));
  try { fs.symlinkSync(outside, dir, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Platform does not permit isolated symlink fixture'); return; } throw error; }
  const result = await request(port, '/api/preview?path=exports%2Fimage.png'); assert.equal(result.status, 403); assert.ok(!result.body.includes('PRIVATE_IMAGE_SENTINEL'));
});

test('server binds only loopback on an ephemeral port and serves the actual static page', async t => {
  const { server, port } = await fixture(t);
  assert.ok(port > 0);
  assert.equal(server.address().address, '127.0.0.1');
  const result = await request(port, '/');
  assert.equal(result.status, 200);
  assert.match(result.headers['content-type'], /^text\/html/);
  assert.match(result.body, /<html[\s>]/i);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
  assert.equal(result.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(result.headers['referrer-policy'], 'no-referrer');
});

test('API missing sources preserve unknown numbers as null rather than zero', async t => {
  const { port } = await fixture(t);
  const result = await request(port, '/api/snapshot');
  assert.equal(result.status, 200);
  assert.match(result.headers['content-type'], /^application\/json/);
  const snapshot = JSON.parse(result.body);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.kind, 'deepmine-evidence');
  assert.equal(snapshot.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal(snapshot.days.length, 1);
  assert.equal(snapshot.history.enabled, true);
  assert.equal(snapshot.sources.codex.status, 'missing');
  assert.equal(snapshot.sources.git.status, 'missing');
  assert.ok(snapshot.days.every(day => day.usage.totalTokens === null && day.usage.sessions === null && day.usage.quality === 'unavailable'));
  assert.deepEqual(snapshot.workingTree, { modified: null, untracked: null, status: 'unavailable' });
  assert.equal(result.headers['access-control-allow-origin'], undefined);
});

test('explicit fixture roots collect only fixture counters and never expose prompt text or absolute paths', async t => {
  const { port, config } = await fixture(t, syntheticLog);
  const result = await request(port, '/api/snapshot');
  const snapshot = JSON.parse(result.body);
  assert.equal(snapshot.sources.codex.status, 'connected');
  assert.equal(snapshot.sources.codex.sessions, 1);
  assert.equal(snapshot.days.reduce((sum, day) => sum + day.usage.totalTokens, 0), 110);
  assert.equal(result.body.includes('PRIVATE_PROMPT_SENTINEL'), false);
  assert.equal(result.body.includes(config.projectPath.replace(/\\/g, '\\\\')), false);
  assert.equal(result.body.includes(config.codexRoot.replace(/\\/g, '\\\\')), false);
});

test('HEAD serves headers without a body for both static content and evidence API', async t => {
  const { port } = await fixture(t);
  for (const pathname of ['/', '/api/snapshot']) {
    const result = await request(port, pathname, { method: 'HEAD' });
    assert.equal(result.status, 200);
    assert.equal(result.body, '');
    assert.equal(result.headers['cache-control'], 'no-store');
  }
});

test('mutating methods and preflight requests are rejected by the read-only server', async t => {
  const { port } = await fixture(t);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const result = await request(port, '/api/snapshot', { method });
    assert.equal(result.status, 405, method);
    assert.equal(result.headers.allow, 'GET, HEAD');
    assert.equal(result.body.includes('deepmine-evidence'), false);
  }
  assert.equal((await request(port, '/', { method: 'POST' })).status, 405);
});

test('external, opaque, and wrong-port Origins cannot read project evidence', async t => {
  const { port } = await fixture(t);
  for (const origin of ['https://unrelated.example', 'null', 'http://127.0.0.1:1', `https://localhost:${port}`, `http://localhost:${port}.example`]) {
    const result = await request(port, '/api/snapshot', { headers: { Origin: origin } });
    assert.equal(result.status, 403, origin);
    assert.equal(result.body.includes('deepmine-evidence'), false);
    assert.equal(result.headers['access-control-allow-origin'], undefined);
  }
});

test('cross-site fetch metadata blocks requests even without an Origin header', async t => {
  const { port } = await fixture(t);
  for (const headers of [
    { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'cross-site', Origin: `http://127.0.0.1:${port}` }
  ]) assert.equal((await request(port, '/api/snapshot', { headers })).status, 403);
});

test('same-origin localhost and loopback requests are accepted', async t => {
  const { port } = await fixture(t);
  for (const name of ['localhost', '127.0.0.1']) {
    const result = await request(port, '/api/snapshot', { headers: { Host: `${name}:${port}`, Origin: `http://${name}:${port}`, 'Sec-Fetch-Site': 'same-origin' } });
    assert.equal(result.status, 200);
  }
});

test('untrusted Host values and missing port are rejected before serving files or API', async t => {
  const { port } = await fixture(t);
  for (const host of ['attacker.example', '127.0.0.1', `127.0.0.1:${port}.example`, `0.0.0.0:${port}`, '']) {
    for (const pathname of ['/', '/api/snapshot']) {
      const result = await request(port, pathname, { headers: { Host: host } });
      assert.equal(result.status, 403, `${host} ${pathname}`);
      assert.equal(result.body.includes('deepmine-evidence'), false);
    }
  }
});

test('path traversal cannot retrieve server code, configuration, or files outside dist', async t => {
  const { port } = await fixture(t);
  const paths = [
    '/scripts/server.cjs', '/scripts/collector.cjs', '/package.json', '/.deepmine/config.json',
    '/../scripts/server.cjs', '/..%2fscripts%2fserver.cjs', '/%2e%2e%5cscripts%5cserver.cjs',
    '/%2e%2e%2f.deepmine%2fconfig.json', '/..%2f..%2f..%2fconfig.json',
    '/%252e%252e%252fscripts%252fcollector.cjs', '/%00', '/.git/config'
  ];
  for (const pathname of paths) {
    const result = await request(port, pathname);
    assert.ok([400, 403, 404].includes(result.status), `${pathname}: ${result.status}`);
    assert.equal(result.body.includes('async function start'), false);
    assert.equal(result.body.includes('module.exports'), false);
    assert.equal(result.body.includes('projectPath'), false);
  }
});

test('malformed URL escapes and unknown API routes return controlled errors', async t => {
  const { port } = await fixture(t);
  assert.equal((await request(port, '/%E0%A4%A')).status, 400);
  assert.equal((await request(port, '/api/unknown')).status, 404);
  const healthy = await request(port, '/api/snapshot');
  assert.equal(healthy.status, 200);
});

test('parallel requests share one cached snapshot and do not multiply evidence', async t => {
  const { port } = await fixture(t, syntheticLog);
  const responses = await Promise.all(Array.from({ length: 8 }, () => request(port, '/api/snapshot')));
  assert.ok(responses.every(response => response.status === 200));
  const snapshots = responses.map(response => JSON.parse(response.body));
  assert.equal(new Set(snapshots.map(snapshot => snapshot.collectedAt)).size, 1);
  assert.ok(snapshots.every(snapshot => snapshot.days.reduce((sum, day) => sum + day.usage.totalTokens, 0) === 110));
  assert.equal((await request(port, '/api/snapshot')).body, responses[0].body);
});

test('collector configuration failures return a generic 503 without leaking local paths', async t => {
  const { port, config } = await fixture(t, config => { config.scopePath = path.join(path.dirname(config.projectPath), 'wrong-scope'); });
  const result = await request(port, '/api/snapshot');
  assert.equal(result.status, 503);
  assert.deepEqual(Object.keys(JSON.parse(result.body)), ['error']);
  assert.equal(result.body.includes(config.projectPath.replace(/\\/g, '\\\\')), false);
  assert.equal(result.body.includes('stack'), false);
  assert.equal((await request(port, '/')).status, 200);
});

test('invalid port configuration fails before opening a server', async () => {
  const explicit = { quiet: true, aiEnabled: false, projectPath: os.tmpdir(), scopePath: os.tmpdir(), codexRoot: path.join(os.tmpdir(), 'deepmine-unused-codex-fixture') };
  await assert.rejects(start({ ...explicit, port: -1 }), /Invalid port/);
  await assert.rejects(start({ ...explicit, port: 65536 }), /Invalid port/);
});

test('daily artifacts require the exact application header before invoking AI', async t => {
  const ai = fakeAI();
  const { port } = await fixture(t, config => { config.aiEnabled = true; config.aiService = ai; });
  for (const method of ['GET', 'HEAD']) {
    for (const headers of [{}, { 'X-Deepmine-Client': 'wrong-client' }, { 'X-Deepmine-Client': 'DAILY-AI' }]) {
      const result = await request(port, '/api/daily-artifacts', { method, headers });
      assert.equal(result.status, 403, `${method} ${JSON.stringify(headers)}`);
      assert.equal(result.headers['access-control-allow-origin'], undefined);
    }
  }
  assert.equal(ai.calls.get.length, 0);
});

test('daily artifact HEAD returns headers without collecting evidence or generating an item', async t => {
  const ai = fakeAI();
  const { port } = await fixture(t, config => {
    config.aiEnabled = true; config.aiService = ai;
    // Collection would fail, so success also proves HEAD never asks for a snapshot.
    config.scopePath = path.join(path.dirname(config.projectPath), 'invalid-head-scope');
  });
  const result = await request(port, '/api/daily-artifacts?date=not-a-date', { method: 'HEAD', headers: dailyHeaders });
  assert.equal(result.status, 200);
  assert.equal(result.body, '');
  assert.match(result.headers['content-type'], /^application\/json/);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(ai.calls.get.length, 0);
});

test('daily artifacts reject malformed, impossible, and out-of-range dates without invoking AI', async t => {
  const ai = fakeAI();
  const { port } = await fixture(t, config => { config.aiEnabled = true; config.aiService = ai; });
  for (const date of ['not-a-date', '2026-2-03', '2026-02-30', '0000-00-00', '2000-01-01', '2999-12-31']) {
    const result = await request(port, `/api/daily-artifacts?date=${encodeURIComponent(date)}`, { headers: dailyHeaders });
    assert.equal(result.status, 400, date);
    assert.match(result.headers['content-type'], /^application\/json/);
    assert.deepEqual(Object.keys(JSON.parse(result.body)), ['error']);
  }
  assert.equal(ai.calls.get.length, 0);
});

test('daily artifacts pass the cached snapshot and default or selected date to the AI service', async t => {
  const ai = fakeAI();
  const instance = await fixture(t, config => { config.aiEnabled = true; config.aiService = ai; config.outputDirs=['exports']; const dir=path.join(config.projectPath,'exports');fs.mkdirSync(dir);const file=path.join(dir,'yesterday.txt');fs.writeFileSync(file,'isolated past output');const yesterday=new Date(Date.now()-86400000);fs.utimesSync(file,yesterday,yesterday); });
  const snapshot = await instance.snapshot();
  const expectedToday = new Intl.DateTimeFormat('en-CA', { timeZone: snapshot.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(snapshot.collectedAt));
  const selectedDate = snapshot.days.find(day => day.date !== expectedToday).date;
  const requests = [
    ['/api/daily-artifacts', expectedToday],
    [`/api/daily-artifacts?date=${encodeURIComponent(selectedDate)}`, selectedDate],
    ['/api/daily-artifacts?date=', expectedToday]
  ];
  for (const [pathname] of requests) assert.equal((await request(instance.port, pathname, { headers: dailyHeaders })).status, 200);
  assert.equal(ai.calls.get.length, requests.length);
  ai.calls.get.forEach((call, i) => {
    assert.strictEqual(call.snapshot, snapshot);
    assert.equal(call.date, requests[i][1]);
  });
});

test('daily artifact polling preserves pending and ready service responses including the semantic item', async t => {
  const responses = [
    { status: 'pending', items: [], fingerprint: 'fixture-semantic-fingerprint' },
    { status: 'ready', items: [{ id: 'fixture-pickaxe', recipeId: 'pickaxe', name: '矿洞开拓镐', summary: '根据示例挖矿项目制作的矿镐。', variant: 2 }], fingerprint: 'fixture-semantic-fingerprint' }
  ];
  const ai = fakeAI((_snapshot, _date, callNumber) => responses[callNumber - 1]);
  const { port } = await fixture(t, config => { config.aiEnabled = true; config.aiService = ai; });
  for (const expected of responses) {
    const result = await request(port, '/api/daily-artifacts', { headers: dailyHeaders });
    assert.equal(result.status, 200);
    assert.match(result.headers['content-type'], /^application\/json/);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.deepEqual(JSON.parse(result.body), expected);
  }
  assert.equal(ai.calls.get.length, 2);
  assert.strictEqual(ai.calls.get[0].snapshot, ai.calls.get[1].snapshot);
  assert.equal(ai.calls.get[0].date, ai.calls.get[1].date);
});

test('explicitly disabled AI returns disabled without collecting evidence or invoking the injected service', async t => {
  const ai = fakeAI();
  const { port } = await fixture(t, config => {
    config.aiEnabled = false; config.aiService = ai;
    config.scopePath = path.join(path.dirname(config.projectPath), 'invalid-disabled-scope');
  });
  const result = await request(port, '/api/daily-artifacts', { headers: dailyHeaders });
  assert.equal(result.status, 200);
  const body = JSON.parse(result.body);
  assert.equal(body.status, 'disabled');
  assert.deepEqual(body.items, []);
  assert.equal(ai.calls.get.length, 0);
});

test('daily artifact generation rejects cross-origin and cross-site requests despite a valid application header', async t => {
  const ai = fakeAI();
  const { port } = await fixture(t, config => { config.aiEnabled = true; config.aiService = ai; });
  for (const extra of [
    { Origin: 'https://unrelated.example' },
    { Origin: 'null' },
    { Origin: 'http://127.0.0.1:1' },
    { Origin: `https://localhost:${port}` },
    { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'cross-site', Origin: `http://127.0.0.1:${port}` }
  ]) {
    const result = await request(port, '/api/daily-artifacts', { headers: { ...dailyHeaders, ...extra } });
    assert.equal(result.status, 403, JSON.stringify(extra));
    assert.equal(result.headers['access-control-allow-origin'], undefined);
  }
  assert.equal(ai.calls.get.length, 0);
});

test('daily artifact service failures produce a controlled 503 without leaking paths or model errors', async t => {
  const ai = fakeAI(() => { throw new Error('PRIVATE_AI_FAILURE_SENTINEL'); });
  const { port, config } = await fixture(t, config => { config.aiEnabled = true; config.aiService = ai; });
  const result = await request(port, '/api/daily-artifacts', { headers: dailyHeaders });
  assert.equal(result.status, 503);
  assert.deepEqual(Object.keys(JSON.parse(result.body)), ['error']);
  assert.equal(result.body.includes('PRIVATE_AI_FAILURE_SENTINEL'), false);
  assert.equal(result.body.includes(config.projectPath.replace(/\\/g, '\\\\')), false);
  assert.equal(result.body.includes('stack'), false);
  assert.equal(ai.calls.get.length, 1);
  assert.equal((await request(port, '/')).status, 200);
});

test('closing the HTTP server closes its injected AI service exactly once', async t => {
  const ai = fakeAI();
  const { server, port } = await fixture(t, config => { config.aiEnabled = true; config.aiService = ai; });
  assert.equal((await request(port, '/api/daily-artifacts', { headers: dailyHeaders })).status, 200);
  assert.equal(ai.calls.close, 0);
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  assert.equal(server.listening, false);
  assert.equal(ai.calls.close, 1);
});
