'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../dist/evidence-core.js');
const D = require('../dist/daily-artifact-core.js');
const W = require('../dist/expedition-world.js');
const P = require('../dist/expedition-progress.js');
const NOW = '2026-11-17T02:00:00Z';
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const snapshot = W.demoSnapshot(NOW); snapshot.mode = 'live'; snapshot.project.id = 'progress-fixture';
  return snapshot;
}
function semanticWorld(snapshot, objectTypes) {
  const items = snapshot.days.map((day, index) => {
    const input = D.buildInput(snapshot, day.date);
    return input && { projectId: snapshot.project.id, date: day.date, fingerprint: input.fingerprint, generatedAt: NOW, source: 'ai',
      result: { objectType: objectTypes[index % objectTypes.length], name: '当天纪念物', summary: '更新了当天记录中的文件。', meaning: '对应本次文件更新的主题。', evidenceIds: input.commits.map(commit => commit.hash) } };
  }).filter(Boolean);
  return W.build(snapshot, undefined, items);
}
function missingCodex(snapshot) {
  snapshot.sources.codex.status = 'missing'; snapshot.sources.codex.sessions = 0; snapshot.sources.codex.events = 0;
  for (const day of snapshot.days) for (const key of Object.keys(day.usage)) day.usage[key] = key === 'quality' ? 'unavailable' : null;
  return snapshot;
}
function missingGit(snapshot) {
  snapshot.sources.git.status = 'missing'; snapshot.sources.git.head = null;
  for (const day of snapshot.days) day.evidence = [];
  return snapshot;
}

test('browser UMD and CommonJS share deterministic progress and immutable definitions', () => {
  const context = { Intl, Date, TextEncoder };
  for (const filename of ['evidence-core.js', 'daily-artifact-core.js', 'expedition-world.js', 'expedition-progress.js']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist', filename), 'utf8'), context);
  const snapshot = fixture(), world = semanticWorld(snapshot, ['key', 'quill', 'pickaxe']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.ExpeditionProgress.build(snapshot, world))), P.build(snapshot, world));
  assert.ok(Object.isFrozen(P.definitions) && P.definitions.every(Object.isFrozen));
  assert.throws(() => vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/expedition-progress.js'), 'utf8'), {}), /evidence-core/);
});

test('six-day demo yields three facilities, six briefs and no new evidence or collectible', () => {
  const snapshot = W.demoSnapshot(NOW), world = W.build(snapshot, undefined, W.demoInterpretations(snapshot));
  const original = clone(snapshot), originalWorld = clone(world), projection = C.project(snapshot), progress = P.build(snapshot, world, projection);
  assert.equal(progress.mode, 'demo'); assert.equal(progress.projectId, 'fictional-preview');
  assert.deepEqual(progress.period, { startDate: '2026-11-04', endDate: '2026-11-17' });
  assert.equal(progress.throughDate, '2026-11-17'); assert.equal(progress.briefs.length, 6);
  assert.deepEqual(progress.tracks.map(track => [track.id, track.value, track.progress, track.target, track.unlocked]), [
    ['relay', 6, 3, 3, true], ['sorter', 4, 4, 4, true], ['garden', 6, 3, 3, true]
  ]);
  for (const track of progress.tracks) {
    assert.equal(track.source, 'demo'); assert.equal(track.status, 'unlocked');
    const day = projection.days.find(day => day.date === track.unlockedAt);
    assert.equal(track.depth, day.depthEnd); assert.ok(track.depth <= 154);
  }
  assert.equal(progress.tracks[0].unlockedAt, snapshot.days[2].date);
  assert.equal(progress.tracks[1].unlockedAt, snapshot.days[5].date);
  assert.equal(progress.tracks[2].unlockedAt, snapshot.days[2].date);
  assert.ok(progress.briefs.every(brief => brief.source === 'demo' && brief.summary.startsWith('演示（虚构）')));
  assert.equal(progress.briefs.at(-1).usage.totalTokens, 86000);
  assert.equal(world.artifacts.length, 6); assert.equal(projection.depth, 154);
  assert.deepEqual(snapshot, original); assert.deepEqual(world, originalWorld); assert.deepEqual(C.project(snapshot), projection);
});

test('historical cutoff excludes later dates, evidence, types and facilities without moving the 14-day window', () => {
  const snapshot = W.demoSnapshot(NOW), world = W.build(snapshot, undefined, W.demoInterpretations(snapshot));
  const second = P.build(snapshot, world, undefined, snapshot.days[1].date);
  assert.equal(second.briefs.length, 2); assert.ok(second.tracks.every(track => !track.unlocked && track.depth === null));
  assert.deepEqual(second.tracks.map(track => track.value), [2, 2, 2]);
  assert.deepEqual(second.period, P.build(snapshot, world).period);
  for (const track of second.tracks) {
    assert.ok(track.dates.every(date => date <= snapshot.days[1].date));
    assert.ok(track.evidenceIds.every(hash => ['1'.repeat(40), '2'.repeat(40)].includes(hash)));
  }
  const third = P.build(snapshot, world, undefined, snapshot.days[2].date);
  assert.deepEqual(third.tracks.map(track => track.unlocked), [true, false, true]);
  assert.deepEqual(third.briefs.at(-1).unlockedTrackIds, ['relay', 'garden']);
  assert.equal(third.briefs.at(-1).artifact.recipeId, 'prism');
});

