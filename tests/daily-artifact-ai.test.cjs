'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawn } = require('node:child_process');
const C = require('../dist/evidence-core.js');
const D = require('../dist/daily-artifact-core.js');
const { createService, buildPrompt, childEnvironment, cliArguments, transportSchema } = require('../scripts/daily-artifact-ai.cjs');
const DATE = '2026-11-17', NOW = '2026-11-17T05:00:00Z';
const clone = value => JSON.parse(JSON.stringify(value));

function snapshot() {
  const value = C.demoSnapshot(NOW); value.mode = 'live'; value.project.id = 'service-fixture';
  value.days = [value.days[1]];
  value.days[0].evidence[0].title = '更新挖矿游戏的竖直钻进与跟随镜头';
  value.days[0].evidence[0].files = [{ path: 'src/mining.js', kind: 'code' }, { path: 'docs/mining.md', kind: 'document' }];
  return value;
}
function result(value = snapshot()) { return { objectType: 'pickaxe', name: '深掘之镐', summary: '更新了提交中记录的挖矿游戏钻进与镜头文件。', meaning: '矿镐对应矿井开拓的工作主题。', evidenceIds: [value.days[0].evidence[0].hash] }; }
function driver() {
  const jobs = [];
  function start(command, args, options) {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const job = { command, args, options, child, input: '', killed: false, finished: false, output: args[args.indexOf('-o') + 1], schema: args[args.indexOf('--output-schema') + 1] };
    child.stdin.on('data', chunk => { job.input += chunk.toString(); }); child.stdin.on('finish', () => { job.finished = true; });
    child.kill = () => { job.killed = true; queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return true; };
    job.complete = async (raw = result()) => { await fs.writeFile(job.output, JSON.stringify(raw)); child.emit('close', 0); };
    job.fail = code => child.emit('close', code);
    jobs.push(job); return child;
  }
  return { jobs, spawn: start };
}
async function until(predicate, label = 'condition') { const start = Date.now(); while (!await predicate()) { if (Date.now() - start > 3000) throw new Error('Timed out waiting for ' + label); await new Promise(resolve => setTimeout(resolve, 5)); } }
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deepmine-service-test-')), fake = driver(); let clock = Date.parse(NOW);
  const service = createService({ projectPath: root, spawn: fake.spawn, now: () => clock, ...options });
  t.after(async () => {
    await service.close();
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
    assert.ok(relative.startsWith('deepmine-service-test-') && !relative.includes(path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, fake, service, moveClock: ms => { clock += ms; }, async job(index = 0) { await until(() => fake.jobs[index]?.finished, 'child stdin'); return fake.jobs[index]; }, async status(value = snapshot(), date = DATE, wanted = 'ready') { let answer; await until(async () => { answer = await service.get(value, date); return answer.status === wanted; }, wanted); return answer; } };
}

test('get returns pending promptly and runs exactly one selected-day background job', async t => {
  const f = await fixture(t); const state = snapshot();
  const response = await f.service.get(state, DATE); assert.equal(response.status, 'pending'); assert.deepEqual(response.items, []);
  const job = await f.job(); assert.equal((await f.service.get(state, DATE)).status, 'pending'); assert.equal(f.fake.jobs.length, 1);
  await job.complete(); const ready = await f.status();
  assert.equal(ready.items.length, 1); assert.equal(ready.items[0].source, 'ai'); assert.equal(ready.items[0].projectId, state.project.id); assert.equal(ready.items[0].date, DATE);
  assert.equal(ready.items[0].generatedAt, new Date(NOW).toISOString()); assert.deepEqual(ready.items[0].result, result());
});

test('only submitted title, relative paths and hashes enter the bounded stdin prompt', async t => {
  const f = await fixture(t); const state = snapshot(); state.prompt = 'PRIVATE_CONVERSATION'; state.project.absolutePath = 'C:/PRIVATE_LOCATION';
  state.days[0].evidence[0].files[0].content = 'PRIVATE_SOURCE'; state.days[0].evidence[0].diff = 'PRIVATE_DIFF';
  await f.service.get(state, DATE); const job = await f.job();
  assert.ok(job.input.includes('src/mining.js')); assert.ok(job.input.includes(state.days[0].evidence[0].hash));
  for (const secret of ['PRIVATE_CONVERSATION', 'PRIVATE_LOCATION', 'PRIVATE_SOURCE', 'PRIVATE_DIFF', 'inputTokens', 'collectedAt']) assert.equal(job.input.includes(secret), false);
  assert.ok(job.input.includes('不可信数据')); assert.ok(job.input.includes('不得宣称未证实')); assert.ok(Buffer.byteLength(job.input) < 128 * 1024);
});

test('the CLI runs without shell, tools, parent thread attachment, or a repository working directory', async t => {
  const f = await fixture(t, { codexPath: 'C:/configured/codex.exe', model: 'configured-model', env: { PATH: 'safe-path', CODEX_HOME: '/auth/home', OPENAI_API_KEY: 'preserved-login-env', CODEX_THREAD_ID: 'parent', CODEX_SESSION_ID: 'session', CODEX_APP_TOOLS_PIPE_PATH: 'pipe', CODEX_MCP_NODE_PATH: 'parent-tools' } });
  await f.service.get(snapshot(), DATE); const job = await f.job();
  assert.equal(job.command, 'C:/configured/codex.exe'); assert.equal(job.options.shell, false); assert.equal(job.options.windowsHide, true);
  assert.equal(job.options.env.CODEX_HOME, '/auth/home'); assert.equal(job.options.env.PATH, 'safe-path'); assert.equal(job.options.env.OPENAI_API_KEY, 'preserved-login-env');
  assert.equal(job.options.env.CODEX_THREAD_ID, undefined); assert.equal(job.options.env.CODEX_SESSION_ID, undefined); assert.equal(job.options.env.CODEX_APP_TOOLS_PIPE_PATH, undefined); assert.equal(job.options.env.CODEX_MCP_NODE_PATH, undefined);
  assert.equal(job.args[job.args.indexOf('-s') + 1], 'read-only'); assert.equal(job.args[job.args.indexOf('--model') + 1], 'configured-model');
  for (const argument of ['--ephemeral', '--ignore-user-config', '--skip-git-repo-check', 'web_search="disabled"', 'mcp_servers={}', 'project_doc_max_bytes=0', 'model_providers.openai.supports_websockets=false']) assert.ok(job.args.includes(argument));
  for (const feature of ['shell_tool', 'apps', 'plugins', 'hooks', 'multi_agent', 'browser_use', 'computer_use', 'image_generation']) assert.ok(job.args.some((arg, index) => arg === '--disable' && job.args[index + 1] === feature));
  assert.notEqual(job.options.cwd, f.root); assert.equal(path.relative(f.root, job.options.cwd).startsWith('..'), true); assert.deepEqual(await fs.readdir(job.options.cwd), []);
  const schema = JSON.parse(await fs.readFile(job.schema, 'utf8'));
  assert.deepEqual(schema, transportSchema()); assert.deepEqual(schema.required, D.outputSchema.required); assert.deepEqual(schema.properties.objectType.enum, D.itemTypes);
  assert.equal(schema.additionalProperties, false); assert.equal(schema.properties.evidenceIds.uniqueItems, undefined);
});

test('token-only changes reuse memory and disk cache without new AI calls', async t => {
  const f = await fixture(t); const state = snapshot(); await f.service.get(state, DATE); await (await f.job()).complete(); await f.status();
  const changed = clone(state); changed.days[0].usage.inputTokens += 100; changed.days[0].usage.totalTokens += 100; changed.collectedAt = '2026-11-17T06:00:00Z';
  const reused = await f.service.get(changed, DATE); assert.equal(reused.status, 'ready'); assert.equal(f.fake.jobs.length, 1);
  reused.items[0].result.name = 'mutated response'; assert.equal((await f.service.get(changed, DATE)).items[0].result.name, result().name);
  await f.service.close(); const other = createService({ projectPath: f.root, spawn() { throw new Error('cache should avoid process'); } }); t.after(() => other.close());
  const disk = await other.get(changed, DATE); assert.equal(disk.status, 'ready'); assert.equal(disk.items[0].result.name, result().name);
});

test('any Git evidence change invalidates prior cache and never returns the stale item', async t => {
  const f = await fixture(t); const state = snapshot(); await f.service.get(state, DATE); await (await f.job()).complete(); const original = await f.status();
  const changed = clone(state); changed.days[0].evidence[0].title = '补充矿井音频';
  const answer = await f.service.get(changed, DATE); assert.equal(answer.status, 'pending'); assert.deepEqual(answer.items, []); assert.notEqual(answer.fingerprint, original.fingerprint);
  await (await f.job(1)).complete(result(changed)); assert.equal((await f.status(changed)).fingerprint, D.fingerprint(changed, DATE));
});

test('other selected dates return busy with no queued batch, and can generate on a later poll', async t => {
  const f = await fixture(t); const state = snapshot(), prior = clone(state.days[0]); prior.date = '2026-11-16'; prior.evidence[0].timestamp = prior.date + 'T10:00:00+08:00'; prior.evidence[0].hash = 'a'.repeat(40); prior.evidence[0].id = 'prior'; prior.evidence[0].shortHash = 'aaaaaaaa'; state.days.unshift(prior);
  await f.service.get(state, DATE); const first = await f.job();
  assert.equal((await f.service.get(state, prior.date)).status, 'busy'); assert.equal(f.fake.jobs.length, 1);
  await first.complete(result()); await f.status(state); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(f.fake.jobs.length, 1);
  assert.equal((await f.service.get(state, prior.date)).status, 'pending'); await f.job(1); assert.equal(f.fake.jobs.length, 2);
});

test('missing Git, empty days, empty commits and invalid dates never launch AI', async t => {
  const f = await fixture(t); const state = snapshot();
  const missing = clone(state); missing.sources.git.status = 'missing';
  const empty = clone(state); empty.days[0].evidence = [];
  const noFiles = clone(state); noFiles.days[0].evidence[0].files = [];
  for (const value of [missing, empty, noFiles]) { const answer = await f.service.get(value, DATE); assert.equal(answer.status, 'unavailable'); assert.deepEqual(answer.items, []); }
  assert.equal((await f.service.get(state, 'invalid')).reason, 'invalid_input'); assert.equal((await f.service.get(state, '2026-11-15')).reason, 'no_evidence'); assert.equal(f.fake.jobs.length, 0);
});

test('cache envelopes with wrong dates, projects, fingerprints, or foreign citations are rejected', async t => {
  const f = await fixture(t); const state = snapshot(); await f.service.get(state, DATE); await (await f.job()).complete(); await f.status(); await f.service.close();
  const cache = path.join(f.root, '.deepmine', 'ai'); const file = (await fs.readdir(cache)).find(name => !name.startsWith('.') && name.endsWith('.json'));
  const original = JSON.parse(await fs.readFile(path.join(cache, file), 'utf8'));
  for (const mutate of [value => { value.date = '2026-11-16'; }, value => { value.projectId = 'another'; }, value => { value.fingerprint = '0'.repeat(64); }, value => { value.result.evidenceIds = ['f'.repeat(40)]; }, value => { value.source = 'demo'; }, value => { value.generatedAt = 'not-a-date'; }]) {
    const poisoned = clone(original); mutate(poisoned); await fs.writeFile(path.join(cache, file), JSON.stringify(poisoned));
    const next = createService({ projectPath: f.root, spawn: driver().spawn });
    try { const answer = await next.get(state, DATE); assert.equal(answer.status, 'pending'); assert.deepEqual(answer.items, []); } finally { await next.close(); }
  }
});

test('foreign or malformed model results fail validation and remain visibly non-AI', async t => {
  const f = await fixture(t); await f.service.get(snapshot(), DATE); await (await f.job()).complete({ ...result(), evidenceIds: ['f'.repeat(40)] });
  const answer = await f.status(snapshot(), DATE, 'error'); assert.equal(answer.reason, 'invalid_result'); assert.deepEqual(answer.items, []);
  const files = await fs.readdir(path.join(f.root, '.deepmine', 'ai')); assert.equal(files.some(name => !name.startsWith('.') && name.endsWith('.json')), false);
});

test('failed generation is cooled down across repeated polling and may retry after expiry', async t => {
  const f = await fixture(t, { cooldownMs: 1000 }); await f.service.get(snapshot(), DATE);
  const job = await f.job();
  // Pause a poll after it has checked memory but before the disk cache responds.
  const lstat = fs.lstat;
  let reading = false, resume;
  const gate = new Promise(resolve => { resume = resolve; });
  t.mock.method(fs, 'lstat', async (file, ...args) => {
    if (!reading && path.dirname(file) === path.dirname(job.output) && /^[a-f0-9]{64}\.json$/.test(path.basename(file))) {
      reading = true;
      await gate;
    }
    return lstat(file, ...args);
  });
  const polling = f.service.get(snapshot(), DATE);
  try {
    await until(() => reading, 'concurrent cache read');
    job.fail(1);
    await f.status(snapshot(), DATE, 'error');
  } finally { resume(); }
  assert.equal((await polling).status, 'error');
  const first = await f.status(snapshot(), DATE, 'error'); assert.equal(first.reason, 'cli_failed');
  for (let i = 0; i < 10; i++) assert.equal((await f.service.get(snapshot(), DATE)).status, 'error');
  assert.equal(f.fake.jobs.length, 1); f.moveClock(1001); assert.equal((await f.service.get(snapshot(), DATE)).status, 'pending'); await f.job(1); assert.equal(f.fake.jobs.length, 2);
});

test('missing executable returns unavailable and sanitized diagnostics rather than CLI details', async t => {
  const f = await fixture(t, { spawn() { const error = new Error('PRIVATE_PROVIDER_DETAIL'); error.code = 'ENOENT'; throw error; } });
  await f.service.get(snapshot(), DATE); const answer = await f.status(snapshot(), DATE, 'unavailable');
  assert.equal(answer.reason, 'cli_missing'); assert.equal(JSON.stringify(answer).includes('PRIVATE_PROVIDER_DETAIL'), false);
});

test('deadline kills the child, reports timeout, and cleans its schema, result and empty cwd', async t => {
  const f = await fixture(t, { deadlineMs: 30 }); await f.service.get(snapshot(), DATE); const job = await f.job();
  const answer = await f.status(snapshot(), DATE, 'error'); assert.equal(answer.reason, 'timeout'); assert.ok(answer.message.includes('三分钟')); assert.equal(job.killed, true);
  await until(async () => { try { await fs.access(job.options.cwd); return false; } catch { return true; } }, 'temporary cleanup');
  assert.deepEqual(await fs.readdir(path.join(f.root, '.deepmine', 'ai')), []);
});

test('bounded stdout and stderr cause cancellation without retaining or returning their text', async t => {
  const f = await fixture(t, { maxOutputBytes: 128 }); await f.service.get(snapshot(), DATE); const job = await f.job();
  job.child.stderr.write('PRIVATE_PROVIDER_OUTPUT'.repeat(20)); const answer = await f.status(snapshot(), DATE, 'error');
  assert.equal(job.killed, true); assert.equal(answer.reason, 'output_limit'); assert.equal(JSON.stringify(answer).includes('PRIVATE_PROVIDER_OUTPUT'), false);
});

test('oversized result files are rejected before parsing', async t => {
  const f = await fixture(t); await f.service.get(snapshot(), DATE); const job = await f.job();
  await fs.writeFile(job.output, ' '.repeat(65537)); job.child.emit('close', 0);
  const answer = await f.status(snapshot(), DATE, 'error'); assert.equal(answer.reason, 'output_limit'); assert.deepEqual(answer.items, []);
});

test('close cancels pending generation, awaits cleanup, and makes subsequent calls inert', async t => {
  const f = await fixture(t); await f.service.get(snapshot(), DATE); const job = await f.job(); await f.service.close();
  assert.equal(job.killed, true); await assert.rejects(fs.access(job.options.cwd), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(path.join(f.root, '.deepmine', 'ai')), []); assert.equal((await f.service.get(snapshot(), DATE)).reason, 'closed'); await f.service.close();
});

test('close during pre-spawn setup never allows a child to escape afterward', async t => {
  const f = await fixture(t); await f.service.get(snapshot(), DATE); await f.service.close(); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(f.fake.jobs.length, 0);
});

test('large metadata is rejected before spending a model call', async t => {
  const f = await fixture(t); const state = snapshot();
  state.days[0].evidence[0].files = Array.from({ length: 100 }, (_, index) => ({ path: `src/${index}/` + 'a'.repeat(1800) + '.js', kind: 'code' }));
  const answer = await f.service.get(state, DATE); assert.equal(answer.status, 'unavailable'); assert.equal(answer.reason, 'input_limit'); assert.equal(f.fake.jobs.length, 0);
});

test('cache path occupied by a file fails without running the model', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.root, '.deepmine'), 'occupied');
  const answer = await f.service.get(snapshot(), DATE); assert.equal(answer.status, 'unavailable'); assert.equal(answer.reason, 'cache_unavailable'); assert.equal(f.fake.jobs.length, 0);
});

