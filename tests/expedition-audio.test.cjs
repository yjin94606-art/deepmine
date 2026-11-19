const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function fixture() {
  const state = { contexts: [], sources: [], resume: null };
  const parameter = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const source = () => { const node = { frequency: parameter(), connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; } }; state.sources.push(node); return node; };
  class AudioContext {
    constructor() { this.state = 'suspended'; this.sampleRate = 8000; this.currentTime = 1; this.destination = {}; state.contexts.push(this); }
    async resume() { if (state.resume) await state.resume; this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createOscillator() { return source(); }
    createBufferSource() { return source(); }
    createGain() { return { gain: parameter(), connect() {}, disconnect() {} }; }
    createBuffer(_channels, size) { return { getChannelData: () => new Float32Array(size) }; }
  }
  const window = { AudioContext, document: { visibilityState: 'visible' } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/expedition-audio.js'), 'utf8'), { window });
  return { state, window, audio: window.DeepmineAudio.create() };
}
test('sound remains silent and creates no AudioContext until explicitly enabled', async () => {
  const f = fixture(); f.audio.play({ type: 'boost' });
  assert.equal(f.state.contexts.length, 0); assert.equal(f.audio.getState().enabled, false);
  assert.equal(await f.audio.setEnabled(true), true); f.audio.play({ type: 'artifact' });
  assert.equal(f.state.sources.length, 4); assert.equal(f.audio.getState().voices, 4);
  await f.audio.setEnabled(false); assert.equal(f.audio.getState().voices, 0);
  f.audio.play({ type: 'boost' }); assert.equal(f.state.sources.length, 4); f.audio.destroy();
});
test('rapid mute during pending resume cannot turn audio back on', async () => {
  const f = fixture(); let resume;
  f.state.resume = new Promise(resolve => { resume = resolve; });
  const enabling = f.audio.setEnabled(true); await f.audio.setEnabled(false); resume(); await enabling;
  assert.equal(f.audio.getState().enabled, false); f.audio.play({ type: 'mineral' }); assert.equal(f.state.sources.length, 0); f.audio.destroy();
});
test('hidden pages suppress sounds, voices are bounded, and destroy closes audio', async () => {
  const f = fixture(); await f.audio.setEnabled(true);
  f.window.document.visibilityState = 'hidden'; f.audio.play({ type: 'artifact' }); assert.equal(f.audio.getState().voices, 0);
  f.window.document.visibilityState = 'visible'; for (let i = 0; i < 12; i++) f.audio.play({ type: 'artifact' });
  assert.equal(f.audio.getState().voices, 16);
  f.audio.destroy(); assert.equal(f.audio.getState().voices, 0); assert.equal(f.state.contexts[0].state, 'closed');
  assert.equal(await f.audio.setEnabled(true), false);
});