test('invalid or unprojected cutoffs are rejected, while an empty current day remains usable', () => {
  const snapshot = fixture();
  for (const cutoff of ['bad', '2026-02-30', '2026-11-18', '2026-11-01', '2026-11-05', null, 123]) assert.throws(() => P.build(snapshot, undefined, undefined, cutoff), /截止日期/);
  snapshot.days = [];
  assert.deepEqual(P.build(snapshot, undefined, undefined, '2026-11-17').briefs, []);
});

test('splitting commits and repeating paths do not advance any facility', () => {
  const snapshot = fixture(), before = P.build(snapshot), first = snapshot.days[0].evidence[0];
  const extra = clone(first); extra.hash = 'a'.repeat(40); extra.shortHash = 'a'.repeat(8); extra.id = 'split-commit';
  extra.files.reverse(); extra.files.push(clone(extra.files[0])); snapshot.days[0].evidence.push(clone(first), extra);
  const after = P.build(snapshot);
  for (let index = 0; index < after.tracks.length; index++) for (const key of ['value', 'progress', 'target', 'unlocked', 'unlockedAt', 'depth', 'dates', 'fileKinds', 'artifactTypes']) assert.deepEqual(after.tracks[index][key], before.tracks[index][key]);
  assert.equal(after.briefs[0].fileCount, before.briefs[0].fileCount);
  assert.deepEqual(after.briefs[0].paths, before.briefs[0].paths);
  assert.equal(after.briefs[0].commits, 2);
});

test('three same-category workdays unlock relay but not artificial file or collectible variety', () => {
  const snapshot = fixture(); snapshot.days = snapshot.days.slice(0, 3);
  for (const day of snapshot.days) day.evidence[0].files = [{ path: 'same/source.js', kind: 'code' }];
  const progress = P.build(snapshot);
  assert.deepEqual(progress.tracks.map(track => track.value), [3, 1, 1]);
  assert.deepEqual(progress.tracks.map(track => track.unlocked), [true, false, false]);
  assert.deepEqual(progress.tracks[2].artifactSources, ['rules']);
});

test('token-only days and empty-file commits never advance facility goals', () => {
  const snapshot = fixture();
  for (const day of snapshot.days) day.evidence = [];
  let progress = P.build(snapshot);
  assert.ok(progress.tracks.every(track => track.value === 0 && !track.unlocked));
  assert.ok(progress.briefs.every(brief => brief.artifact === null && brief.fileCount === 0));
  const empty = fixture().days[0].evidence[0]; empty.files = []; snapshot.days[0].evidence = [empty];
  progress = P.build(snapshot);
  assert.ok(progress.tracks.every(track => track.value === 0 && track.evidenceIds.length === 0));
  assert.equal(progress.briefs[0].commits, 1); assert.match(progress.briefs[0].summary, /未包含文件变更/);
  assert.deepEqual(progress.briefs[0].evidenceIds, [empty.hash]);
});

test('unknown Git is unavailable rather than zero; unknown usage remains null in Git briefs', () => {
  const noGit = P.build(missingGit(fixture()));
  assert.ok(noGit.tracks.every(track => track.progress === null && track.value === null && track.status === 'unavailable' && !track.unlocked));
  assert.ok(noGit.briefs.every(brief => brief.commits === null && brief.fileCount === null && brief.artifact === null && brief.source === 'codex'));
  assert.deepEqual(noGit.briefs[0].fileCounts, { code: null, document: null, asset: null, other: null });
  const noCodex = P.build(missingCodex(fixture()));
  assert.ok(noCodex.briefs.every(brief => brief.source === 'git' && Object.values(brief.usage).every(value => value === null)));
  assert.equal(noCodex.tracks[0].value, 6);
  assert.deepEqual(P.build(missingCodex(missingGit(fixture()))).briefs, []);
});

test('token changes alter brief counters and existing depth only, not milestone quantities or shape choice', () => {
  const snapshot = fixture(), world = semanticWorld(snapshot, ['key', 'quill', 'musicbox']), before = P.build(snapshot, world);
  for (const day of snapshot.days) Object.assign(day.usage, { inputTokens: 1000000, cachedInputTokens: 0, outputTokens: 100000, totalTokens: 1100000, sessions: 50 });
  const after = P.build(snapshot, world);
  for (let index = 0; index < after.tracks.length; index++) {
    const { depth: firstDepth, ...first } = before.tracks[index], { depth: secondDepth, ...second } = after.tracks[index];
    assert.deepEqual(second, first);
  }
  assert.ok(after.briefs.every(brief => brief.artifact.source === 'ai' && brief.usage.totalTokens === 1100000));
});

