'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const C = require('../scripts/collector.cjs');
const NOW = new Date('2026-11-17T04:00:00.000Z');
const DATES = C.dateWindow(NOW);
const scope = 'C:/workspace/project';
const rawUsage = (input = 100, output = 10, cached = 60, reasoning = 3) => ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output });
const metaRaw = (id = 'session-1', cwd = scope, source = 'vscode', timestamp = '2026-11-16T12:00:00Z') => ({ timestamp, ordinal: 0, type: 'session_meta', payload: { id, cwd, source } });
const eventRaw = (total = rawUsage(), last = total, timestamp = '2026-11-16T13:00:00Z', ordinal = 1) => ({ timestamp, ordinal, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last } } });
const parsedSession = (events, metadata = metaRaw()) => ({ meta: C.parseMetadata(metadata, scope), events: events.map(C.parseTokenEvent), partial: false });
const aggregate = sessions => C.aggregateSessions(sessions, DATES, NOW);
const usage = (result, date = '2026-11-16') => result.days.find(day => day.date === date).usage;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepmine-collector-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectPath = path.join(root, 'project');
  const codexRoot = path.join(root, 'codex');
  fs.mkdirSync(projectPath);
  return { root, projectPath, scopePath: projectPath, codexRoot, now: NOW };
}
function writeSession(config, rows, filename = 'session.jsonl', folder = 'sessions') {
  const directory = path.join(config.codexRoot, folder, '2026', '11', '16');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, filename), rows.map(row => typeof row === 'string' ? row : JSON.stringify(row)).join('\n') + '\n');
}

test('Windows scope comparison is case-insensitive and requires a path boundary', () => {
  assert.equal(C.inScope('c:\\WORKSPACE\\Project\\child', scope), true);
  assert.equal(C.inScope('C:/workspace/project-other', scope), false);
  assert.equal(C.inScope('C:/workspace/project/../elsewhere', scope), false);
  assert.equal(C.inScope(undefined, scope), false);
  assert.equal(C.inScope(scope, scope), true);
});

test('turns in another project only advance the baseline and cannot claim the selected project’s tokens',async t=>{
  const f=fixture(t), context=cwd=>({type:'turn_context',payload:{cwd}});
  const totals=n=>rawUsage(n,n/10,0,0);
  writeSession(f,[metaRaw('switched',f.scopePath),eventRaw(totals(100),totals(100)),
    context(path.join(f.root,'sibling')),
    eventRaw(totals(300),totals(200),'2026-11-16T13:01:00Z',2),
    context(f.scopePath),eventRaw(totals(300),totals(200),'2026-11-16T13:02:00Z',3),
    eventRaw(totals(350),totals(50),'2026-11-16T13:03:00Z',4),
    context(path.join(f.root,'sibling')),context(f.scopePath),
    eventRaw(totals(700),totals(20),'2026-11-16T13:04:00Z',5)]);
  const result=await C.collect(f),day=result.days.find(d=>d.date==='2026-11-16');
  assert.equal(day.usage.totalTokens,187);
  assert.equal(day.sourceTokenTotals.codex,187);
  assert.equal(result.sources.codex.events,3);
  assert.equal(day.usage.quality,'partial');
});

test('project identities hash normalized paths and never expose absolute paths', () => {
  const a = C.projectIdentity(scope), b = C.projectIdentity('c:\\WORKSPACE\\project\\');
  assert.deepEqual(a, b);
  assert.match(a.id, /^[a-f0-9]{16}$/);
  assert.equal(a.label, 'project');
  assert.notEqual(a.id, C.projectIdentity('C:/workspace/another').id);
});

test('recorded POSIX, UNC and extended Windows session paths use their own directory boundaries',()=>{
  assert.equal(C.inScope('\\\\?\\C:\\Work\\Selected\\sub','c:/work/selected'),true);
  assert.equal(C.inScope('\\\\?\\UNC\\Office\\Share\\Work','//office/share'),true);
  assert.equal(C.inScope('\\\\?\\C:\\Work\\Selected-old','C:/work/selected'),false);
  assert.equal(C.inScope('/home/A/work/child','/home/A/work'),true);
  assert.equal(C.inScope('/home/a/work','/home/A/work'),false);
  assert.equal(C.inScope('/home/A/work\\other','/home/A/work'),false);
  assert.equal(C.inScope('.','.'),false);
  assert.equal(C.inScope('C:relative','C:/'),false);
  assert.equal(C.inScope('//server/share','/'),false);
});

