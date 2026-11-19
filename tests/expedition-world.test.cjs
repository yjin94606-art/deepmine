'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../dist/evidence-core.js');
const D = require('../dist/daily-artifact-core.js');
const W = require('../dist/expedition-world.js');
const clone = value => JSON.parse(JSON.stringify(value));
const INSTANT = '2026-11-17T02:00:00Z';
const KINDS = ['code', 'document', 'asset', 'other'];

function oneDay(mask = 1) {
  const snapshot = C.demoSnapshot(INSTANT);
  snapshot.mode = 'live'; snapshot.project.id = 'world-fixture';
  snapshot.days = [snapshot.days[1]];
  snapshot.days[0].evidence[0].files = KINDS.filter((_, index) => mask & (1 << index)).map(kind => ({ path: `fixture/${kind}.file`, kind }));
  return snapshot;
}
function withoutUsage(snapshot) {
  snapshot.sources.codex.status = 'missing';
  snapshot.sources.codex.sessions = 0; snapshot.sources.codex.events = 0;
  for (const day of snapshot.days) for (const key of Object.keys(day.usage)) day.usage[key] = key === 'quality' ? 'unavailable' : null;
  return snapshot;
}
function interpretation(snapshot, changes = {}) {
  const input = D.buildInput(snapshot, snapshot.days[0].date);
  return {
    projectId: input.projectId, date: input.date, fingerprint: input.fingerprint, source: 'ai', generatedAt: INSTANT,
    result: { objectType: 'pickaxe', name: '工作矿镐', summary: '更新了示例项目的文件。', meaning: '矿镐对应挖掘主题。', evidenceIds: input.commits.map(commit => commit.hash) },
    ...changes
  };
}

