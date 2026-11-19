'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const L = require('../dist/cavern-lighting.js');

const base = { width: 200, height: 200, scale: 1, cameraY: 0, frontier: 300, wallAt: () => 200, biomeAt: () => 0, reduced: true };
const lamp = { x: 0, y: 100, radius: 70, color: [255, 190, 90], strength: 1, kind: 'lamp' };
function sample(map, state, x, y) {
  const gx = Math.max(0, Math.min(map.width - 1, Math.floor((x * state.scale + state.width / 2) / map.pixelSize)));
  const gy = Math.max(0, Math.min(map.height - 1, Math.floor((y - state.cameraY) * state.scale / map.pixelSize)));
  return Array.from(map.data.slice((gy * map.width + gx) * 4, (gy * map.width + gx) * 4 + 3));
}
const brightness = rgb => rgb.reduce((a, b) => a + b, 0);
test('a lit vista preserves authored colors while the rest of its stratum stays underground',()=>{
  const map=L.buildLightmap({...base,lights:[lamp],daylight:{left:-42,right:42,top:52,bottom:148}});
  assert.deepEqual(sample(map,base,0,100),[255,255,255]);
  assert.ok(brightness(sample(map,base,88,185))<620);
});
function renderFixture() {
  let created = 0, uploads = 0, imageAllocations = 0;
  const drawn = [], saved = [];
  const target = { globalCompositeOperation: 'source-over', globalAlpha: .4, imageSmoothingEnabled: true,
    save() { saved.push([this.globalCompositeOperation, this.globalAlpha, this.imageSmoothingEnabled]); },
    restore() { [this.globalCompositeOperation, this.globalAlpha, this.imageSmoothingEnabled] = saved.pop(); },
    drawImage(canvas, x, y, width, height) { drawn.push({ canvas, x, y, width, height, composite: this.globalCompositeOperation, alpha: this.globalAlpha, smoothing: this.imageSmoothingEnabled }); }
  };
  const canvas = { width: 0, height: 0, getContext() { return {
    createImageData(w, h) { imageAllocations++; return { data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() { uploads++; }
  }; } };
  const lighting = L.create({ canvasFactory() { created++; return canvas; } });
  return { lighting, target, canvas, drawn, saved, counts: () => ({ created, uploads, imageAllocations }) };
}

test('distance attenuation is bounded, smooth and strictly decreases inside its radius', () => {
  assert.equal(L.attenuation(0, 80), 1); assert.equal(L.attenuation(80, 80), 0); assert.equal(L.attenuation(900, 80), 0);
  assert.equal(L.attenuation(1, 0), 0); assert.equal(L.attenuation(Infinity, 20), 0);
  let previous = 1; for (let d = 1; d < 80; d++) { const next = L.attenuation(d, 80); assert.ok(next >= 0 && next < previous); previous = next; }
});

test('lit surfaces approach sprite color while ambient remains readable outside the light', () => {
  const state = { ...base, lights: [lamp] }, map = L.buildLightmap(state);
  assert.ok(brightness(sample(map, state, 0, 100)) > brightness(sample(map, state, 30, 100)));
  assert.ok(brightness(sample(map, state, 30, 100)) > brightness(sample(map, state, 90, 100)));
  assert.ok(sample(map, state, 0, 100).every(value => value >= 235));
  assert.ok(sample(map, state, 90, 100).every(value => value >= 150));
});

test('warm lamps and cold crystals tint the actual RGB lightmap differently', () => {
  const warmState = { ...base, lights: [lamp] }, coldState = { ...base, lights: [{ ...lamp, kind: 'crystal', color: [65, 155, 255] }] };
  const warm = sample(L.buildLightmap(warmState), warmState, 28, 100), cold = sample(L.buildLightmap(coldState), coldState, 28, 100);
  assert.ok(warm[0] > warm[2]); assert.ok(cold[2] > cold[0]); assert.ok(warm[0] > cold[0]); assert.ok(cold[2] > warm[2]);
});

test('the drill headlamp has a downward cone and close spill rather than a circular overlay', () => {
  assert.equal(L.directionalGain(0, 45, 100, Math.PI / 2), 1);
  assert.equal(L.directionalGain(0, -45, 100, Math.PI / 2), 0);
  assert.ok(L.directionalGain(0, -3, 100, Math.PI / 2) > 0);
  const state = { ...base, lights: [{ ...lamp, kind: 'headlamp', direction: Math.PI / 2 }] }, map = L.buildLightmap(state);
  assert.ok(brightness(sample(map, state, 0, 135)) > brightness(sample(map, state, 0, 65)) + 30);
});

test('solid rock limits transmission and a known open room allows local light through', () => {
  const clear = { ...base, lights: [lamp] }, rock = { ...clear, wallAt: () => 8 };
  const room = { ...rock, rooms: [{ left: -20, right: 70, top: 40, bottom: 160 }] };
  const clearValue = brightness(sample(L.buildLightmap(clear), clear, 40, 100));
  const rockValue = brightness(sample(L.buildLightmap(rock), rock, 40, 100));
  const roomValue = brightness(sample(L.buildLightmap(room), room, 40, 100));
  assert.ok(rockValue < clearValue - 15); assert.ok(roomValue > rockValue + 15); assert.ok(Math.abs(clearValue - roomValue) <= 8);
});

test('unexcavated ground absorbs light and deeper ambient never turns the scene black', () => {
  const open = { ...base, lights: [lamp] }, ground = { ...open, frontier: 102 };
  assert.ok(brightness(sample(L.buildLightmap(ground), ground, 0, 140)) < brightness(sample(L.buildLightmap(open), open, 0, 140)));
  const shallow = L.buildLightmap(base), deep = L.buildLightmap({ ...base, cameraY: 9000, biomeAt: () => 3 });
  assert.ok(brightness(sample(deep, { ...base, cameraY: 9000 }, 0, 9100)) < brightness(sample(shallow, base, 0, 100)));
  for (let i = 0; i < deep.data.length; i += 4) assert.ok(deep.data[i] >= 135 && deep.data[i + 1] >= 135 && deep.data[i + 2] >= 135);
});

test('the grid, rays, rooms, colors and lights have strict bounded costs', () => {
  const map = L.buildLightmap({ ...base, width: 16000, height: 10000, scale: 16,
    lights: Array.from({ length: 1000 }, () => ({ ...lamp, radius: 10000, strength: 200 })),
    rooms: Array.from({ length: 1000 }, () => ({ x: -100, y: 0, width: 200, height: 200 })) });
  assert.ok(map.width <= 160 && map.height <= 100); assert.ok(map.lightCount <= 32); assert.equal(map.roomCount, 64);
  assert.ok(map.raySamples <= map.width * map.height * 32 * 6); assert.ok(Number.isInteger(map.pixelSize));
  const levels = new Set(Array.from({ length: 32 }, (_, i) => Math.round(i * 255 / 31)));
  for (let i = 0; i < map.data.length; i++) assert.ok(i % 4 === 3 ? map.data[i] === 255 : levels.has(map.data[i]));
});

test('smaller budgets are available without exceeding the hard cap, and invalid records stay harmless', () => {
  const map = L.buildLightmap({ ...base, maxColumns: 64, maxRows: 40, lights: [null, {}, { ...lamp, x: NaN }, { ...lamp, radius: -1 }], rooms: [{ left: 4, right: 1, top: 0, bottom: 2 }], wallAt() { throw new Error('bad wall'); } });
  assert.ok(map.width <= 64 && map.height <= 40); assert.equal(map.lightCount, 0); assert.equal(map.roomCount, 0);
  assert.equal(L.buildLightmap({ width: Infinity, height: -3 }).data.length, 0);
});

test('reduced motion is time-independent and normal flicker is deterministic, not random', () => {
  const input = Object.freeze({ ...base, reduced: true, lights: Object.freeze([Object.freeze({ ...lamp, color: Object.freeze([...lamp.color]) })]) });
  const a = L.buildLightmap({ ...input, time: 0 }), b = L.buildLightmap({ ...input, time: 50000 }); assert.deepEqual(a.data, b.data);
  const animated = { ...input, reduced: false, time: 520 }; assert.deepEqual(L.buildLightmap(animated).data, L.buildLightmap(animated).data);
  assert.equal(input.lights[0].radius, 70); a.data.fill(0); assert.notDeepEqual(L.buildLightmap(input).data, a.data);
});

test('render uses nearest-neighbor multiply with integer sizing and restores caller state', () => {
  const f = renderFixture(), state = { ...base, lights: [lamp] };
  const stats = f.lighting.render(f.target, state), draw = f.drawn[0];
  assert.equal(draw.composite, 'multiply'); assert.equal(draw.alpha, 1); assert.equal(draw.smoothing, false); assert.ok(Number.isInteger(draw.width) && Number.isInteger(draw.height));
  assert.equal(f.target.globalCompositeOperation, 'source-over'); assert.equal(f.target.globalAlpha, .4); assert.equal(f.target.imageSmoothingEnabled, true); assert.equal(f.saved.length, 0);
  assert.equal(stats.rendered, true); assert.equal(stats.cells, stats.width * stats.height); assert.ok(Object.isFrozen(stats));
});

test('drawing failures restore the destination context even when the overlay cannot complete', () => {
  const f = renderFixture(); f.target.drawImage = () => { throw new Error('device lost'); };
  assert.throws(() => f.lighting.render(f.target, base), /device lost/);
  assert.equal(f.target.globalCompositeOperation, 'source-over'); assert.equal(f.target.globalAlpha, .4); assert.equal(f.target.imageSmoothingEnabled, true); assert.equal(f.saved.length, 0);
});

test('on/off, canvas reuse, resize and destroy do not leak extra canvases or draws', () => {
  const f = renderFixture(); assert.equal(f.lighting.render(f.target, { ...base, enabled: false }).skipped, 'disabled'); assert.equal(f.counts().created, 0);
  f.lighting.render(f.target, base); f.lighting.render(f.target, base); assert.deepEqual(f.counts(), { created: 1, uploads: 2, imageAllocations: 1 });
  f.lighting.render(f.target, { ...base, width: 800, height: 200 }); assert.equal(f.counts().created, 1); assert.equal(f.counts().imageAllocations, 2);
  f.lighting.destroy(); f.lighting.destroy(); assert.equal(f.canvas.width, 0); assert.equal(f.canvas.height, 0); assert.equal(f.lighting.render(f.target, base).skipped, 'destroyed'); assert.equal(f.drawn.length, 3);
});

test('disabled CPU maps are identity overlays and missing DOM gracefully skips the renderer', () => {
  const identity = L.buildLightmap({ ...base, enabled: false, lights: [lamp] }); assert.ok(identity.data.every(value => value === 255));
  const f = renderFixture(); assert.equal(L.create().render(f.target, base).skipped, 'canvas-unavailable');
  assert.equal(L.create().render(null, base).skipped, 'context-unavailable');
});

test('the same module exposes its public API as a browser UMD global', () => {
  const context = vm.createContext({}); vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/cavern-lighting.js'), 'utf8'), context);
  assert.equal(typeof context.CavernLighting.create, 'function'); assert.equal(typeof context.CavernLighting.buildLightmap, 'function'); assert.equal(context.CavernLighting.MAX_LIGHTS, 32);
});

test('colored emissive pools are bounded, warm/cold, and black outside the light radius', () => {
  for (const [color, dominant] of [[[255, 160, 65], 0], [[65, 180, 255], 2]]) {
    const state = { ...base, lights: [{ ...lamp, color }] }, map = L.buildLightmap(state), emission = { ...map, data: map.emissive };
    const local = sample(emission, state, 25, 100); assert.ok(local[dominant] > local[dominant === 0 ? 2 : 0]);
    assert.ok(map.hasEmission); assert.ok(map.emissionMax <= Math.floor(.22 * 255));
    assert.deepEqual(sample(emission, state, 90, 100), [0, 0, 0]);
    for (let i = 0; i < map.emissive.length; i++) assert.ok(i % 4 === 3 ? map.emissive[i] === 255 : map.emissive[i] <= 56);
  }
});

test('emissive spill shares rock occlusion, headlamp direction, and reduced-motion stability', () => {
  const open = { ...base, lights: [{ ...lamp, kind: 'headlamp' }] }, rock = { ...open, frontier: 102 };
  const sampleGlow = (state, x, y) => { const map = L.buildLightmap(state); return brightness(sample({ ...map, data: map.emissive }, state, x, y)); };
  assert.ok(sampleGlow(open, 0, 135) > sampleGlow(rock, 0, 135)); assert.equal(sampleGlow(open, 0, 65), 0);
  assert.deepEqual(L.buildLightmap({ ...open, time: 0 }).emissive, L.buildLightmap({ ...open, time: 123456 }).emissive);
});

test('the emissive screen pass reuses the canvas and restores the caller state on second-pass errors', () => {
  const f = renderFixture(); const stats = f.lighting.render(f.target, { ...base, lights: [lamp] });
  assert.equal(stats.passes, 2); assert.deepEqual(f.drawn.map(item => item.composite), ['multiply', 'screen']); assert.equal(f.counts().created, 1);
  assert.equal(f.target.globalCompositeOperation, 'source-over'); assert.equal(f.target.globalAlpha, .4); assert.equal(f.target.imageSmoothingEnabled, true);
  let draws = 0; f.target.drawImage = () => { if (++draws === 2) throw new Error('screen pass failed'); };
  assert.throws(() => f.lighting.render(f.target, { ...base, lights: [lamp] }), /screen pass failed/);
  assert.equal(f.target.globalCompositeOperation, 'source-over'); assert.equal(f.target.globalAlpha, .4); assert.equal(f.target.imageSmoothingEnabled, true); assert.equal(f.saved.length, 0);
});

test('pathological overlapping lights lower map resolution while normal lighting retains full detail', () => {
  const state = { ...base, width: 1440, height: 844, scale: 3 };
  const normal = L.buildLightmap({ ...state, lights: [lamp] });
  const intense = L.buildLightmap({ ...state, lights: Array.from({ length: 32 }, () => ({ ...lamp, radius: 512 })) });
  assert.ok(intense.pixelSize > normal.pixelSize); assert.ok(intense.width * intense.height * 32 <= 130000);
  assert.equal(normal.pixelSize, 9); assert.equal(intense.lightCount, 32); assert.ok(intense.emissionMax <= 56);
});