test('an explicit application cache path leaves an externally observed project untouched', async t => {
  const f = await fixture(t); await f.service.close();
  const observed = path.join(f.root, 'external-repository'), app = path.join(f.root, 'application'); await fs.mkdir(observed); await fs.mkdir(app);
  const cachePath = path.join(app, '.deepmine', 'ai'), fake = driver();
  const service = createService({ projectPath: observed, cachePath, spawn: fake.spawn }); t.after(() => service.close());
  assert.equal((await service.get(snapshot(), DATE)).status, 'pending'); await until(() => fake.jobs[0]?.finished); await fake.jobs[0].complete();
  await until(async () => (await service.get(snapshot(), DATE)).status === 'ready'); await service.close();
  assert.deepEqual(await fs.readdir(observed), []); assert.equal((await fs.readdir(cachePath)).filter(name => name.endsWith('.json')).length, 1);
});

test('CLI path fallback only accepts the expected executable name from desktop environment', async t => {
  const invalid = await fixture(t, { env: { CODEX_APP_RUNTIME_CLI_PATH: '/app/helper-server.exe' } }); await invalid.service.get(snapshot(), DATE);
  assert.equal((await invalid.job()).command, process.platform === 'win32' ? 'codex.exe' : 'codex');
  const valid = await fixture(t, { env: { CODEX_APP_RUNTIME_CLI_PATH: path.resolve('codex.exe') } }); await valid.service.get(snapshot(), DATE); assert.equal((await valid.job()).command, path.resolve('codex.exe'));
});