test('Shanghai day window always contains exactly the latest 14 dates', () => {
  assert.equal(C.dateOf('2026-11-16T15:59:59Z'), '2026-11-16');
  assert.equal(C.dateOf('2026-11-16T16:00:00Z'), '2026-11-17');
  assert.equal(DATES.length, 14);
  assert.equal(DATES[0], '2026-11-04');
  assert.equal(DATES.at(-1), '2026-11-17');
  assert.throws(() => C.dateOf('invalid'), /时间/);
});

test('token schema retains cache and reasoning as subsets, never extra usage', () => {
  const parsed = C.parseTokenEvent(eventRaw());
  assert.equal(parsed.total.totalTokens, 110);
  assert.equal(parsed.total.cachedInputTokens, 60);
  assert.equal(parsed.total.reasoningOutputTokens, 3);
  const result = usage(aggregate([parsedSession([eventRaw()])]));
  assert.equal(result.totalTokens, 110);
  assert.equal(result.inputTokens + result.outputTokens, 110);
});

test('invalid or inconsistent token counters are not accepted as facts', () => {
  for (const patch of [{ input_tokens: -1 }, { output_tokens: Infinity }, { total_tokens: 999 }, { cached_input_tokens: 101 }, { reasoning_output_tokens: 11 }, { input_tokens: '100' }]) assert.equal(C.counters({ ...rawUsage(), ...patch }), null);
  assert.equal(C.parseTokenEvent({ ...eventRaw(), timestamp: 'invalid' }), null);
  assert.equal(C.parseTokenEvent({ ...eventRaw(), type: 'response_item' }), null);
  assert.equal(C.parseTokenEvent({ ...eventRaw(), payload: { type: 'token_count', info: null } }), null);
});

test('missing optional measurements remain unknown, never fabricated zero', () => {
  const raw = rawUsage();
  delete raw.cached_input_tokens;
  delete raw.reasoning_output_tokens;
  delete raw.cache_write_input_tokens;
  const result = aggregate([parsedSession([eventRaw(raw)])]);
  assert.equal(usage(result).cachedInputTokens, null);
  assert.equal(usage(result).reasoningOutputTokens, null);
  assert.equal(usage(result).totalTokens, 110);
  assert.equal(usage(result).quality, 'partial');
});

test('repeated cumulative snapshots do not multiply last-call usage', () => {
  const result = aggregate([parsedSession([
    eventRaw(), eventRaw(rawUsage(), rawUsage(), '2026-11-16T13:01:00Z', 2),
    eventRaw(rawUsage(150, 15, 90, 4), rawUsage(50, 5, 30, 1), '2026-11-16T13:02:00Z', 3)
  ])]);
  assert.equal(usage(result).totalTokens, 165);
  assert.equal(result.events, 2);
  assert.ok(result.notes.some(note => /重复/.test(note)));
});

test('active and archived copies with the same session ID are deduplicated', () => {
  const session = parsedSession([eventRaw(), eventRaw(rawUsage(150, 15, 90, 4), rawUsage(50, 5, 30, 1), '2026-11-16T14:00:00Z', 2)]);
  const result = aggregate([session, structuredClone(session)]);
  assert.equal(result.sessions, 1);
  assert.equal(result.events, 2);
  assert.equal(usage(result).totalTokens, 165);
});

test('different workers with identical numeric counters remain separate real usage', () => {
  const source = { subagent: { thread_spawn: { parent_thread_id: 'root', depth: 1 } } };
  const result = aggregate([
    parsedSession([eventRaw()], metaRaw('worker-a', scope, source)),
    parsedSession([eventRaw()], metaRaw('worker-b', scope, source))
  ]);
  assert.equal(result.sessions, 2);
  assert.equal(usage(result).sessions, 2);
  assert.equal(usage(result).totalTokens, 220);
});

test('guardian and unknown subagent sources are excluded', () => {
  const guardian = parsedSession([eventRaw()], metaRaw('guardian', scope, { subagent: { other: 'guardian' } }));
  const unknown = parsedSession([eventRaw()], metaRaw('unknown', scope, { subagent: { custom: true } }));
  const result = aggregate([guardian, unknown, parsedSession([eventRaw()])]);
  assert.equal(result.sessions, 1);
  assert.equal(usage(result).totalTokens, 110);
});