test('browser UMD and CommonJS expose the same catalog contract', () => {
  const context = { Intl, Date };
  for (const filename of ['evidence-core.js', 'expedition-world.js']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist', filename), 'utf8'), context);
  assert.equal(typeof context.ExpeditionWorld.build, 'function');
  assert.equal(context.ExpeditionWorld.catalog.length, 8);
  assert.deepEqual(Array.from(context.ExpeditionWorld.catalog, item => item.id), W.catalog.map(item => item.id));
  assert.throws(() => vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/expedition-world.js'), 'utf8'), {}), /evidence-core/);
});

test('every observed file-category combination has a fixed recipe, independent of quality claims', () => {
  const expected = { 1: 'engine', 2: 'archive', 4: 'prism', 8: 'compass', 3: 'rover', 5: 'drill', 6: 'projector' };
  for (let mask = 1; mask <= 15; mask++) {
    const result = W.build(oneDay(mask)), artifact = result.artifacts[0];
    assert.equal(result.artifacts.length, 1);
    assert.equal(artifact.kindMask, mask);
    assert.equal(artifact.recipeId, expected[mask] || 'observatory');
    assert.equal(artifact.fileCount, KINDS.filter((_, index) => mask & (1 << index)).length);
    assert.equal(artifact.quality, undefined);
    assert.equal(artifact.rarity, undefined);
  }
});

test('layers keep exactly the core depth endpoints, with usage and evidence separately visible', () => {
  const snapshot = W.demoSnapshot(INSTANT), projection = C.project(snapshot), world = W.build(snapshot, projection);
  assert.equal(world.layers.length, 6);
  for (const layer of world.layers) {
    const original = projection.days.find(day => day.date === layer.date);
    assert.equal(layer.depthStart, original.depthStart);
    assert.equal(layer.depthEnd, original.depthEnd);
    assert.equal(layer.tokens, original.tokens);
    assert.equal(layer.usageDepth + layer.evidenceDepth, original.depthEnd - original.depthStart);
    assert.equal(layer.evidenceDepth, 18);
    assert.ok(layer.usageDepth >= 0 && layer.usageDepth <= 18);
    assert.equal(layer.artifactId, world.artifacts.find(item => item.date === layer.date).id);
  }
});

test('token-only work has a real layer and no fabricated mineral or artifact', () => {
  const snapshot = oneDay(); snapshot.days[0].evidence = [];
  const result = W.build(snapshot);
  assert.equal(result.layers.length, 1);
  assert.equal(result.layers[0].usageDepth, 8);
  assert.equal(result.layers[0].evidenceDepth, 0);
  assert.equal(result.layers[0].artifactId, null);
  assert.deepEqual(result.layers[0].discoveryIds, []);
  assert.deepEqual(result.layers[0].fileCounts, { code: 0, document: 0, asset: 0, other: 0 });
  assert.deepEqual(result.artifacts, []);
});

test('missing Codex preserves unknown usage while verified Git can still shape a collectible', () => {
  const result = W.build(withoutUsage(oneDay(3)));
  assert.equal(result.layers[0].tokens, null);
  assert.equal(result.layers[0].usageDepth, 0);
  assert.equal(result.layers[0].evidenceDepth, 18);
  assert.equal(result.artifacts[0].recipeId, 'rover');
});

test('missing Git cannot produce an artifact, and fully missing evidence produces no layer', () => {
  const snapshot = oneDay(); snapshot.days[0].evidence = [];
  snapshot.sources.git.status = 'missing'; snapshot.sources.git.head = null;
  assert.equal(W.build(snapshot).artifacts.length, 0);
  const unknown = W.build(withoutUsage(snapshot));
  assert.deepEqual(unknown.layers, []);
  assert.deepEqual(unknown.artifacts, []);
  const malformed = oneDay(); malformed.sources.git.status = 'missing';
  assert.throws(() => W.build(malformed), /Git/);
});

test('empty-file commits are not a recipe input and do not add provenance to a collectible', () => {
  const snapshot = withoutUsage(oneDay(0));
  assert.equal(W.build(snapshot).artifacts.length, 0);
  assert.equal(W.build(snapshot).layers.length, 0);
  const verified = oneDay(1), empty = clone(verified.days[0].evidence[0]);
  empty.hash = 'a'.repeat(40); empty.id = 'empty'; empty.shortHash = 'a'.repeat(8); empty.files = [];
  verified.days[0].evidence.push(empty);
  assert.deepEqual(W.build(verified).artifacts[0].evidenceIds, ['2'.repeat(40)]);
});

test('splitting commits and repeating paths never increases item count, variant, or unique file count', () => {
  const snapshot = oneDay(7), before = W.build(snapshot), original = snapshot.days[0].evidence[0];
  snapshot.days[0].evidence.push(clone(original));
  const copy = clone(original); copy.hash = 'a'.repeat(40); copy.id = 'another-commit'; copy.shortHash = 'a'.repeat(8);
  copy.files.reverse(); copy.files.push(clone(copy.files[0])); snapshot.days[0].evidence.push(copy);
  const after = W.build(snapshot);
  assert.equal(after.artifacts.length, 1);
  for (const key of ['id', 'recipeId', 'variant', 'fileCount', 'depth']) assert.equal(after.artifacts[0][key], before.artifacts[0][key]);
  assert.deepEqual(after.layers[0].fileCounts, before.layers[0].fileCounts);
  assert.deepEqual(after.artifacts[0].evidenceIds, ['2'.repeat(40), 'a'.repeat(40)]);
});

test('changing token volume or commit titles changes neither recipe nor cosmetic variant', () => {
  const snapshot = oneDay(5), before = W.build(snapshot).artifacts[0];
  snapshot.days[0].evidence[0].title = 'massive successful feature release';
  Object.assign(snapshot.days[0].usage, { inputTokens: 1000000000, cachedInputTokens: 0, outputTokens: 1000000, totalTokens: 1001000000 });
  const after = W.build(snapshot).artifacts[0];
  assert.equal(after.recipeId, before.recipeId);
  assert.equal(after.variant, before.variant);
  assert.equal(after.fileCount, before.fileCount);
  assert.ok(after.depth > before.depth);
});

test('same-day evidence updates preserve artifact identity and recompute its recipe', () => {
  const snapshot = oneDay(1), before = W.build(snapshot).artifacts[0];
  snapshot.days[0].evidence[0].files.push({ path: 'fixture/guide.md', kind: 'document' });
  const after = W.build(snapshot).artifacts[0];
  assert.equal(after.id, before.id);
  assert.equal(after.recipeId, 'rover');
  assert.equal(after.fileCount, 2);
  snapshot.project.id = 'another-project';
  assert.notEqual(W.build(snapshot).artifacts[0].id, before.id);
});

test('source references resolve to complete hashes and the same daily discoveries', () => {
  const snapshot = W.demoSnapshot(INSTANT), projection = C.project(snapshot), world = W.build(snapshot);
  for (const artifact of world.artifacts) {
    assert.ok(artifact.evidenceIds.length);
    for (const id of artifact.evidenceIds) assert.ok(projection.sourceEvidence.some(entry => entry.hash === id && entry.date === artifact.date && entry.files.length));
    assert.deepEqual(artifact.discoveryIds, projection.discoveries.filter(item => item.date === artifact.date).map(item => item.id));
    assert.equal(artifact.depth, projection.days.find(day => day.date === artifact.date).depthEnd);
  }
});

test('artifacts outside the core 14-day window disappear and do not survive in a cached projection', () => {
  const snapshot = W.demoSnapshot(INSTANT), stale = C.project(snapshot);
  snapshot.collectedAt = '2026-12-15T02:00:00Z';
  const result = W.build(snapshot, stale);
  assert.deepEqual(result.layers, []);
  assert.deepEqual(result.artifacts, []);
});

test('retracted evidence cannot be resurrected by an optional stale or fabricated projection', () => {
  const snapshot = oneDay(1), stale = C.project(snapshot);
  snapshot.days[0].evidence = [];
  stale.depth = 1000000; stale.days[0].depthEnd = 1000000;
  const result = W.build(snapshot, stale);
  assert.equal(result.artifacts.length, 0);
  assert.equal(result.layers[0].depthEnd, 8);
});

test('quiet observed days and empty snapshots create no phantom work layers', () => {
  const snapshot = oneDay(0);
  for (const key of Object.keys(snapshot.days[0].usage)) snapshot.days[0].usage[key] = key === 'quality' ? 'observed' : 0;
  assert.deepEqual(W.build(snapshot).layers, []);
  snapshot.days = [];
  assert.deepEqual(W.build(snapshot).artifacts, []);
});

test('catalog and biome definitions are immutable and each result owns its mutable data', () => {
  assert.ok(Object.isFrozen(W.catalog) && W.catalog.every(Object.isFrozen));
  assert.ok(Object.isFrozen(W.biomes) && W.biomes.every(Object.isFrozen));
  const snapshot = oneDay(3), original = clone(snapshot), first = W.build(snapshot), expected = clone(first);
  first.layers[0].fileCounts.code = 999; first.layers[0].discoveryIds.length = 0;
  first.artifacts[0].evidenceIds.length = 0; first.artifacts[0].name = 'edited';
  assert.deepEqual(snapshot, original);
  assert.deepEqual(W.build(snapshot), expected);
});

test('cosmetic variation is stable for Unicode paths and remains in the three-frame range', () => {
  const snapshot = oneDay(7); snapshot.days[0].evidence[0].files[0].path = '示例/矿井.ts';
  const first = W.build(snapshot).artifacts[0];
  snapshot.days[0].evidence[0].files.reverse();
  assert.equal(W.build(snapshot).artifacts[0].variant, first.variant);
  assert.ok(Number.isInteger(first.variant) && first.variant >= 0 && first.variant <= 2);
});

test('six-day fictional demo covers varied recipes and all four environments without editing the original demo', () => {
  const snapshot = W.demoSnapshot(INSTANT), projected = C.project(snapshot), world = W.build(snapshot);
  assert.equal(snapshot.mode, 'demo'); assert.equal(snapshot.project.id, 'fictional-preview');
  assert.equal(snapshot.days.length, 6); assert.equal(snapshot.days.at(-1).date, '2026-11-17');
  assert.equal(projected.depth, 154); assert.equal(world.artifacts.length, 6);
  assert.equal(new Set(world.artifacts.map(item => item.recipeId)).size, 6);
  assert.equal(world.artifacts.at(-1).recipeId, 'observatory');
  assert.ok(snapshot.days.every(day => day.evidence.every(entry => entry.title.includes('虚构') && entry.files.every(file => file.path.startsWith('demo/')))));
  assert.equal(C.demoSnapshot(INSTANT).days.length, 2);
  assert.deepEqual(C.validateSnapshot(snapshot), snapshot);
});

test('demo dates follow Shanghai boundaries including year rollover and never use a future timestamp', () => {
  const snapshot = W.demoSnapshot('2026-12-31T16:00:00.000Z');
  assert.equal(snapshot.days.at(-1).date, '2027-01-01');
  assert.equal(snapshot.days[0].date, '2026-12-27');
  for (const day of snapshot.days) for (const evidence of day.evidence) assert.ok(Date.parse(evidence.timestamp) <= Date.parse(snapshot.collectedAt));
  assert.throws(() => W.demoSnapshot('invalid'), /时间/);
});

test('biome thresholds are exact descriptive boundaries and do not affect the projected rules', () => {
  assert.equal(W.biomeAt(-12).id, 'roots'); assert.equal(W.biomeAt(17.99).id, 'roots');
  assert.equal(W.biomeAt(18).id, 'aquifer'); assert.equal(W.biomeAt(44).id, 'crystal');
  assert.equal(W.biomeAt(90).id, 'ruins'); assert.equal(W.biomeAt(100000).id, 'ruins');
  assert.equal(W.biomeAt(NaN).id, 'roots'); assert.equal(W.biomeAt(null).id, 'roots');
  assert.equal(W.biomes[3].end, null);
});

test('six-day demo has eighteen evidence-bound rooms without adding progress or collectibles', () => {
  const snapshot = W.demoSnapshot(INSTANT), original = clone(snapshot), projection = C.project(snapshot);
  const world = W.build(snapshot, projection, W.demoInterpretations(snapshot));
  assert.equal(world.rooms.length, 18); assert.equal(world.artifacts.length, 6);
  assert.equal(projection.depth, 154); assert.equal(projection.today.tokens, 86000);
  assert.deepEqual(C.project(snapshot), projection); assert.deepEqual(snapshot, original);
  for (const room of world.rooms) {
    assert.equal(room.projectId, 'fictional-preview'); assert.equal(room.source, 'demo');
    assert.ok(room.id.startsWith(`${room.projectId}/${room.date}/room/`));
    assert.ok(W.roomThemes.includes(room.theme));
    assert.ok(Number.isInteger(room.variant) && room.variant >= 0 && room.variant <= 2);
    assert.ok(Number.isInteger(room.level) && room.level >= 0 && room.level <= 3);
    assert.equal(room.quality, undefined); assert.equal(room.rarity, undefined);
  }
  const last = world.rooms.filter(room => room.date === projection.today.date);
  assert.deepEqual(last.map(room => room.kind), ['usage', 'work', 'files']);
  assert.equal(last[1].theme, 'workshop');
  assert.equal(last[1].description, world.artifacts.at(-1).description);
  assert.equal(last[1].artifactId, world.artifacts.at(-1).id);
  assert.ok(Object.isFrozen(W.roomThemes));
});

test('token-only work creates storage rather than a fabricated result or Git reference', () => {
  const snapshot = oneDay(); snapshot.days[0].evidence = [];
  snapshot.sources.git.status = 'missing'; snapshot.sources.git.head = null;
  const world = W.build(snapshot), room = world.rooms[0];
  assert.equal(world.rooms.length, 1); assert.equal(world.artifacts.length, 0);
  assert.equal(room.kind, 'usage'); assert.equal(room.theme, 'energy'); assert.equal(room.source, 'codex');
  assert.equal(room.artifactId, null); assert.equal(room.fileCount, 0);
  assert.deepEqual(room.paths, []); assert.deepEqual(room.evidenceIds, []);
  assert.equal(room.usage.totalTokens, 34000); assert.match(room.description, /不代表工作成果/);
});

test('missing and partial measurements stay null and do not invent a storage room', () => {
  const snapshot = withoutUsage(oneDay(3)), world = W.build(snapshot);
  assert.deepEqual(world.rooms.map(room => room.kind), ['work', 'files']);
  for (const room of world.rooms) {
    assert.equal(room.source, 'git');
    assert.deepEqual(room.usage, { inputTokens: null, cachedInputTokens: null, outputTokens: null, totalTokens: null, sessions: null });
  }
  const partial = oneDay(); partial.sources.codex.status = 'partial';
  partial.days[0].usage.totalTokens = null; partial.days[0].usage.sessions = null; partial.days[0].usage.quality = 'partial';
  const partialWorld = W.build(partial);
  assert.deepEqual(partialWorld.rooms.map(room => room.kind), ['work', 'files']);
  assert.equal(partialWorld.rooms[0].usage.totalTokens, null);
  assert.equal(partialWorld.rooms[0].usage.sessions, null);
  assert.equal(partialWorld.rooms[0].usage.inputTokens, 28000);
});

test('positive usage below the depth threshold has one endpoint room without inventing depth', () => {
  const snapshot = oneDay(0), usage = snapshot.days[0].usage;
  for (const key of Object.keys(usage)) usage[key] = key === 'quality' ? 'observed' : 0;
  assert.deepEqual(W.build(snapshot).rooms, []);
  Object.assign(usage, { inputTokens: 1, totalTokens: 1, sessions: 1 });
  const world = W.build(snapshot);
  assert.equal(C.project(snapshot).depth, 0); assert.deepEqual(world.layers, []); assert.deepEqual(world.artifacts, []);
  assert.equal(world.rooms.length, 1); assert.equal(world.rooms[0].depth, 0);
  assert.equal(world.rooms[0].level, 1);
});

test('room slots keep fixed sides and fractions within the observed daily endpoints', () => {
  const snapshot = W.demoSnapshot(INSTANT), projection = C.project(snapshot), world = W.build(snapshot);
  for (const day of projection.days) {
    const [usage, work, files] = world.rooms.filter(room => room.date === day.date), span = day.depthEnd - day.depthStart;
    assert.equal(usage.depth, day.depthStart + span * 0.20);
    assert.equal(work.depth, day.depthStart + span * 0.55);
    assert.equal(files.depth, day.depthStart + span * 0.87);
    assert.equal(usage.side, files.side); assert.notEqual(work.side, usage.side);
    assert.ok((files.depth - usage.depth) * 7 >= 84.4);
    for (const room of [usage, work, files]) assert.ok(room.depth >= day.depthStart && room.depth <= day.depthEnd);
  }
});

test('file rooms de-duplicate paths and preserve primary categories with deterministic ties', () => {
  const snapshot = oneDay(3), original = snapshot.days[0].evidence[0];
  original.files.push({ path: 'notes/another.md', kind: 'document' });
  const before = W.build(snapshot), copy = clone(original);
  copy.hash = 'a'.repeat(40); copy.shortHash = 'a'.repeat(8); copy.id = 'split-copy';
  copy.files.reverse(); copy.files.push(clone(copy.files[0])); snapshot.days[0].evidence.push(copy);
  const after = W.build(snapshot), first = before.rooms.find(room => room.kind === 'files'), room = after.rooms.find(room => room.kind === 'files');
  assert.equal(after.rooms.length, 3); assert.equal(room.fileCount, 3);
  assert.deepEqual(room.paths, ['fixture/code.file', 'fixture/document.file', 'notes/another.md']);
  assert.deepEqual(room.evidenceIds, ['2'.repeat(40), 'a'.repeat(40)]);
  assert.equal(room.primaryKind, 'document'); assert.equal(room.secondaryKind, 'code'); assert.equal(room.theme, 'workshop');
  assert.equal(room.displayKind, 'code'); assert.equal(room.name, '代码文件整理室');
  for (const key of ['id', 'variant', 'level', 'side', 'depth', 'fileCount', 'name']) assert.equal(room[key], first[key]);
  const tie = W.build(oneDay(3)).rooms.find(room => room.kind === 'files');
  assert.equal(tie.primaryKind, 'code'); assert.equal(tie.secondaryKind, 'document');
});

test('multi-category file rooms avoid the accepted work theme without changing daily statistics', () => {
  const snapshot = oneDay(7);
  snapshot.days[0].evidence[0].files.push({ path: 'fixture/second-code.js', kind: 'code' });
  const envelope = interpretation(snapshot), world = W.build(snapshot, undefined, [envelope]);
  const work = world.rooms.find(room => room.kind === 'work'), files = world.rooms.find(room => room.kind === 'files');
  assert.equal(work.theme, 'workshop'); assert.equal(files.theme, 'archive');
  assert.equal(files.displayKind, 'document'); assert.equal(files.name, '文档文件整理室');
  assert.equal(files.primaryKind, 'code'); assert.equal(files.secondaryKind, 'document');
  assert.deepEqual(files.fileCounts, { code: 2, document: 1, asset: 1, other: 0 });
  assert.equal(files.fileCount, 4); assert.equal(files.paths.length, 4);
  assert.ok(files.paths.includes('fixture/code.file') && files.paths.includes('fixture/asset.file'));
  assert.deepEqual(files.evidenceIds, ['2'.repeat(40)]);
  assert.match(files.description, /采用文档主题/); assert.match(files.description, /全部 4 个/); assert.match(files.description, /实际以代码为主/);

  envelope.result.objectType = 'quill';
  const changed = W.build(snapshot, undefined, [envelope]), changedFiles = changed.rooms.find(room => room.kind === 'files');
  assert.equal(changed.rooms.find(room => room.kind === 'work').theme, 'archive');
  assert.equal(changedFiles.theme, 'workshop'); assert.equal(changedFiles.displayKind, 'code');
  for (const key of ['paths', 'evidenceIds', 'fileCount', 'fileCounts', 'primaryKind', 'secondaryKind', 'id', 'level', 'variant']) assert.deepEqual(changedFiles[key], files[key]);
});

test('single-category file rooms keep their real category and never invent a different theme', () => {
  for (let index = 0; index < KINDS.length; index++) {
    const world = W.build(oneDay(1 << index)), work = world.rooms.find(room => room.kind === 'work'), files = world.rooms.find(room => room.kind === 'files');
    assert.equal(files.theme, work.theme); assert.equal(files.displayKind, KINDS[index]);
    assert.equal(files.primaryKind, KINDS[index]); assert.equal(files.secondaryKind, null); assert.equal(files.fileCount, 1);
  }
});

test('accepted AI maps the sixteen shapes to room themes and reuses its sourced summary', () => {
  const snapshot = oneDay(1), envelope = interpretation(snapshot);
  const expected = {
    engine: 'workshop', archive: 'archive', prism: 'studio', compass: 'observatory', rover: 'workshop', drill: 'workshop',
    projector: 'studio', observatory: 'observatory', pickaxe: 'workshop', gamepad: 'workshop', quill: 'archive',
    telescope: 'observatory', key: 'gate', seedling: 'garden', bridge: 'gate', musicbox: 'audio'
  };
  for (const [objectType, theme] of Object.entries(expected)) {
    envelope.result.objectType = objectType;
    const world = W.build(snapshot, undefined, [envelope]), room = world.rooms.find(item => item.kind === 'work');
    assert.equal(room.theme, theme); assert.equal(room.source, 'ai');
    assert.equal(room.description, envelope.result.summary); assert.equal(room.artifactId, world.artifacts[0].id);
    assert.deepEqual(room.evidenceIds, envelope.result.evidenceIds);
  }
});

test('AI work-room paths only come from its cited commits while files room keeps all daily paths', () => {
  const snapshot = oneDay(1), extra = clone(snapshot.days[0].evidence[0]);
  extra.hash = 'a'.repeat(40); extra.shortHash = 'a'.repeat(8); extra.id = 'extra';
  extra.files = [{ path: 'private-docs/guide.md', kind: 'document' }]; snapshot.days[0].evidence.push(extra);
  const envelope = interpretation(snapshot); envelope.result.evidenceIds = ['2'.repeat(40)];
  const world = W.build(snapshot, undefined, [envelope]), room = world.rooms.find(item => item.kind === 'work'), files = world.rooms.find(item => item.kind === 'files');
  assert.deepEqual(room.paths, ['fixture/code.file']); assert.equal(room.fileCount, 1);
  assert.deepEqual(room.evidenceIds, ['2'.repeat(40)]);
  assert.deepEqual(files.paths, ['fixture/code.file', 'private-docs/guide.md']); assert.equal(files.fileCount, 2);
  assert.deepEqual(files.evidenceIds, ['2'.repeat(40), 'a'.repeat(40)]);
});

test('stale, cross-project, cross-date, and demo-as-live AI cannot shape live rooms', () => {
  const snapshot = oneDay(1), valid = interpretation(snapshot); valid.result.objectType = 'musicbox';
  const cases = [
    { projectId: 'another-project' }, { date: '2026-11-16' }, { fingerprint: '0'.repeat(64) }, { source: 'demo' },
    { generatedAt: 'invalid' }, { result: { ...valid.result, evidenceIds: ['a'.repeat(40)] } }
  ];
  for (const changes of cases) {
    const room = W.build(snapshot, undefined, [{ ...valid, ...changes }]).rooms.find(item => item.kind === 'work');
    assert.equal(room.theme, 'workshop'); assert.equal(room.source, 'git'); assert.match(room.description, /非 AI/);
  }
  const oldId = W.build(snapshot, undefined, [valid]).rooms.find(item => item.kind === 'work').id;
  snapshot.days[0].evidence[0].title = 'Changed source title';
  const changed = W.build(snapshot, undefined, [valid]).rooms.find(item => item.kind === 'work');
  assert.equal(changed.id, oldId); assert.equal(changed.source, 'git'); assert.equal(changed.theme, 'workshop');
  snapshot.project.id = 'new-project';
  const switched = W.build(snapshot, undefined, [valid]);
  assert.ok(switched.rooms.every(room => room.projectId === 'new-project' && room.id.startsWith('new-project/')));
  assert.equal(switched.rooms.find(item => item.kind === 'work').source, 'git');
});

test('Git withdrawal and rolling-window expiry remove rooms even with stale projection and AI', () => {
  const snapshot = oneDay(1), envelope = interpretation(snapshot), projection = C.project(snapshot);
  snapshot.days[0].evidence = []; snapshot.sources.git.status = 'missing'; snapshot.sources.git.head = null;
  const retracted = W.build(snapshot, projection, [envelope]);
  assert.deepEqual(retracted.rooms.map(room => room.kind), ['usage']); assert.deepEqual(retracted.artifacts, []);
  snapshot.collectedAt = '2026-12-15T02:00:00Z';
  const expired = W.build(snapshot, projection, [envelope]);
  assert.deepEqual(expired.rooms, []); assert.deepEqual(expired.layers, []); assert.deepEqual(expired.artifacts, []);
});

test('token updates change storage detail without minting rooms or upgrading work and file furniture', () => {
  const snapshot = oneDay(7), envelope = interpretation(snapshot), before = W.build(snapshot, undefined, [envelope]);
  Object.assign(snapshot.days[0].usage, { inputTokens: 1000000, cachedInputTokens: 0, outputTokens: 100000, totalTokens: 1100000, sessions: 9 });
  const after = W.build(snapshot, undefined, [envelope]);
  assert.equal(after.rooms.length, before.rooms.length); assert.equal(after.artifacts.length, before.artifacts.length);
  assert.ok(after.rooms[0].level > before.rooms[0].level); assert.equal(after.rooms[0].level, 3);
  for (let index = 0; index < after.rooms.length; index++) {
    for (const key of ['id', 'side', 'theme', 'variant', 'source', 'fileCount']) assert.equal(after.rooms[index][key], before.rooms[index][key]);
    if (after.rooms[index].kind !== 'usage') assert.equal(after.rooms[index].level, before.rooms[index].level);
  }
  assert.equal(after.rooms.find(room => room.kind === 'work').source, 'ai');
});

test('room arrays and nullable counters are owned by each returned result', () => {
  const snapshot = oneDay(7), original = clone(snapshot), first = W.build(snapshot), expected = clone(first);
  const room = first.rooms.find(item => item.kind === 'files');
  room.paths.push('invented.txt'); room.evidenceIds.length = 0; room.fileCounts.code = 999; room.usage.totalTokens = 0;
  assert.deepEqual(snapshot, original); assert.deepEqual(W.build(snapshot), expected);
  assert.equal(first.rooms.find(item => item.kind === 'work').fileCounts.code, 1);
  assert.equal(first.rooms.find(item => item.kind === 'usage').usage.totalTokens, 34000);
});
