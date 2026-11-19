(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.CavernLighting = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const MAX_COLUMNS = 160, MAX_ROWS = 100, MAX_LIGHTS = 32, MAX_ROOMS = 64;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const finite = (n, fallback = 0) => typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  const smooth = n => { const t = clamp(n, 0, 1); return t * t * (3 - 2 * t); };
  const quantize = n => Math.round(clamp(n, 0, 1) * 31) * 255 / 31;
  const AMBIENT = [[.73, .69, .62], [.59, .68, .73], [.65, .59, .75], [.60, .66, .72]];
  const MAX_EMISSION = .22;

  function attenuation(distance, radius) {
    if (!(radius > 0) || !Number.isFinite(distance) || distance < 0) return 0;
    return smooth(1 - distance / radius);
  }
  function directionalGain(dx, dy, radius, direction, cone = Math.PI * .72) {
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return 1;
    const dot = (dx * Math.cos(direction) + dy * Math.sin(direction)) / distance;
    const edge = Math.cos(cone / 2), inner = Math.cos(cone * .3);
    const beam = smooth((dot - edge) / Math.max(.01, inner - edge));
    // Close spill keeps the drill housing readable above the directed cone.
    return Math.max(beam, .7 * attenuation(distance, radius * .28));
  }
  function bounds(item) {
    if (!item || typeof item !== 'object') return null;
    const left = finite(item.left, finite(item.x, NaN)), top = finite(item.top, finite(item.y, NaN));
    const right = finite(item.right, left + finite(item.width, NaN)), bottom = finite(item.bottom, top + finite(item.height, NaN));
    return [left, top, right, bottom].every(Number.isFinite) && right > left && bottom > top ? { left, top, right, bottom } : null;
  }
  function buildLightmap(input = {}) {
    const cssWidth = clamp(Math.ceil(finite(input.width)), 0, 16384), cssHeight = clamp(Math.ceil(finite(input.height)), 0, 16384);
    const scale = clamp(finite(input.scale, 1), .25, 16), cameraY = finite(input.cameraY), frontier = finite(input.frontier, 70);
    const maxColumns = clamp(Math.floor(finite(input.maxColumns, MAX_COLUMNS)), 16, MAX_COLUMNS);
    const maxRows = clamp(Math.floor(finite(input.maxRows, MAX_ROWS)), 12, MAX_ROWS);
    // Keep pathological overlap within a CPU budget without lowering ordinary
    // drill/room light resolution. The limits are upper bounds, never targets.
    let coveredArea = 0;
    for (const light of (Array.isArray(input.lights) ? input.lights : []).slice(0, MAX_LIGHTS)) {
      if (!light || !Number.isFinite(light.x) || !Number.isFinite(light.y) || finite(light.radius) <= 0 || finite(light.strength, 1) <= 0) continue;
      const r = clamp(light.radius, 1, 512) * scale, x = cssWidth / 2 + light.x * scale, y = (light.y - cameraY) * scale;
      coveredArea += Math.max(0, Math.min(cssWidth, x + r) - Math.max(0, x - r)) * Math.max(0, Math.min(cssHeight, y + r) - Math.max(0, y - r));
    }
    const lightCellBudget = clamp(finite(input.maxLightCells, 120000), 4096, 512000);
    const pixelSize = Math.max(1, Math.ceil(cssWidth / maxColumns), Math.ceil(cssHeight / maxRows), Math.ceil(Math.sqrt(coveredArea / lightCellBudget)));
    const width = Math.ceil(cssWidth / pixelSize), height = Math.ceil(cssHeight / pixelSize), cells = width * height;
    const data = new Uint8ClampedArray(cells * 4);
    const emissive = new Uint8ClampedArray(cells * 4);
    const empty = { width, height, pixelSize, cssWidth, cssHeight, data, emissive, hasEmission: false, emissionMax: 0, lightCount: 0, roomCount: 0, raySamples: 0 };
    if (!cells) return empty;
    if (input.enabled === false) { data.fill(255); return empty; }
    const step = pixelSize / scale, worldLeft = -cssWidth / (2 * scale), worldRight = worldLeft + width * step;
    const worldBottom = cameraY + height * step, time = finite(input.time), reduced = input.reduced === true;
    const rooms = (Array.isArray(input.rooms) ? input.rooms : []).slice(0, MAX_ROOMS).map(bounds).filter(Boolean);
    const open = new Uint8Array(cells), ambient = new Float32Array(height * 3), rgb = new Float32Array(cells * 3), glow = new Float32Array(cells * 3);
    const xValues = new Float32Array(width), yValues = new Float32Array(height), walls = new Float32Array(height);
    for (let x = 0; x < width; x++) xValues[x] = worldLeft + (x + .5) * step;
    for (let y = 0; y < height; y++) {
      const wy = cameraY + (y + .5) * step; yValues[y] = wy;
      let biome = 0, wall = 40;
      try { if (typeof input.biomeAt === 'function') biome = clamp(Math.floor(finite(input.biomeAt(wy))), 0, 3); } catch (_) {}
      try { if (typeof input.wallAt === 'function') wall = clamp(finite(input.wallAt(wy), 40), 0, 1024); } catch (_) {}
      walls[y] = wall;
      const darkening = clamp((wy - 70) / 4200, 0, 1) * .06;
      for (let c = 0; c < 3; c++) ambient[y * 3 + c] = AMBIENT[biome][c] - darkening;
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        open[i] = wy <= frontier && Math.abs(xValues[x]) <= wall ? 1 : 0;
        for (let c = 0; c < 3; c++) rgb[i * 3 + c] = ambient[y * 3 + c];
      }
    }
    for (const room of rooms) {
      const left = clamp(Math.ceil((room.left - worldLeft) / step - .5), 0, width), right = clamp(Math.floor((room.right - worldLeft) / step - .5), -1, width - 1);
      const top = clamp(Math.ceil((room.top - cameraY) / step - .5), 0, height), bottom = clamp(Math.floor((room.bottom - cameraY) / step - .5), -1, height - 1);
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) open[y * width + x] = 1;
    }
    const lights = (Array.isArray(input.lights) ? input.lights : []).slice(0, MAX_LIGHTS).filter(light => light && Number.isFinite(light.x) && Number.isFinite(light.y) && finite(light.radius) > 0).map(light => {
      const radius = clamp(light.radius, 1, 512), strength = clamp(finite(light.strength, 1), 0, 2);
      const color = Array.isArray(light.color) ? [0, 1, 2].map(c => clamp(finite(light.color[c], 255), 0, 255) / 255) : [1, .88, .65];
      return { x: light.x, y: light.y, radius, strength, color, glowColor: color.map(channel => Math.pow(channel, 1.35)), kind: light.kind,
        direction: finite(light.direction, Math.PI / 2), cone: clamp(finite(light.cone, Math.PI * .72), .15, Math.PI * 1.8) };
    }).filter(light => light.strength > 0 && light.x + light.radius >= worldLeft && light.x - light.radius <= worldRight && light.y + light.radius >= cameraY && light.y - light.radius <= worldBottom);
    let raySamples = 0;
    for (const light of lights) {
      const left = clamp(Math.floor((light.x - light.radius - worldLeft) / step), 0, width - 1), right = clamp(Math.ceil((light.x + light.radius - worldLeft) / step), 0, width - 1);
      const top = clamp(Math.floor((light.y - light.radius - cameraY) / step), 0, height - 1), bottom = clamp(Math.ceil((light.y + light.radius - cameraY) / step), 0, height - 1);
      // Lighting has a fixed rhythm, never randomness or wall-clock state.
      const flicker = reduced || !['lamp', 'headlamp'].includes(light.kind) ? 1 : .985 + .015 * Math.sin(time * .004 + light.x * .17 + light.y * .11);
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        const dx = xValues[x] - light.x, dy = yValues[y] - light.y, distance = Math.hypot(dx, dy);
        if (distance >= light.radius) continue;
        let gain = attenuation(distance, light.radius) * light.strength * flicker;
        if (light.kind === 'headlamp') gain *= directionalGain(dx, dy, light.radius, light.direction, light.cone);
        if (gain < .005) continue;
        // Six bounded ray taps make rock absorb light; open chambers transmit it.
        let rock = 0;
        const taps = clamp(Math.ceil(distance / (step * 2)), 1, 6);
        for (let tap = 1; tap <= taps; tap++) {
          const t = tap / taps, wx = light.x + dx * t, wy = light.y + dy * t;
          const gx = Math.floor((wx - worldLeft) / step), gy = Math.floor((wy - cameraY) / step);
          const clear = gx >= 0 && gx < width && gy >= 0 && gy < height ? open[gy * width + gx] : rooms.some(room => wx >= room.left && wx <= room.right && wy >= room.top && wy <= room.bottom) || (wy <= frontier && Math.abs(wx) <= walls[clamp(gy, 0, height - 1)]);
          if (!clear) rock++; raySamples++;
        }
        const penetration = Math.exp(-rock / taps * distance / 27);
        gain *= penetration;
        const core = .8 * attenuation(distance, light.radius * .23), i = (y * width + x) * 3;
        for (let c = 0; c < 3; c++) {
          const tint = .18 + .82 * light.color[c], channel = tint + (1 - tint) * core;
          rgb[i + c] += gain * channel * (1 - ambient[y * 3 + c]);
          // Colored reflected light uses the SAME ray transmission and cone as
          // the multiplication pass. Black is neutral under screen blending.
          glow[i + c] += gain * .26 * light.glowColor[c];
        }
      }
    }
    const daylight=bounds(input.daylight);
    if (daylight) {
      // A distant scene carries its own exposure. Fade the cave light treatment
      // at the mouth so warm lamps still cast light on the near rock shoulders.
      for (let y=0; y<height; y++) {
        const dy=Math.min(yValues[y]-daylight.top,daylight.bottom-yValues[y]);
        if (dy<=0) continue;
        for (let x=0; x<width; x++) {
          const edge=Math.min(dy,xValues[x]-daylight.left,daylight.right-xValues[x]);
          if (edge<=0) continue;
          const mix=smooth(edge/8), i=(y*width+x)*3;
          for (let c=0; c<3; c++) { rgb[i+c]+=(1-rgb[i+c])*mix; glow[i+c]*=1-mix; }
        }
      }
    }
    let emissionMax = 0;
    for (let i = 0; i < cells; i++) {
      for (let c = 0; c < 3; c++) {
        data[i * 4 + c] = quantize(rgb[i * 3 + c]);
        const value = Math.min(Math.floor(MAX_EMISSION * 255), Math.round(clamp(glow[i * 3 + c], 0, MAX_EMISSION) * 255 / 4) * 4);
        emissive[i * 4 + c] = value; emissionMax = Math.max(emissionMax, value);
      }
      data[i * 4 + 3] = 255; emissive[i * 4 + 3] = 255;
    }
    return { ...empty, data, emissive, hasEmission: emissionMax > 0, emissionMax, lightCount: lights.length, roomCount: rooms.length, raySamples };
  }

  function create(options = {}) {
    let canvas = null, context = null, pixels = null, destroyed = false, frames = 0;
    let stats = Object.freeze({ rendered: false, skipped: 'not-rendered', width: 0, height: 0, cells: 0, lightCount: 0, frames: 0 });
    function skipped(reason) { stats = Object.freeze({ ...stats, rendered: false, skipped: reason }); return stats; }
    function prepare(width, height) {
      if (!canvas) {
        try {
          if (typeof options.canvasFactory === 'function') canvas = options.canvasFactory(width, height);
          else if (typeof root.OffscreenCanvas === 'function') canvas = new root.OffscreenCanvas(width, height);
          else if (root.document && typeof root.document.createElement === 'function') canvas = root.document.createElement('canvas');
          if (!canvas || typeof canvas.getContext !== 'function') return false;
          context = canvas.getContext('2d');
        } catch (_) { canvas = null; return false; }
      }
      if (!context || typeof context.createImageData !== 'function' || typeof context.putImageData !== 'function') return false;
      if (!pixels || canvas.width !== width || canvas.height !== height) {
        canvas.width = width; canvas.height = height; pixels = context.createImageData(width, height);
      }
      return Boolean(pixels && pixels.data && typeof pixels.data.set === 'function');
    }
    return Object.freeze({
      render(ctx, input = {}) {
        if (destroyed) return skipped('destroyed');
        if (input.enabled === false) return skipped('disabled');
        if (!ctx || ['save', 'restore', 'drawImage'].some(name => typeof ctx[name] !== 'function')) return skipped('context-unavailable');
        if (!canvas && typeof options.canvasFactory !== 'function' && typeof root.OffscreenCanvas !== 'function' && !(root.document && typeof root.document.createElement === 'function')) return skipped('canvas-unavailable');
        const map = buildLightmap(input);
        if (!map.width || !map.height) return skipped('empty-viewport');
        if (!prepare(map.width, map.height)) return skipped('canvas-unavailable');
        pixels.data.set(map.data); context.putImageData(pixels, 0, 0);
        ctx.save();
        try {
          ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = false;
          ctx.drawImage(canvas, 0, 0, map.width * map.pixelSize, map.height * map.pixelSize);
          if (map.hasEmission) {
            pixels.data.set(map.emissive); context.putImageData(pixels, 0, 0);
            ctx.globalCompositeOperation = 'screen';
            ctx.drawImage(canvas, 0, 0, map.width * map.pixelSize, map.height * map.pixelSize);
          }
        } finally { ctx.restore(); }
        frames++;
        stats = Object.freeze({ rendered: true, skipped: null, width: map.width, height: map.height, cells: map.width * map.height, pixelSize: map.pixelSize, lightCount: map.lightCount, roomCount: map.roomCount, raySamples: map.raySamples, emissionMax: map.emissionMax, passes: map.hasEmission ? 2 : 1, frames });
        return stats;
      },
      getStats() { return stats; },
      destroy() { destroyed = true; if (canvas) { canvas.width = 0; canvas.height = 0; } canvas = null; context = null; pixels = null; }
    });
  }
  return Object.freeze({ create, buildLightmap, attenuation, directionalGain, MAX_COLUMNS, MAX_ROWS, MAX_LIGHTS, MAX_ROOMS, MAX_EMISSION });
});