test('forked inherited history before creation is a baseline, not new usage', () => {
  const fork = parsedSession([
    eventRaw(rawUsage(1000, 100, 600, 30), rawUsage(100, 10, 60, 3), '2026-11-16T11:00:00Z', 1),
    eventRaw(rawUsage(1100, 110, 660, 33), rawUsage(), '2026-11-16T13:00:00Z', 2)
  ]);
  const result = aggregate([fork]);
  assert.equal(usage(result).totalTokens, 110);
  assert.equal(result.events, 1);
});

test('first inherited cumulative without history counts last call only and marks partial', () => {
  const result = aggregate([parsedSession([eventRaw(rawUsage(1000, 100, 600, 30), rawUsage())])]);
  assert.equal(usage(result).totalTokens, 110);
  assert.equal(result.partial, true);
  assert.equal(usage(result).quality, 'partial');
});

test('missing last-call data at an inherited first snapshot is not guessed', () => {
  const result = aggregate([parsedSession([eventRaw(rawUsage(1000, 100, 600, 30), null)])]);
  assert.equal(usage(result).totalTokens, null);
  assert.equal(usage(result).quality, 'unavailable');
  assert.equal(result.partial, true);
  assert.equal(result.events, 0);
});

test('counter resets count identifiable last call, mark partial, and rebase future deltas', () => {
  const result = aggregate([parsedSession([
    eventRaw(rawUsage(1000, 100, 600, 30)),
    eventRaw(rawUsage(), rawUsage(), '2026-11-16T14:00:00Z', 2),
    eventRaw(rawUsage(150, 15, 90, 4), rawUsage(50, 5, 30, 1), '2026-11-16T14:01:00Z', 3)
  ])]);
  assert.equal(usage(result).totalTokens, 1265);
  assert.equal(result.partial, true);
  assert.ok(result.notes.some(note => /重置/.test(note)));
});

test('cross-midnight differences retain the previous day baseline', () => {
  const result = aggregate([parsedSession([
    eventRaw(rawUsage(1000, 100, 600, 30), undefined, '2026-11-16T15:59:59Z', 1),
    eventRaw(rawUsage(1100, 110, 660, 33), rawUsage(), '2026-11-16T16:00:00Z', 2)
  ])]);
  assert.equal(usage(result).totalTokens, 1100);
  assert.equal(usage(result, '2026-11-17').totalTokens, 110);
});

test('old events establish a baseline but are not included in the 14-day total', () => {
  const result = aggregate([parsedSession([
    eventRaw(rawUsage(1000, 100, 600, 30), undefined, '2026-11-03T12:00:00Z', 1),
    eventRaw(rawUsage(1100, 110, 660, 33), rawUsage(), '2026-11-16T13:00:00Z', 2)
  ], metaRaw('old', scope, 'vscode', '2026-11-01T00:00:00Z'))]);
  assert.equal(result.days.reduce((sum, day) => sum + day.usage.totalTokens, 0), 110);
});

test('future events are ignored without advancing the saved baseline', () => {
  const result = aggregate([parsedSession([
    eventRaw(), eventRaw(rawUsage(200, 20, 120, 6), undefined, '2026-11-18T00:00:00Z', 2)
  ])]);
  assert.equal(usage(result).totalTokens, 110);
  assert.equal(result.events, 1);
});

test('conflicting duplicate ordinals cannot silently add a second event', () => {
  const result = aggregate([parsedSession([
    eventRaw(), eventRaw(rawUsage(200, 20, 120, 6), undefined, '2026-11-16T14:00:00Z', 1)
  ])]);
  assert.equal(usage(result).totalTokens, 110);
  assert.equal(result.partial, true);
});

test('no valid token snapshots is unavailable while an observed quiet day is zero', () => {
  const missing = aggregate([]);
  assert.equal(usage(missing).totalTokens, null);
  assert.equal(usage(missing).quality, 'unavailable');
  const empty = aggregate([{ meta: C.parseMetadata(metaRaw(), scope), events: [] }]);
  assert.equal(usage(empty).totalTokens, null);
  const known = aggregate([parsedSession([eventRaw()])]);
  assert.equal(usage(known, '2026-11-17').totalTokens, 0);
  assert.equal(usage(known, '2026-11-17').quality, 'observed');
});

