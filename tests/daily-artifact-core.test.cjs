'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const C = require('../dist/evidence-core.js');
const D = require('../dist/daily-artifact-core.js');
const W = require('../dist/expedition-world.js');
const NOW = '2026-11-17T05:00:00Z', DATE = '2026-11-17';
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const value = C.demoSnapshot(NOW); value.mode = 'live'; value.project.id = 'semantic-fixture';
  value.days = [value.days[1]];
  value.days[0].evidence[0].title = '制作挖矿游戏：向下钻机、跟随镜头与矿层';
  value.days[0].evidence[0].files = [{ path: 'src/mining.js', kind: 'code' }, { path: 'docs/mining.md', kind: 'document' }];
  return value;
}
function result(input, changes = {}) {
  return { objectType: 'pickaxe', name: '开拓者矿镐', summary: '调整挖矿游戏的钻机、镜头与矿层相关文件。', meaning: '矿镐象征向下开拓矿井的工作主题。', evidenceIds: [input.commits[0].hash], ...changes };
}
function envelope(snapshot, changes = {}) {
  const input = D.buildInput(snapshot, DATE);
  return { projectId: input.projectId, date: input.date, fingerprint: input.fingerprint, result: result(input), source: 'ai', generatedAt: NOW, ...changes };
}
function commit(index, files = 1) {
  const hash = index.toString(16).padStart(40, '0');
  return { id: 'fixture:' + hash, kind: 'git-commit', timestamp: DATE + 'T08:00:00+08:00', hash, shortHash: hash.slice(0, 8), title: '文件变更 ' + index,
    files: Array.from({ length: files }, (_, i) => ({ path: `src/c${String(index).padStart(3, '0')}/f${i}.js`, kind: 'code' })) };
}

test('sixteen immutable object types and the strict structured-output schema share one contract', () => {
  assert.equal(D.catalog.length, 16); assert.equal(new Set(D.itemTypes).size, 16);
  assert.deepEqual(D.outputSchema.properties.objectType.enum, D.itemTypes);
  assert.equal(D.outputSchema.additionalProperties, false);
  assert.ok(Object.isFrozen(D.catalog) && Object.isFrozen(D.catalog[0]) && Object.isFrozen(D.outputSchema.properties));
  for (const type of ['pickaxe', 'gamepad', 'quill', 'telescope', 'key', 'seedling', 'bridge', 'musicbox']) assert.ok(D.itemTypes.includes(type));
});