test('forged optional projection and basic world counts cannot manufacture progress', () => {
  const snapshot = fixture(); snapshot.days = snapshot.days.slice(0, 1);
  const expected = P.build(snapshot), forged = W.build(snapshot);
  forged.artifacts[0].recipeId = 'seedling'; forged.artifacts.push({ ...forged.artifacts[0], id: 'invented', date: '2026-11-17' });
  assert.deepEqual(P.build(snapshot, forged, { depth: 9999, days: fixture().days, totals: { days: 100 } }), expected);
});

test('semantic world is revalidated by project, date, fingerprint, schema, source and citations', () => {
  const snapshot = fixture(), valid = semanticWorld(snapshot, ['seedling']), fallback = P.build(snapshot);
  const mutations = [
    world => { world.projectId = 'foreign'; },
    world => world.artifacts.forEach(item => { item.id = item.id.replace('progress-fixture', 'foreign'); }),
    world => world.artifacts.forEach(item => { item.date = '2026-11-17'; }),
    world => world.artifacts.forEach(item => { item.fingerprint = '0'.repeat(64); }),
    world => world.artifacts.forEach(item => { item.recipeId = 'invented'; }),
    world => world.artifacts.forEach(item => { item.source = 'demo'; }),
    world => world.artifacts.forEach(item => { item.generatedAt = 'invalid'; }),
    world => world.artifacts.forEach(item => { item.evidenceIds = ['a'.repeat(40)]; }),
    world => world.artifacts.forEach(item => { item.name = 'too-long'.repeat(50); })
  ];
  for (const mutate of mutations) {
    const world = clone(valid); mutate(world);
    if (world.artifacts.every(item => item.date === '2026-11-17')) world.artifacts.forEach(item => { item.id = 'mismatched-id'; });
    assert.deepEqual(P.build(snapshot, world), fallback);
  }
  assert.deepEqual(P.build(snapshot, valid).tracks[2].artifactTypes, ['seedling']);
});

test('source revision invalidates old AI variety and Git withdrawal retracts facilities', () => {
  const snapshot = fixture(); snapshot.days = snapshot.days.slice(0, 3);
  for (const day of snapshot.days) day.evidence[0].files = [{ path: 'same/source.js', kind: 'code' }];
  const world = semanticWorld(snapshot, ['key', 'quill', 'musicbox']), previous = P.build(snapshot, world), projection = C.project(snapshot);
  assert.equal(previous.tracks[2].unlocked, true);
  for (const day of snapshot.days) day.evidence[0].title = 'Source metadata was revised';
  const revised = P.build(snapshot, world, projection);
  assert.equal(revised.tracks[2].value, 1); assert.equal(revised.tracks[2].unlocked, false);
  assert.equal(revised.tracks[2].depth, null); assert.ok(revised.briefs.every(brief => brief.artifact.source === 'rules'));
  const removedHash = snapshot.days[2].evidence[0].hash; snapshot.days[2].evidence = [];
  const retracted = P.build(snapshot, world, projection);
  assert.equal(retracted.tracks[0].value, 2); assert.equal(retracted.tracks[0].unlocked, false);
  assert.ok(retracted.tracks.every(track => !track.evidenceIds.includes(removedHash)));
});

test('project changes and window expiry cannot reuse previous facilities or daily briefs', () => {
  const snapshot = fixture(), world = semanticWorld(snapshot, ['seedling']), projection = C.project(snapshot);
  snapshot.project.id = 'another-project';
  const switched = P.build(snapshot, world, projection);
  assert.equal(switched.projectId, 'another-project'); assert.ok(switched.briefs.every(brief => brief.id.startsWith('another-project/') && brief.artifact.source === 'rules'));
  snapshot.collectedAt = '2026-12-15T02:00:00Z';
  const expired = P.build(snapshot, world, projection);
  assert.deepEqual(expired.briefs, []); assert.ok(expired.tracks.every(track => track.value === 0 && !track.unlocked && track.dates.length === 0));
});

test('daily references resolve to actual dated commits and result mutations do not reach input or siblings', () => {
  const snapshot = fixture(), world = semanticWorld(snapshot, ['key', 'quill', 'musicbox']), original = clone(snapshot), originalWorld = clone(world);
  const progress = P.build(snapshot, world), expected = clone(progress);
  for (const brief of progress.briefs) {
    const day = snapshot.days.find(day => day.date === brief.date);
    assert.ok(brief.evidenceIds.every(hash => day.evidence.some(entry => entry.hash === hash)));
    assert.ok(brief.paths.every(file => day.evidence.some(entry => entry.files.some(item => item.path === file))));
  }
  progress.tracks[0].dates.length = 0; progress.tracks[1].evidenceIds.length = 0;
  progress.briefs[0].usage.totalTokens = 0; progress.briefs[0].paths.push('forged'); progress.briefs[0].artifact.evidenceIds.length = 0;
  assert.ok(progress.tracks[2].evidenceIds.length > 0);
  assert.deepEqual(snapshot, original); assert.deepEqual(world, originalWorld); assert.deepEqual(P.build(snapshot, world), expected);
});
