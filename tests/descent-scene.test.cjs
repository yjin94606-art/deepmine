'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../dist/descent-scene.js'), 'utf8');

function fixture(t, options = {}) {
  let now = 0, nextFrame = 0, nextTimer = 0, width = options.width || 1440, height = options.height || 740;
  const timers = new Map();
  let occluders = [];
  const frames = new Map(), progress = [], opened = [], artifactsOpened = [], roomsOpened = [], reveals = [], impacts = [], scans = [], hovers = [], inspections = [], observers = [];
  const stats = { tiles: 0, biomes: new Set(), blits: 0, crystals: [], rigs: [], supports: 0, environments: [], dressing: [], seams: [], workshops: [], outputs: [], chambers: [], stations: [], drones: [], ambient: 0, veins: [], texts: [], translations: [] };
  const context = new Proxy({ measureText: value => ({ width: value.length * 8 }), drawImage: (...args) => { stats.blits++; options.onDrawImage?.(...args); }, translate: (x, y) => stats.translations.push({ x, y }), fillText: (value, x, y) => stats.texts.push({ value, x, y }) }, {
    get: (object, key) => object[key] || (() => {}),
    set: (object, key, value) => { if (key === 'fillStyle') assert.equal(typeof value, 'string'); object[key] = value; return true; }
  });
  class Element {
    constructor() { this.style = {}; this.attrs = {}; this.dataset = {}; this.children = []; this.listeners = new Map(); this.parentNode = null; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    removeAttribute(key) { delete this.attrs[key]; }
    addEventListener(key, value) { this.listeners.set(key, value); }
    removeEventListener(key) { this.listeners.delete(key); }
    insertBefore(child, before) { if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1); const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); child.parentNode = this; }
    remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
    contains(child) { return this === child || this.children.some(item => item.contains(child)); }
    getContext() { return context; }
    getBoundingClientRect() { return { left: options.left || 0, top: options.top || 0, width, height }; }
    focus() { document.activeElement = this; this.listeners.get('focus')?.({ target: this }); }
    setPointerCapture() {}
    releasePointerCapture() {}
  }
  const document = new Element(); document.visibilityState = 'visible'; document.createElement = () => new Element();
  const canvas = new Element(), parent = new Element(); parent.insertBefore(canvas, null);
  parent.querySelectorAll = () => occluders.map(bounds => ({ hidden: false, getBoundingClientRect: () => ({ ...bounds, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top }) }));
  const media = { matches: Boolean(options.reduced), listener: null, addEventListener(_name, listener) { this.listener = listener; }, removeEventListener() { this.listener = null; } };
  class ResizeObserver { constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } }
  class IntersectionObserver extends ResizeObserver {}
  const palette = Object.fromEntries(['ink', 'deep', 'steel', 'shine', 'earthShadow', 'earth', 'earthLight', 'tealShadow', 'shaleShadow', 'bedrockShadow', 'woodShadow', 'woodLight'].map((key, i) => [key, '#' + (0x203040 + i * 257).toString(16)]));
  const window = {
    devicePixelRatio: 2, matchMedia: () => media, addEventListener() {}, removeEventListener() {},
    setTimeout(callback,delay) { const id=++nextTimer;timers.set(id,{at:now+delay,callback});return id; },
    clearTimeout(id) { timers.delete(id); },
    OutputArt: options.noOutputArt ? null : { draw(_ctx, x, y, type, variant) { stats.outputs.push({ x, y, type, variant }); } },
    ExpeditionLife: {
      drawStation(_ctx, x, y, type, frame, compact) { stats.stations.push({ x, y, type, frame, compact }); },
      drawDrone(_ctx, x, y, frame, working) { stats.drones.push({ x, y, frame, working }); },
      drawAmbient() { stats.ambient++; }
    },
    ExpeditionArt: {
      drawEnvironment(_ctx, biome, x, y, variant) { stats.environments.push({ biome, x, y, variant }); },
      drawRelic(_ctx, x, y, recipeId, variant, frame, assembled) { stats.workshops.push({ x, y, recipeId, variant, frame, assembled }); },
      drawDressing(_ctx, biome, x, y, variant) { stats.dressing.push({ biome, x, y, variant }); },
      drawSeam(_ctx, biome, x, y, variant) { stats.seams.push({ biome, x, y, variant }); },
      drawChamber(_ctx, x, y, theme, variant, level, frame, compact) { stats.chambers.push({ x, y, theme, variant, level, frame, compact }); },
      drawVein(_ctx, x, y, kind, richness, revealed) { stats.veins.push({ x, y, kind, richness, revealed }); }
    },
    DrillArt: {
      palette,
      drawTile(_ctx, _x, _y, biome) { stats.tiles++; stats.biomes.add(biome); },
      drawRig(_ctx, x, y, frame, working) { stats.rigs.push({ x, y, frame, working }); },
      drawRigHeavy(_ctx, x, y, frame, working) { stats.rigs.push({ x, y, frame, working, heavy: true }); },
      drawCrystal(_ctx, x, y, kind) { stats.crystals.push({ x, y, kind }); },
      drawSupport() { stats.supports++; }, drawLamp() {}
    }
  };
  vm.runInContext(source, vm.createContext({ window, document, performance: { now: () => now }, ResizeObserver, IntersectionObserver, requestAnimationFrame: callback => { const id = ++nextFrame; frames.set(id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id) }));
  const scene = window.ExpeditionScene.create(canvas, { pauseAtFindings: options.pauseAtFindings, getWorkSprite:options.getWorkSprite, onProgress: value => progress.push({ at: now, value }), onDiscovery: id => opened.push(id), onArtifact: id => artifactsOpened.push(id), onRoom: id => roomsOpened.push(id), onReveal: value => { reveals.push(value); options.onReveal?.(value); }, onImpact: value => impacts.push(value), onScan: value => scans.push(value), ...(options.sourceUI ? { onHover: value => hovers.push(value), onInspect: value => inspections.push(value) } : {}) });
  t.after(() => scene.destroy());
  function step(ms = 40) {
    now+=ms;
    for(const [id,timer] of timers) if(timer.at<=now){timers.delete(id);timer.callback();}
    const queued=[...frames.values()];frames.clear();queued.forEach(callback=>callback(now));
  }
  function advance(ms, quantum = 40) { for (let elapsed = 0; elapsed < ms; elapsed += quantum) step(Math.min(quantum, ms - elapsed)); }
  function fire(name, extra = {}) { canvas.listeners.get(name)?.({ target: canvas, preventDefault() {}, ...extra }); }
  return {
    scene, canvas, parent, window, document, media, frames, progress, opened, artifactsOpened, roomsOpened, reveals, impacts, scans, hovers, inspections, stats, observers, step, advance, fire,
    hide(value) { document.visibilityState = value ? 'hidden' : 'visible'; document.listeners.get('visibilitychange')(); },
    elapse(ms) { now += ms; },
    resize(w, h) { width = w; height = h; observers[0].callback([]); },
    cover(rectangles) { occluders = rectangles; scene.setState({}); },
    reduce(value) { media.matches = value; media.listener({ matches: value }); },
    resetStats() { stats.blits = 0; stats.crystals = []; stats.rigs = []; stats.supports = 0; stats.environments = []; stats.dressing = []; stats.seams = []; stats.workshops = []; stats.outputs = []; stats.chambers = []; stats.stations = []; stats.drones = []; stats.ambient = 0; stats.veins = []; stats.texts = []; stats.translations = []; }
  };
}
const nodes = [{ id: 'one', depth: 1, kind: 'code', title: '真实变更一' }, { id: 'three', depth: 3, kind: 'document', title: '真实变更三' }];

test('initial target begins at zero with synchronous scoped diagnostics', t => {
  const f = fixture(t);
  f.scene.setState({ depth: 50, discoveries: nodes, active: true, scopeKey: 'live/project/today' });
  const state = f.scene.getState();
  assert.equal(state.depth, 0); assert.equal(state.targetDepth, 50); assert.equal(state.working, true);
  assert.equal(state.scopeKey, 'live/project/today'); assert.equal(state.mode, 'follow');
  assert.deepEqual(Array.from(state.revealedIds), []);
  assert.equal(f.progress.at(-1).value.scopeKey, state.scopeKey);
});

test('normal drilling advances at 2.5m/s while world camera travels continuously downward', t => {
  const f = fixture(t); f.scene.setState({ depth: 50, active: true });
  f.step(); let previous = f.scene.getState().cameraY;
  for (let i = 0; i < 250; i++) { f.step(); const next = f.scene.getState(); assert.ok(next.cameraY >= previous); previous = next.cameraY; }
  assert.ok(Math.abs(f.scene.getState().depth - 25) < .00001);
  assert.ok(f.scene.getState().cameraY > f.progress[1].value.cameraY + 150);
});

test('observed target is a hard endpoint and final diagnostics are emitted', t => {
  const f = fixture(t); f.scene.setState({ depth: 3, discoveries: nodes, active: true }); f.advance(6000);
  const state = f.scene.getState();
  assert.equal(state.depth, 3); assert.equal(state.working, false); assert.equal(state.status, 'idle'); assert.equal(f.frames.size, 0);
  assert.equal(f.progress.at(-1).value.depth, 3); assert.equal(f.progress.at(-1).value.cameraY, state.cameraY);
});

test('new data increases target without rewinding the displayed depth or moving source coordinates', t => {
  const f = fixture(t); f.scene.setState({ depth: 30, active: true, scopeKey: 'today' }); f.advance(2040);
  const before = f.scene.getState();
  f.scene.setState({ depth: 50, startDepth: 0, scopeKey: 'today', active: true });
  assert.equal(f.scene.getState().depth, before.depth); assert.equal(f.scene.getState().cameraY, before.cameraY); assert.equal(f.scene.getState().targetDepth, 50);
  f.scene.setState({ depth: 4, scopeKey: 'today' }); assert.equal(f.scene.getState().targetDepth, 50);
});

test('explicit reset and scope changes correctly clamp smaller real targets', t => {
  const f = fixture(t); f.scene.setState({ depth: 60, discoveries: nodes, active: true, scopeKey: 'old', instant: true });
  f.scene.setState({ depth: 8, startDepth: 50, reset: true, scopeKey: 'old' });
  assert.equal(f.scene.getState().depth, 8); assert.equal(f.scene.getState().targetDepth, 8);
  f.scene.setState({ depth: 2, scopeKey: 'new', active: false, instant: true });
  assert.equal(f.scene.getState().depth, 2); assert.equal(f.scene.getState().targetDepth, 2); assert.deepEqual(Array.from(f.scene.getState().revealedIds), []);
});

test('active false never automatically consumes a target', t => {
  const f = fixture(t); f.scene.setState({ depth: 20, startDepth: 4, active: false }); f.advance(10000);
  assert.equal(f.scene.getState().depth, 4); assert.equal(f.scene.getState().working, false); assert.equal(f.frames.size, 0);
});

test('pause freezes both physical depth and camera until explicit unpause', t => {
  const f = fixture(t); f.scene.setState({ depth: 50, active: true }); f.advance(2040);
  f.scene.setPaused(true); const stopped = f.scene.getState(); f.elapse(60000); f.step();
  assert.equal(f.scene.getState().depth, stopped.depth); assert.equal(f.scene.getState().cameraY, stopped.cameraY); assert.equal(f.scene.getState().status, 'paused');
  f.scene.setPaused(false); f.step(); assert.equal(f.scene.getState().depth, stopped.depth); f.advance(1000);
  assert.ok(Math.abs(f.scene.getState().depth - stopped.depth - 2.5) < .00001);
});

test('hidden documents freeze with no wall-clock catch-up after resuming', t => {
  const f = fixture(t); f.scene.setState({ depth: 100, active: true }); f.advance(1040);
  f.hide(true); const stopped = f.scene.getState(); f.elapse(300000);
  assert.equal(f.frames.size, 0); assert.equal(f.scene.getState().depth, stopped.depth);
  f.hide(false); f.step(); assert.equal(f.scene.getState().depth, stopped.depth); f.step();
  assert.ok(f.scene.getState().depth < stopped.depth + .11);
});

test('historical explicit replay moves at 5m/s and never changes its observed target', async t => {
  const f = fixture(t); f.scene.setState({ depth: 20, instant: true, active: false, scopeKey: 'history' });
  const replay = f.scene.replay(0, 20); assert.equal(f.scene.getState().mode, 'replay');
  f.advance(2040); assert.ok(Math.abs(f.scene.getState().depth - 10) < .00001); assert.equal(f.scene.getState().targetDepth, 20);
  f.advance(4000); await replay;
  assert.equal(f.scene.getState().depth, 20); assert.equal(f.scene.getState().working, false); assert.equal(f.scene.getState().mode, 'follow');
});

test('a paused replay Promise remains pending and resumes without jumping', async t => {
  const f = fixture(t); f.scene.setState({ depth: 15, instant: true, active: false });
  let resolved = false; const replay = f.scene.replay(0, 15).then(() => { resolved = true; });
  f.advance(1040); f.scene.setPaused(true); const stopped = f.scene.getState().depth; f.elapse(60000); await Promise.resolve();
  assert.equal(resolved, false); assert.equal(f.scene.getState().depth, stopped); assert.equal(f.scene.getState().mode, 'replay');
  f.scene.setPaused(false); f.step(); assert.equal(f.scene.getState().depth, stopped); f.advance(5000); await replay;
  assert.equal(f.scene.getState().depth, 15);
});

test('requesting replay while paused does not even rewind until resumed', async t => {
  const f = fixture(t); f.scene.setState({ depth: 10, instant: true, active: false }); f.scene.setPaused(true);
  const replay = f.scene.replay(0, 10); assert.equal(f.scene.getState().depth, 10); f.elapse(10000); assert.equal(f.scene.getState().depth, 10);
  f.scene.setPaused(false); f.step(); assert.equal(f.scene.getState().depth, 0); f.advance(3000); await replay;
});

test('refreshes preserve a replay endpoint, while scope reset resolves the old replay safely', async t => {
  const f = fixture(t); f.scene.setState({ depth: 10, instant: true, active: false, scopeKey: 'a' });
  const replay = f.scene.replay(0, 10); f.advance(440); const before = f.scene.getState().depth;
  f.scene.setState({ depth: 20, startDepth: 0, active: false, scopeKey: 'a' });
  assert.equal(f.scene.getState().depth, before); assert.equal(f.scene.getState().replayTargetDepth, 10); assert.equal(f.scene.getState().targetDepth, 20);
  f.scene.setState({ depth: 5, instant: true, active: false, scopeKey: 'b' }); await replay;
  assert.equal(f.scene.getState().depth, 5); assert.equal(f.scene.getState().scopeKey, 'b'); assert.equal(f.scene.getState().mode, 'follow');
});

