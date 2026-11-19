'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const A = require('../scripts/source-adapters.cjs');
const { collect } = require('../scripts/collector.cjs');
const NOW = new Date('2026-11-18T04:00:00Z'), dates = ['2026-11-17', '2026-11-18'];
function claude(changes = {}) {
  return { type: 'assistant', cwd: '/work/project', sessionId: 's1', timestamp: '2026-11-18T02:00:00Z', requestId: 'req_1', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'PRIVATE_BODY_SENTINEL' }], usage: { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: 5 } }, ...changes };
}
function imported(changes = {}) { return { schemaVersion: 1, id: 'call-1', source: 'my-editor', projectPath: '/work/project', timestamp: '2026-11-18T02:00:00Z', sessionId: 's1', usage: { inputTokens: 100, cachedInputTokens: 60, outputTokens: 10, totalTokens: 110 }, ...changes }; }
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepmine-adapter-'));
  t.after(() => { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('deepmine-adapter-')) throw new Error('Unexpected test path'); fs.rmSync(root, { recursive: true, force: true }); });
  const projectPath = path.join(root, 'project'); fs.mkdirSync(projectPath);
  return { root, projectPath, scopePath: projectPath, claudeRoot: path.join(root, 'claude'), codexRoot: path.join(root, 'codex') };
}
function write(file, values) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n') + '\n'); }
test('Windows, macOS and Linux defaults use home and explicit environment overrides', () => {
  assert.deepEqual(A.defaults('C:\\Users\\person', {}, 'win32'), { codexRoot: 'C:\\Users\\person\\.codex', claudeRoot: 'C:\\Users\\person\\.claude' });
  assert.equal(A.defaults('/Users/person', {}, 'darwin').claudeRoot, '/Users/person/.claude');
  assert.equal(A.defaults('/home/person', {}, 'linux').codexRoot, '/home/person/.codex');
  assert.deepEqual(A.defaults('/home/person', { CODEX_HOME: '/logs/codex', CLAUDE_CONFIG_DIR: '/logs/claude' }, 'linux'), { codexRoot: '/logs/codex', claudeRoot: '/logs/claude' });
});
test('Claude cache read and cache creation are included once in total input, with no body retained', () => {
  const event = A.claudeEvent(claude(), '/work/project');
  assert.deepEqual(event.usage, { inputTokens: 130, cachedInputTokens: 100, cacheWriteInputTokens: 20, outputTokens: 5, totalTokens: 135, reasoningOutputTokens: null });
  assert.ok(!JSON.stringify(event).includes('PRIVATE_BODY_SENTINEL'));
  assert.equal(A.claudeEvent(claude({ cwd: '/work/project-other' }), '/work/project'), null);
  assert.equal(A.claudeEvent(claude({ type: 'user' }), '/work/project'), null);
});
test('missing cache counters remain unknown; malformed and unscoped counters are rejected', () => {
  const raw = claude(); delete raw.message.usage.cache_creation_input_tokens;
  const event = A.claudeEvent(raw, '/work/project'); assert.equal(event.usage.totalTokens, null); assert.equal(event.partial, true);
  raw.message.usage.output_tokens = -1; assert.deepEqual(A.claudeEvent(raw, '/work/project'), { invalid: true });
  assert.deepEqual(A.claudeEvent(claude({ sessionId: '' }), '/work/project'), { invalid: true });
});
test('Claude repeated message and request records count once; streaming output growth uses final count', () => {
  const first = claude(), second = claude(); second.message.usage.output_tokens = 9;
  const events = [first, second, second].map(raw => A.claudeEvent(raw, '/work/project'));
  const result = A.aggregate(events, dates, NOW, 'claude-code', 'claude');
  assert.equal(result.events, 1); assert.equal(result.days[1].usage.totalTokens, 139); assert.equal(result.days[1].usage.sessions, 1);
});
test('a transcript copy missing requestId still deduplicates by assistant message id', () => {
  const raw = claude(), copy = claude(); delete copy.requestId;
  const result = A.aggregate([copy, raw].map(row => A.claudeEvent(row, '/work/project')), dates, NOW, 'claude-code', 'claude');
  assert.equal(result.events, 1); assert.equal(result.days[1].usage.totalTokens, 135);
});
test('conflicting identifiers are excluded rather than counted twice; distinct subagent calls are counted', () => {
  const raw = claude(), duplicate = claude({ sessionId: 'different-session' });
  let result = A.aggregate([raw, duplicate].map(row => A.claudeEvent(row, '/work/project')), dates, NOW, 'claude-code', 'claude');
  assert.equal(result.events, 0); assert.equal(result.partial, true); assert.equal(result.days[1].usage.totalTokens, null);
  const subagent = claude({ requestId: 'req_2' }); subagent.message.id = 'msg_2';
  result = A.aggregate([raw, subagent].map(row => A.claudeEvent(row, '/work/project')), dates, NOW, 'claude-code', 'claude'); assert.equal(result.days[1].usage.totalTokens, 270);
});
test('Shanghai midnight and future timestamps are assigned without importing future use', () => {
  const early = claude({ timestamp: '2026-11-17T15:59:59Z' }), later = claude({ requestId: 'req_2', timestamp: '2026-11-17T16:00:00Z' }), future = claude({ requestId: 'req_3', timestamp: '2026-11-19T01:00:00Z' });
  later.message.id = 'msg_2'; future.message.id = 'msg_3';
  const result = A.aggregate([early, later, future].map(row => A.claudeEvent(row, '/work/project')), dates, NOW, 'claude-code', 'claude');
  assert.deepEqual(result.days.map(day => day.usage.totalTokens), [135, 135]);
});
test('the configured timezone controls imported and Claude daily buckets', () => {
  const event = A.claudeEvent(claude({ timestamp: '2026-11-18T02:00:00Z' }), '/work/project');
  const result = A.aggregate([event], dates, NOW, 'claude-code', 'claude', false, 'America/Los_Angeles');
  assert.deepEqual(result.days.map(day => day.usage.totalTokens), [135, 0]);
});
test('generic import requires exact project, per-call schema, overlap identities and non-native source', () => {
  assert.equal(A.importEvent(imported(), '/work/project').usage.totalTokens, 110);
  assert.equal(A.importEvent(imported({ projectPath: '/work/project/subdir' }), '/work/project'), null);
  for (const source of ['codex', 'claude-code', 'claude']) assert.deepEqual(A.importEvent(imported({ source }), '/work/project'), { invalid: true });
  assert.deepEqual(A.importEvent(imported({ cumulative: true }), '/work/project'), { invalid: true });
  assert.deepEqual(A.importEvent(imported({ usage: { inputTokens: 100, cachedInputTokens: 110, outputTokens: 10, totalTokens: 110 } }), '/work/project'), { invalid: true });
  assert.deepEqual(A.importEvent(imported({ timestamp: '2026-11-18' }), '/work/project'), { invalid: true });
});
test('generic repeated ids dedupe and conflicting replacement cannot inflate totals', () => {
  const raw = imported(), event = A.importEvent(raw, '/work/project');
  assert.equal(A.aggregate([event, event], dates, NOW, 'import:my-editor', 'import').days[1].usage.totalTokens, 110);
  const changed = A.importEvent(imported({ usage: { inputTokens: 200, cachedInputTokens: 60, outputTokens: 10, totalTokens: 210 } }), '/work/project');
  const result = A.aggregate([event, changed], dates, NOW, 'import:my-editor', 'import'); assert.equal(result.days[1].usage.totalTokens, null); assert.equal(result.partial, true);
});
test('scoped filesystem collection includes nested subagents and ignores other project and prompt rows', async t => {
  const config = fixture(t), raw = claude({ cwd: config.projectPath });
  write(path.join(config.claudeRoot, 'projects', 'encoded', 'session.jsonl'), [raw, claude({ type: 'user', cwd: config.projectPath }), claude({ cwd: path.join(config.root, 'outside') })]);
  write(path.join(config.claudeRoot, 'projects', 'encoded', 'session', 'subagents', 'agent.jsonl'), [raw]);
  const results = await A.collectAdditional({ ...config, dates, now: NOW });
  assert.equal(results[0].source.status, 'connected'); assert.equal(results[0].days[1].usage.totalTokens, 135);
  assert.ok(!JSON.stringify(results).includes('PRIVATE_BODY_SENTINEL')); assert.ok(!JSON.stringify(results).includes(config.projectPath));
});
test('empty/missing logs remain unknown; invalid lines are diagnosed and imports do not mix projects', async t => {
  const config = fixture(t), file = path.join(config.root, 'usage.ndjson');
  write(file, [imported({ projectPath: config.projectPath }), imported({ id: 'other-call', projectPath: config.root }), '{broken']);
  const results = await A.collectAdditional({ ...config, usageImports: [file], dates, now: NOW });
  assert.equal(results[0].source.status, 'missing'); assert.ok(results[0].days.every(day => day.usage.totalTokens === null));
  assert.equal(results[1].source.status, 'partial'); assert.equal(results[1].days[1].usage.totalTokens, 110);
});
test('known source totals combine while missing or disabled sources never become zero providers', () => {
  const event = A.claudeEvent(claude(), '/work/project'), observed = A.aggregate([event], dates, NOW, 'claude-code', 'claude');
  const missing = { days: dates.map(date => ({ date, usage: A.emptyUsage(false) })) };
  const combined = A.combineUsage([observed, missing], dates); assert.equal(combined[1].usage.totalTokens, 135); assert.equal(combined[1].usage.quality, 'observed');
  assert.equal(A.combineUsage([missing], dates)[1].usage.totalTokens, null);
});
test('Codex-style totals, Claude cache-expanded totals, and imported calls combine without adding cache twice', () => {
  const native = { days: dates.map(date => ({ date, usage: { inputTokens: 100, cachedInputTokens: 60, outputTokens: 10, totalTokens: 110, reasoningOutputTokens: 2, cacheWriteInputTokens: 0, sessions: 1, quality: 'observed' } })) };
  const claudeTotals = A.aggregate([A.claudeEvent(claude(), '/work/project')], dates, NOW, 'claude-code', 'claude');
  const imports = A.aggregate([A.importEvent(imported(), '/work/project')], dates, NOW, 'import:my-editor', 'import');
  const usage = A.combineUsage([native, claudeTotals, imports], dates)[1].usage;
  assert.equal(usage.inputTokens, 330); assert.equal(usage.cachedInputTokens, 220); assert.equal(usage.outputTokens, 25); assert.equal(usage.totalTokens, 355); assert.equal(usage.sessions, 3); assert.equal(usage.reasoningOutputTokens, null);
});
test('collector keeps Codex algorithm and normalizes Claude-only use without pretending Git outputs exist', async t => {
  const config = fixture(t); write(path.join(config.claudeRoot, 'projects', 'encoded', 'session.jsonl'), [claude({ cwd: config.projectPath })]);
  const snapshot = await collect({ ...config, now: NOW });
  assert.equal(snapshot.usageSources.find(source => source.id === 'codex').status, 'missing');
  assert.equal(snapshot.usageSources.find(source => source.id === 'claude-code').status, 'connected');
  assert.equal(snapshot.days.at(-1).usage.totalTokens, 135); assert.match(snapshot.sources.codex.method, /兼容字段名/);
  assert.ok(snapshot.days.every(day => !day.evidence.length));
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE_BODY_SENTINEL'));
});