test('browser and Node produce the identical SHA-256 fingerprint including Unicode metadata', () => {
  const snapshot = fixture(); snapshot.days[0].evidence[0].files.push({ path: '世界/矿井⛏.js', kind: 'code' });
  const clean = C.validateSnapshot(snapshot);
  const canonical = JSON.stringify({ projectId: clean.project.id, date: DATE, commits: clean.days[0].evidence.slice().sort((a, b) => a.hash.localeCompare(b.hash)) });
  const expected = crypto.createHash('sha256').update(canonical).digest('hex');
  assert.equal(D.fingerprint(snapshot, DATE), expected);
  const context = { TextEncoder, Intl, Date };
  for (const file of ['evidence-core.js', 'daily-artifact-core.js']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8'), context);
  assert.equal(context.DailyArtifactCore.fingerprint(snapshot, DATE), expected);
  assert.deepEqual(JSON.parse(JSON.stringify(context.DailyArtifactCore.buildInput(snapshot, DATE))), D.buildInput(snapshot, DATE));
});

test('input contains only bounded source metadata, no token values, bodies, or absolute project paths', () => {
  const snapshot = fixture(); snapshot.prompt = 'PRIVATE_PROMPT'; snapshot.project.absolutePath = 'C:/PRIVATE_PATH';
  snapshot.days[0].evidence[0].files[0].content = 'PRIVATE_SOURCE';
  snapshot.days[0].evidence[0].diff = 'PRIVATE_DIFF';
  const input = D.buildInput(snapshot, DATE), text = JSON.stringify(input);
  assert.equal(input.commits.length, 1); assert.equal(input.files.length, 2);
  assert.equal(input.projectId, snapshot.project.id); assert.equal(input.date, DATE);
  for (const forbidden of ['PRIVATE_', 'inputTokens', 'outputTokens', 'totalTokens', 'collectedAt', 'absolutePath', 'timestamp', 'shortHash']) assert.ok(!text.includes(forbidden));
  assert.deepEqual(Object.keys(input.commits[0]).sort(), ['hash', 'paths', 'title']);
});

test('tokens, collection time, and unrelated days do not invalidate the same daily source', () => {
  const snapshot = fixture(), before = D.fingerprint(snapshot, DATE);
  snapshot.collectedAt = '2026-11-18T05:00:00Z';
  snapshot.days[0].usage.inputTokens += 1000; snapshot.days[0].usage.totalTokens += 1000;
  snapshot.days.push({ date: '2026-11-18', usage: clone(snapshot.days[0].usage), evidence: [] });
  assert.equal(D.fingerprint(snapshot, DATE), before);
});

test('all meaningful daily source metadata changes invalidate the fingerprint', () => {
  const snapshot = fixture(), before = D.fingerprint(snapshot, DATE);
  for (const mutate of [
    x => { x.days[0].evidence[0].title += ' revised'; },
    x => { x.days[0].evidence[0].files[0].path = 'src/other.js'; },
    x => { x.days[0].evidence[0].files[0].kind = 'other'; },
    x => { x.days[0].evidence[0].timestamp = DATE + 'T03:00:00Z'; },
    x => { x.days[0].evidence[0].id += ':new'; },
    x => { x.project.id = 'other-project'; },
    x => { x.days[0].evidence.push(commit(44, 0)); }
  ]) {
    const changed = clone(snapshot); mutate(changed); assert.notEqual(D.fingerprint(changed, DATE), before);
  }
});

test('source sorting and duplicate normalization do not churn cache identity', () => {
  const snapshot = fixture(); snapshot.days[0].evidence.push(commit(44, 2));
  const before = D.fingerprint(snapshot, DATE);
  snapshot.days[0].evidence.reverse(); snapshot.days[0].evidence[0].files.reverse();
  snapshot.days[0].evidence.push(clone(snapshot.days[0].evidence[0]));
  assert.equal(D.fingerprint(snapshot, DATE), before);
});

test('input truncates to forty nonempty commits and three hundred unique files while fingerprint covers everything', () => {
  const snapshot = fixture(); snapshot.days[0].evidence = Array.from({ length: 41 }, (_, i) => commit(i + 1, 10));
  const input = D.buildInput(snapshot, DATE);
  assert.equal(input.commits.length, 40); assert.equal(input.files.length, 300);
  assert.deepEqual(input.totals, { commits: 41, files: 410 }); assert.deepEqual(input.truncated, { commits: true, files: true });
  const sent = new Set(input.files.map(file => file.path));
  assert.ok(input.commits.every(item => item.paths.every(value => sent.has(value))));
  snapshot.days[0].evidence[40].title += ' hidden change';
  assert.notEqual(D.fingerprint(snapshot, DATE), input.fingerprint);
  snapshot.days[0].evidence[39].files[9].path = 'z/not-in-prompt.js';
  assert.notEqual(D.fingerprint(snapshot, DATE), input.fingerprint);
});

test('empty, missing, and token-only days never create model input or a model result', () => {
  const snapshot = fixture(); snapshot.days[0].evidence = [];
  assert.equal(D.buildInput(snapshot, DATE), null); assert.equal(D.fingerprint(snapshot, DATE), null);
  snapshot.days[0].evidence = [commit(1, 0)]; assert.equal(D.buildInput(snapshot, DATE), null);
  snapshot.days[0].evidence = []; snapshot.sources.git.status = 'missing'; snapshot.sources.git.head = null;
  assert.equal(D.buildInput(snapshot, DATE), null); assert.equal(D.buildInput(fixture(), '2026-11-01'), null);
  assert.equal(D.validateResult({}, null), null); assert.equal(D.validateResult({}, { commits: [], files: [] }), null);
});

test('source validation rejects unknown Git evidence and absolute paths before any model input', () => {
  const snapshot = fixture(); snapshot.sources.git.status = 'missing';
  assert.throws(() => D.buildInput(snapshot, DATE), /Git/);
  const other = fixture(); other.days[0].evidence[0].files[0].path = 'C:/secret.js';
  assert.throws(() => D.buildInput(other, DATE), /相对路径/);
});

test('valid semantic output is copied, trimmed, and bound to sent commit hashes', () => {
  const input = D.buildInput(fixture(), DATE), raw = result(input, { name: '  开拓者矿镐  ' });
  const clean = D.validateResult(raw, input); assert.equal(clean.name, '开拓者矿镐');
  clean.evidenceIds.length = 0; assert.equal(raw.evidenceIds.length, 1);
  for (const type of D.itemTypes) assert.equal(D.validateResult(result(input, { objectType: type }), input).objectType, type);
});

test('strict output rejects extra or missing fields, invalid types, control characters and length overflow', () => {
  const input = D.buildInput(fixture(), DATE);
  for (const changes of [
    { objectType: 'dragon' }, { name: '' }, { summary: '   ' }, { meaning: null },
    { name: 'x'.repeat(25) }, { summary: 'x'.repeat(181) }, { meaning: 'x'.repeat(101) },
    { name: 'bad\nname' }, { summary: 'bad\u0000text' }, { meaning: 'bad\u007ftext' },
    { evidenceIds: [] }, { evidenceIds: ['f'.repeat(40)] }, { evidenceIds: [input.commits[0].hash, input.commits[0].hash] }
  ]) assert.throws(() => D.validateResult(result(input, changes), input));
  assert.throws(() => D.validateResult({ ...result(input), projectId: 'fake' }, input), /字段/);
  const missing = result(input); delete missing.meaning; assert.throws(() => D.validateResult(missing, input), /字段/);
  assert.throws(() => D.validateResult([], input));
});

test('model cannot cite a real but truncated-away commit', () => {
  const snapshot = fixture(); snapshot.days[0].evidence = Array.from({ length: 41 }, (_, i) => commit(i + 1));
  const input = D.buildInput(snapshot, DATE), omitted = snapshot.days[0].evidence[40].hash;
  assert.throws(() => D.validateResult(result(input, { evidenceIds: [omitted] }), input), /已发送/);
});

test('matching AI envelope replaces only the daily representation and preserves progression identity', () => {
  const snapshot = fixture(), basic = W.build(snapshot).artifacts[0], ai = envelope(snapshot);
  const item = W.build(snapshot, undefined, [ai]).artifacts[0];
  assert.equal(item.recipeId, 'pickaxe'); assert.equal(item.name, '开拓者矿镐'); assert.equal(item.semantic, true); assert.equal(item.source, 'ai');
  assert.equal(item.description, ai.result.summary); assert.equal(item.meaning, ai.result.meaning); assert.equal(item.generatedAt, NOW);
  for (const key of ['id', 'date', 'depth', 'kindMask', 'variant', 'fileCount']) assert.equal(item[key], basic[key]);
  assert.deepEqual(item.discoveryIds, basic.discoveryIds); assert.deepEqual(item.evidenceIds, ai.result.evidenceIds);
});

test('wrong project/date/fingerprint, invalid output and demo-as-live envelopes cannot replace rule results', () => {
  const snapshot = fixture(), valid = envelope(snapshot);
  for (const changes of [
    { projectId: 'other-project' }, { date: '2026-11-16' }, { fingerprint: '0'.repeat(64) },
    { source: 'demo' }, { source: 'made-up' }, { generatedAt: 'invalid' },
    { result: { ...valid.result, evidenceIds: ['f'.repeat(40)] } }
  ]) {
    const item = W.build(snapshot, undefined, [{ ...valid, ...changes }]).artifacts[0];
    assert.equal(item.source, 'rules'); assert.equal(item.semantic, false);
  }
});

test('same-day source revision rejects cached interpretation but token-only refresh keeps it', () => {
  const snapshot = fixture(), item = envelope(snapshot);
  snapshot.days[0].usage.inputTokens += 2000; snapshot.days[0].usage.totalTokens += 2000;
  assert.equal(W.build(snapshot, undefined, [item]).artifacts[0].source, 'ai');
  snapshot.days[0].evidence[0].title += ' and new work';
  assert.equal(W.build(snapshot, undefined, [item]).artifacts[0].source, 'rules');
  snapshot.days[0].evidence = [];
  assert.equal(W.build(snapshot, undefined, [item]).artifacts.length, 0);
});

test('multiple valid envelopes resolve to the newest result and retain only the model citation subset', () => {
  const snapshot = fixture(); snapshot.days[0].evidence.push(commit(44, 1));
  const old = envelope(snapshot), newer = envelope(snapshot, { generatedAt: '2026-11-17T06:00:00Z' });
  newer.result.name = '新的矿镐';
  const item = W.build(snapshot, undefined, [newer, old]).artifacts[0];
  assert.equal(item.name, '新的矿镐'); assert.equal(item.evidenceIds.length, 1);
});

test('handwritten demo interpretations are explicitly demo and match six distinct work themes', () => {
  const snapshot = W.demoSnapshot(NOW), items = W.demoInterpretations(snapshot), world = W.build(snapshot, undefined, items);
  assert.equal(items.length, 6); assert.ok(items.every(item => item.source === 'demo'));
  assert.deepEqual(world.artifacts.map(item => item.recipeId), ['key', 'quill', 'prism', 'telescope', 'musicbox', 'pickaxe']);
  assert.equal(world.artifacts.at(-1).name, '开拓者矿镐');
  assert.match(world.artifacts.at(-1).description, /挖矿游戏/);
  assert.match(world.artifacts.at(-1).description, /向下钻进/);
  assert.match(world.artifacts.at(-1).description, /镜头.*矿层展示/);
  assert.equal(C.project(snapshot).depth, 154); assert.equal(C.project(snapshot).today.tokens, 86000);
  assert.match(snapshot.days.at(-1).evidence[0].title, /制作挖矿游戏/);
  assert.deepEqual(W.demoInterpretations(fixture()), []);
  snapshot.mode = 'live';
  assert.ok(W.build(snapshot, undefined, items).artifacts.every(item => item.source === 'rules'));
});