test('reduced motion directly seeks actual observed data and schedules no animation', async t => {
  const f = fixture(t, { reduced: true }); f.scene.setState({ depth: 17, active: true, discoveries: nodes });
  assert.equal(f.scene.getState().depth, 17); assert.equal(f.frames.size, 0);
  await f.scene.replay(0, 12); assert.equal(f.scene.getState().depth, 17);
  f.reduce(false); f.scene.setState({ depth: 20 }); f.advance(440); assert.ok(f.scene.getState().depth > 17);
  f.reduce(true); assert.equal(f.scene.getState().depth, 20); assert.equal(f.frames.size, 0);
});

test('only supplied discoveries at reached depth become visible or keyboard accessible', t => {
  const f = fixture(t); f.scene.setState({ depth: 3, active: true, discoveries: nodes });
  assert.equal(f.stats.crystals.length, 0); assert.equal(f.parent.children[1].children.length, 0);
  f.advance(480); assert.deepEqual(Array.from(f.scene.getState().revealedIds), ['one']);
  assert.equal(f.parent.children[1].children.length, 1);
  const button = f.parent.children[1].children[0]; button.focus(); button.listeners.get('click')(); assert.deepEqual(f.opened, ['one']);
  f.advance(3000); assert.deepEqual(Array.from(f.scene.getState().revealedIds), ['one', 'three']);
});

test('resizing changes the projection scale but leaves mine and node world coordinates unchanged', t => {
  const f = fixture(t); f.scene.setState({ depth: 3, discoveries: nodes, instant: true, active: false });
  const before = f.stats.crystals.slice(-2).map(item => [item.x, item.y]); const depth = f.scene.getState().depth;
  f.resetStats(); f.resize(390, 700);
  assert.equal(f.scene.getState().scale, 2); assert.equal(f.scene.getState().depth, depth);
  assert.deepEqual(f.stats.crystals.slice(-2).map(item => [item.x, item.y]), before);
});

test('old tunnels may be inspected but the camera cannot be dragged into unlocked future terrain', t => {
  const f = fixture(t); f.scene.setState({ depth: 100, instant: true, active: false }); const frontier = f.scene.getState().cameraY;
  f.fire('keydown', { key: 'Home' }); assert.equal(f.scene.getState().mode, 'inspect'); assert.ok(f.scene.getState().cameraY < frontier - 500);
  f.fire('wheel', { deltaY: 1000000, deltaMode: 0 }); assert.ok(f.scene.getState().cameraY <= frontier);
  f.fire('wheel', { deltaY: -1000000, deltaMode: 0 }); assert.ok(f.scene.getState().cameraY > -1000);
  f.fire('keydown', { key: 'End' }); f.advance(3000); assert.equal(f.scene.getState().mode, 'follow'); assert.equal(f.scene.getState().depth, 100); assert.ok(Math.abs(f.scene.getState().cameraY - frontier) < .05);
});

test('render cost is tied to visible rows and a bounded number of real nodes', t => {
  const f = fixture(t); const many = Array.from({ length: 4000 }, (_, index) => ({ id: 'node-' + index, depth: index / 8, kind: 'code', title: '真实记录' }));
  f.resetStats(); f.scene.setState({ depth: 499, instant: true, active: false, discoveries: many });
  assert.ok(f.stats.blits < 250, `tile blits: ${f.stats.blits}`); assert.ok(f.stats.crystals.length <= 16); assert.ok(f.stats.tiles <= 16);
  const tiles = f.stats.tiles; f.resetStats(); f.scene.setPaused(true); f.scene.setPaused(false); assert.equal(f.stats.tiles, tiles);
});

test('the 50m preview crosses visual soil, teal and shale strata without altering source progress', t => {
  const f = fixture(t); f.scene.setState({ depth: 50, instant: true, active: false });
  assert.ok(f.stats.biomes.has(0)); assert.ok(f.stats.biomes.has(1)); assert.ok(f.stats.biomes.has(2)); assert.equal(f.stats.biomes.has(3), false);
  assert.equal(f.scene.getState().depth, 50); assert.equal(f.scene.getState().targetDepth, 50);
  f.scene.setState({ depth: 100, instant: true, active: false }); assert.ok(f.stats.biomes.has(3));
});

test('normal-frame telemetry is throttled to at most eight updates per second', t => {
  const f = fixture(t); f.scene.setState({ depth: 50, active: true }); const start = f.progress.length;
  f.advance(4040);
  const updates = f.progress.slice(start); assert.ok(updates.length <= 33);
  for (let i = 1; i < updates.length; i++) assert.ok(updates[i].at - updates[i - 1].at >= 125);
});

test('diagnostics are immutable copies and source data is never mutated', t => {
  const f = fixture(t); const input = Object.freeze({ depth: 3, discoveries: Object.freeze(nodes.map(node => Object.freeze({ ...node }))), instant: true, active: false });
  f.scene.setState(input); const state = f.scene.getState(); assert.ok(Object.isFrozen(state)); assert.ok(Object.isFrozen(state.revealedIds));
  assert.throws(() => { state.depth = 900; }, TypeError); assert.throws(() => { state.revealedIds.push('fake'); }, TypeError);
  assert.equal(f.scene.getState().depth, 3); assert.equal(input.discoveries[0].x, undefined);
});

test('destroy resolves pending replay and removes every scheduled frame, observer, and control', async t => {
  const f = fixture(t); f.scene.setState({ depth: 20, active: false, instant: true, discoveries: nodes });
  const replay = f.scene.replay(0, 20); f.scene.destroy(); await replay;
  assert.equal(f.frames.size, 0); assert.equal(f.canvas.listeners.size, 0); assert.equal(f.document.listeners.size, 0); assert.equal(f.parent.children.length, 1); assert.ok(f.observers.every(observer => observer.disconnected));
  f.scene.destroy(); f.scene.setState({ depth: 999 }); assert.equal(f.frames.size, 0);
});

const artifact = { id: 'project/2026-11-17/artifact', date: '2026-11-17', depth: 3, recipeId: 'engine', name: '齿轮引擎', kindMask: 1, variant: 2, evidenceIds: ['commit-a'] };

test('forward veins are limited to eight metres and cannot be opened before excavation', t => {
  const f = fixture(t); f.resetStats();
  f.scene.setState({ depth: 10, active: false, discoveries: [{ id: 'near', depth: 5, kind: 'asset' }, { id: 'far', depth: 9, kind: 'code' }] });
  assert.equal(f.stats.veins.length, 1); assert.equal(f.stats.veins[0].kind, 'asset'); assert.equal(f.stats.veins[0].revealed, false);
  assert.equal(f.stats.crystals.length, 0); assert.equal(f.parent.children[1].children.length, 0); assert.equal(f.reveals.length, 0);
  f.scene.setState({ active: true }); f.advance(2200);
  assert.deepEqual(f.reveals.map(item => item.id), ['near']); assert.deepEqual(Array.from(f.scene.getState().revealedIds), ['near']);
});

test('downward crossings reveal supplied minerals and the daily artifact once per scope', t => {
  const f = fixture(t); f.scene.setState({ depth: 4, active: true, scopeKey: 'today', discoveries: nodes, artifacts: [artifact] }); f.advance(2040);
  assert.deepEqual(f.reveals.map(item => [item.type, item.id]), [['mineral', 'one'], ['mineral', 'three'], ['artifact', artifact.id]]);
  assert.equal(f.reveals.at(-1).name, artifact.name); assert.equal(f.reveals.at(-1).depth, 3); assert.ok(Object.isFrozen(f.reveals[0]));
  assert.deepEqual(Array.from(f.scene.getState().revealedArtifactIds), [artifact.id]);
  f.scene.setState({ depth: 4, discoveries: nodes, artifacts: [{ ...artifact }] }); f.advance(3000); assert.equal(f.reveals.length, 3);
  f.scene.setState({ depth: 4, reset: true, active: true, scopeKey: 'another-day', discoveries: nodes, artifacts: [artifact] }); f.advance(2040);
  assert.equal(f.reveals.length, 6);
});

test('historical and reduced-motion seeks show real artifacts without reward-event backlogs', async t => {
  const f = fixture(t); f.scene.setState({ depth: 10, instant: true, active: false, discoveries: nodes, artifacts: [artifact] });
  assert.equal(f.reveals.length, 0); assert.deepEqual(Array.from(f.scene.getState().revealedArtifactIds), [artifact.id]); assert.equal(f.scene.getState().feedbackCount, 0);
  const quiet = fixture(t, { reduced: true }); quiet.scene.setState({ depth: 10, active: true, discoveries: nodes, artifacts: [artifact] });
  assert.equal(quiet.reveals.length, 0); assert.equal(quiet.frames.size, 0); assert.deepEqual(Array.from(quiet.scene.getState().revealedArtifactIds), [artifact.id]);
  await quiet.scene.replay(0, 10); assert.equal(quiet.reveals.length, 0); assert.equal(quiet.scene.getState().targetDepth, 10);
});

test('each explicit replay may repeat presentation events while leaving evidence and target unchanged', async t => {
  const f = fixture(t); const sourceArtifact = Object.freeze({ ...artifact, evidenceIds: Object.freeze(['commit-a']) });
  f.scene.setState({ depth: 4, instant: true, active: false, discoveries: nodes, artifacts: [sourceArtifact] });
  for (let run = 0; run < 2; run++) { const replay = f.scene.replay(0, 4); f.advance(2040); await replay; }
  assert.deepEqual(f.reveals.map(item => item.type), ['mineral', 'mineral', 'artifact', 'mineral', 'mineral', 'artifact']);
  assert.equal(f.scene.getState().targetDepth, 4); assert.equal(f.scene.getState().depth, 4); assert.equal(sourceArtifact.depth, 3); assert.equal(sourceArtifact.x, undefined);
  assert.deepEqual(sourceArtifact.evidenceIds, ['commit-a']);
});

test('reached artifact recipe and kind revisions reassemble exactly once and freeze while paused', t => {
  const f = fixture(t); f.scene.setState({ depth: 10, instant: true, active: false, scopeKey: 'today', artifacts: [artifact] });
  const next = { ...artifact, recipeId: 'prism', name: '棱镜灯', kindMask: 5 };
  f.scene.setState({ artifacts: [next] }); f.scene.setState({ artifacts: [{ ...next }] }); f.advance(80);
  assert.equal(f.reveals.length, 1); assert.equal(f.reveals[0].name, next.name); assert.ok(f.scene.getState().feedbackCount > 0);
  f.scene.setState({ artifacts: [next] }); f.advance(80); assert.equal(f.reveals.length, 1);
  f.scene.setPaused(true); const revised = { ...next, kindMask: 7 };
  f.scene.setState({ artifacts: [revised] }); f.scene.setState({ artifacts: [revised] }); f.advance(5000);
  assert.equal(f.reveals.length, 1); assert.equal(f.frames.size, 0);
  f.scene.setPaused(false); f.step(); assert.equal(f.reveals.length, 2);
  f.scene.setState({ artifacts: [revised] }); f.advance(2000); assert.equal(f.reveals.length, 2); assert.equal(f.scene.getState().feedbackCount, 0);
});

test('reduced-motion recipe changes emit one accessible event after a pause without animation', t => {
  const f = fixture(t, { reduced: true }); f.scene.setState({ depth: 10, active: false, artifacts: [artifact] }); f.scene.setPaused(true);
  const revised = { ...artifact, recipeId: 'beacon', kindMask: 3 };
  f.scene.setState({ artifacts: [revised] }); f.scene.setState({ artifacts: [revised] }); assert.equal(f.reveals.length, 0);
  f.scene.setPaused(false); assert.equal(f.reveals.length, 1); assert.equal(f.frames.size, 0); assert.equal(f.scene.getState().feedbackCount, 0);
  f.scene.setState({ artifacts: [revised] }); assert.equal(f.reveals.length, 1);
});

test('small wall relics keep recipe and world anchors across resize and open artifact provenance', t => {
  const f = fixture(t); f.scene.setState({ depth: 3, instant: true, active: false, artifacts: [artifact] });
  const workshop = f.stats.workshops.at(-1); assert.equal(workshop.recipeId, 'engine'); assert.equal(workshop.variant, 2); assert.equal(workshop.assembled, true);
  const controls = f.parent.children[1].children; assert.equal(controls.length, 1); assert.equal(controls[0].dataset.hitKey, 'artifact:' + artifact.id);
  controls[0].listeners.get('click')(); assert.deepEqual(f.artifactsOpened, [artifact.id]); assert.deepEqual(f.opened, []);
  f.resetStats(); f.resize(390, 700); const resized = f.stats.workshops.at(-1);
  assert.deepEqual([resized.x, resized.y], [workshop.x, workshop.y]);
  assert.ok(Object.isFrozen(f.scene.getState().revealedArtifactIds));
});

test('layer dates and biome diagnostics track actual drilling while world markers use recorded amounts', t => {
  const f = fixture(t); const layers = Object.freeze([
    Object.freeze({ date: '2026-11-16', depthStart: 0, depthEnd: 18, tokens: 12300, usageDepth: 8, evidenceDepth: 10 }),
    Object.freeze({ date: '2026-11-17', depthStart: 18, depthEnd: 50, tokens: null, usageDepth: 14, evidenceDepth: 18 })
  ]);
  f.scene.setState({ depth: 50, active: true, layers }); assert.equal(f.scene.getState().currentLayerDate, '2026-11-16'); assert.equal(f.scene.getState().biomeId, 'roots');
  assert.ok(f.stats.texts.some(item => item.value === '11.16')); assert.ok(f.stats.texts.some(item => item.value === '12.3k')); assert.equal(f.stats.texts.some(item => item.value === '11.17'), false);
  f.advance(7640); assert.equal(f.scene.getState().currentLayerDate, '2026-11-17'); assert.equal(f.scene.getState().biomeId, 'aquifer'); assert.ok(f.stats.texts.some(item => item.value === '—'));
  f.scene.setState({ depth: 50, instant: true }); assert.equal(f.scene.getState().biomeId, 'crystal'); assert.equal(f.scene.getState().currentLayerDate, '2026-11-17');
});

test('sparse landmarks and small edge dressing remain biome-specific without creating discoveries', t => {
  const f = fixture(t); f.resetStats(); f.scene.setState({ depth: 50, instant: true, active: false });
  assert.ok(f.stats.environments.length <= 2); assert.ok(f.stats.dressing.length >= 3 && f.stats.dressing.length <= 10); assert.ok(f.stats.dressing.some(item => item.biome === 'crystal'));
  const uniqueAnchors = new Set(f.stats.dressing.map(item => item.y));
  f.resetStats(); f.resize(390, 700); assert.ok(f.stats.dressing.some(item => uniqueAnchors.has(item.y)));
  assert.equal(f.parent.children[1].children.length, 0); assert.equal(f.reveals.length, 0); assert.equal(f.stats.workshops.length, 0);
});

