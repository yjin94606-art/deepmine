'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../dist/output-art.js'), 'utf8');

class Surface {
  constructor(width = 64, height = 64) {
    this.width = width; this.height = height; this.pixels = new Map(); this.states = [];
    const surface = this;
    this.ctx = {
      fillStyle: '#000000', imageSmoothingEnabled: true,
      save() { surface.states.push([this.fillStyle, this.imageSmoothingEnabled]); },
      restore() { [this.fillStyle, this.imageSmoothingEnabled] = surface.states.pop(); },
      fillRect(x, y, w, h) {
        for (const value of [x, y, w, h]) assert.ok(Number.isInteger(value), 'pixel primitives remain integer-aligned');
        for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) { assert.ok(col >= 0 && col < surface.width && row >= 0 && row < surface.height, 'sprite stays in the surface'); surface.pixels.set(col + ':' + row, this.fillStyle); }
      },
      drawImage(image, x, y) { for (const [key, color] of image.pixels) { const [sx, sy] = key.split(':').map(Number); surface.pixels.set((sx + x) + ':' + (sy + y), color); } }
    };
  }
  getContext() { return this.ctx; }
}
function load(cached) {
  const context = { module: { exports: {} }, ...(cached ? { OffscreenCanvas: Surface } : {}) };
  vm.runInNewContext(source, context); return context.module.exports;
}
function pixels(art, type, variant = 0) { const surface = new Surface(32, 32); art.draw(surface.ctx, 16, 31, type, variant); return surface; }

test('all ten direct output types retain 32px bounds and restored canvas state', () => {
  const art = load(false); assert.equal(art.types.length, 10); assert.ok(art.types.includes('memory'));
  const colors = new Set(Object.values(art.palette));
  for (const type of art.types) for (let variant = 0; variant < 3; variant++) {
    const surface = pixels(art, type, variant);
    assert.ok(surface.pixels.size > 200 && surface.pixels.size < 1000);
    assert.ok([...surface.pixels.values()].every(color => colors.has(color)));
    assert.equal(surface.ctx.fillStyle, '#000000'); assert.equal(surface.ctx.imageSmoothingEnabled, true); assert.equal(surface.states.length, 0);
  }
});

test('cached and primitive art remain pixel-identical for all thirty output variants', () => {
  const direct = load(false), cached = load(true);
  for (const type of direct.types) for (let variant = 0; variant < 3; variant++) {
    assert.deepEqual(pixels(cached, type, variant).pixels, pixels(direct, type, variant).pixels);
    assert.deepEqual(pixels(cached, type, variant).pixels, pixels(direct, type, variant).pixels);
  }
});

test('unknown types fall back to a file and each known output keeps its own silhouette', () => {
  const art = load(false), silhouettes = new Set();
  for (const type of art.types) silhouettes.add([...pixels(art, type).pixels.keys()].sort().join('|'));
  assert.equal(silhouettes.size, 10);
  for (const value of [undefined, null, 'unknown', '<script>', {}]) assert.deepEqual(pixels(art, value).pixels, pixels(art, 'file').pixels);
});