test('record envelope classification rejects prompt and tool payload records', () => {
  assert.equal(C.envelopeKind(JSON.stringify(metaRaw())), 'meta');
  assert.equal(C.envelopeKind(JSON.stringify(eventRaw())), 'usage');
  assert.equal(C.envelopeKind(JSON.stringify({ timestamp: NOW.toISOString(), type: 'response_item', payload: { type: 'token_count', text: 'not-a-counter' } })), null);
  assert.equal(C.envelopeKind(JSON.stringify({ timestamp: NOW.toISOString(), type: 'event_msg', payload: { type: 'agent_message', text: 'token_count' } })), null);
});

test('working-tree status counts tracked and untracked files without treating them as commits', () => {
  assert.deepEqual(C.parseWorkingTree(' M src/a.js\0?? new.md\0R  renamed.js\0old.js\0AM staged.js\0'), { modified: 3, untracked: 1, status: 'observed' });
  assert.equal(C.classifyFile('nested/test.cjs'), 'code');
  assert.equal(C.classifyFile('README.md'), 'document');
  assert.equal(C.classifyFile('logo.svg'), 'asset');
  assert.equal(C.classifyFile('package.json'), 'other');
});

test('missing local sources are explicit null measurements, with 14 empty evidence buckets', async t => {
  const config = fixture(t);
  const result = await C.collect(config);
  assert.equal(result.kind, 'deepmine-evidence');
  assert.equal(result.days.length, 14);
  assert.equal(result.sources.codex.status, 'missing');
  assert.equal(result.sources.git.status, 'missing');
  assert.ok(result.days.every(day => day.usage.totalTokens === null && day.evidence.length === 0));
  assert.deepEqual(result.workingTree, { modified: null, untracked: null, status: 'unavailable' });
  assert.ok(result.warnings.length >= 2);
});

test('collector reads only scoped metadata and counters, ignoring prompts and other projects', async t => {
  const config = fixture(t);
  const secret = 'NEVER_COPY_PROMPTS_TO_SNAPSHOT';
  writeSession(config, [
    { ...metaRaw('real', config.scopePath), payload: { ...metaRaw('real', config.scopePath).payload, instructions: secret } },
    { timestamp: NOW.toISOString(), type: 'response_item', payload: { type: 'message', text: secret } },
    eventRaw()
  ]);
  writeSession(config, [metaRaw('other', path.join(config.root, 'project-other')), eventRaw(rawUsage(9000, 900, 6000, 30))], 'unrelated.jsonl');
  writeSession(config, [metaRaw('guard', config.scopePath, { subagent: { other: 'guardian' } }), eventRaw(rawUsage(9000, 900, 6000, 30))], 'guardian.jsonl');
  fs.writeFileSync(path.join(config.codexRoot, 'auth.json'), secret);
  fs.writeFileSync(path.join(config.codexRoot, 'config.toml'), secret);
  const result = await C.collect(config);
  assert.equal(result.sources.codex.status, 'connected');
  assert.equal(result.sources.codex.sessions, 1);
  assert.equal(result.days.find(day => day.date === '2026-11-16').usage.totalTokens, 110);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes(config.root.replace(/\\/g, '\\\\')), false);
});

test('an incomplete trailing token line preserves previous counts and reports partial coverage', async t => {
  const config = fixture(t);
  writeSession(config, [metaRaw('real', config.scopePath), eventRaw(), '{"timestamp":"2026-11-16T14:00:00Z","type":"event_msg","payload":{"type":"token_count","info":']);
  const result = await C.collect(config);
  assert.equal(result.sources.codex.status, 'partial');
  assert.equal(result.days.find(day => day.date === '2026-11-16').usage.totalTokens, 110);
  assert.equal(result.days.find(day => day.date === '2026-11-16').usage.quality, 'partial');
});

test('filesystem active/archive duplicates are collected once', async t => {
  const config = fixture(t);
  const rows = [metaRaw('same', config.scopePath), eventRaw()];
  writeSession(config, rows);
  writeSession(config, rows, 'copied.jsonl', 'archived_sessions');
  const result = await C.collect(config);
  assert.equal(result.sources.codex.sessions, 1);
  assert.equal(result.sources.codex.events, 1);
  assert.equal(result.days.find(day => day.date === '2026-11-16').usage.totalTokens, 110);
});