test('feedback freezes in hidden pages and removed evidence leaves no collectible or stale effect', t => {
  const f = fixture(t); f.scene.setState({ depth: 4, active: true, discoveries: nodes, artifacts: [artifact] }); f.advance(1320);
  assert.ok(f.scene.getState().feedbackCount > 0); const count = f.scene.getState().feedbackCount;
  f.hide(true); f.elapse(120000); f.step(); assert.equal(f.scene.getState().feedbackCount, count); assert.equal(f.frames.size, 0);
  f.scene.setState({ artifacts: [], discoveries: [] }); assert.equal(f.scene.getState().feedbackCount, 0); assert.deepEqual(Array.from(f.scene.getState().revealedArtifactIds), []);
  f.hide(false); assert.equal(f.parent.children[1].children.length, 0); f.advance(3000); assert.equal(f.scene.getState().depth, 4);
});

test('late historical additions stay silent and malformed artifact records do not create rewards', t => {
  const f = fixture(t); f.scene.setState({ depth: 10, instant: true, active: false });
  f.scene.setState({ artifacts: [artifact, { ...artifact }, { id: 'negative', depth: -1 }, { id: 'missing', depth: null }, { id: 'infinite', depth: Infinity }, { id: '', depth: 3 }] });
  assert.deepEqual(Array.from(f.scene.getState().revealedArtifactIds), [artifact.id]); assert.equal(f.reveals.length, 0);
  f.scene.setState({ scopeKey: 'new', depth: 0, active: false }); assert.deepEqual(Array.from(f.scene.getState().revealedArtifactIds), []); assert.equal(f.scene.getState().currentLayerDate, null);
});

test('boost lasts 1.2 active seconds, has a three second cooldown, and never increases the target', t => {
  const f = fixture(t); f.scene.setState({ depth: 100, active: true }); f.step();
  assert.equal(f.scene.getState().boostReady, true); assert.equal(f.scene.boost(), true); assert.equal(f.scene.boost(), false);
  f.advance(1200); const after = f.scene.getState();
  assert.ok(Math.abs(after.depth - 7.8) < .000001); assert.ok(after.boostRemaining < .000001); assert.ok(Math.abs(after.boostCooldown - 1.8) < .000001);
  assert.equal(after.targetDepth, 100); assert.equal(after.boostReady, false);
  f.advance(1800); assert.equal(f.scene.getState().boostReady, true); assert.equal(f.scene.boost(), true);
  assert.deepEqual(f.impacts.map(item => item.type), ['boost', 'boost']); assert.ok(Object.isFrozen(f.impacts[0]));
});

test('boost cannot mine while paused, hidden, inspecting, inactive, reduced, or arrived', t => {
  const f = fixture(t); f.scene.setState({ depth: 20, active: true });
  f.scene.setPaused(true); assert.equal(f.scene.boost(), false); f.scene.setPaused(false);
  f.hide(true); assert.equal(f.scene.boost(), false); f.hide(false);
  f.fire('keydown', { key: 'Home' }); assert.equal(f.scene.boost(), false); f.fire('keydown', { key: 'End' });
  f.scene.setState({ active: false }); assert.equal(f.scene.boost(), false);
  f.scene.setState({ active: true, instant: true }); assert.equal(f.scene.boost(), false);
  f.reduce(true); f.scene.setState({ depth: 30 }); assert.equal(f.scene.boost(), false);
  assert.equal(f.impacts.length, 0); assert.equal(f.scene.getState().particleCount, 0); assert.equal(f.frames.size, 0);
});

test('pause and hidden state freeze boost, cooldown, debris and depth without elapsed-time catch-up', t => {
  const f = fixture(t); f.scene.setState({ depth: 100, active: true }); f.step(); f.scene.boost(); f.advance(240);
  f.scene.setPaused(true); const stopped = f.scene.getState(); f.elapse(60000); f.step();
  assert.equal(f.scene.getState().boostRemaining, stopped.boostRemaining); assert.equal(f.scene.getState().boostCooldown, stopped.boostCooldown); assert.equal(f.scene.getState().particleCount, stopped.particleCount);
  f.scene.setPaused(false); f.hide(true); f.elapse(60000); f.step(); assert.equal(f.scene.getState().depth, stopped.depth);
  f.hide(false); f.step(); assert.equal(f.scene.getState().depth, stopped.depth); f.step();
  assert.ok(f.scene.getState().depth > stopped.depth && f.scene.getState().depth < stopped.depth + .3);
});

test('boosted replay stops at its original endpoint and reveals each real item once', async t => {
  const f = fixture(t); f.scene.setState({ depth: 20, instant: true, active: false, discoveries: nodes, artifacts: [artifact] });
  const replay = f.scene.replay(0, 4); assert.equal(f.scene.boost(), true); f.advance(2000); await replay;
  assert.equal(f.scene.getState().depth, 4); assert.equal(f.scene.getState().targetDepth, 20); assert.equal(f.scene.boost(), false);
  assert.deepEqual(f.reveals.map(item => item.id), ['one', 'three', artifact.id]);
  assert.deepEqual(f.impacts.map(item => item.type), ['boost', 'mineral', 'mineral', 'artifact']);
});

test('same-scope refresh preserves an active boost; reset and reduction clear transient effects', t => {
  const f = fixture(t); f.scene.setState({ depth: 20, active: true, scopeKey: 'a' }); f.step(); f.scene.boost(); f.advance(200);
  const before = f.scene.getState(); f.scene.setState({ depth: 30, scopeKey: 'a' });
  assert.equal(f.scene.getState().boostRemaining, before.boostRemaining); assert.equal(f.scene.getState().depth, before.depth);
  f.scene.setState({ depth: 1, reset: true, instant: true, scopeKey: 'b', active: false });
  assert.equal(f.scene.getState().boostRemaining, 0); assert.equal(f.scene.getState().boostCooldown, 0); assert.equal(f.scene.getState().particleCount, 0); assert.equal(f.scene.getState().depth, 1);
});

test('short pointer tap on the rig boosts, while drags, cancellation, and secondary pointers do not', t => {
  const f = fixture(t); f.scene.setState({ depth: 100, active: true });
  const p = () => ({ pointerId: 1, clientX: 720, clientY: (70 + f.scene.getState().depth * 7 - 23 - Math.floor(f.scene.getState().cameraY)) * 3 });
  f.fire('pointerdown', p()); f.fire('pointermove', { ...p(), clientY: p().clientY + 30 }); f.fire('pointerup', p()); assert.equal(f.impacts.length, 0);
  f.fire('keydown', { key: 'End' }); f.fire('pointerdown', p()); f.fire('pointercancel', p()); f.fire('pointerup', p()); assert.equal(f.impacts.length, 0);
  f.fire('pointerdown', { ...p(), isPrimary: false }); f.fire('pointerup', p()); assert.equal(f.impacts.length, 0);
  f.fire('pointerdown', p()); f.fire('pointerup', p()); assert.equal(f.impacts.length, 1); assert.equal(f.impacts[0].type, 'boost');
});

test('Space ignores repeat and other targets, and focused mineral activation takes priority', t => {
  const f = fixture(t); f.scene.setState({ depth: 100, active: true });
  f.fire('keydown', { key: ' ', repeat: true }); f.fire('keydown', { key: ' ', target: f.parent }); assert.equal(f.impacts.length, 0);
  f.fire('keydown', { key: ' ' }); assert.equal(f.impacts.length, 1);
  f.scene.setState({ depth: 10, startDepth: 3, reset: true, active: true, discoveries: nodes });
  f.parent.children[1].children[0].focus(); f.fire('keydown', { key: ' ' });
  assert.deepEqual(f.opened, ['one']); assert.equal(f.impacts.length, 1);
});

test('impact debris is bounded and settles completely at the observed target', t => {
  const f = fixture(t); f.scene.setState({ depth: 3, active: true, discoveries: nodes }); f.scene.boost(); f.advance(200);
  assert.ok(f.scene.getState().particleCount > 0 && f.scene.getState().particleCount <= 90);
  f.advance(4000); assert.equal(f.scene.getState().depth, 3); assert.equal(f.scene.getState().particleCount, 0); assert.equal(f.scene.getState().feedbackCount, 0); assert.equal(f.frames.size, 0);
  assert.equal(f.scene.getState().boostReady, false); assert.deepEqual(Array.from(f.scene.getState().revealedIds), ['one', 'three']);
});

test('draw-only shake leaves authoritative camera coordinates intact and is disabled by reduced motion', t => {
  const f = fixture(t); f.scene.setState({ depth: 20, active: true }); f.scene.boost(); f.advance(440);
  assert.ok(f.stats.translations.some(p => p.x >= 718 && p.x <= 722 && p.x !== 720));
  let prior = f.scene.getState().cameraY; for (let i = 0; i < 10; i++) { f.step(); assert.ok(f.scene.getState().cameraY >= prior); prior = f.scene.getState().cameraY; }
  f.resetStats(); f.reduce(true); assert.equal(f.scene.getState().depth, 20); assert.ok(f.stats.translations.filter(p => p.x >= 718 && p.x <= 722).every(p => p.x === 720 && p.y === 0));
});

test('compact relics remain completely inside a narrow viewport with matching clickable provenance', t => {
  const f = fixture(t, { width: 320, height: 700 }); f.scene.setState({ depth: 3, instant: true, active: false, artifacts: [artifact] });
  const relic = f.stats.workshops.at(-1), s = f.scene.getState();
  assert.ok(160 + (relic.x - 16) * s.scale >= 0); assert.ok(160 + (relic.x + 16) * s.scale <= 320);
  const p = { pointerId: 1, clientX: 160 + relic.x * s.scale, clientY: (relic.y - 15 - Math.floor(s.cameraY)) * s.scale };
  f.fire('pointerdown', p); f.fire('pointerup', p); assert.deepEqual(f.artifactsOpened, [artifact.id]); assert.equal(f.impacts.length, 0);
});

const chamber = { id: 'project/date/room/work', date: '2026-11-17', depth: 3, side: 'left', kind: 'work', theme: 'workshop', name: '本地工作间', description: '已观测记录', level: 2, variant: 1 };

test('rooms unlock only at real reached depth and never emit rewards or change the target', t => {
  const f = fixture(t); f.scene.setState({ depth: 5, active: true, rooms: [chamber, { ...chamber, id: 'future', depth: 6 }] });
  assert.equal(f.scene.getState().revealedRoomIds.length, 0); assert.equal(f.stats.chambers.length, 0);
  f.advance(1320); assert.deepEqual(Array.from(f.scene.getState().revealedRoomIds), [chamber.id]);
  assert.equal(f.scene.getState().targetDepth, 5); assert.equal(f.reveals.length, 0); assert.equal(f.impacts.length, 0);
  f.advance(3000); assert.equal(f.scene.getState().depth, 5); assert.deepEqual(Array.from(f.scene.getState().revealedRoomIds), [chamber.id]);
});

test('a visible chamber supports pointer and keyboard provenance without triggering boost', t => {
  const f = fixture(t); f.scene.setState({ depth: 10, startDepth: 4, active: true, rooms: [chamber] });
  const room = f.scene.getState().visibleRooms[0]; assert.equal(room.name, chamber.name); assert.ok(Object.isFrozen(room)); assert.ok(Object.isFrozen(f.scene.getState().visibleRooms));
  const p = { pointerId: 1, clientX: room.screenX, clientY: room.screenY };
  f.fire('pointerdown', p); f.fire('pointerup', p);
  const button = f.parent.children[1].children.find(item => item.dataset.hitKey === 'room:' + chamber.id); button.focus(); f.fire('keydown', { key: ' ' });
  assert.deepEqual(f.roomsOpened, [chamber.id, chamber.id]); assert.equal(f.impacts.length, 0); assert.equal(f.scene.getState().boostRemaining, 0);
});

test('room drags do not activate the source and withdrawn rooms leave no stale controls', t => {
  const f = fixture(t); f.scene.setState({ depth: 5, instant: true, active: false, rooms: [chamber] });
  const room = f.scene.getState().visibleRooms[0], p = { pointerId: 1, clientX: room.screenX, clientY: room.screenY };
  f.fire('pointerdown', p); f.fire('pointermove', { ...p, clientY: p.clientY + 22 }); f.fire('pointerup', p); assert.equal(f.roomsOpened.length, 0);
  const button = f.parent.children[1].children.find(item => item.dataset.hitKey === 'room:' + chamber.id);
  f.scene.setState({ rooms: [] }); button.listeners.get('click')();
  assert.equal(f.roomsOpened.length, 0); assert.equal(f.scene.getState().revealedRoomIds.length, 0); assert.equal(f.scene.getState().visibleRooms.length, 0); assert.equal(f.parent.children[1].children.length, 0);
});

test('scope changes and hidden withdrawals clear every room and its interaction state', t => {
  const f = fixture(t); f.scene.setState({ depth: 5, instant: true, scopeKey: 'old', rooms: [chamber] });
  const button = f.parent.children[1].children[0]; f.hide(true); assert.equal(f.scene.getState().visibleRooms.length, 0);
  f.scene.setState({ rooms: [] }); button.listeners.get('click')(); assert.equal(f.roomsOpened.length, 0); assert.equal(f.parent.children[1].children.length, 0);
  f.hide(false); f.scene.setState({ rooms: [chamber] }); f.scene.setState({ depth: 0, scopeKey: 'new' });
  assert.equal(f.scene.getState().revealedRoomIds.length, 0); assert.equal(f.scene.getState().visibleRooms.length, 0);
});

test('compact mobile chambers keep complete interactive width while preserving true depth and provenance', t => {
  const f = fixture(t); f.scene.setState({ depth: 5, instant: true, rooms: [chamber] });
  const before = f.scene.getState(); assert.equal(f.stats.chambers.at(-1).compact, false); assert.equal(before.visibleRooms[0].width, 112 * 3);
  f.resize(320, 700); const after = f.scene.getState(), room = after.visibleRooms[0];
  assert.equal(f.stats.chambers.at(-1).compact, true); assert.equal(after.depth, before.depth); assert.equal(room.width, 48 * 2);
  assert.ok(room.screenX - room.width / 2 >= 0 && room.screenX + room.width / 2 <= 320);
  const p = { pointerId: 2, clientX: room.screenX, clientY: room.screenY }; f.fire('pointerdown', p); f.fire('pointerup', p); assert.deepEqual(f.roomsOpened, [chamber.id]);
});

test('zero-depth usage rooms represent known activity without inventing excavation or rewards', t => {
  const f = fixture(t); f.scene.setState({ depth: 0, active: true, rooms: [{ ...chamber, kind: 'usage', theme: 'energy', depth: 0 }] });
  f.advance(2000); assert.equal(f.scene.getState().depth, 0); assert.equal(f.scene.getState().targetDepth, 0); assert.equal(f.scene.boost(), false);
  assert.deepEqual(Array.from(f.scene.getState().revealedRoomIds), [chamber.id]); assert.equal(f.reveals.length, 0); assert.equal(f.impacts.length, 0);
});

