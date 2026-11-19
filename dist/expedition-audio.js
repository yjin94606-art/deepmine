(function (root) {
  'use strict';
  // Short, original synthesized cues. Audio starts only after a user gesture.
  function create() {
    let context = null, enabled = false, destroyed = false, noise = null, generation = 0;
    const voices = new Set();
    function stopVoices() { for (const voice of voices) { try { voice.stop(); } catch (_) {} } voices.clear(); }
    async function setEnabled(value) {
      if (destroyed) return false;
      const request = ++generation;
      enabled = Boolean(value);
      if (!enabled) { stopVoices(); return false; }
      try {
        const Audio = root.AudioContext || root.webkitAudioContext;
        if (!Audio) { enabled = false; return false; }
        if (!context) context = new Audio();
        if (context.state !== 'running') await context.resume();
        if (destroyed || request !== generation) return enabled;
        enabled = context.state === 'running'; return enabled;
      } catch (_) { enabled = false; return false; }
    }
    function voice(source, gain, duration, when) {
      if (voices.size >= 16) return;
      source.connect(gain); gain.connect(context.destination); voices.add(source);
      source.onended = () => { voices.delete(source); source.disconnect(); gain.disconnect(); };
      source.start(when); source.stop(when + duration);
    }
    function tone(freq, delay, length, volume, endFreq) {
      const when = context.currentTime + delay, oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(freq, when);
      if (endFreq) oscillator.frequency.exponentialRampToValueAtTime(endFreq, when + length);
      gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(volume, when + .008); gain.gain.exponentialRampToValueAtTime(.0001, when + length);
      voice(oscillator, gain, length + .01, when);
    }
    function crumble() {
      if (!noise) {
        noise = context.createBuffer(1, Math.ceil(context.sampleRate * .18), context.sampleRate);
        const data = noise.getChannelData(0); let seed = 0x6d2b79f5;
        for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = (seed / 2147483648 - 1) * Math.pow(1 - i / data.length, 2); }
      }
      const source = context.createBufferSource(), gain = context.createGain(); source.buffer = noise;
      gain.gain.setValueAtTime(.035, context.currentTime); voice(source, gain, .18, context.currentTime);
    }
    function play(event) {
      if (!enabled || destroyed || !context || context.state !== 'running' || root.document?.visibilityState === 'hidden') return;
      if (event?.type === 'boost') { tone(125, 0, .17, .055, 46); crumble(); }
      else if (event?.type === 'mineral') { tone(660, 0, .08, .025); tone(990, .045, .13, .02); }
      else if (event?.type === 'artifact') { [523, 659, 784, 1047].forEach((note, i) => tone(note, i * .065, .19, .026)); }
    }
    return Object.freeze({ setEnabled, play, getState: () => ({ enabled, voices: voices.size }), destroy() { destroyed = true; generation++; enabled = false; stopVoices(); if (context) context.close().catch(() => {}); context = null; noise = null; } });
  }
  root.DeepmineAudio = Object.freeze({ create });
})(window);