test('truncated first metadata cannot make other valid sessions look fully complete', async t => {
  const config = fixture(t);
  writeSession(config, [metaRaw('real', config.scopePath), eventRaw()]);
  writeSession(config, ['{"timestamp":"2026-11-16T14:00:00Z","type":"session_meta","payload":'], 'in-progress.jsonl');
  const result = await C.collect(config);
  assert.equal(result.sources.codex.status, 'partial');
  assert.equal(result.days.find(day => day.date === '2026-11-16').usage.totalTokens, 110);
  assert.equal(result.days.find(day => day.date === '2026-11-16').usage.quality, 'partial');
  assert.ok(result.sources.codex.notes.some(note => /归属/.test(note)));
});

test('an unreadable or empty log returns an explicit incomplete marker before metadata', async t => {
  const config = fixture(t);
  const missing = await C.readRollout(path.join(config.root, 'vanished.jsonl'), config.scopePath);
  assert.deepEqual(missing, { meta: null, events: [], partial: true });
  writeSession(config, [metaRaw('real', config.scopePath), eventRaw()]);
  writeSession(config, [], 'empty.jsonl');
  const result = await C.collect(config);
  assert.equal(result.sources.codex.status, 'partial');
  assert.equal(result.sources.codex.sessions, 1);
});

test('known out-of-scope log contents are never parsed or allowed to degrade scoped coverage', async t => {
  const config = fixture(t);
  writeSession(config, [metaRaw('real', config.scopePath), eventRaw()]);
  writeSession(config, [metaRaw('elsewhere', path.join(config.root, 'unrelated')), '{"timestamp":"broken","type":"event_msg","payload":{"type":"token_count",'], 'unrelated.jsonl');
  const result = await C.collect(config);
  assert.equal(result.sources.codex.status, 'connected');
  assert.equal(result.sources.codex.sessions, 1);
});

test('Git collection uses committer date, immutable SHA, and paths without reading content', async t => {
  const config = fixture(t);
  const git = args => execFileSync('git', ['-C', config.projectPath, ...args], { windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-11-16T14:00:00Z' } });
  git(['init', '--quiet']);
  fs.writeFileSync(path.join(config.projectPath, 'example.js'), 'PRIVATE_FILE_CONTENT_DO_NOT_COLLECT');
  fs.writeFileSync(path.join(config.projectPath, 'README.md'), 'Private documentation body');
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'A real code snapshot']);
  fs.appendFileSync(path.join(config.projectPath, 'example.js'), '\nmodified');
  fs.writeFileSync(path.join(config.projectPath, 'untracked.txt'), 'not yet committed');
  const result = await C.collect(config);
  assert.equal(result.sources.git.status, 'connected');
  const evidence = result.days.find(day => day.date === '2026-11-16').evidence;
  assert.equal(evidence.length, 1);
  assert.equal(new Date(evidence[0].timestamp).toISOString(), '2026-11-16T14:00:00.000Z');
  assert.equal(evidence[0].title, 'A real code snapshot');
  assert.match(evidence[0].id, /^git:[a-f0-9]{16}:[a-f0-9]{40}$/);
  assert.deepEqual(evidence[0].files.map(file => file.kind).sort(), ['code', 'document']);
  assert.deepEqual(result.workingTree, { modified: 1, untracked: 1, status: 'observed' });
  assert.equal(JSON.stringify(result).includes('PRIVATE_FILE_CONTENT_DO_NOT_COLLECT'), false);
  assert.equal(JSON.stringify(result).includes('2020-01-01'), false);
});

test('a repository with no commits is connected, with an observed clean tree', async t => {
  const config = fixture(t);
  execFileSync('git', ['-C', config.projectPath, 'init', '--quiet'], { windowsHide: true });
  const result = await C.collect(config);
  assert.equal(result.sources.git.status, 'connected');
  assert.equal(result.sources.git.head, null);
  assert.deepEqual(result.workingTree, { modified: 0, untracked: 0, status: 'observed' });
  assert.ok(result.days.every(day => day.evidence.length === 0));
});

test('scope must explicitly contain the selected project and invalid dates fail closed', async t => {
  const config = fixture(t);
  await assert.rejects(C.collect({ ...config, scopePath: path.join(config.root, 'elsewhere') }), /工作区/);
  await assert.rejects(C.collect({ ...config, now: 'invalid' }), /时间/);
});