test('duplicate and malformed rooms are bounded; overlapping rooms retain records without stacked scenery', t => {
  const f = fixture(t); const source = Object.freeze({ ...chamber });
  f.scene.setState({ depth: 3, instant: true, rooms: [source, source, { ...chamber, id: 'invalid-side', side: 'up' }, { ...chamber, id: 'negative', depth: -1 }, { ...chamber, id: 'unknown-theme', theme: 'invented' }, { ...chamber, id: 'missing', depth: null }, { ...chamber, id: 'newer', depth: 3 }] });
  assert.equal(f.scene.getState().revealedRoomIds.length, 2); assert.equal(f.scene.getState().visibleRooms.length, 1); assert.equal(source.x, undefined);
  f.scene.setState({ rooms: Array.from({ length: 1000 }, (_, i) => ({ ...chamber, id: 'room-' + i })) }); assert.equal(f.scene.getState().revealedRoomIds.length, 128); assert.equal(f.scene.getState().visibleRooms.length, 1);
});

test('reduced-motion and repeated replay show the same rooms without presentation reward events', async t => {
  const f = fixture(t, { reduced: true }); f.scene.setState({ depth: 5, active: true, rooms: [chamber] });
  assert.equal(f.scene.getState().visibleRooms.length, 1); assert.equal(f.frames.size, 0);
  await f.scene.replay(0, 5); f.reduce(false); const replay = f.scene.replay(0, 5); f.advance(2040); await replay;
  assert.deepEqual(Array.from(f.scene.getState().revealedRoomIds), [chamber.id]); assert.equal(f.reveals.length, 0); assert.equal(f.impacts.length, 0); assert.equal(f.scene.getState().targetDepth, 5);
});

test('room hit regions avoid HUD coverage while keeping their world anchors unchanged', t => {
  const f = fixture(t); f.scene.setState({ depth: 5, instant: true, active: false, rooms: [chamber] });
  const original = f.scene.getState().visibleRooms[0], art = f.stats.chambers.at(-1);
  const cover = { left: original.screenX - 20, right: original.screenX + original.width / 2 + 10, top: 0, bottom: 740 };
  f.cover([cover]); const visible = f.scene.getState().visibleRooms[0];
  assert.ok(visible.screenX + visible.width / 2 <= cover.left); assert.deepEqual([f.stats.chambers.at(-1).x, f.stats.chambers.at(-1).y], [art.x, art.y]);
  const p = { pointerId: 1, clientX: visible.screenX, clientY: visible.screenY }; f.fire('pointerdown', p); f.fire('pointerup', p); assert.deepEqual(f.roomsOpened, [chamber.id]);
  const blocked = { pointerId: 2, clientX: original.screenX + 20, clientY: original.screenY }; f.fire('pointerdown', blocked); f.fire('pointerup', blocked); assert.equal(f.roomsOpened.length, 1);
});

test('a mostly covered room is excluded from keyboard candidates but retains its source record', t => {
  const f = fixture(t); f.scene.setState({ depth: 5, instant: true, active: false, rooms: [chamber] });
  const room = f.scene.getState().visibleRooms[0];
  f.cover([{ left: room.screenX - room.width / 2 + 10, right: 1440, top: 0, bottom: 740 }]);
  assert.equal(f.scene.getState().visibleRooms.length, 0); assert.equal(f.parent.children[1].children.length, 0); assert.deepEqual(Array.from(f.scene.getState().revealedRoomIds), [chamber.id]);
  f.cover([]); assert.equal(f.scene.getState().visibleRooms.length, 1); assert.equal(f.parent.children[1].children.length, 1); assert.equal(f.scene.getState().depth, 5);
});

test('sonar returns immutable nearby reached sources exactly once without minting any progress', t => {
  const f = fixture(t); f.scene.setState({ depth: 10, startDepth: 4, active: false, discoveries: [...nodes, { id: 'future', depth: 5, kind: 'asset' }], artifacts: [artifact], rooms: [chamber] });
  const result = f.scene.scan(); assert.ok(Object.isFrozen(result)); assert.ok(result.every(Object.isFrozen));
  assert.deepEqual(Array.from(result, item => item.type), ['mineral', 'mineral', 'artifact', 'room']); assert.equal(result.some(item => item.id === 'future'), false);
  assert.equal(f.scans.length, 1); assert.equal(f.scene.scan(), null); assert.equal(f.scans.length, 1);
  assert.equal(f.scene.getState().scanCount, 4); assert.equal(f.scene.getState().depth, 4); assert.equal(f.scene.getState().targetDepth, 10); assert.equal(f.reveals.length, 0); assert.equal(f.impacts.length, 0);
});

test('an unconnected empty page refuses sonar while known zero activity can return an honest empty scan', t => {
  const f = fixture(t); assert.equal(f.scene.getState().scanReady, false); assert.equal(f.scene.scan(), null); assert.equal(f.frames.size, 0);
  f.scene.setState({ depth: 0, active: true }); const result = f.scene.scan(); assert.equal(result.length, 0); assert.equal(f.scans.length, 1); assert.equal(f.scene.getState().depth, 0);
});

test('sonar highlights last two seconds and an eight second active-time cooldown becomes ready again', t => {
  const f = fixture(t); f.scene.setState({ depth: 3, instant: true, active: false, discoveries: nodes }); f.scene.scan(); f.step();
  f.advance(2040); assert.equal(f.scene.getState().scanRemaining, 0); assert.ok(f.scene.getState().scanCooldown > 5.9); assert.equal(f.scene.getState().scanReady, false);
  f.advance(6000); assert.equal(f.scene.getState().scanCooldown, 0); assert.equal(f.scene.getState().scanReady, true); assert.equal(f.scene.getState().depth, 3); assert.ok(f.scene.scan());
});

test('pause and hidden state refuse scans and freeze sonar timers without wall-clock catch-up', t => {
  const f = fixture(t); f.scene.setState({ depth: 3, instant: true, discoveries: nodes }); f.scene.scan(); f.advance(440); f.scene.setPaused(true);
  const before = f.scene.getState(); assert.equal(f.scene.scan(), null); f.elapse(60000); f.step(); assert.equal(f.scene.getState().scanRemaining, before.scanRemaining); assert.equal(f.scene.getState().scanCooldown, before.scanCooldown);
  f.scene.setPaused(false); f.hide(true); assert.equal(f.scene.scan(), null); f.elapse(60000); f.step(); assert.equal(f.scene.getState().scanCooldown, before.scanCooldown);
  f.hide(false); f.step(); assert.equal(f.scene.getState().scanCooldown, before.scanCooldown); f.step(); assert.ok(f.scene.getState().scanCooldown < before.scanCooldown);
});

test('reduced motion sonar gives static results then cools down without continuous scene redraws', t => {
  const f = fixture(t, { reduced: true }); f.scene.setState({ depth: 3, active: false, discoveries: nodes }); assert.equal(f.frames.size, 0); f.resetStats();
  f.scene.scan(); const progressBefore = f.progress.length; f.advance(8120);
  assert.equal(f.scans.length, 1); assert.equal(f.scene.getState().scanRemaining, 0); assert.equal(f.scene.getState().scanCooldown, 0); assert.equal(f.scene.getState().scanReady, true);
  assert.ok(f.stats.rigs.length <= 2); assert.ok(f.progress.length - progressBefore <= 9); assert.equal(f.frames.size, 0); assert.equal(f.scene.getState().depth, 3); assert.ok(f.scene.scan());
});

test('relay extends the real scan footprint only after its depth is reached and withdrawal removes the extension', t => {
  const f = fixture(t); const records = [{ id: 'outer', depth: 4, kind: 'code' }, { id: 'near', depth: 25, kind: 'document' }];
  f.scene.setState({ depth: 30, instant: true, active: false, discoveries: records, tracks: [{ id: 'relay', unlocked: true, depth: 31 }] });
  assert.equal(f.scene.getState().scanRadius, 130); assert.deepEqual(Array.from(f.scene.scan(), item => item.id), ['near']); f.advance(8120);
  f.scene.setState({ tracks: [{ id: 'relay', unlocked: true, depth: 30 }] }); assert.equal(f.scene.getState().scanRadius, 190);
  assert.deepEqual(Array.from(f.scene.scan(), item => item.id), ['outer', 'near']);
  f.scene.setState({ tracks: [] }); assert.equal(f.scene.getState().scanRadius, 130); assert.equal(f.scene.getState().scanCount, 1); assert.equal(f.scans.length, 2);
});

test('sonar withdrawal and scope/reset remove old results, highlights and cooldown state', t => {
  const f = fixture(t); f.scene.setState({ depth: 4, instant: true, scopeKey: 'a', rooms: [chamber] }); f.scene.scan();
  f.scene.setState({ rooms: [] }); assert.equal(f.scene.getState().scanCount, 0); assert.equal(f.scene.getState().scanRemaining, 0); assert.equal(f.scans.length, 1);
  f.scene.setState({ depth: 0, reset: true }); assert.equal(f.scene.getState().scanCooldown, 0);
  f.scene.setState({ depth: 4, instant: true, rooms: [chamber] }); f.scene.scan(); f.scene.setState({ depth: 0, scopeKey: 'b' });
  assert.equal(f.scene.getState().scanCount, 0); assert.equal(f.scene.getState().scanRemaining, 0); assert.equal(f.scene.getState().scanCooldown, 0); assert.equal(f.scene.scan(), null);
});

test('historical room focus exposes its real record, preserves depth and uses viewport-centered sonar', t => {
  const f = fixture(t); f.scene.setState({ depth: 120, instant: true, active: false, rooms: [chamber, { ...chamber, id: 'latest', depth: 110 }], discoveries: [{ id: 'old-sample', depth: 5, kind: 'code' }] });
  const before = f.scene.getState(); assert.equal(before.visibleRooms.some(item => item.id === chamber.id), false);
  assert.equal(f.scene.focusRoom(chamber.id), true); const focused = f.scene.getState(); assert.equal(focused.mode, 'inspect'); assert.ok(focused.cameraY < before.cameraY); assert.equal(focused.depth, 120); assert.equal(focused.targetDepth, 120);
  assert.ok(focused.visibleRooms.some(item => item.id === chamber.id)); assert.equal(f.roomsOpened.length, 0);
  const result = f.scene.scan(); assert.ok(result.some(item => item.id === chamber.id)); assert.ok(result.some(item => item.id === 'old-sample')); assert.equal(result.some(item => item.id === 'latest'), false);
  assert.equal(f.scene.focusRoom('missing'), false); assert.equal(f.scene.getState().cameraY, focused.cameraY);
});

test('focus prioritizes an overlapping reached room and rejects future or withdrawn rooms', async t => {
  const f = fixture(t); f.scene.setState({ depth: 10, instant: true, active: false, rooms: [chamber, { ...chamber, id: 'zz-newer' }, { ...chamber, id: 'future', depth: 11 }] });
  assert.equal(f.scene.getState().visibleRooms[0].id, 'zz-newer'); assert.equal(f.scene.focusRoom(chamber.id), true); assert.equal(f.scene.getState().visibleRooms[0].id, chamber.id);
  assert.equal(f.scene.focusRoom('future'), false);
  const replay = f.scene.replay(0, 10); f.advance(840); assert.equal(f.scene.focusRoom(chamber.id), true); await replay; assert.equal(f.scene.getState().mode, 'inspect');
  f.scene.setState({ rooms: [] }); assert.equal(f.scene.focusRoom(chamber.id), false);
});

test('facilities gate their station, drone and ambient visuals independently on actual reached depth', t => {
  const f = fixture(t); const source = Object.freeze([{ id: 'relay', unlocked: true, depth: 2 }, { id: 'sorter', unlocked: true, depth: 5 }, { id: 'garden', unlocked: true, depth: 10 }].map(Object.freeze));
  f.scene.setState({ depth: 20, startDepth: 4, active: false, tracks: [...source, { id: 'fake', unlocked: true, depth: 0 }, { id: 'sorter', unlocked: false, depth: 0 }] });
  assert.deepEqual(Array.from(f.scene.getState().revealedTrackIds), ['relay']); assert.equal(f.stats.drones.length, 0); assert.equal(f.stats.ambient, 0);
  f.resetStats(); f.scene.setState({ startDepth: 6, reset: true }); assert.ok(f.stats.drones.length > 0); assert.equal(f.stats.ambient, 0);
  f.resetStats(); f.scene.setState({ instant: true }); assert.ok(f.stats.drones.length > 0); assert.ok(f.stats.ambient > 0); assert.deepEqual(Array.from(f.scene.getState().revealedTrackIds), ['relay', 'sorter', 'garden']);
  assert.equal(source[0].x, undefined); f.resetStats(); f.scene.setState({ tracks: [] }); assert.equal(f.stats.stations.length, 0); assert.equal(f.stats.drones.length, 0); assert.equal(f.stats.ambient, 0);
});

test('historical facility focus is an inspect-only camera movement and invalid tracks cannot create stations', t => {
  const f = fixture(t); f.scene.setState({ depth: 154, instant: true, active: false, tracks: [{ id: 'relay', unlocked: true, depth: 74 }, { id: 'garden', unlocked: true, depth: 200 }, { id: 'sorter', unlocked: true, depth: '0' }, { id: 'relay', unlocked: true, depth: 0 }] });
  const before = f.scene.getState(); f.resetStats(); assert.equal(f.scene.focusTrack('relay'), true);
  assert.equal(f.scene.getState().mode, 'inspect'); assert.ok(f.scene.getState().cameraY < before.cameraY); assert.equal(f.scene.getState().depth, 154); assert.ok(f.stats.stations.some(item => item.type === 'relay'));
  assert.equal(f.scene.focusTrack('garden'), false); assert.equal(f.scene.focusTrack('sorter'), false); assert.equal(f.scene.focusTrack('unknown'), false); assert.equal(f.reveals.length, 0);
});

test('reduced focus survives same-scope refresh and destroying a scan clears its scheduled work', t => {
  const f = fixture(t, { reduced: true }); f.scene.setState({ depth: 120, rooms: [chamber], active: false, scopeKey: 'a' });
  f.scene.focusRoom(chamber.id); const camera = f.scene.getState().cameraY; f.scene.setState({ depth: 120, scopeKey: 'a' }); assert.equal(f.scene.getState().cameraY, camera); assert.equal(f.scene.getState().mode, 'inspect');
  f.scene.scan(); assert.ok(f.frames.size > 0); f.scene.destroy(); assert.equal(f.frames.size, 0); assert.equal(f.scene.scan(), null); assert.equal(f.scene.focusRoom(chamber.id), false); assert.equal(f.scene.focusTrack('relay'), false);
});

