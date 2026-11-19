'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../dist/evidence-core.js');

const DATE = '2026-11-17';
const clone = value => JSON.parse(JSON.stringify(value));
const usage = (overrides = {}) => ({ inputTokens: 2000, cachedInputTokens: 1000, outputTokens: 1000, totalTokens: 3000, reasoningOutputTokens: 500, cacheWriteInputTokens: 0, sessions: 1, quality: 'observed', ...overrides });
const unavailable = () => usage({ inputTokens: null, cachedInputTokens: null, outputTokens: null, totalTokens: null, reasoningOutputTokens: null, cacheWriteInputTokens: null, sessions: null, quality: 'unavailable' });
const commit = (digit = 'a', overrides = {}) => ({ id: `git:project:${digit.repeat(40)}`, kind: 'git-commit', timestamp: DATE + 'T08:00:00+08:00', hash: digit.repeat(40), shortHash: digit.repeat(8), title: 'Observed repository change', files: [{ path: 'src/main.js', kind: 'code' }], ...overrides });
const day = (overrides = {}) => ({ date: DATE, usage: usage(), evidence: [commit()], ...overrides });
const snapshot = (overrides = {}) => ({
  schemaVersion: 1, kind: 'deepmine-evidence', collectedAt: DATE + 'T12:00:00+08:00', timezone: 'Asia/Shanghai',
  project: { id: 'project-123', label: 'Example repository' },
  sources: { codex: { status: 'connected', sessions: 1, events: 2, method: 'observed local events', notes: [] }, git: { status: 'connected', branch: 'main', head: 'a'.repeat(40), notes: [] } },
  days: [day()], workingTree: { modified: 0, untracked: 0, status: 'clean' }, warnings: [], ...overrides,
});