test('pure prompt, environment and argument helpers preserve boundaries without mutating inputs', () => {
  const input = D.buildInput(snapshot(), DATE), before = clone(input); buildPrompt(input); assert.deepEqual(input, before);
  const env = { Path: 'retained', CODEX_HOME: '/home', CODEX_TOOL_CALL_ID: 'call', SESSION_ID: 'session', CODEX_TASK_WORKSPACE_VERIFYING_IDENTITY: 'parent', CODEX_APP_RUNTIME_CLI_PATH: '/app/codex', CODEX_APP_SERVER_ADDRESS: 'parent' };
  assert.deepEqual(childEnvironment(env), { Path: 'retained', CODEX_HOME: '/home' }); assert.equal(env.SESSION_ID, 'session');
  const args = cliArguments('schema.json', 'result.json', 'empty-directory'); assert.equal(args.includes('--model'), false); assert.equal(args.at(-1), '-');
  assert.equal(transportSchema().properties.name.maxLength, undefined); assert.equal(D.outputSchema.properties.name.maxLength, 24);
});

test('transport schema compatibility never relaxes local length, uniqueness or extra-field validation', async t => {
  for (const invalid of [{ ...result(), name: '名'.repeat(25) }, { ...result(), evidenceIds: [result().evidenceIds[0], result().evidenceIds[0]] }, { ...result(), unsupported: true }]) {
    const f = await fixture(t); await f.service.get(snapshot(), DATE); await (await f.job()).complete(invalid);
    assert.equal((await f.status(snapshot(), DATE, 'error')).reason, 'invalid_result');
  }
});

test('real child-process pipe and output-file integration uses no shell or real user data', async t => {
  const f = await fixture(t); await f.service.close();
  const script = path.join(f.root, 'fixture-child.cjs');
  await fs.writeFile(script, "const fs = require('node:fs'); let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => { if (!input.includes('不可信数据')) process.exit(2); fs.writeFileSync(process.env.TEST_RESULT_FILE, process.env.TEST_RESULT_JSON); });");
  let calls = 0;
  const service = createService({ projectPath: f.root, spawn(_command, args, options) { calls++; assert.equal(options.shell, false); return spawn(process.execPath, [script], { ...options, env: { ...options.env, TEST_RESULT_FILE: args[args.indexOf('-o') + 1], TEST_RESULT_JSON: JSON.stringify(result()) } }); } });
  t.after(() => service.close()); assert.equal((await service.get(snapshot(), DATE)).status, 'pending');
  let answer; await until(async () => { answer = await service.get(snapshot(), DATE); return answer.status === 'ready'; }, 'real process'); assert.equal(calls, 1); assert.equal(answer.items[0].result.objectType, 'pickaxe'); await service.close();
});