for (const width of [1440, 390]) test(`coincident facilities avoid each other, rooms and real provenance targets at ${width}px`, t => {
  const f = fixture(t, { width, height: 840 });
  const tracks = Object.freeze(['relay', 'sorter', 'garden'].map(id => Object.freeze({ id, unlocked: true, depth: 100 })));
  f.scene.setState({ depth: 154, instant: true, active: false, tracks,
    rooms: ['left', 'right'].map(side => ({ ...chamber, id: side, depth: 100, side })),
    artifacts: [{ id: 'pickaxe', depth: 100, recipeId: 'pickaxe', name: '真实矿镐' }],
    discoveries: ['code', 'document', 'asset', 'other'].map(kind => ({ id: kind, depth: 100, kind })) });
  const stationBounds = item => ({ left: item.x - (item.compact ? 16 : 32), right: item.x + (item.compact ? 16 : 32), top: item.y - (item.compact ? 28 : 44), bottom: item.y + 3 });
  const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const positions = new Map();
  for (const track of tracks) {
    f.resetStats(); assert.equal(f.scene.focusTrack(track.id), true);
    const item = f.stats.stations.find(station => station.type === track.id); assert.ok(item, track.id + ' is visible when focused'); positions.set(track.id, item);
    const blockers = [
      ...f.stats.chambers.map(room => ({ left: room.x - (room.compact ? 24 : 56), right: room.x + (room.compact ? 24 : 56), top: room.y - (room.compact ? 56 : 72), bottom: room.y + 3 })),
      ...f.stats.workshops.map(artifact => ({ left: artifact.x - 19, right: artifact.x + 19, top: artifact.y - 36, bottom: artifact.y + 5 })),
      ...f.stats.crystals.map(mineral => ({ left: mineral.x - 14, right: mineral.x + 14, top: mineral.y - 26, bottom: mineral.y + 5 }))
    ];
    for (const station of f.stats.stations) {
      const bounds = stationBounds(station);
      assert.equal(blockers.some(other => overlap(bounds, other)), false, station.type + ' must not hide a provenance target');
      assert.ok(bounds.left >= -width / (2 * f.scene.getState().scale)); assert.ok(bounds.right <= width / (2 * f.scene.getState().scale));
      assert.ok(station.y <= 70 + track.depth * 7 - 3); assert.ok(bounds.top >= 70);
    }
  }
  const placed = [...positions.values()]; assert.equal(placed.length, 3);
  for (let a = 0; a < placed.length; a++) for (let b = a + 1; b < placed.length; b++) assert.equal(overlap(stationBounds(placed[a]), stationBounds(placed[b])), false);
  assert.ok(placed.some(item => item.x < 0)); assert.ok(placed.some(item => item.x > 0));
  f.scene.setState({ tracks: [...tracks].reverse() });
  for (const track of tracks) { f.resetStats(); f.scene.focusTrack(track.id); const next = f.stats.stations.find(item => item.type === track.id); assert.deepEqual({ x: next.x, y: next.y }, { x: positions.get(track.id).x, y: positions.get(track.id).y }); }
  assert.equal(f.scene.getState().depth, 154); assert.equal(f.scene.getState().targetDepth, 154); assert.equal(f.reveals.length, 0);
  assert.ok(tracks.every(item => item.depth === 100 && item.x === undefined && item.y === undefined));
});

test('compact transport drone follows inside the shaft above the rig instead of sitting on a mineral', t => {
  const f = fixture(t, { width: 390, height: 844 });
  f.scene.setState({ depth: 154, instant: true, active: false, tracks: [{ id: 'sorter', unlocked: true, depth: 74 }], discoveries: [{ id: 'sample', depth: 154, kind: 'other' }] });
  const drone = f.stats.drones.at(-1), rig = f.stats.rigs.at(-1);
  assert.equal(drone.x, -8); assert.equal(drone.y, rig.y - 38); assert.equal(drone.working, false);
  assert.equal(f.scene.getState().depth, 154); assert.equal(f.scene.getState().revealedIds.length, 1);
});

const workFindings = Object.freeze(['engine', 'beacon', 'prism', 'survey', 'garden', 'archive'].map((recipeId, index) => Object.freeze({
  id: 'project/2026-11-17/finding/' + index, kind: 'work-finding', date: '2026-11-17',
  recipeId, name: ['采集引擎', '状态指示灯', '调色棱镜', '巡览仪', '像素温室', '文件档案箱'][index],
  visualType: ['code', 'web', 'image', 'document', 'table', 'file'][index],
  description: '当天实际变更的文件物件', depth: 36 + 36 * (.24 + .68 * index / 5), variant: index % 3
})));

for (const width of [1440, 390, 320]) test(`six same-day work findings remain distinct and individually selectable at ${width}px`, t => {
  const f = fixture(t, { width, height: 844 });
  const daily = { ...artifact, depth: 72 };
  f.scene.setState({ depth: 72, instant: true, active: false, scopeKey: 'local/project', artifacts: [daily, ...workFindings],
    discoveries: [{ id: 'code', depth: 53, kind: 'code' }, { id: 'document', depth: 63, kind: 'document' }],
    rooms: [{ ...chamber, depth: 43.2, kind: 'usage', theme: 'energy', side: 'left' }],
    tracks: [{ id: 'relay', unlocked: true, depth: 72 }, { id: 'sorter', unlocked: true, depth: 72 }] });
  const positions = new Map();
  for (const source of workFindings) {
    f.resetStats(); assert.equal(f.scene.focusArtifact(source.id), true);
    const state = f.scene.getState(), hit = state.visibleFindings.find(item => item.id === source.id);
    assert.ok(hit, source.name + ' is visible after focus'); assert.equal(hit.kind, 'work-finding'); assert.equal(hit.depth, source.depth);
    assert.ok(Object.isFrozen(state.visibleFindings)); assert.ok(Object.isFrozen(hit));
    assert.ok(hit.screenX - hit.width / 2 >= 0 && hit.screenX + hit.width / 2 <= width);
    positions.set(source.id, { x: (hit.screenX - width / 2) / state.scale, y: hit.screenY / state.scale + Math.floor(state.cameraY) + 15 });
    const labels = f.stats.texts.filter(item => workFindings.some(finding => item.value === finding.name));
    assert.ok(labels.length > 0 && labels.length <= (width < 700 ? 2 : 3));
    f.fire('pointerdown', { pointerId: 1, clientX: hit.screenX, clientY: hit.screenY });
    f.fire('pointerup', { pointerId: 1, clientX: hit.screenX, clientY: hit.screenY });
    assert.equal(f.artifactsOpened.at(-1), source.id);
    const button = f.parent.children[1].children.find(item => item.dataset.hitKey === 'artifact:' + source.id);
    assert.ok(button); button.listeners.get('click')(); assert.equal(f.artifactsOpened.at(-1), source.id);
    const item = f.stats.outputs.find(draw => draw.type === source.visualType && Math.abs(draw.x - positions.get(source.id).x) < .1);
    assert.ok(item);
    for (const station of f.stats.stations) {
      assert.equal(Math.abs(station.x - item.x) < (station.compact ? 16 : 32) + 18 && station.y > item.y - 32 && station.y - (station.compact ? 28 : 44) < item.y, false);
    }
  }
  const placed = [...positions.values()];
  for (let a = 0; a < placed.length; a++) for (let b = a + 1; b < placed.length; b++) assert.equal(Math.abs(placed[a].x - placed[b].x) < 32 && Math.abs(placed[a].y - placed[b].y) < 32, false);
  const camera = f.scene.getState().cameraY; f.scene.setState({ artifacts: [...workFindings].reverse().concat(daily) });
  assert.equal(f.scene.getState().cameraY, camera); assert.equal(f.scene.getState().mode, 'inspect');
  for (const source of workFindings) { f.scene.focusArtifact(source.id); const state = f.scene.getState(), next = state.visibleFindings.find(item => item.id === source.id); assert.deepEqual({ x: (next.screenX - width / 2) / state.scale, y: next.screenY / state.scale + Math.floor(state.cameraY) + 15 }, positions.get(source.id)); }
  assert.equal(f.scene.focusArtifact(daily.id), true); assert.ok(f.parent.children[1].children.some(item => item.dataset.hitKey === 'artifact:' + daily.id));
  assert.equal(f.scene.getState().depth, 72); assert.equal(f.scene.getState().targetDepth, 72); assert.equal(f.reveals.length, 0);
  assert.ok(workFindings.every(item => item.x === undefined && item.y === undefined));
});

test('work-finding crossings and revisions emit their own type once without changing the daily artifact event', async t => {
  const f = fixture(t); const finding = { ...workFindings[0], depth: 2 };
  f.scene.setState({ depth: 4, active: true, artifacts: [finding, artifact] }); f.advance(2040);
  assert.deepEqual(f.reveals.map(item => [item.type, item.id]), [['work-finding', finding.id], ['artifact', artifact.id]]);
  f.scene.setState({ artifacts: [artifact, finding] }); f.advance(2000); assert.equal(f.reveals.length, 2);
  f.scene.setState({ artifacts: [artifact, { ...finding, recipeId: 'beacon' }] }); f.advance(80);
  assert.equal(f.reveals.at(-1).type, 'work-finding'); assert.equal(f.reveals.filter(item => item.type === 'artifact').length, 1);
  const replay = f.scene.replay(0, 4); f.advance(2040); await replay;
  assert.equal(f.reveals.filter(item => item.type === 'work-finding').length, 3); assert.equal(f.scene.getState().targetDepth, 4);
});

test('work finding focus and sonar respect arrival, withdrawal and scope while retaining artifact provenance routing', t => {
  const f = fixture(t, { width: 390 }); const finding = workFindings[2];
  f.scene.setState({ depth: 72, startDepth: 40, active: false, artifacts: [finding], scopeKey: 'live' });
  assert.equal(f.scene.focusArtifact(finding.id), false); assert.equal(f.scene.getState().visibleFindings.length, 0);
  f.scene.setState({ instant: true }); assert.equal(f.scene.focusArtifact(finding.id), true);
  const scan = f.scene.scan(); assert.ok(scan.some(item => item.id === finding.id && item.type === 'artifact' && item.title === finding.name));
  f.scene.setState({ artifacts: [] }); assert.equal(f.scene.focusArtifact(finding.id), false); assert.equal(f.scene.getState().visibleFindings.length, 0); assert.equal(f.scene.getState().scanCount, 0);
  f.scene.setState({ artifacts: [finding] }); f.scene.setState({ scopeKey: 'demo', depth: 0, reset: true });
  assert.equal(f.scene.focusArtifact(finding.id), false); assert.equal(f.scene.getState().visibleFindings.length, 0); assert.equal(f.reveals.length, 0);
  f.scene.destroy(); assert.equal(f.scene.focusArtifact(finding.id), false);
});

test('all direct output types keep their identity, selection and source depth instead of drawing reward relics', t => {
  const f = fixture(t, { width: 390, height: 844 });
  const types = ['web', 'document', 'image', 'audio', 'video', 'slides', 'table', 'code', 'file'];
  for (const [index, type] of types.entries()) {
    const finding = Object.freeze({ ...workFindings[0], id: 'output/' + type, visualType: type, depth: 60, variant: index % 3 });
    f.resetStats(); f.scene.setState({ depth: 72, active: false, instant: true, artifacts: [finding, { ...artifact, depth: 72, visualType: type }] });
    assert.equal(f.scene.focusArtifact(finding.id), true);
    const hit = f.scene.getState().visibleFindings.find(item => item.id === finding.id);
    assert.equal(hit.visualType, type); assert.equal(hit.depth, 60);
    assert.ok(f.stats.outputs.every(item => item.type === type && item.variant === index % 3)); assert.ok(f.stats.outputs.length > 0);
    assert.ok(f.stats.workshops.every(item => item.recipeId === artifact.recipeId));
    f.fire('pointerdown', { pointerId: 1, clientX: hit.screenX, clientY: hit.screenY });
    f.fire('pointerup', { pointerId: 1, clientX: hit.screenX, clientY: hit.screenY });
    assert.equal(f.artifactsOpened.at(-1), finding.id);
    assert.equal(f.scene.getState().depth, 72); assert.equal(f.scene.getState().targetDepth, 72); assert.equal(f.reveals.length, 0);
    assert.equal(finding.x, undefined); assert.equal(finding.visualType, type);
  }
});

test('unknown or absent direct output types normalize to file without inheriting a metaphorical recipe', t => {
  const f = fixture(t);
  for (const visualType of [undefined, null, '', 'engine', '<img onerror=alert(1)>', { type: 'web' }]) {
    f.resetStats(); f.scene.setState({ depth: 72, instant: true, active: false, artifacts: [{ ...workFindings[0], visualType }] });
    assert.equal(f.scene.focusArtifact(workFindings[0].id), true);
    assert.equal(f.scene.getState().visibleFindings[0].visualType, 'file'); assert.ok(f.stats.outputs.length > 0);
    assert.ok(f.stats.outputs.every(item => item.type === 'file')); assert.equal(f.stats.workshops.length, 0);
  }
});

test('a missing output atlas uses a plain-file fallback while daily artifacts retain their existing art', t => {
  const f = fixture(t, { noOutputArt: true });
  f.scene.setState({ depth: 72, instant: true, active: false, artifacts: [workFindings[2], { ...artifact, depth: 72 }] });
  f.scene.focusArtifact(workFindings[2].id);
  assert.ok(f.scene.getState().visibleFindings.some(item => item.id === workFindings[2].id));
  assert.equal(f.stats.outputs.length, 0); assert.ok(f.stats.workshops.length > 0);
  assert.ok(f.stats.workshops.every(item => item.recipeId === artifact.recipeId));
  assert.equal(f.reveals.length, 0);
});

test('a direct output type correction updates in place with a work-finding event and no additional daily reward', t => {
  const f = fixture(t); const finding = { ...workFindings[0], depth: 60, visualType: 'code' };
  f.scene.setState({ depth: 72, instant: true, active: false, artifacts: [finding] }); f.scene.focusArtifact(finding.id);
  const before = f.scene.getState().visibleFindings[0], camera = f.scene.getState().cameraY;
  f.resetStats(); f.scene.setState({ artifacts: [{ ...finding, visualType: 'web' }] }); f.advance(80);
  const after = f.scene.getState().visibleFindings[0];
  assert.equal(after.visualType, 'web'); assert.equal(after.screenX, before.screenX); assert.equal(after.screenY, before.screenY); assert.equal(f.scene.getState().cameraY, camera);
  assert.ok(f.stats.outputs.every(item => item.type === 'web')); assert.equal(f.reveals.length, 1); assert.equal(f.reveals[0].type, 'work-finding');
  f.scene.setState({ artifacts: [{ ...finding, visualType: 'web' }] }); f.advance(80); assert.equal(f.reveals.length, 1);
  assert.equal(f.scene.getState().depth, 72); assert.equal(f.scene.getState().targetDepth, 72);
});

function historyFixture(count) {
  const days = [], findings = [];
  for (let day = 0; day < count; day++) {
    const date = new Date(Date.UTC(2010, 0, day + 1)).toISOString().slice(0, 10);
    days.push({ date, depthStart: day * 18, depthEnd: (day + 1) * 18 });
    for (let slot = 0; slot < 6; slot++) findings.push({ id: date + '/' + slot, date, depth: day * 18 + 18 * (.24 + .68 * slot / 5), name: 'Output ' + slot, visualType: ['code', 'document', 'web', 'image', 'table', 'audio'][slot], source: 'local-files' });
  }
  return { days, workFindings: findings };
}