test('exports a browser UMD API as well as the CommonJS API', () => {
  const context = { Intl, Date, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/evidence-core.js'), 'utf8'), context);
  assert.equal(typeof context.EvidenceCore.project, 'function');
  assert.equal(context.EvidenceCore.TIMEZONE, C.TIMEZONE);
  assert.equal(C.claimDay, undefined);
  assert.equal(C.dig, undefined);
});

test('Shanghai date boundary is independent of the host zone', () => {
  assert.equal(C.today(new Date('2026-11-16T15:59:59.999Z')), '2026-11-16');
  assert.equal(C.today(new Date('2026-11-16T16:00:00.000Z')), DATE);
  assert.equal(C.today(new Date('2026-12-31T16:00:00.000Z')), '2027-01-01');
});

test('projection uses collection time rather than wall clock or the newest observed day', () => {
  const raw = snapshot({ days: [day({ date: '2026-11-16', evidence: [commit('a', { timestamp: '2026-11-16T09:00:00+08:00' })] })] });
  const projected = C.project(raw);
  assert.equal(projected.today.date, DATE);
  assert.equal(projected.today.tokens, null);
  assert.equal(projected.today.commits, null);
  assert.equal(projected.today.sessions, null);
  assert.deepEqual(C.project(raw), projected);
});

test('sanitization returns an independent bounded clone and excludes unrelated fields', () => {
  const raw = snapshot(); raw.secret = 'do not project'; raw.project.absolutePath = 'C:/private/path';
  raw.days[0].evidence[0].files[0].contents = 'private file contents';
  const clean = C.validateSnapshot(raw);
  assert.equal(clean.secret, undefined);
  assert.equal(clean.project.absolutePath, undefined);
  assert.equal(clean.days[0].evidence[0].files[0].contents, undefined);
  clean.days[0].evidence[0].files[0].path = 'changed.js';
  assert.equal(raw.days[0].evidence[0].files[0].path, 'src/main.js');
});

test('missing sources remain unknown instead of becoming observed zero', () => {
  const raw = snapshot({ days: [day({ usage: unavailable(), evidence: [] })], workingTree: { modified: null, untracked: null, status: 'unavailable' } });
  raw.sources.codex.status = 'missing'; raw.sources.git.status = 'missing'; raw.sources.git.head = null;
  const clean = C.validateSnapshot(raw), projected = C.project(clean);
  assert.equal(projected.today.tokens, null);
  assert.equal(projected.today.uncachedTokens, null);
  assert.equal(projected.today.sessions, null);
  assert.equal(projected.today.commits, null);
  assert.equal(projected.totals.tokens, null);
  assert.equal(projected.totals.commits, null);
  assert.equal(clean.workingTree.modified, null);
  assert.equal(projected.depth, 0);
  assert.deepEqual(projected.discoveries, []);
});

test('a genuinely observed zero day stays zero', () => {
  const raw = snapshot({ days: [day({ usage: usage({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningOutputTokens: 0, sessions: 0 }), evidence: [] })] });
  const projected = C.project(raw);
  assert.equal(projected.today.tokens, 0);
  assert.equal(projected.today.sessions, 0);
  assert.equal(projected.today.commits, 0);
  assert.equal(projected.totals.tokens, 0);
  assert.equal(projected.totals.commits, 0);
  assert.equal(projected.depth, 0);
});

test('empty snapshots do not invent observations, days, discoveries, or a preview', () => {
  const projected = C.project(snapshot({ days: [] }));
  assert.equal(projected.today.date, DATE);
  assert.equal(projected.today.tokens, null);
  assert.equal(projected.totals.days, 0);
  assert.equal(projected.totals.tokens, null);
  assert.deepEqual(projected.days, []);
  assert.deepEqual(projected.sourceEvidence, []);
  assert.deepEqual(projected.discoveries, []);
});

test('cached input and reasoning output are not counted a second time', () => {
  const projected = C.project(snapshot({ days: [day({ usage: usage({ inputTokens: 10000, cachedInputTokens: 9000, outputTokens: 1000, totalTokens: 11000, reasoningOutputTokens: 900, cacheWriteInputTokens: 2000 }), evidence: [] })] }));
  assert.equal(projected.today.tokens, 11000);
  assert.equal(projected.today.uncachedTokens, 1000);
  assert.equal(projected.today.cachedTokens, 9000);
  assert.equal(projected.today.outputTokens, 1000);
  assert.equal(projected.depth, 2, 'Only 2,000 uncached input + output tokens affect depth');
});

test('partial measurements preserve unknown fields and do not guess uncached input', () => {
  const raw = snapshot({ days: [day({ usage: usage({ cachedInputTokens: null, reasoningOutputTokens: null, cacheWriteInputTokens: null, quality: 'partial' }), evidence: [] })] });
  raw.sources.codex.status = 'partial';
  const projected = C.project(raw);
  assert.equal(projected.today.tokens, 3000);
  assert.equal(projected.today.cachedTokens, null);
  assert.equal(projected.today.uncachedTokens, null);
  assert.equal(projected.depth, 0);
});

test('period token totals remain unknown when a recorded day has unavailable usage', () => {
  const raw = snapshot({ days: [day({ date: '2026-11-16', usage: unavailable(), evidence: [] }), day()] });
  assert.equal(C.project(raw).totals.tokens, null);
  assert.equal(C.project(raw).today.tokens, 3000);
});

test('repeated commits and paths do not inflate evidence or discovery counts', () => {
  const a = commit(), b = commit('b', { files: [{ path: 'src/main.js', kind: 'code' }, { path: 'src/main.js', kind: 'code' }] });
  const raw = snapshot({ days: [day({ evidence: [a, clone(a), b] })] });
  const projected = C.project(raw);
  assert.equal(projected.today.commits, 2);
  assert.equal(projected.today.codeFiles, 1);
  assert.equal(projected.totals.evidenceCount, 2);
  assert.equal(projected.discoveries.length, 1);
  assert.equal(projected.discoveries[0].count, 1);
  assert.equal(projected.depth, C.project(snapshot()).depth);
});

test('a hundred distinct commits still grant the same once-per-day file-change depth', () => {
  const evidence = Array.from({ length: 100 }, (_, index) => {
    const hash = (index + 1).toString(16).padStart(40, '0');
    return commit('a', { id: `git:${hash}`, hash, shortHash: hash.slice(0, 8), files: [{ path: `src/file-${index}.js`, kind: 'code' }] });
  });
  const projected = C.project(snapshot({ days: [day({ usage: unavailable(), evidence })] }));
  assert.equal(projected.depth, 18);
  assert.equal(projected.today.commits, 100);
  assert.equal(projected.today.codeFiles, 100);
  assert.equal(projected.discoveries.length, 1);
});

test('empty-file commits count as commits but create no depth reward or mineral', () => {
  const projected = C.project(snapshot({ days: [day({ usage: unavailable(), evidence: [commit('a', { files: [] })] })] }));
  assert.equal(projected.today.commits, 1);
  assert.equal(projected.totals.evidenceCount, 1);
  assert.equal(projected.depth, 0);
  assert.deepEqual(projected.discoveries, []);
});

test('daily usage depth caps at 18 and file evidence adds at most another 18', () => {
  const projected = C.project(snapshot({ days: [day({ usage: usage({ inputTokens: 999999000000, cachedInputTokens: 0, outputTokens: 1000000, totalTokens: 1000000000000, reasoningOutputTokens: 0 }) })] }));
  assert.equal(projected.depth, 36);
});

test('only the 14-day collection window contributes to the expedition', () => {
  const evidenceAt = (date, digit) => day({ date, usage: unavailable(), evidence: [commit(digit, { timestamp: date + 'T08:00:00+08:00' })] });
  const projected = C.project(snapshot({ days: [evidenceAt('2026-11-03', '1'), evidenceAt('2026-11-04', '2'), evidenceAt(DATE, '3')] }));
  assert.deepEqual(projected.days.map(item => item.date), ['2026-11-04', DATE]);
  assert.equal(projected.depth, 36);
  assert.equal(projected.totals.days, 2);
  assert.equal(projected.totals.commits, 2);
});

test('one stable node per kind and day links only to the commits that support it', () => {
  const first = commit('a', { files: [{ path: 'src/main.js', kind: 'code' }, { path: 'README.md', kind: 'document' }] });
  const second = commit('b', { files: [{ path: 'rig.png', kind: 'asset' }, { path: '.config', kind: 'other' }, { path: 'src/extra.js', kind: 'code' }] });
  const projected = C.project(snapshot({ days: [day({ usage: unavailable(), evidence: [second, first] })] }));
  assert.deepEqual(projected.discoveries.map(item => item.kind), ['code', 'document', 'asset', 'other']);
  assert.deepEqual(projected.discoveries.map(item => item.count), [2, 1, 1, 1]);
  assert.deepEqual(projected.discoveries.map(item => item.depth), [4, 7, 11, 14]);
  const sources = new Map(projected.sourceEvidence.map(item => [item.id, item]));
  for (const node of projected.discoveries) {
    assert.equal(node.id, `project-123/${DATE}/${node.kind}`);
    assert.ok(node.evidenceIds.every(id => sources.has(id)));
    assert.ok(node.evidenceIds.every(id => sources.get(id).files.some(file => file.kind === node.kind)));
  }
  assert.deepEqual(projected.discoveries[1].evidenceIds, ['a'.repeat(40)]);
  assert.equal(projected.sourceEvidence[0].sourceId, first.id);
});

test('invalid numeric measurements and inconsistent token accounting are rejected', () => {
  for (const value of [-1, 0.5, Infinity, NaN, '12', 1000000000001]) {
    assert.throws(() => C.validateSnapshot(snapshot({ days: [day({ usage: usage({ inputTokens: value }) })] })), Error);
  }
  for (const overrides of [{ cachedInputTokens: 2001 }, { reasoningOutputTokens: 1001 }, { totalTokens: 4000 }, { cacheWriteInputTokens: 2001 }, { quality: 'unavailable' }]) {
    assert.throws(() => C.validateSnapshot(snapshot({ days: [day({ usage: usage(overrides) })] })), Error);
  }
});

test('invalid schema, date, source, hash, path and contradictory duplicates are rejected', () => {
  for (const overrides of [{ schemaVersion: 2 }, { kind: 'deepmine' }, { timezone: 'Invalid/Timezone' }, { mode: 'invented' }, { collectedAt: '2026-02-30T00:00:00Z' }]) assert.throws(() => C.validateSnapshot(snapshot(overrides)), Error);
  assert.throws(() => C.validateSnapshot(snapshot({ days: [day({ date: '2026-02-30' })] })), Error);
  assert.throws(() => C.validateSnapshot(snapshot({ days: [day(), day()] })), Error);
  for (const overrides of [{ hash: 'not-a-hash' }, { shortHash: 'bbbbbbbb' }, { timestamp: '2026-11-16T00:00:00Z' }, { files: [{ path: '../outside.js', kind: 'code' }] }, { files: [{ path: 'C:/private/file.js', kind: 'code' }] }]) {
    assert.throws(() => C.validateSnapshot(snapshot({ days: [day({ evidence: [commit('a', overrides)] })] })), Error);
  }
  assert.throws(() => C.validateSnapshot(snapshot({ days: [day({ evidence: [commit(), commit('a', { title: 'Conflicting metadata' })] })] })), Error);
  const missing = snapshot(); missing.sources.git.status = 'missing';
  assert.throws(() => C.validateSnapshot(missing), Error);
  const missingUsage = snapshot(); missingUsage.sources.codex.status = 'missing';
  assert.throws(() => C.validateSnapshot(missingUsage), Error);
});

test('snapshot size bounds are enforced before counting duplicated input', () => {
  assert.throws(() => C.validateSnapshot(snapshot({ days: Array.from({ length: 32 }, () => day()) })), Error);
  assert.throws(() => C.validateSnapshot(snapshot({ days: [day({ evidence: Array.from({ length: 1001 }, () => commit()) })] })), Error);
  assert.throws(() => C.validateSnapshot(snapshot({ days: [day({ evidence: [commit('a', { files: Array.from({ length: 2001 }, () => ({ path: 'a.js', kind: 'code' })) })] })] })), Error);
});

test('explicit demo data stays clearly fictional and produces a valid preview', () => {
  const demo = C.demoSnapshot(new Date('2026-11-17T04:00:00Z'));
  assert.equal(demo.mode, 'demo');
  assert.match(demo.project.label, /虚构/);
  assert.ok(demo.days.flatMap(item => item.evidence).every(item => item.title.includes('虚构')));
  assert.ok(C.project(demo).depth > 0);
  assert.deepEqual(C.validateSnapshot(demo), demo);
});

test('presentation helpers preserve unknown values and escape untrusted source text', () => {
  assert.equal(C.formatTokens(null), '—');
  assert.equal(C.formatTokens(undefined), '—');
  assert.equal(C.formatTokens(0), '0');
  assert.equal(C.formatTokens(12000), '12k');
  assert.equal(C.escapeHTML(`<img title="it's">&`), '&lt;img title=&quot;it&#39;s&quot;&gt;&amp;');
});