test('long-term direct mode retains ten thousand days and renders only viewport neighbors', t => {
  const f = fixture(t); const world = historyFixture(10000), target = 10000 * 18;
  f.resetStats(); f.scene.setState({ depth: target, startDepth: target, active: false, world, scopeKey: 'permanent' });
  assert.equal(f.scene.getState().revealedArtifactIds.length, 60000); assert.ok(f.stats.outputs.length > 0 && f.stats.outputs.length <= 16); assert.ok(f.stats.blits < 400);
  assert.equal(f.scene.getState().directMode, true); assert.equal(f.scene.jumpToDate(world.days[0].date), true);
  assert.equal(f.scene.getState().visibleDateRange.first, world.days[0].date);
  assert.ok(f.scene.getState().visibleFindings.some(item => item.id.startsWith(world.days[0].date)));
  f.resetStats(); assert.equal(f.scene.jumpToDate(world.days[3000].date), true);
  assert.ok(f.scene.getState().visibleFindings.some(item => item.id.startsWith(world.days[3000].date))); assert.ok(f.stats.outputs.length <= 16); assert.ok(f.stats.blits < 400);
  assert.ok(f.stats.texts.some(item => item.value === world.days[3000].date));
  assert.equal(f.scene.getState().depth, target); assert.equal(f.scene.getState().targetDepth, target); assert.equal(f.reveals.length, 0);
});

test('direct-mode wheel and touch drag keep an independent camera while the real drill continues', t => {
  const f = fixture(t); const world = historyFixture(8);
  f.scene.setState({ depth: 144, startDepth: 100, active: true, world });
  f.fire('wheel', { deltaY: -300, deltaMode: 0 }); const camera = f.scene.getState().cameraY, before = f.scene.getState().depth;
  f.advance(1240); assert.equal(f.scene.getState().cameraY, camera); assert.ok(f.scene.getState().depth > before); assert.equal(f.scene.getState().mode, 'inspect');
  f.scene.setState({ depth: 144, active: false, world }); assert.equal(f.scene.getState().cameraY, camera);
  f.fire('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 720, clientY: 400 });
  f.fire('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 720, clientY: 520 });
  f.fire('pointerup', { pointerType: 'touch', pointerId: 1, clientX: 720, clientY: 520 });
  const dragged = f.scene.getState().cameraY; f.advance(3000); assert.equal(f.scene.getState().cameraY, dragged); assert.ok(dragged < camera);
  f.scene.returnToDrill(); assert.equal(f.scene.getState().mode, 'follow'); assert.ok(f.scene.getState().cameraY > dragged);
  f.fire('wheel', { deltaY: -1e9, deltaMode: 0 }); assert.equal(f.scene.getState().visibleDateRange.first, world.days[0].date);
  f.fire('wheel', { deltaY: 1e9, deltaMode: 0 }); assert.equal(f.scene.getState().mode, 'inspect'); assert.equal(f.scene.getState().targetDepth, 144);
});

test('work-finding mode removes legacy reward targets even when old arrays are supplied alongside it', t => {
  const f = fixture(t); f.scene.setState({ depth: 72, startDepth: 72, active: false, world: { workFindings }, discoveries: nodes, artifacts: [artifact], rooms: [chamber], tracks: [{ id: 'relay', unlocked: true, depth: 0 }] });
  assert.equal(f.scene.getState().revealedIds.length, 0); assert.equal(f.scene.getState().revealedRoomIds.length, 0); assert.equal(f.scene.getState().revealedTrackIds.length, 0);
  assert.equal(f.stats.crystals.length, 0); assert.equal(f.stats.workshops.length, 0); assert.equal(f.stats.chambers.length, 0); assert.equal(f.stats.stations.length, 0);
  assert.equal(f.scene.getState().revealedArtifactIds.includes(artifact.id), false);
  f.scene.setState({ workFindings: [], discoveries: nodes, artifacts: [artifact] }); assert.equal(f.scene.getState().revealedArtifactIds.length, 0);
  f.scene.setState({ scopeKey: 'legacy', depth: 3, instant: true, artifacts: [artifact] }); assert.equal(f.scene.getState().directMode, false); assert.ok(f.stats.workshops.length > 0);
});

test('hover publishes an immutable viewport rectangle and clears on leave, hidden state and withdrawal', t => {
  const f = fixture(t, { sourceUI: true, left: 35, top: 22 }); const finding = { ...workFindings[2], source: 'local-files' };
  f.scene.setState({ depth: 72, startDepth: 72, active: false, workFindings: [finding] }); f.scene.focusArtifact(finding.id);
  const hit = f.scene.getState().visibleFindings[0], point = { pointerType: 'mouse', clientX: hit.screenX + 35, clientY: hit.screenY + 22 };
  f.resetStats(); f.fire('pointermove', point); const hovered = f.hovers.at(-1);
  assert.equal(hovered.item.id, finding.id); assert.equal(hovered.item.date, finding.date); assert.equal(hovered.item.source, 'local-files');
  assert.equal(hovered.screenX, hit.screenX + 35); assert.equal(hovered.screenY, hit.screenY + 22); assert.equal(hovered.rect.width, hit.width);
  assert.ok(Object.isFrozen(hovered) && Object.isFrozen(hovered.item) && Object.isFrozen(hovered.rect));
  assert.equal(f.stats.texts.filter(item => item.value === finding.name).length, 1);
  const count = f.hovers.length; f.fire('pointermove', point); assert.equal(f.hovers.length, count);
  f.fire('pointerleave'); assert.equal(f.hovers.at(-1), null);
  f.fire('pointermove', point); f.hide(true); assert.equal(f.hovers.at(-1), null); f.hide(false);
  f.fire('pointermove', point); f.scene.setState({ workFindings: [] }); assert.equal(f.hovers.at(-1), null);
});

test('touch taps inspect the actual source, with no hover popup and no activation after dragging', t => {
  const f = fixture(t, { sourceUI: true, width: 390, height: 844 }); const finding = workFindings[3];
  f.scene.setState({ depth: 72, startDepth: 72, active: false, workFindings: [finding] }); f.scene.focusArtifact(finding.id);
  const hit = f.scene.getState().visibleFindings[0], point = { pointerType: 'touch', pointerId: 1, clientX: hit.screenX, clientY: hit.screenY };
  f.fire('pointermove', point); assert.equal(f.hovers.length, 0);
  f.fire('pointerdown', point); f.fire('pointerup', point); assert.equal(f.inspections.length, 1); assert.equal(f.inspections[0].item.id, finding.id); assert.equal(f.artifactsOpened.length, 0);
  f.fire('pointerdown', point); f.fire('pointermove', { ...point, clientY: point.clientY + 60 }); f.fire('pointerup', { ...point, clientY: point.clientY + 60 }); assert.equal(f.inspections.length, 1);
  assert.equal(f.scene.getState().depth, 72); assert.equal(f.reveals.length, 0);
});

test('wall text and its pointer target stay steady during drill impacts and same-project syncs', t=>{
  const sprite={width:42,height:37};
  const f=fixture(t,{sourceUI:true,getWorkSprite:()=>sprite}),finding=workFindings[0];
  f.window.devicePixelRatio=1.25;f.resize(1280,800);
  f.scene.setState({depth:finding.depth+20,startDepth:finding.depth+.1,active:true,workFindings:[finding]});
  const hit=f.scene.getState().visibleFindings[0];
  f.fire('pointermove',{pointerType:'mouse',clientX:hit.screenX+hit.width/2-.4,clientY:hit.screenY-8});
  assert.equal(f.hovers.at(-1)?.item.id,finding.id);
  f.resetStats();f.advance(400);
  f.scene.setState({workFindings:[finding]});
  f.advance(400);
  const text=f.stats.texts.filter(call=>call.value===finding.name);
  assert.ok(text.length>10);
  assert.equal(new Set(text.map(call=>call.x)).size,1);
  assert.ok(text.every(call=>Number.isInteger(call.y*1.25)));
  assert.ok(f.hovers.every(hover=>hover?.item.id===finding.id));
  f.scene.setState({workFindings:[]});
  assert.equal(f.hovers.at(-1),null);
});

test('the wall draws the selected work pixels, updates without advancing, and accepts taps across their full width',t=>{
  const landscape={width:112,height:63,lightColor:[205,155,70]};
  const portrait={width:56,height:112,lightColor:[69,121,84]};
  const drawn=[],requests=[];
  let sprite;
  const f=fixture(t,{sourceUI:true,reduced:true,width:1040,
    getWorkSprite:(id,lod)=>{requests.push({id,lod});return lod==='scene' ? null : sprite;},
    onDrawImage:(image,...rect)=>{if(image===landscape||image===portrait)drawn.push({image,rect});}});
  const item={id:'mine-illustration',visualType:'image',date:'2026-11-17',depth:39};
  f.scene.setState({depth:75,startDepth:75,workFindings:[item],active:false});
  assert.ok(f.scene.focusArtifact(item.id));
  assert.ok(f.stats.outputs.some(icon=>icon.type==='image'));
  const before=f.scene.getState();
  sprite=landscape;f.resetStats();f.scene.refreshWorkArt();
  assert.equal(f.stats.outputs.length,0);
  assert.equal(drawn.at(-1).image,landscape);
  const [, ,w,h]=drawn.at(-1).rect;
  assert.ok(w>=90 && Math.abs(w/h-landscape.width/landscape.height)<.04);
  const hit=f.scene.getState().visibleFindings[0];
  assert.equal(hit.width,w*before.scale);assert.equal(hit.height,h*before.scale);
  const point={pointerType:'touch',pointerId:1,clientX:hit.screenX+hit.width*.4,clientY:hit.screenY};
  f.fire('pointerdown',point);f.fire('pointerup',point);
  assert.equal(f.inspections.at(-1).item.id,item.id);
  sprite=portrait;f.scene.refreshWorkArt();
  const next=f.scene.getState();
  assert.equal(drawn.at(-1).image,portrait);
  assert.ok(next.visibleFindings[0].height>next.visibleFindings[0].width);
  assert.equal(next.depth,before.depth);assert.equal(next.cameraY,before.cameraY);
  assert.equal(f.reveals.length,0);
  assert.ok(requests.every(r=>r.id===item.id && ['stage','scene'].includes(r.lod)));
});

test('a narrow wall leaves clearance for the drill, nearby records, and the screen edge',t=>{
  const media={width:112,height:63},sheet={width:40,height:46};
  const f=fixture(t,{width:390,height:844,getWorkSprite:(id,lod)=>lod==='scene'?null:id==='ledger'?sheet:media});
  const items=['before','after','ledger'].map((id,i)=>({id,date:'2026-11-17',depth:35+i*.1,visualType:i===2?'table':'image'}));
  f.scene.setState({depth:69,startDepth:69,active:false,workFindings:items});f.scene.focusArtifact('after');
  const hits=Array.from(f.scene.getState().visibleFindings);assert.equal(hits.length,3);
  for(const a of hits){
    assert.ok(a.screenX-a.width/2>0 && a.screenX+a.width/2<390);
    assert.ok(Math.abs(a.screenX-195)-a.width/2>=46);
    for(const b of hits.filter(b=>b.id!==a.id)){
      assert.ok(Math.abs(a.screenX-b.screenX)>=(a.width+b.width)/2 || Math.abs(a.screenY-b.screenY)>=(a.height+b.height)/2);
    }
  }
});

test('encountering an image while digging keeps its original thumbnail in the wall on a portrait phone',t=>{
  const artwork={width:288,height:162},frames=[];
  const item={id:'phone-landscape',date:'2026-11-18',depth:10.5,visualType:'image'};
  let f;
  f=fixture(t,{width:390,height:844,pauseAtFindings:true,
    getWorkSprite:()=>artwork,onDrawImage:(image,...rect)=>{if(image===artwork)frames.push(rect);},
    onReveal:()=>f.scene.setDiscoveryHold(true)});
  f.scene.setState({scopeKey:'phone-run',active:false,startDepth:10,depth:35,workFindings:[item]});
  f.scene.setState({active:true,revealStart:true});f.step();f.step(900);
  assert.equal(f.reveals.at(-1).id,item.id);
  frames.length=0;f.advance(1080);
  const state=f.scene.getState(),hit=state.visibleFindings.find(work=>work.id===item.id);
  assert.equal(state.depth,item.depth);
  assert.ok(hit.width>=24 && hit.width<170);
  assert.ok(frames.length>0);
  assert.ok(frames.every(([, ,w])=>w*state.scale<170));
});

test('focusing a picture leaves it on its shelf after inspecting, syncing and moving between works',t=>{
  const camp={width:288,height:162},paper={width:32,height:39},frames=[];
  const works=[{id:'camp',date:'2026-11-17',depth:93,visualType:'image'},{id:'letter',date:'2026-11-17',depth:94,visualType:'document'}];
  const f=fixture(t,{width:1040,height:800,sourceUI:true,reduced:true,
    getWorkSprite:(id,lod)=>id==='letter'?paper:camp,onDrawImage:(image,...dest)=>{if(image===camp)frames.push(dest);}});
  f.scene.setState({scopeKey:'actual',depth:200,startDepth:200,workFindings:works});
  frames.length=0;assert.ok(f.scene.focusArtifact('camp'));
  const checkView=()=>{
    const hit=f.scene.getState().visibleFindings.find(w=>w.id==='camp');
    assert.ok(hit.width>24 && hit.width<400);
    assert.ok(Math.abs(hit.width/hit.height-16/9)<.02);
    assert.ok(Math.abs(hit.screenX-520)>hit.width/2);
  };
  checkView();assert.equal(frames.length,1);
  f.scene.setState({scopeKey:'actual',depth:201,active:false,preserveView:true,workFindings:works});checkView();
  const nearby=f.scene.getState().visibleFindings.find(w=>w.id==='letter');
  const point={pointerType:'touch',pointerId:1,clientX:nearby.screenX,clientY:nearby.screenY};
  f.fire('pointerdown',point);f.fire('pointerup',point);
  assert.equal(f.inspections.at(-1).item.id,'letter');
  f.scene.focusArtifact('letter');
  assert.ok(f.scene.getState().visibleFindings.find(w=>w.id==='camp').width<400);
  f.scene.focusArtifact('camp');frames.length=0;
  f.scene.setView({depth:180});assert.equal(frames.length,0);
  f.scene.setState({scopeKey:'different',depth:100,startDepth:100,workFindings:works});f.scene.setView({depth:93});
  assert.ok(f.scene.getState().visibleFindings.find(w=>w.id==='camp').width<400);
});

test('wheel browsing past real media preserves the mine and other work stays clickable',t=>{
  const sprite={width:288,height:162},clip={width:240,height:160},sheet={width:32,height:40};
  const ready=new Map([['dusk',sprite],['film',clip]]),requests=[];
  const works=[['dusk','image',60],['letter','document',61],['absent','image',120],['film','video',122],['notes','code',170],['future','image',241]]
    .map(([id,visualType,depth])=>({id,visualType,depth,date:'2026-11-17'}));
  const f=fixture(t,{width:1040,height:800,reduced:true,sourceUI:true,
    getWorkSprite(id,lod){if(lod==='scene'){requests.push(id);return ready.get(id);}return ready.get(id)||sheet;}});
  f.scene.setState({depth:240,startDepth:240,workFindings:works});
  const panorama=()=>f.scene.getState().visibleFindings.find(w=>w.width>800)?.id;
  const wheelTo=depth=>{
    const s=f.scene.getState(),center=70+depth*7-19;
    f.fire('wheel',{deltaY:(center-400/s.scale-s.cameraY)*s.scale/.8,deltaMode:0});
  };
  wheelTo(120);f.advance(60);wheelTo(60);f.advance(100);
  assert.equal(panorama(),undefined);assert.equal(requests.length,0);
  f.advance(80);assert.equal(panorama(),undefined);
  const hit=f.scene.getState().visibleFindings.find(w=>w.id==='letter');
  const tap={pointerType:'touch',pointerId:4,clientX:hit.screenX,clientY:hit.screenY};
  f.fire('pointerdown',tap);f.fire('pointerup',tap);assert.equal(f.inspections.at(-1).item.id,'letter');
  wheelTo(120);f.advance(180);assert.equal(panorama(),undefined);
  assert.deepEqual(requests,[]);
  ready.set('absent',sprite);f.scene.refreshWorkArt();assert.equal(panorama(),undefined);
  wheelTo(170);f.advance(180);assert.equal(panorama(),undefined);assert.ok(!requests.includes('notes'));
  f.scene.setView({depth:60});f.advance(500);assert.equal(panorama(),undefined);
  assert.equal(f.reveals.length,0);assert.equal(f.scene.getState().depth,240);
});

test('keyboard browsing keeps wall art bounded while paused and End returns to the drill',t=>{
  const sprite={width:288,height:162};
  const f=fixture(t,{width:1040,height:800,reduced:true,sourceUI:true,getWorkSprite:()=>sprite});
  f.scene.setState({depth:220,startDepth:220,workFindings:[{id:'art',visualType:'image',depth:80,date:'2026-11-17'}]});
  f.scene.setView({depth:80});
  const expanded=()=>f.scene.getState().visibleFindings.some(w=>w.id==='art' && w.width>800);
  f.fire('keydown',{key:'ArrowUp'});f.advance(60);
  assert.equal(expanded(),false);
  f.fire('keydown',{key:'ArrowDown'});f.advance(180);
  assert.equal(expanded(),false);
  f.fire('keydown',{key:'End'});f.advance(180);
  assert.equal(f.scene.getState().mode,'follow');assert.equal(expanded(),false);
});

test('touch browsing, date jumps and scope changes keep pictures in their own wall compartments',t=>{
  const sprite={width:288,height:162},works=[['selected',90],['nearby',94],['other',110]].map(([id,depth])=>({id,depth,date:'2026-11-17',visualType:'image'}));
  const f=fixture(t,{width:1040,height:800,reduced:true,getWorkSprite:()=>sprite});
  const world={workFindings:works,days:[{date:'2026-11-17',depthStart:80,depthEnd:108}]};
  f.scene.setState({scopeKey:'one',depth:180,startDepth:180,world});
  const panorama=()=>f.scene.getState().visibleFindings.find(w=>w.width>800)?.id;
  f.scene.focusArtifact('selected');assert.equal(panorama(),undefined);
  f.fire('wheel',{deltaY:105,deltaMode:0});f.advance(200);assert.equal(panorama(),undefined);
  const s=f.scene.getState(),dy=(s.cameraY+400/s.scale-(70+110*7-19))*s.scale;
  const touch={pointerType:'touch',pointerId:1,clientX:180,clientY:520};
  f.fire('pointerdown',touch);f.fire('pointermove',{...touch,clientY:520+dy});f.advance(250);
  assert.equal(panorama(),undefined);
  f.fire('pointerup',{...touch,clientY:520+dy});f.advance(180);assert.equal(panorama(),undefined);
  f.fire('wheel',{deltaY:-220,deltaMode:0});f.scene.jumpToDate('2026-11-17');f.advance(220);assert.equal(panorama(),undefined);
  f.fire('wheel',{deltaY:12,deltaMode:0});f.scene.setState({scopeKey:'next',depth:110,startDepth:110,world});
  f.advance(200);assert.equal(panorama(),undefined);
});

test('zoom and date jumps change only the inspected view and reject unexcavated dates', t => {
  const f = fixture(t, { width: 390, height: 844 }); const world = historyFixture(40);
  f.scene.setState({ depth: 720, startDepth: 500, active: false, world });
  assert.equal(f.scene.jumpToDate(world.days[35].date), false); assert.equal(f.scene.jumpToDate('missing'), false);
  assert.equal(f.scene.jumpToDate(world.days[12].date), true); const center = f.scene.getState().cameraY + 844 / (2 * f.scene.getState().scale);
  assert.equal(f.scene.setZoom(.6), .5); assert.equal(f.scene.getState().scale, 1); assert.equal(f.scene.getState().cameraY + 844 / 2, center);
  assert.equal(f.scene.setZoom(1.6), 1.5); assert.equal(f.scene.getState().scale, 3); assert.equal(f.scene.getState().mode, 'inspect');
  f.scene.setState({ depth: 720, world }); assert.equal(f.scene.getState().mode, 'inspect');
  assert.equal(f.scene.getState().depth, 500); assert.equal(f.scene.getState().targetDepth, 720); assert.equal(f.scene.setView({ depth: -50 }), true);
  f.scene.follow(); assert.equal(f.scene.getState().mode, 'follow'); assert.equal(f.reveals.length, 0);
});

test('zoom buttons advance by one pixel scale and disable only at the limits', t => {
  for (const [width, height, base, min, max] of [[390, 844, 2, 1, 3], [1280, 800, 3, 2, 5]]) {
    const { scene } = fixture(t, { width, height });
    const state = () => scene.getState();
    assert.equal(state().scale, base);
    for (let scale = base - 1; scale >= min; scale--) {
      scene.stepZoom(-1);
      assert.equal(state().scale, scale);
      assert.equal(state().canZoomOut, scale > min);
    }
    scene.stepZoom(-1);
    assert.equal(state().scale, min);
    for (let scale = min + 1; scale <= max; scale++) {
      scene.stepZoom(1);
      assert.equal(state().scale, scale);
      assert.equal(state().canZoomIn, scale < max);
    }
    scene.stepZoom(1);
    assert.equal(state().scale, max);
    for (let scale = max - 1; scale >= base; scale--) {
      scene.stepZoom(-1);
      assert.equal(state().scale, scale);
    }
    assert.equal(state().zoom, 1);
    assert.equal(state().canZoomOut && state().canZoomIn, true);
  }
});

test('turning a zoomed screen preserves the inspected center and round-trips the chosen pixel scale', t => {
  const f = fixture(t, { width: 844, height: 390 });
  f.scene.setState({ depth: 600, startDepth: 600, active: false, world: historyFixture(40) });
  f.scene.setView({ depth: 275 });
  const center = height => { const view = f.scene.getState(); return view.cameraY + height / (2 * view.scale); };
  const initial = center(390);
  f.scene.stepZoom(1);
  assert.equal(f.scene.getState().scale, 4);
  assert.equal(center(390), initial);
  f.resize(390, 844);
  assert.equal(f.scene.getState().scale, 3);
  assert.equal(center(844), initial);
  f.resize(844, 390);
  assert.equal(f.scene.getState().scale, 4);
  assert.equal(center(390), initial);
  f.scene.returnToDrill();
  const follow = f.scene.getState();
  f.resize(390, 844);
  f.resize(844, 390);
  assert.equal(f.scene.getState().mode, 'follow');
  assert.equal(f.scene.getState().depth, follow.depth);
  assert.equal(f.scene.getState().cameraY, follow.cameraY);
});

test('inactive reduced-motion direct mode preserves settled depth until an explicit start', t => {
  const f = fixture(t, { reduced: true }); const world = historyFixture(8);
  f.scene.setState({ depth: 144, startDepth: 100, active: false, world }); assert.equal(f.scene.getState().depth, 100); assert.equal(f.frames.size, 0);
  f.scene.jumpToDate(world.days[2].date); const camera = f.scene.getState().cameraY;
  f.scene.setState({ depth: 144, world }); assert.equal(f.scene.getState().depth, 100); assert.equal(f.scene.getState().cameraY, camera);
  f.scene.setPaused(true); f.scene.setState({ active: true }); assert.equal(f.scene.getState().depth, 100);
  f.scene.setPaused(false); assert.equal(f.scene.getState().depth, 144); assert.equal(f.scene.getState().cameraY, camera); assert.equal(f.frames.size, 0);
  assert.equal(f.reveals.length, 0);
});

test('locale updates accessible source controls and hidden inspection never advances direct data', t => {
  const f = fixture(t); const finding = workFindings[2]; f.scene.setState({ depth: 72, startDepth: 72, active: false, workFindings: [finding], locale: 'en' }); f.scene.focusArtifact(finding.id);
  assert.ok(f.canvas.getAttribute('aria-label').startsWith('Mine history')); assert.ok(f.parent.children[1].children[0].textContent.includes('Press Enter'));
  f.scene.setState({ locale: 'ja' }); assert.ok(f.canvas.getAttribute('aria-label').startsWith('採掘')); assert.ok(f.parent.children[1].children[0].textContent.includes('Enterで'));
  f.hide(true); f.advance(10000); assert.equal(f.scene.getState().depth, 72); assert.equal(f.frames.size, 0); f.hide(false);
  assert.equal(f.scene.getState().mode, 'inspect'); assert.equal(f.reveals.length, 0);
});

test('conversation memories retain their direct icon and immutable provenance through hover and touch inspection', t => {
  const f = fixture(t, { sourceUI: true });
  const finding = { ...workFindings[0], visualType: 'memory', source: 'conversation', sourceLabel: 'AI 记录', method: 'agent-memory', memoryIds: ['memory-1'], sourceIds: ['session-1'], outputIds: [], paths: ['notes/daily.md'], path: 'notes/daily.md' };
  f.scene.setState({ depth: 72, startDepth: 72, active: false, workFindings: [finding] }); f.scene.focusArtifact(finding.id);
  const hit = f.scene.getState().visibleFindings[0]; assert.equal(hit.visualType, 'memory'); assert.ok(f.stats.outputs.some(item => item.type === 'memory'));
  const point = { clientX: hit.screenX, clientY: hit.screenY, pointerId: 1 };
  f.fire('pointermove', { ...point, pointerType: 'mouse' }); const hover = f.hovers.at(-1).item;
  assert.equal(hover.source, 'conversation'); assert.equal(hover.sourceLabel, 'AI 记录'); assert.equal(hover.method, 'agent-memory'); assert.equal(hover.path, finding.path);
  assert.deepEqual(Array.from(hover.paths), finding.paths); assert.deepEqual(Array.from(hover.memoryIds), ['memory-1']); assert.ok(Object.isFrozen(hover.paths) && Object.isFrozen(hover.memoryIds));
  finding.memoryIds.push('mutated'); assert.deepEqual(Array.from(hover.memoryIds), ['memory-1']);
  f.fire('pointerdown', { ...point, pointerType: 'touch' }); f.fire('pointerup', { ...point, pointerType: 'touch' });
  assert.deepEqual(Array.from(f.inspections[0].item.memoryIds), ['memory-1']); assert.equal(f.scene.getState().depth, 72); assert.equal(f.reveals.length, 0);
});

test('a permanent day retains nine output types plus three source-backed memories', t => {
  const f = fixture(t); const types = ['web','document','image','audio','video','slides','table','code','file','memory','memory','memory'];
  const findings = types.map((visualType, index) => ({ id: 'day/' + index, date: '2026-11-18', name: visualType, visualType, depth: 36 + index * 3 }));
  f.scene.setState({ depth: 72, startDepth: 72, active: false, world: { workFindings: findings } });
  assert.equal(f.scene.getState().revealedArtifactIds.length, 12);
  for (const item of findings) { assert.equal(f.scene.focusArtifact(item.id), true); assert.ok(f.scene.getState().visibleFindings.some(hit => hit.id === item.id && hit.visualType === item.visualType)); }
  assert.equal(f.scene.getState().targetDepth, 72); assert.equal(f.reveals.length, 0);
});

test('body-sibling transparent HUD controls suppress covered scene labels without hiding the source', t => {
  const f = fixture(t); const finding = workFindings[2];
  f.scene.setState({ depth: 72, startDepth: 72, active: false, workFindings: [finding] }); f.resetStats(); f.scene.focusArtifact(finding.id);
  const label = f.stats.texts.find(item => item.value === finding.name); assert.ok(label);
  let hidden = false;
  f.document.querySelectorAll = selector => {
    assert.ok(selector.includes('.mine-actions') && selector.includes('.topbar'));
    return [{ get hidden() { return hidden; }, getBoundingClientRect: () => ({ left: label.x - 100, right: label.x + 100, top: label.y - 12, bottom: label.y + 12, width: 200, height: 24 }) }];
  };
  f.resetStats(); f.scene.setState({}); assert.equal(f.stats.texts.some(item => item.value === finding.name), false); assert.equal(f.scene.getState().visibleFindings.length, 1);
  hidden = true; f.resetStats(); f.scene.setState({}); assert.ok(f.stats.texts.some(item => item.value === finding.name));
});

test('historical camera date follows date jumps, wheel and zoom independently of the drill date', t => {
  const f = fixture(t); const world = historyFixture(20);
  f.scene.setState({ depth: 360, startDepth: 360, active: false, world });
  const drillDate = world.days.at(-1).date; assert.equal(f.scene.getState().currentLayerDate, drillDate);
  assert.equal(f.scene.jumpToDate(world.days[8].date), true);
  let state = f.scene.getState(); assert.equal(state.viewDate, world.days[8].date); assert.equal(state.visibleLayerDate, state.viewDate); assert.equal(state.currentLayerDate, drillDate);
  assert.equal(f.progress.at(-1).value.viewDate, world.days[8].date);
  f.scene.setZoom(.6); state = f.scene.getState(); assert.equal(state.viewDate, world.days[8].date);
  f.fire('wheel', { deltaY: -315, deltaMode: 0 }); assert.equal(f.scene.getState().viewDate, world.days[7].date);
  f.scene.setState({ world }); assert.equal(f.scene.getState().viewDate, world.days[7].date); assert.equal(f.scene.getState().currentLayerDate, drillDate);
  f.scene.returnToDrill(); assert.equal(f.scene.getState().viewDate, drillDate); assert.equal(f.scene.getState().depth, 360);
  f.scene.setState({ scopeKey: 'empty', depth: 0, startDepth: 0, world: { workFindings: [], days: [] } }); assert.equal(f.scene.getState().viewDate, null);
});


test('chronicle digging uses 1.7 metres per actual foreground second at different frame rates', t => {
  const fine=fixture(t),coarse=fixture(t);
  for(const f of [fine,coarse]){f.scene.setState({depth:300,startDepth:0,active:true,workFindings:[]});f.step();}
  fine.advance(10000,40);coarse.advance(10000,500);
  assert.ok(Math.abs(fine.scene.getState().depth-17)<1e-8);assert.ok(Math.abs(coarse.scene.getState().depth-17)<1e-8);
  assert.equal(coarse.scene.getState().speed,1.7);assert.equal(coarse.scene.getState().active,true);
});

test('all three paces change travel time without skipping work or increasing the earned depth',t=>{
  const f=fixture(t);
  const works=[{id:'first',depth:4,date:'2026-11-18',visualType:'image'},{id:'second',depth:8,date:'2026-11-18',visualType:'audio'}];
  f.scene.setState({depth:20,active:false,workFindings:works});
  assert.equal(f.scene.setPace('brisk'),true);
  assert.equal(f.scene.getState().speed,2.55);assert.equal(f.scene.getState().depth,0);
  f.scene.setState({active:true});f.step();f.advance(2000);
  assert.ok(Math.abs(f.scene.getState().depth-5.1)<1e-8);
  assert.equal(f.scene.setPace('fast'),true);assert.equal(f.scene.getState().speed,5.1);
  f.advance(1000);assert.ok(Math.abs(f.scene.getState().depth-10.2)<1e-8);
  assert.deepEqual(f.reveals.map(work=>[work.id,work.depth]),[['first',4],['second',8]]);
  assert.equal(f.scene.setPace('invalid'),false);f.scene.setPaused(true);f.elapse(90000);f.scene.setPaused(false);f.step();
  assert.ok(Math.abs(f.scene.getState().depth-10.2)<1e-8);
  f.scene.setPace('normal');f.advance(10000);assert.equal(f.scene.getState().depth,20);assert.equal(f.scene.getState().targetDepth,20);
});

test('direct discovery events arrive in source-depth order before endpoint progress, once only',t=>{
  let f;const trace=[];f=fixture(t,{onReveal:event=>trace.push({event,lastProgress:f.progress.at(-1).value.depth})});
  const items=[{id:'third',depth:3,date:'2026-11-18',visualType:'memory',name:'A note'},{id:'first',depth:1,date:'2026-11-18',visualType:'web'},{id:'second',depth:2,date:'2026-11-18',visualType:'code'}];
  f.scene.setState({depth:3,active:true,workFindings:items,scopeKey:'live'});f.step();f.step(4000);
  assert.deepEqual(trace.map(x=>x.event.id),['first','second','third']);assert.deepEqual(trace.map(x=>x.event.sequence),[1,2,3]);
  assert.ok(trace.every(x=>x.event.type==='work-finding'&&x.event.date==='2026-11-18'&&x.lastProgress<3));assert.equal(trace.at(-1).event.visualType,'memory');
  f.scene.setState({workFindings:items});f.scene.jumpToDate('2026-11-18');assert.equal(f.reveals.length,3);
});

test('direct historical refresh, type correction, inspection and replay never trigger discovery theatrics',async t=>{
  const f=fixture(t);const items=[{id:'past',depth:2,date:'2026-11-18',visualType:'code'},{id:'next',depth:4,date:'2026-11-18',visualType:'memory'}];
  f.scene.setState({depth:6,startDepth:3,active:true,workFindings:items});assert.equal(f.reveals.length,0);
  f.scene.setState({workFindings:items.map(i=>({...i,visualType:'document'}))});f.step();assert.equal(f.reveals.length,0);
  f.scene.setView({depth:1});f.advance(4000);assert.equal(f.reveals.length,0);assert.equal(f.scene.getState().depth,6);
  const promise=f.scene.replay(0,6);f.advance(2000);await promise;assert.equal(f.reveals.length,0);assert.equal(f.scene.getState().targetDepth,6);
  f.scene.returnToDrill();f.scene.setState({depth:8,workFindings:[...items,{id:'new',depth:7,date:'2026-11-18',visualType:'image'}]});f.advance(2000);
  assert.deepEqual(f.reveals.map(i=>i.id),['new']);assert.equal(f.reveals[0].sequence,1);
});

test('large foreground frame gaps remain target bounded and do not produce unbounded particles',t=>{
  const f=fixture(t);f.scene.setState({depth:300,active:true,workFindings:[]});f.step();f.scene.boost();f.step(1000000);
  assert.equal(f.scene.getState().depth,300);assert.ok(f.scene.getState().particleCount<=90);assert.equal(f.scene.getState().boostRemaining,0);
  const after=f.scene.getState().depth;f.hide(true);f.elapse(1000000);f.hide(false);f.step();assert.equal(f.scene.getState().depth,after);
});

test('reduced motion settles without effects and direct scope reset restarts reveal sequence',t=>{
  const f=fixture(t);const workFindings=[{id:'a',depth:1,date:'2026-11-18',visualType:'web'}];
  f.scene.setState({depth:2,active:true,workFindings,scopeKey:'one'});f.advance(1500);assert.equal(f.reveals[0].sequence,1);
  f.scene.setState({depth:2,startDepth:0,active:true,workFindings,scopeKey:'two'});f.advance(1500);assert.equal(f.reveals[1].sequence,1);
  f.scene.setState({depth:10,workFindings:[...workFindings,{id:'b',depth:8}]});f.reduce(true);assert.equal(f.scene.getState().depth,10);assert.equal(f.reveals.length,2);assert.equal(f.scene.getState().feedbackCount,0);
});

test('heavy direct-mode rig retains contact depth and accepts a tap on the upper cabin',t=>{
  const f=fixture(t);f.scene.setState({depth:20,active:true,workFindings:[]});const state=f.scene.getState(),rig=f.stats.rigs.at(-1);
  assert.equal(rig.heavy,true);assert.ok(rig.y+23<=70&&rig.y+23>=68);const x=720,y=(rig.y-34-Math.floor(state.cameraY))*state.scale;
  f.fire('pointerdown',{pointerId:1,clientX:x,clientY:y});f.fire('pointerup',{pointerId:1,clientX:x,clientY:y});assert.ok(f.scene.getState().boostRemaining>0);
  f.scene.setState({scopeKey:'legacy',depth:20,active:true});assert.equal(f.stats.rigs.at(-1).heavy,undefined);
});


test('an explicit reduced-motion start publishes static discoveries once, while initialization and polls remain silent',t=>{
  const f=fixture(t,{reduced:true});const items=[{id:'one',depth:1,date:'2026-11-18',visualType:'web'},{id:'two',depth:2,date:'2026-11-18',visualType:'memory'}];
  f.scene.setState({depth:3,startDepth:0,active:false,workFindings:items,scopeKey:'reduced'});assert.equal(f.reveals.length,0);
  f.scene.setState({active:true,revealStart:true});assert.deepEqual(f.reveals.map(i=>i.id),['one','two']);assert.ok(f.reveals.every(i=>i.static));assert.equal(f.scene.getState().depth,3);assert.equal(f.scene.getState().feedbackCount,0);assert.equal(f.frames.size,0);
  f.scene.setState({active:true,workFindings:items});assert.equal(f.reveals.length,2);
  f.scene.setState({scopeKey:'loaded-active',depth:3,active:true,workFindings:items});assert.equal(f.reveals.length,2);
});

test('reduced-motion preference changes do not bypass a paused dialog or hidden tab',t=>{
  for(const suspension of ['pause','hidden']){
    const f=fixture(t);f.scene.setState({depth:40,startDepth:10,active:true,workFindings:[]});f.step();f.advance(1000);
    if(suspension==='pause')f.scene.setPaused(true);else f.hide(true);
    const stopped=f.scene.getState().depth;f.reduce(true);assert.equal(f.scene.getState().depth,stopped);assert.equal(f.frames.size,0);
    if(suspension==='pause')f.scene.setPaused(false);else f.hide(false);
    assert.equal(f.scene.getState().depth,40);assert.equal(f.frames.size,0);assert.equal(f.reveals.length,0);
  }
});

test('a reduced-motion tab synchronizing another clients start stays silent',t=>{
  const a=fixture(t,{reduced:true}),b=fixture(t,{reduced:true}),workFindings=[{id:'new',date:'2026-11-18',depth:15,visualType:'web'}];
  for(const f of [a,b])f.scene.setState({scopeKey:'same-project',depth:20,startDepth:10,active:false,workFindings});
  a.scene.setState({active:true,revealStart:true});b.scene.setState({active:true});
  assert.equal(a.reveals.length,1);assert.equal(b.reveals.length,0);assert.equal(a.scene.getState().depth,20);assert.equal(b.scene.getState().depth,20);
  b.scene.setState({reset:true,startDepth:20,depth:20,active:false,workFindings});assert.equal(b.reveals.length,0);
});

test('remote settled progress preserves an inspected camera only when explicitly requested',t=>{
  const f=fixture(t),world=historyFixture(15);f.scene.setState({scopeKey:'one',depth:270,startDepth:200,active:true,world});f.scene.jumpToDate(world.days[4].date);const camera=f.scene.getState().cameraY;
  f.scene.setState({scopeKey:'one',depth:270,startDepth:230,active:true,reset:true,preserveView:true,world});
  assert.equal(f.scene.getState().depth,230);assert.equal(f.scene.getState().mode,'inspect');assert.equal(f.scene.getState().cameraY,camera);assert.equal(f.reveals.length,0);
  f.scene.setState({scopeKey:'two',depth:270,startDepth:230,active:false,reset:true,preserveView:true,world});assert.equal(f.scene.getState().mode,'follow');assert.notEqual(f.scene.getState().cameraY,camera);
});

test('repeated source taps and pace changes while paused cannot create progress or reveals',t=>{
  const f=fixture(t,{sourceUI:true}),finding={id:'stable',depth:10,date:'2026-11-18',visualType:'code'};
  f.scene.setState({depth:40,startDepth:20,active:true,workFindings:[finding]});f.scene.setPaused(true);f.scene.focusArtifact('stable');const before=f.scene.getState(),hit=before.visibleFindings[0];
  for(let i=0;i<2;i++){f.fire('pointerdown',{pointerId:i+1,pointerType:'touch',clientX:hit.screenX,clientY:hit.screenY});f.fire('pointerup',{pointerId:i+1,pointerType:'touch',clientX:hit.screenX,clientY:hit.screenY});}
  f.scene.setPace('fast');f.advance(10000);assert.equal(f.scene.getState().depth,before.depth);assert.equal(f.inspections.length,2);assert.equal(f.reveals.length,0);assert.equal(f.scene.getState().pace,'fast');
  f.scene.setPaused(false);f.scene.returnToDrill();f.step();f.advance(1000);assert.ok(Math.abs(f.scene.getState().depth-25.1)<1e-8);
});

function excavationStopFixture(t, reduced = false) {
  let f;
  f = fixture(t, {reduced, pauseAtFindings:true, onReveal() { f.scene.setDiscoveryHold(true); }});
  const findings = [{id:'first',depth:10.5},{id:'sibling',depth:10.5},{id:'last',depth:11.25}]
    .map(item => ({...item, date:'2026-11-18', visualType:'image'}));
  f.scene.setState({scopeKey:'trip', active:false, startDepth:10, depth:35, workFindings:findings});
  return f;
}

test('a long frame stops on the first rock, then shows only its same-depth siblings', t => {
  const f = excavationStopFixture(t);
  f.scene.setState({active:true, revealStart:true}); f.step(); f.step(30000);
  assert.equal(f.scene.getState().depth,10.5);
  assert.equal(f.scene.getState().discoveryHold,true);
  assert.equal(f.scene.getState().working,false);
  assert.deepEqual(f.reveals.map(e=>e.id),['first','sibling']);
  assert.equal(f.progress.at(-1).value.depth,10.5);
  f.fire('wheel',{deltaY:-100,deltaMode:0});
  assert.equal(f.scene.getState().mode,'follow');
  assert.equal(f.scene.focusArtifact('first'),false);
  f.advance(1000); f.step(9000);
  assert.equal(f.scene.getState().depth,10.5);
  assert.equal(f.frames.size,0);
  f.scene.setDiscoveryHold(false); f.step(); f.step(10000);
  assert.equal(f.scene.getState().depth,11.25);
  assert.equal(f.reveals.at(-1).id,'last');
  f.scene.setDiscoveryHold(false); f.step(); f.step(30000);
  assert.equal(f.scene.getState().depth,35);
});

test('cracking rock conceals the sprite at impact, then ejects and settles it at the wall', t => {
  const f = excavationStopFixture(t);
  f.scene.setState({active:true,revealStart:true}); f.step();
  f.resetStats(); f.step(900);
  assert.equal(f.stats.outputs.length,0);
  f.step(); f.advance(320);
  const airborne = f.stats.outputs.slice(-2);
  f.advance(720);
  const settled = f.stats.outputs.slice(-2);
  assert.equal(airborne.length,2); assert.equal(settled.length,2);
  for (let i=0; i<2; i++) {
    assert.ok(airborne[i].y < settled[i].y);
    assert.ok(Math.abs(airborne[i].x) < Math.abs(settled[i].x));
  }
  assert.equal(f.scene.getState().depth,10.5);
});

test('reduced motion waits at each discovery across visibility and modal transitions', t => {
  const f = excavationStopFixture(t,true);
  f.scene.setState({active:true, revealStart:true});
  assert.equal(f.scene.getState().depth,10.5);
  assert.equal(f.scene.getState().feedbackCount,0);
  assert.ok(f.reveals.every(event=>event.static));
  f.hide(true); f.elapse(12000); f.hide(false);
  f.scene.setPaused(true); f.scene.setDiscoveryHold(false); f.advance(2000);
  assert.equal(f.scene.getState().depth,10.5);
  f.scene.setPaused(false);
  assert.equal(f.scene.getState().depth,11.25);
  f.scene.setDiscoveryHold(false); assert.equal(f.scene.getState().depth,35);
});

test('another tab can save progress without moving the drill behind an open discovery', t => {
  const f = excavationStopFixture(t);
  f.scene.setState({active:true,revealStart:true}); f.step(); f.step(450);
  f.scene.setState({reset:true, active:true, depth:35, startDepth:20});
  assert.equal(f.scene.getState().depth,10.5);
  f.scene.setDiscoveryHold(false);
  assert.equal(f.scene.getState().depth,20); assert.deepEqual(f.reveals.map(e=>e.id),['first','sibling']);
  f.scene.setDiscoveryHold(true);
  f.scene.setState({scopeKey:'another-project', startDepth:0, depth:4, active:false, workFindings:[]});
  assert.equal(f.scene.getState().discoveryHold,false);
});

test('a restored pending discovery in reduced motion starts paused at its saved depth', t => {
  const f = excavationStopFixture(t, true);
  f.scene.setState({reset:true, active:true, discoveryHold:true, startDepth:10.5, depth:35});
  assert.equal(f.scene.getState().depth,10.5); assert.equal(f.reveals.length,0);
  f.scene.setDiscoveryHold(false);
  assert.equal(f.scene.getState().depth,11.25); assert.deepEqual(f.reveals.map(e=>e.id),['last']);
});
