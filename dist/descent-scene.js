(function () {
  'use strict';

  const INSTANCES = new WeakMap();
  const SURFACE = 70, PIXELS_PER_METER = 7, MAX_DEPTH = 10000000;
  const NORMAL_SPEED = 2.5, CHRONICLE_SPEED = 1.7, FAST_SPEED = 5, REPLAY_SPEED = 5, FRAME_MS = 1000 / 30;
  const PACE_MULTIPLIERS = Object.freeze({ normal: 1, brisk: 1.5, fast: 3 });
  const BOOST_DURATION = 1.2, BOOST_COOLDOWN = 3, BOOST_MULTIPLIER = 2.6, MAX_PARTICLES = 90;
  // Visual strata only: these thresholds never alter observed depth or rewards.
  const STRATA = Object.freeze([18, 44, 90]);
  const BIOMES = Object.freeze(['roots', 'aquifer', 'crystal', 'ruins']);
  const POCKET_CONTOUR = [[0,.23],[.035,.23],[.035,.10],[.10,.10],[.10,.045],[.21,.045],[.21,.02],[.45,.02],[.45,0],[.77,0],[.77,.025],[.88,.025],[.88,.06],[.95,.06],[.95,.14],[.98,.14],[.98,.28],[1,.28],[1,.75],[.975,.75],[.975,.89],[.94,.89],[.94,.955],[.85,.955],[.85,.985],[.58,.985],[.58,1],[.18,1],[.18,.975],[.09,.975],[.09,.93],[.035,.93],[.035,.83],[0,.83]];
  const MAX_NODES = 4096, MAX_DRAWN_NODES = 16;
  const OUTPUT_TYPES = Object.freeze(['web', 'document', 'image', 'audio', 'video', 'slides', 'table', 'code', 'file', 'memory']);
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const depthOf = value => clamp(finite(value), 0, MAX_DEPTH);
  const tipAt = depth => SURFACE + depth * PIXELS_PER_METER;
  const rigAt = depth => tipAt(depth) - 23;
  const kindOf = value => value === 'writing' ? 'document' : value === 'design' ? 'asset' : ['code', 'document', 'asset'].includes(value) ? value : 'other';
  const EPSILON = 0.000001;
  function restore(element, name, value) { if (value === null) element.removeAttribute(name); else element.setAttribute(name, value); }
  function biomeAt(y) { const depth = (y - SURFACE) / PIXELS_PER_METER; const index = STRATA.findIndex(boundary => depth < boundary); return index < 0 ? 3 : index; }
  function baseWallAt(y) { return 44 + Math.round(Math.sin(y / 123) * 6 + Math.sin(y / 67) * 3 + Math.max(0, Math.sin(y / 207)) * 10); }
  function signature(item) { return `${item.id}|${item.recipeId}|${item.kindMask}|${item.kind}|${item.visualType}`; }
  function hash(value) { let n = 0; for (const char of String(value)) n = (Math.imul(n, 31) + char.charCodeAt(0)) >>> 0; return n; }
  function rockSeed(x, y, salt = 0) {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ salt;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (n ^ (n >>> 16)) >>> 0;
  }
  function lowerBound(list, depth) { let lo = 0, hi = list.length; while (lo < hi) { const middle = (lo + hi) >>> 1; if (list[middle].depth < depth) lo = middle + 1; else hi = middle; } return lo; }

  function create(canvas, options) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('ExpeditionScene requires a canvas.');
    if (INSTANCES.has(canvas)) INSTANCES.get(canvas).destroy();
    const art = window.DrillArt;
    if (!art || ['drawRig', 'drawTile', 'drawCrystal', 'drawSupport', 'drawLamp'].some(name => typeof art[name] !== 'function')) throw new Error('请先加载 drill-art.js。');
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    const opts = options || {}, palette = art.palette;
    const getWorkSprite = typeof opts.getWorkSprite === 'function' ? opts.getWorkSprite : null;
    const expedition = window.ExpeditionArt || null;
    const outputArt = window.OutputArt || null;
    const geology = window.CavernGeology || null;
    const lighting = window.CavernLighting?.create() || null;
    const life = window.ExpeditionLife || null;
    let lightingEnabled = true;
    const original = { rendering: canvas.style.imageRendering, touch: canvas.style.touchAction, cursor: canvas.style.cursor, tabindex: canvas.getAttribute('tabindex'), label: canvas.getAttribute('aria-label'), role: canvas.getAttribute('role') };
    canvas.style.imageRendering = 'pixelated'; canvas.style.touchAction = 'none'; canvas.style.cursor = 'grab';
    canvas.setAttribute('tabindex', original.tabindex || '0'); canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '向下钻进的矿井。点击钻机或空格短时冲击，拖动或滚轮回看矿道，End 返回钻机。Tab 选择当前视野的真实矿样，Enter 查看来源。');
    const accessible = document.createElement('div');
    accessible.setAttribute('role', 'group'); accessible.setAttribute('aria-label', '当前视野的矿样');
    accessible.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap;border:0;';
    if (canvas.parentNode) canvas.parentNode.insertBefore(accessible, canvas.nextSibling);

    let width = 1, height = 1, ratio = 1, scale = 3, hasSize = false;
    let preferredZoom = 1, directMode = false, locale = 'zh-CN', hoverPayloadKey = '', hoverPoint = null, layoutVersion = 0, directCache = null;
    let initialized = false, destroyed = false, paused = false, intersecting = true;
    let scopeKey = '', observedTarget = 0, depth = 0, cameraY = 0, cameraMode = 'follow', active = false;
    let pace = 'normal', revealSequence = 0, pendingReducedReveal = false, discoveryHold = false, localRun = false;
    let deferredFront = null;
    let notifyingFind = false;
    let nodes = [], layers = [], artifacts = [], chambers = [], hits = [], controlsKey = '', hovered = null, selected = null, pointer = null;
    let effects = [], pendingReassemblies = [], seen = new Set(), replaySeen = new Set();
    let particles = [], particleClock = 0, particleSeed = 0, boostRemaining = 0, boostCooldown = 0;
    let drawShake = { x: 0, y: 0 };
    let tracks = [], focusedRoom = null, scanRemaining = 0, scanCooldown = 0, scanResults = [], scanOrigin = null, scanTelemetryAt = -Infinity;
    let occluders = [];
    let frame = 0, lastTick = null, lastProgress = -Infinity, animationTime = 0, playback = null;
    const motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let reduced = Boolean(motion && motion.matches);
    const tileCache = new Map();
    const rockCache = new Map();
    const spriteCache = new Map();
    const backs = [palette.earthShadow, palette.tealShadow, palette.shaleShadow, palette.bedrockShadow];
    const shade = palette.ink;
    function labels() { return locale === 'en' ? { canvas: 'Mine history. Scroll or drag to explore. End returns to the drill. Select an output to inspect its source.', group: 'Visible outputs', source: 'Press Enter to inspect source.' } : locale === 'ja' ? { canvas: '採掘の履歴。スクロールやドラッグで移動。Endでドリルへ戻ります。成果物を選んで出典を確認できます。', group: '表示中の成果物', source: 'Enterで出典を確認。' } : { canvas: '矿坑历史。滚动或拖动自由浏览，End 返回钻机。选择成果查看来源。', group: '当前视野的成果', source: '按回车查看来源。' }; }
    function updateLabels() { const text = labels(); canvas.setAttribute('aria-label', text.canvas); accessible.setAttribute('aria-label', text.group); controlsKey = null; }
    function invalidateLayout() { layoutVersion++; directCache = null; }
    function indexedRange(list, low, high, field) {
      let a = 0, b = list.length;
      while (a < b) { const mid = (a + b) >>> 1; if (list[mid][field] < low) a = mid + 1; else b = mid; }
      const result = []; for (let i = a; i < list.length && list[i][field] <= high; i++) result.push(list[i]); return result;
    }
    let dragPreview=null;
    function directLayout() {
      if (directCache && directCache.version === layoutVersion) return directCache;
      const grid = new Map(), placed = [], byId = new Map(), slots = new Map();
      const keys = box => { const result = []; for (let row = Math.floor(box.top / 48); row <= Math.floor(box.bottom / 48); row++) result.push(row); return result; };
      for (const item of artifacts) {
        const position=dragPreview?.id===item.id?dragPreview:opts.gallery?.position(item.id);
        const slot = slots.get(item.date) || 0; slots.set(item.date, slot + 1);
        const side = position?.side || ((slot + hash(item.date)) % 2 ? 1 : -1);
        const halfView = width / (2 * scale);
        const landscape = item.visualType === 'image' || item.visualType === 'video';
        // Reserve this pocket before its pixels arrive. Scrolling, a slow
        // decode or switching versions must never move neighbouring finds.
        const inner = Math.min(width < 700 ? 30 : 55, halfView * .53);
        const artWidth = getWorkSprite ? Math.max(4, Math.min(landscape ? 108 : 48, Math.floor(halfView - inner - 14))) : 0;
        const artHeight = getWorkSprite ? (landscape ? 68 : 39) : 0;
        const halfPocket = Math.max(17, Math.ceil(artWidth / 2) + 5);
        const ideal = width < 700 ? 62 : (slot % 4 < 2 ? 96 : 142);
        const reach = Math.min(halfView - halfPocket - 3, Math.max(ideal, getWorkSprite ? inner + halfPocket : 0));
        let chosen = null;
        for (let offset = 0; offset <= 800 && !chosen; offset += 2) {
          const y = (position?Math.max(SURFACE+2,Math.min(tipAt(depth)-2,item.y+position.row*24)):item.y) - offset;
          for (const sign of position?[side]:[side, -side]) {
            const x = Math.round(sign * reach);
            const box = {left:getWorkSprite ? sign : x-17, right:getWorkSprite ? sign+.5 : x+17, top:y-32, bottom:y+1};
            if (keys(box).some(key => (grid.get(key) || []).some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top))) continue;
            chosen = { ...item, x, y, artWidth, artHeight }; for (const key of keys(box)) { if (!grid.has(key)) grid.set(key, []); grid.get(key).push(box); } break;
          }
        }
        // A pathological pile of records remains a source target; no earned
        // depth is invented to create display space for it.
        if (!chosen) chosen = { ...item, x: Math.round(side * reach), artWidth, artHeight };
        placed.push(chosen); byId.set(chosen.id, chosen);
      }
      placed.sort((a,b)=>a.y-b.y || a.id.localeCompare(b.id));
      if (getWorkSprite) {
        const floorBySide=new Map();
        for (const item of placed) {
          const side=Math.sign(item.x), last=floorBySide.get(side);
          if (last!==undefined) item.artHeight=Math.min(item.artHeight,Math.max(6,item.y-last-8));
          floorBySide.set(side,item.y);
        }
      }
      directCache = { version: layoutVersion, placed, byId }; return directCache;
    }
    function sourcePayload(item) {
      const bounds = canvas.getBoundingClientRect(), sx = bounds.width / width || 1, sy = bounds.height / height || 1;
      const w = item.hitWidth || 32 * scale, h = item.hitHeight || 32 * scale;
      const rect = Object.freeze({ left: bounds.left + (item.screenX - w / 2) * sx, top: bounds.top + (item.screenY - h / 2) * sy, right: bounds.left + (item.screenX + w / 2) * sx, bottom: bounds.top + (item.screenY + h / 2) * sy, width: w * sx, height: h * sy });
      const value = Object.freeze({ id: item.id, name: item.name, description: item.description, date: item.date, depth: item.depth, kind: item.kind, visualType: item.visualType, source: item.source, sourceLabel: item.sourceLabel, method: item.method, path: item.path, paths: item.paths, memoryIds: item.memoryIds, evidenceIds: item.evidenceIds, outputIds: item.outputIds, sourceIds: item.sourceIds });
      return Object.freeze({ item: value, rect, screenX: (rect.left + rect.right) / 2, screenY: (rect.top + rect.bottom) / 2 });
    }
    function publishHover() {
      if (hoverPoint && drawable() && !pointer) { const found = nodeAt(hoverPoint); hovered = found?.key || null; }
      const item = drawable() ? hits.find(value => value.key === hovered && value.kind === 'work-finding') : null;
      const payload = item ? sourcePayload(item) : null, key = payload ? JSON.stringify(payload) : '';
      if (key === hoverPayloadKey) return; hoverPayloadKey = key;
      if (typeof opts.onHover === 'function') opts.onHover(payload);
    }
    function wallAt(y) { return width < 700 ? clamp(Math.round(baseWallAt(y) * .52), 23, 30) : baseWallAt(y); }
    function refreshOcclusion() {
      occluders = [];
      const origin = canvas.getBoundingClientRect();
      const selectors = '.depth-hud, .shift-report, .daily-artifact, .expedition-dock, .discovery-rail, .map-tools, .atlas-button, .drill-controls, .biome-banner, .topbar, .view-caption, .history-rail, .mine-actions, .view-tools, .status-line, .demo-notice';
      const elements = new Set();
      for (const surface of [canvas.parentNode, document]) if (typeof surface?.querySelectorAll === 'function') for (const element of surface.querySelectorAll(selectors)) elements.add(element);
      for (const element of elements) {
        if (element.hidden) continue;
        const bounds = element.getBoundingClientRect();
        if (bounds.width > 0 && bounds.height > 0) occluders.push({ left: bounds.left - origin.left, right: bounds.right - origin.left, top: bounds.top - origin.top, bottom: bounds.bottom - origin.top });
      }
    }
    function unobstructedArea(box) {
      let pieces = [box];
      for (const cover of occluders) {
        const next = [];
        for (const p of pieces) {
          const left = Math.max(p.left, cover.left), right = Math.min(p.right, cover.right), top = Math.max(p.top, cover.top), bottom = Math.min(p.bottom, cover.bottom);
          if (left >= right || top >= bottom) { next.push(p); continue; }
          next.push({ ...p, bottom: top }, { ...p, top: bottom }, { left: p.left, right: left, top, bottom }, { left: right, right: p.right, top, bottom });
        }
        pieces = next.filter(p => p.right - p.left >= 24 && p.bottom - p.top >= 24);
      }
      return pieces.filter(p => p.right - p.left >= 24 && p.bottom - p.top >= 24).sort((a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top))[0];
    }

    function drawable() { return !destroyed && hasSize && intersecting && document.visibilityState !== 'hidden'; }
    function frozen() { return paused || document.visibilityState === 'hidden' || !intersecting || !hasSize; }
    function travelTarget() { return playback ? playback.to : observedTarget; }
    function hasTravel() { return !discoveryHold && (Boolean(playback && playback.pendingStart) || ((Boolean(playback) || active) && depth + EPSILON < travelTarget())); }
    function working() { return !destroyed && !reduced && !frozen() && hasTravel(); }
    function travelSpeed() {
      if (playback) return REPLAY_SPEED;
      if (directMode) return CHRONICLE_SPEED * PACE_MULTIPLIERS[pace];
      return pace === 'fast' ? FAST_SPEED : NORMAL_SPEED * PACE_MULTIPLIERS[pace];
    }
    function boostReady() { return !destroyed && !reduced && !discoveryHold && !frozen() && (playback ? !playback.pendingStart : active) && cameraMode === 'follow' && depth + EPSILON < travelTarget() && boostCooldown <= EPSILON; }
    function impact(type, intensity) { if (!reduced && typeof opts.onImpact === 'function') opts.onImpact(Object.freeze({ type, intensity })); }
    function boost() {
      if (!boostReady()) return false;
      boostRemaining = BOOST_DURATION; boostCooldown = BOOST_COOLDOWN;
      for (let i = 0; i < 18; i++) debris(tipAt(depth), true);
      impact('boost', 1); draw(); emit(true); start(); return true;
    }
    function reachedTracks() { return tracks.filter(item => item.depth <= Math.min(depth, observedTarget) + EPSILON); }
    function scanRadius() { return reachedTracks().some(item => item.id === 'relay') ? 190 : 130; }
    function scanReady() { return !destroyed && !frozen() && scanCooldown <= EPSILON && (active || revealedIds().length > 0 || revealedArtifactIds().length > 0 || revealedRoomIds().length > 0 || reachedTracks().length > 0); }
    function scanSources() {
      const reach = Math.min(depth, observedTarget);
      return [...nodes.filter(item => item.depth <= reach + EPSILON).map(item => ({ ...item, type: 'mineral', title: item.title })),
        ...artifactLayout().map(item => ({ ...item, type: 'artifact', title: item.name })),
        ...chambers.filter(item => item.depth <= reach + EPSILON).map(item => ({ ...item, type: 'room', title: item.name }))];
    }
    function pruneScan() {
      const current = new Map(scanSources().map(item => [item.type + ':' + item.id, item]));
      const hadResults = scanResults.length > 0;
      if (scanOrigin) scanOrigin.radius = Math.min(scanOrigin.radius, scanRadius());
      scanResults = scanResults.filter(item => current.has(item.type + ':' + item.id) && (!scanOrigin || scanDistance(current.get(item.type + ':' + item.id)) <= scanOrigin.radius)).map(item => {
        const fresh = current.get(item.type + ':' + item.id); return Object.freeze({ id: fresh.id, type: fresh.type, title: fresh.title, depth: fresh.depth });
      });
      if (hadResults && !scanResults.length) { scanRemaining = 0; scanOrigin = null; }
    }
    function scanDistance(item) {
      if (item.type === 'room') {
        const x = item.sign * 130;
        return Math.hypot(Math.max(0, Math.abs(x - scanOrigin.x) - 56), Math.max(item.y - 72 - scanOrigin.y, 0, scanOrigin.y - item.y));
      }
      return Math.hypot(item.x - scanOrigin.x, item.y - scanOrigin.y);
    }
    function clearScan(cooldown = true) { scanRemaining = 0; scanResults = []; scanOrigin = null; if (cooldown) scanCooldown = 0; }
    function scan() {
      if (!scanReady()) return null;
      scanOrigin = { x: 0, y: cameraMode === 'inspect' ? cameraY + height / (2 * scale) : rigAt(depth), radius: scanRadius() };
      const seenResults = new Set();
      scanResults = scanSources().filter(item => {
        const key = item.type + ':' + item.id; if (seenResults.has(key)) return false;
        if (scanDistance(item) > scanOrigin.radius) return false;
        seenResults.add(key); return true;
      }).map(item => Object.freeze({ id: item.id, type: item.type, title: item.title, depth: item.depth }));
      scanRemaining = 2; scanCooldown = 8; scanTelemetryAt = performance.now();
      const result = Object.freeze([...scanResults]);
      if (typeof opts.onScan === 'function') opts.onScan(result);
      draw(); emit(true); start(); return result;
    }
    function focusRoom(id) {
      if (destroyed) return false;
      const item = chambers.find(room => room.id === id && room.depth <= Math.min(depth, observedTarget) + EPSILON);
      if (!item) return false;
      resolveReplay(); stop(); focusedRoom = item.id; cameraMode = 'inspect'; hovered = null; selected = null;
      const roomHeight = width < 1120 ? 56 : 72;
      cameraY = item.y - roomHeight / 2 - height / (2 * scale); clampCamera();
      draw(); emit(true); start(); return true;
    }
    function focusTrack(id) {
      if (destroyed) return false;
      const item = reachedTracks().find(track => track.id === id); if (!item) return false;
      resolveReplay(); stop(); focusedRoom = null; cameraMode = 'inspect'; hovered = null; selected = null;
      const placed = stationLayout(-Infinity, Infinity).find(track => track.id === id);
      cameraY = (placed ? placed.y - placed.h / 2 : tipAt(item.depth) - 25) - height / (2 * scale); clampCamera();
      draw(); emit(true); start(); return true;
    }
    function focusArtifact(id) {
      if (destroyed || discoveryHold) return false;
      const item = directMode ? directLayout().byId.get(id) : artifactLayout().find(value => value.id === id);
      if (!item || item.depth > Math.min(depth, observedTarget) + EPSILON) return false;
      resolveReplay(); stop(); focusedRoom = null; cameraMode = 'inspect'; hovered = null; selected = null;
      cameraY = item.y - 16 - height / (2 * scale); clampCamera();
      draw(); emit(true); start(); return true;
    }
    function anchor() {
      const top = width < 600 ? 150 : 124, bottom = width < 600 ? 205 : 132;
      return clamp(top + Math.max(100, height - top - bottom) * .43, height * .28, height * .64) / scale;
    }
    function wantedCamera(value = depth) { return rigAt(value) - anchor(); }
    function cameraLimits() { return { min: wantedCamera(0), max: wantedCamera(depth) }; }
    function clampCamera() { const limits = cameraLimits(); cameraY = clamp(cameraY, limits.min, limits.max); }
    function revealedIds() { return nodes.filter(node => node.depth <= depth + EPSILON).map(node => node.id); }
    function revealedArtifactIds() { return artifacts.filter(item => item.depth <= depth + EPSILON).map(item => item.id); }
    function revealedRoomIds() { return chambers.filter(item => item.depth <= Math.min(depth, observedTarget) + EPSILON).map(item => item.id); }
    function visibleRooms() { return (drawable() ? hits : []).filter(item => item.type === 'room' && chambers.some(room => room.id === item.id) && item.depth <= Math.min(depth, observedTarget) + EPSILON).map(item => Object.freeze({ id: item.id, name: item.name, theme: item.theme, depth: item.depth, side: item.side, screenX: item.screenX, screenY: item.screenY, width: item.hitWidth, height: item.hitHeight })); }
    function visibleFindings() { return (drawable() ? hits : []).filter(item => item.kind === 'work-finding').map(item => Object.freeze({ id: item.id, name: item.name, kind: item.kind, visualType: item.visualType, depth: item.depth, screenX: item.screenX, screenY: item.screenY, width: item.hitWidth || 32 * scale, height: item.hitHeight || 32 * scale })); }
    function layerDate() { return layers.find(layer => depth >= layer.depthStart && depth < layer.depthEnd)?.date || layers.filter(layer => layer.depthStart <= depth + EPSILON).at(-1)?.date || null; }
    function viewDate() {
      const viewDepth = clamp((cameraY + height / (2 * scale) - SURFACE) / PIXELS_PER_METER, 0, Math.min(depth, observedTarget));
      let low = 0, high = layers.length;
      while (low < high) { const middle = (low + high) >>> 1; if (layers[middle].depthStart <= viewDepth + EPSILON) low = middle + 1; else high = middle; }
      return layers[Math.max(0, low - 1)]?.date || null;
    }
    function visibleDates() {
      const top = (cameraY - SURFACE) / PIXELS_PER_METER, bottom = (cameraY + height / scale - SURFACE) / PIXELS_PER_METER;
      const found = indexedRange(layers, Math.max(0, top - 64), Math.min(depth, bottom), 'depthStart').filter(item => item.depthEnd >= top);
      return Object.freeze({ first: found[0]?.date || null, last: found.at(-1)?.date || null });
    }
    function baseScale() { return width < 700 ? 2 : 3; }
    function pixelScale(value) { return Math.round(baseScale() * clamp(value, .6, 1.6)); }
    function snapshot() {
      return Object.freeze({ depth, targetDepth: observedTarget, observedTarget, cameraY, zoom: scale / baseScale(), canZoomOut: scale > pixelScale(.6), canZoomIn: scale < pixelScale(1.6), directMode, discoveryHold, active, pace, speed: travelSpeed(), viewDate: viewDate(), visibleLayerDate: viewDate(), visibleDateRange: visibleDates(), working: working(), mode: playback ? 'replay' : cameraMode, status: (frozen() || discoveryHold) ? 'paused' : working() ? 'working' : 'idle', scopeKey, revealedIds: Object.freeze(revealedIds()), revealedArtifactIds: Object.freeze(revealedArtifactIds()), revealedRoomIds: Object.freeze(revealedRoomIds()), visibleRooms: Object.freeze(visibleRooms()), visibleFindings: Object.freeze(visibleFindings()), currentLayerDate: layerDate(), biomeId: BIOMES[biomeAt(tipAt(depth))], replayTargetDepth: playback ? playback.to : null, scale, feedbackCount: effects.length, particleCount: particles.length, boostReady: boostReady(), boostRemaining, boostCooldown, scanReady: scanReady(), scanRemaining, scanCooldown, scanCount: scanResults.length, scanRadius: scanRadius(), revealedTrackIds: Object.freeze(reachedTracks().map(item => item.id)) });
    }
    function emit(force) {
      if (destroyed || typeof opts.onProgress !== 'function') return;
      const now = performance.now();
      if (!force && now - lastProgress < 125) return;
      lastProgress = now; opts.onProgress(snapshot());
    }
    function stop() { if (frame) cancelAnimationFrame(frame); frame = 0; lastTick = null; }
    function needsFrames() { return drawable() && !paused && (scanRemaining > 0 || scanCooldown > 0 || (!reduced && (hasTravel() || particles.length || boostCooldown > 0 || effects.length || pendingReassemblies.some(item => item.depth <= depth + EPSILON) || (cameraMode === 'follow' && wantedCamera() - cameraY > .05)))); }
    function start() { if (needsFrames() && !frame) frame = requestAnimationFrame(tick); }
    function resolveReplay() { if (!playback) return; const done = playback.resolve; playback = null; done(); }
    function beginReplay() {
      if (!playback || !playback.pendingStart) return;
      depth = playback.from; cameraMode = 'follow'; focusedRoom = null; cameraY = wantedCamera(); playback.pendingStart = false; hovered = null; selected = null; effects = []; particles = []; boostRemaining = 0; clearScan(false); replaySeen = new Set(); emit(true);
    }
    function markReached() {
      const pending = new Set(pendingReassemblies.map(signature));
      for (const node of nodes) if (node.depth <= depth + EPSILON) seen.add('mineral:' + node.id);
      for (const item of artifacts) if (item.depth <= depth + EPSILON && !pending.has(signature(item))) seen.add('artifact:' + signature(item));
    }
    function reveal(type, item, revision = false, staticReveal = false) {
      const key = type === 'artifact' ? 'artifact:' + signature(item) : 'mineral:' + item.id;
      const registry = playback && !revision ? replaySeen : seen;
      if (registry.has(key)) return;
      registry.add(key);
      // A refresh, historical visit or replay cannot masquerade as new work.
      if (directMode && (revision || playback || !active || cameraMode !== 'follow' || (reduced && !staticReveal))) return;
      const displayed = directMode ? directLayout().byId.get(item.id) || item : type === 'artifact' ? artifactLayout().find(value => value.id === item.id) || item : item;
      if (!reduced) effects.push({ type: type === 'artifact' ? 'assembly' : 'collect', id: item.id, x: type === 'artifact' ? displayed.x : item.veinX, y: displayed.y, kind: item.visualKind || item.kind || 'other', direct: directMode, age: 0, life: directMode ? 700 : type === 'artifact' ? 1500 : 1050 });
      effects = effects.slice(-32);
      impact(type, type === 'artifact' ? .8 : .45);
      if (typeof opts.onReveal === 'function') {
        notifyingFind = true;
        try { opts.onReveal(Object.freeze({ type: item.kind === 'work-finding' ? 'work-finding' : type, id: item.id, name: item.name || item.title || '矿样', depth: item.depth, date: item.date || null, visualType: item.visualType || null, sequence: ++revealSequence, static: staticReveal })); }
        finally { notifyingFind = false; }
      }
    }
    function crossed(previous, current, staticReveal = false) {
      if (current <= previous) return;
      for (let i = lowerBound(nodes, previous); i < nodes.length && nodes[i].depth <= current + EPSILON; i++) if (nodes[i].depth > previous + EPSILON) reveal('mineral', nodes[i], false, staticReveal);
      for (let i = lowerBound(artifacts, previous); i < artifacts.length && artifacts[i].depth <= current + EPSILON; i++) if (artifacts[i].depth > previous + EPSILON) reveal('artifact', artifacts[i], false, staticReveal);
      if (!directMode && !reduced) for (const boundary of STRATA) if (previous < boundary && current >= boundary) effects.push({ type: 'stratum', y: tipAt(boundary), age: 0, life: 720 });
    }
    function advanceTo(end, staticReveal = false) {
      // Present a find at its exact depth even if one frame spans many finds.
      // The callback may acquire a hold synchronously. Equal-depth siblings
      // still enter the same queue without nudging the persisted drill front.
      const gated = opts.pauseAtFindings && directMode && active && !playback && cameraMode === 'follow';
      if (gated) {
        let cursor = lowerBound(artifacts, depth);
        while (cursor < artifacts.length && !discoveryHold) {
          const item = artifacts[cursor++];
          if (item.depth > end) break;
          if (item.depth <= depth + EPSILON || seen.has('artifact:' + signature(item))) continue;
          const previous = depth;
          depth = item.depth;
          crossed(previous, depth, staticReveal);
        }
      }
      if (!discoveryHold) {
        const previous = depth;
        depth = end;
        crossed(previous, depth, staticReveal);
      }
    }
    function settleReduced() {
      if (discoveryHold || (directMode && (!active || frozen()))) return;
      if (pendingReducedReveal) {
        advanceTo(observedTarget, true);
        pendingReducedReveal = discoveryHold && depth < observedTarget;
      } else depth = observedTarget;
      if (cameraMode === 'follow') cameraY = wantedCamera();
      markReached();
    }
    function flushReassemblies() {
      if (frozen()) return;
      const ready = pendingReassemblies.filter(item => item.depth <= depth + EPSILON);
      pendingReassemblies = pendingReassemblies.filter(item => item.depth > depth + EPSILON);
      ready.forEach(item => reveal('artifact', item, true));
    }

    function tile(biome, variant) {
      const key = biome * 4 + variant;
      if (!tileCache.has(key)) {
        const image = document.createElement('canvas'); image.width = 32; image.height = 32;
        const context = image.getContext('2d', { alpha: false });
        if (!context) return null;
        context.imageSmoothingEnabled = false; art.drawTile(context, 0, 0, biome, variant); tileCache.set(key, image);
      }
      return tileCache.get(key);
    }
    function rect(x, y, w, h, color) { if (w <= 0 || h <= 0) return; ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h)); }
    function polygon(points, color) { ctx.fillStyle = color; ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(Math.round(point[0]), Math.round(point[1])) : ctx.moveTo(Math.round(point[0]), Math.round(point[1]))); ctx.closePath(); ctx.fill(); }
    function debris(y, burst = false) {
      // Deterministic visual particles; never used as a source of discoveries.
      const seed = ++particleSeed, side = seed % 2 ? -1 : 1, type = seed % 5 === 0 ? 'spark' : seed % 3 === 0 ? 'dust' : 'stone';
      particles.push({ type, x: side * (3 + seed % 10), y: y - 2, vx: side * (14 + seed % 19) * (burst ? 1.5 : 1), vy: -(13 + seed % 23), age: 0, life: type === 'spark' ? .3 : type === 'dust' ? .7 : .85, size: 1 + seed % 3 });
      if (particles.length > MAX_PARTICLES) particles.shift();
    }
    function advanceDebris(elapsed, moving) {
      particles.forEach(p => { p.age += elapsed; p.x += p.vx * elapsed; p.y += p.vy * elapsed; p.vy += (p.type === 'dust' ? 6 : 110) * elapsed; });
      particles = particles.filter(p => p.age < p.life);
      if (!moving) { particleClock = 0; return; }
      particleClock += elapsed;
      const interval = boostRemaining > 0 ? .025 : .065;
      while (particleClock >= interval) { particleClock -= interval; debris(tipAt(depth)); }
    }
    function excavationFace() {
      const y = tipAt(depth), moving = working(), beat = Math.floor(animationTime / 65), half = wallAt(y);
      // A shallow compression seam joins both walls to the unexcavated rock.
      const rock = geology?.palette[BIOMES[biomeAt(y)] + 'Mid'] || backs[biomeAt(y)];
      polygon([[-half-6,y-2],[-half+4,y],[-13,y+1],[0,y+3],[13,y+1],[half-4,y],[half+6,y-2],[half+6,y+3],[12,y+4],[-12,y+4],[-half-6,y+3]], rock);
      rect(-half, y - 1, half - 13, 1, backs[biomeAt(y)]); rect(13, y - 1, half - 13, 1, backs[biomeAt(y)]);
      rect(-12, y + 1, 7, 1, palette.earthLight); rect(5, y + 1, 7, 1, palette.earthLight);
      for (let i = -2; i <= 2; i++) {
        const x = i * 9, reach = (moving ? 8 + (beat + i + 8) % 6 : 5);
        polygon([[x,y+2],[x+2,y+reach*.5],[x+(i<0?-4:4),y+reach],[x+1,y+reach*.5],[x-1,y+3]], backs[biomeAt(y)]);
        rect(x + (i < 0 ? -5 : 3), y + reach - 1, 4, 1, palette.earthLight);
      }
      if (moving && beat % 3 !== 2) {
        const x = (beat % 2 ? -1 : 1) * 9;
        rect(x, y - 2, 4, 2, palette.shine); rect(x + (x < 0 ? -5 : 5), y - 4, 3, 1, palette.woodLight);
      }
      if (directMode && moving) {
        const strike = Math.floor(animationTime / (boostRemaining > 0 ? 40 : 75)) % 5;
        if (strike < 2) {
          rect(-15, y, 11, 2, backs[biomeAt(y)]); rect(4, y + 1, 12, 2, backs[biomeAt(y)]);
          rect(-11, y - 1, 6, 1, palette.woodLight); rect(5, y, 7, 1, palette.shine);
          rect(-18, y - 4, 3, 2, palette.earthLight); rect(15, y - 5, 4, 2, palette.earth);
        }
      }
    }
    function contactLight() {
      const y = tipAt(depth), bright = boostRemaining > 0 && working();
      ctx.save(); ctx.globalAlpha = bright ? .19 : .12;
      polygon([[-11,y-17],[11,y-17],[11,y-8],[21,y-8],[21,y+2],[30,y+2],[30,y+14],[40,y+14],[40,y+24],[-40,y+24],[-40,y+14],[-30,y+14],[-30,y+2],[-21,y+2],[-21,y-8],[-11,y-8]], palette.woodLight);
      ctx.globalAlpha = bright ? .17 : .1;
      polygon([[-8,y-9],[8,y-9],[8,y-2],[17,y-2],[17,y+9],[25,y+9],[25,y+16],[-25,y+16],[-25,y+9],[-17,y+9],[-17,y-2],[-8,y-2]], palette.shine);
      ctx.restore();
    }
    function drawDebris() {
      for (const p of particles) {
        const left = 1 - p.age / p.life;
        if (p.type === 'dust') {
          const size = p.size + Math.floor(p.age * 7);
          rect(p.x - size / 2, p.y, size, Math.max(1, size - 2), backs[biomeAt(p.y)]);
          if (left > .4) rect(p.x, p.y - 1, 2, 1, palette.earth);
        } else if (p.type === 'spark') {
          rect(p.x, p.y, left > .5 ? 3 : 1, 1, palette.shine);
          if (left > .55) rect(p.x - Math.sign(p.vx) * 3, p.y + 1, 2, 1, palette.woodLight);
        } else {
          rect(p.x, p.y, p.size + 1, p.size, palette.earthShadow);
          rect(p.x, p.y, p.size, 1, palette.earthLight);
        }
      }
    }
    function smallSprite(key, w, h, painter, x, y) {
      if (!spriteCache.has(key)) {
        const image = document.createElement('canvas'); image.width = w; image.height = h;
        const context = image.getContext('2d'); if (!context) return;
        context.imageSmoothingEnabled = false; painter(context, w / 2, h - 1); spriteCache.set(key, image);
        if (spriteCache.size > 96) spriteCache.delete(spriteCache.keys().next().value);
      }
      ctx.drawImage(spriteCache.get(key), Math.round(x - w / 4), Math.round(y - h / 2 + 1), w / 2, h / 2);
    }
    function terrain(top, bottom) {
      const half = width / (2 * scale);
      const firstCol = Math.floor(-half / 32) - 1, lastCol = Math.ceil(half / 32);
      const firstRow = Math.floor(top / 32), lastRow = Math.ceil(bottom / 32);
      for (let row = firstRow; row <= lastRow; row++) {
        const biome = biomeAt(row * 32 + 16);
        for (let column = firstCol; column <= lastCol; column++) {
          const variant = ((Math.imul(column, 13) ^ Math.imul(row, 7)) >>> 0) % 4;
          const texture = tile(biome, variant);
          if (texture) ctx.drawImage(texture, column * 32, row * 32);
          else art.drawTile(ctx, column * 32, row * 32, biome, variant);
        }
      }
      // Broad rock planes break the tiled surface without adding noisy detail.
      ctx.save(); ctx.globalAlpha = .24;
      for (let band = Math.floor((top - 110) / 166); band <= Math.ceil(bottom / 166); band++) {
        const y = band * 166, offset = Math.abs(band % 4) * 13;
        for (const side of [-1, 1]) {
          const inner = side * (85 + offset), outer = side * (half + 40), end = y + 63 + offset;
          polygon([[inner,y+10],[outer,y-22],[outer,end+38],[side*(117+offset),end+18],[side*(107+offset),end-2],[side*(76+offset),y+35]], backs[biomeAt(y + 40)]);
        }
      }
      ctx.restore();
      for (const boundary of STRATA) {
        const y = tipAt(boundary);
        if (y >= top - 4 && y <= bottom + 4) {
          rect(-half - 2, y, half * 2 + 4, 3, backs[biomeAt(y)]);
          for (let x = Math.floor(-half / 43) * 43; x < half; x += 43) rect(x, y - 3, 24, 3, backs[biomeAt(y)]);
        }
      }
    }
    function detailedRockChunk(column, row) {
      const key = column + ':' + row;
      if (rockCache.has(key)) return rockCache.get(key);
      const size = 128, ox = column * size, oy = row * size, image = document.createElement('canvas'); image.width = size; image.height = size;
      const brush = image.getContext('2d', { alpha: false }); if (!brush) return null;
      brush.imageSmoothingEnabled = false;
      const gp = geology?.palette || {}, fallback = ['#84715a','#55777c','#716d86','#677779'];
      const tone = (y, role) => gp[BIOMES[biomeAt(y)] + role] || (role === 'Deep' || role === 'Fissure' ? shade : fallback[biomeAt(y)]);
      function fill(x, y, w, h, color) { const left = Math.max(ox, Math.round(x)), top = Math.max(oy, Math.round(y)), right = Math.min(ox + size, Math.round(x + w)), bottom = Math.min(oy + size, Math.round(y + h)); if (right <= left || bottom <= top) return; brush.fillStyle = color; brush.fillRect(left - ox, top - oy, right - left, bottom - top); }
      function shape(points, color) {
        for (let y = Math.max(oy, Math.min(...points.map(p => p[1]))); y < Math.min(oy + size, Math.max(...points.map(p => p[1]))); y++) {
          const cuts = [], at = y + .5;
          for (let i = 0, j = points.length - 1; i < points.length; j = i++) { const a = points[j], b = points[i]; if ((a[1] <= at && b[1] > at) || (b[1] <= at && a[1] > at)) cuts.push(a[0] + (at - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); }
          cuts.sort((a, b) => a - b); for (let i = 0; i + 1 < cuts.length; i += 2) fill(Math.ceil(cuts[i] - .5), y, Math.ceil(cuts[i + 1] - .5) - Math.ceil(cuts[i] - .5), 1, color);
        }
      }
      function stroke(x0, y0, x1, y1, color, weight = 1) { let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, error = dx + dy; for (;;) { fill(x0, y0, weight, weight, color); if (x0 === x1 && y0 === y1) break; const twice = error * 2; if (twice >= dy) { error += dy; x0 += sx; } if (twice <= dx) { error += dx; y0 += sy; } } }
      for (let y = oy; y < oy + size; y++) fill(ox, y, size, 1, tone(y, 'Shadow'));
      // Sample bedding on a world grid so a quiet stretch reads as one slab across chunk edges.
      for (let band = Math.floor((oy - 100) / 86); band < Math.ceil((oy + size + 100) / 86); band++) {
        const n = rockSeed(band, 3), y = band * 86 + n % 19, phase = n % 29;
        const crest = x => y + Math.round(Math.sin(x / 140 + phase) * 11 + Math.sin(x / 57 + phase) * 3);
        const thickness = 46 + (n >>> 8) % 24;
        for (let x = Math.floor(ox / 64) * 64; x < ox + size; x += 64) {
          const a = crest(x), b = crest(x + 64);
          shape([[x,a],[x+64,b],[x+64,b+thickness],[x,a+thickness]], tone(y, 'Base'));
          stroke(x, a, x + 64, b, tone(y, 'Mid'));
          if (n % 3 === 0) stroke(x, a + 7, x + 64, b + 7, tone(y, 'Shadow'));
        }
      }
      // Irregular stone faces have distinct top, front and underside planes.
      for (let r = Math.floor((oy - 70) / 27); r <= Math.ceil((oy + size + 45) / 27); r++) for (let c = Math.floor((ox - 100) / 48); c <= Math.ceil((ox + size + 70) / 48); c++) {
        const n = rockSeed(c, r, 53);
        const fractured = rockSeed(Math.floor(c / 3), Math.floor(r / 4), 487) % 6;
        if (n % 10 >= 2 + fractured) continue;
        const x = c * 48 + (r % 2) * 23 + n % 19 - 9, y = r * 27 + (n >>> 8) % 17 - 7;
        const w = 29 + (n >>> 12) % 29, h = 17 + (n >>> 19) % 16;
        const form = n % 4, body = form === 0 ? [[x,y+8],[x+9,y+3],[x+21,y],[x+w-9,y+2],[x+w,y+9],[x+w-4,y+h-3],[x+w-16,y+h+3],[x+6,y+h],[x-3,y+h-7]] : form === 1 ? [[x,y+2],[x+w-5,y],[x+w,y+h-4],[x+w-10,y+h],[x+5,y+h-5]] : form === 2 ? [[x-3,y+h-5],[x+7,y+5],[x+19,y+6],[x+25,y-3],[x+w,y+5],[x+w-5,y+h],[x+12,y+h+2]] : [[x,y+5],[x+w,y-3],[x+w+12,y+h-1],[x+2,y+h+4]];
        shape(body, tone(y, n % 4 === 0 ? 'Shadow' : 'Base'));
        if (form === 0) shape([[x,y+8],[x+9,y+3],[x+21,y],[x+w-9,y+2],[x+w-3,y+7],[x+23,y+5],[x+12,y+7],[x+2,y+12]], tone(y, 'Mid'));
        else shape([[x+4,y+5],[x+w-8,y+1],[x+w-3,y+5],[x+6,y+9]], tone(y, 'Mid'));
        if (form !== 3) {
          shape([[x+w-3,y+9],[x+w-4,y+h-3],[x+w-16,y+h+3],[x+6,y+h],[x+3,y+h-5],[x+w-18,y+h-2]], tone(y, 'Shadow'));
          stroke(x + w - 16, y + h + 1, x + 6, y + h - 1, tone(y, 'Deep'));
        }
        if ((n >>> 7) % 3 === 0) stroke(x + 10, y + 3, x + 22, y + 1, tone(y, 'Light'));
        stroke(x + 8, y + h - 5, x + w - 18, y + h - 2, tone(y, 'Shadow'));
        // Fine bedding stays local to a stone, not a full-screen noise texture.
        for (let line = 0; line < (n >>> 5) % 3; line++) {
          const sy = y + 11 + line * 4, length = Math.max(4, w - 20 - (n >>> (line * 3)) % 15);
          stroke(x + 8 + line, sy, x + 8 + line + length, sy - (n % 3), tone(y, line === 1 ? 'Mid' : 'Shadow'));
        }
        if (n % 4 === 0) {
          const fx = x + 17 + n % 9;
          stroke(fx, y + 6, fx - 3, y + 13, tone(y, 'Fissure'));
          stroke(fx - 3, y + 13, fx + 3, y + h - 2, tone(y, 'Fissure'));
          stroke(fx - 1, y + 13, fx + 5, y + h - 3, tone(y, 'Mid'));
        }
        for (let chip = 0; chip < (n >>> 12) % 4; chip++) {
          const k = rockSeed(c + chip, r, n), px = x + 7 + k % Math.max(8, w - 14), py = y + 8 + (k >>> 8) % Math.max(6, h - 10);
          fill(px, py, 2 + k % 3, 1, tone(y, chip % 3 ? 'Mid' : 'Shadow')); if (chip === 0 && n % 3 === 0) fill(px + 1, py - 1, 1, 1, tone(y, 'Light'));
        }
      }
      // Moss and water cling to selected seams; hanging roots are sparse.
      for (let r = Math.floor((oy - 50) / 74); r <= Math.ceil((oy + size + 30) / 74); r++) for (let c = Math.floor((ox - 45) / 93); c <= Math.ceil((ox + size + 30) / 93); c++) {
        const n = rockSeed(c, r, 941); if ((n >>> 17) % 4 !== 0) continue;
        const x = c * 93 + n % 31, y = r * 74 + (n >>> 9) % 39, b = biomeAt(y);
        if (b === 0 || b === 1 || n % 5 === 0) {
          const dark = gp.mossDark || '#3c5141', moss = gp.moss || '#61784c', light = gp.mossLight || '#91a366';
          for (let k = 0; k < 7; k++) { const px = x + k * 3, py = y + Math.round(Math.sin(k + n % 4) * 2); fill(px, py, 4, 3 + (k % 3), dark); fill(px + 1, py, 2, 2, moss); if (k % 3 === 0) fill(px + 1, py - 1, 1, 1, light); }
          if (b === 0) { stroke(x + 9, y + 3, x + 11, y + 12, gp.rootDark || '#513f37', 2); stroke(x + 11, y + 12, x + 6, y + 25, gp.root || '#806344'); stroke(x + 11, y + 10, x + 17, y + 17, gp.root || '#806344'); }
        }
        if (b === 1 || (b === 3 && n % 4 === 0)) {
          stroke(x + 7, y + 5, x + 9, y + 20, gp.waterDark || '#285464', 2); fill(x + 8, y + 7, 1, 7, gp.water || '#468b9a');
          fill(x + 9, y + 25, 2, 3, gp.water || '#468b9a'); fill(x + 9, y + 25, 1, 1, gp.waterLight || '#86bab5');
          stroke(x + 4, y + 31, x + 15, y + 31, gp.waterDark || '#285464');
        }
        if (b === 2 && n % 2 === 0) { fill(x + 5, y + 3, 2, 3, gp.purple || '#9e85b7'); fill(x + 10, y + 6, 3, 2, gp.crystal || '#70a1ae'); fill(x + 17, y + 2, 1, 2, gp.purpleLight || '#c4b0d4'); }
      }
      rockCache.set(key, image); if (rockCache.size > 96) rockCache.delete(rockCache.keys().next().value); return image;
    }
    function detailedTerrain(top, bottom) {
      const half = width / (2 * scale);
      for (let row = Math.floor(top / 128); row <= Math.floor(bottom / 128); row++) for (let column = Math.floor(-half / 128); column <= Math.floor(half / 128); column++) {
        const image = detailedRockChunk(column, row); if (image) ctx.drawImage(image, column * 128, row * 128);
      }
    }
    function wallEcology(top, bottom) {
      const end = Math.min(bottom + 25, tipAt(depth) - 12), gp = geology?.palette || {};
      for (let band = Math.floor((top - 108) / 164); band <= Math.floor(end / 164); band++) {
        const n = rockSeed(band, 4, 659), y = band * 164 + n % 65, side = n % 2 ? -1 : 1, edge = side * (wallAt(y) + 3), b = biomeAt(y);
        if (y > end || y < SURFACE) continue;
        const dark = gp.mossDark || '#3c5141', moss = gp.moss || '#61784c', light = gp.mossLight || '#91a366';
        // Small ledges overlap the shaft rim; the broad source hitboxes stay clear.
        polygon([[edge,y],[edge+side*11,y-3],[edge+side*17,y+2],[edge+side*13,y+5],[edge,y+4]], backs[b]);
        rect(Math.min(edge, edge + side * 10), y, 10, 1, gp[BIOMES[b] + 'Mid'] || palette.earthLight);
        if (b < 2 || n % 3 === 0) for (let i = 0; i < 4; i++) { const x = edge + side * (3 + i * 3); rect(x, y - 2 - i % 2, 3, 3 + i % 3, dark); rect(x, y - 2 - i % 2, 2, 1, moss); if (i === 1) rect(x, y - 3, 1, 1, light); }
        if (b === 0 && n % 2 === 0) {
          for (let i = 0; i < 19; i++) rect(edge + side * (7 + Math.floor(Math.sin(i / 4) * 2)), y + i, 1, 2, i % 5 ? (gp.root || palette.woodShadow) : (gp.rootLight || palette.woodLight));
        } else if (b === 1 || (b === 3 && n % 3 === 0)) {
          rect(edge + side * 6, y + 4, 2, 14, gp.waterDark || '#285464'); rect(edge + side * 6, y + 5, 1, 6, gp.water || '#468b9a');
          const drip = reduced ? 8 : Math.floor(animationTime / 90 + band * 7) % 21;
          rect(edge + side * 6, y + 13 + drip, 1, 2, gp.waterLight || '#86bab5');
        }
        if (n % 4 === 0) { rect(edge + side * 15, y + 8, 3, 2, gp[BIOMES[b] + 'Mid'] || palette.earth); rect(edge + side * 19, y + 12, 2, 1, backs[b]); }
      }
    }
    function shaftSupports(top, bottom) {
      const supports = [], frontier = tipAt(depth);
      // Include fixtures just outside the frame whose pool of light reaches the camera.
      for (let section = Math.max(0, Math.floor((top - 160) / 272)); section <= Math.floor((bottom + 52) / 272); section++) {
        const seed = rockSeed(section, 8, 303), y = section * 272 + 42 + seed % 66;
        if (y > frontier - 34 || y < top - 76 || y > bottom + 52) continue;
        const half = wallAt(y), side = (seed >>> 9) % 2 ? -1 : 1;
        const lit=(seed >>> 17) % 5 < 2;
        if (!directMode || lit) supports.push({ y, half, side, lampX: lit ? side * (half - 8) : null });
      }
      return supports;
    }
    function shaft(top, bottom, supports, structures) {
      const frontier = tipAt(depth), end = Math.min(frontier, bottom + 18), begin = Math.min(top - 20, end);
      if (end <= top - 18) return;
      const left = [], right = [];
      for (let y = begin; y < end; y += 12) { const half = wallAt(y); left.push([-half, y]); right.unshift([half, y]); }
      left.push([-wallAt(end), end]); right.unshift([wallAt(end), end]);
      polygon(left.concat(right), shade);
      // Keep the open shaft quiet. Only wall edges and actual mining hardware
      // interrupt its dark back plane; excavation ends at the drill tip.
      for (let y = Math.floor(begin / 12) * 12; y < end; y += 12) {
        const next=Math.min(y+12,end),half=wallAt(y),nextHalf=wallAt(next);
        // A continuous broken lip reads as rock. Evenly spaced rectangular
        // dashes here look like rungs even when there is no ladder in the shaft.
        for(const side of [-1,1]){
          const a=2+rockSeed(Math.floor(y/12),side,811)%5;
          const b=2+rockSeed(Math.floor(y/12)+1,side,811)%5;
          polygon([[side*(half-1),y],[side*(half+a),y],[side*(nextHalf+b),next],[side*(nextHalf-1),next]],backs[biomeAt(y)]);
        }
        const rim = rockSeed(Math.floor(y / 12), 3, 181);
        if ((rim >>> 5) % 9 === 1 && y+11<=end) {
          const side=rim%2 ? -1:1;
          polygon([[side*half,y+2],[side*(half-5),y+4],[side*(half-7),y+8],[side*half,y+11]], backs[biomeAt(y)]);
        }
      }
      const cableEnd = Math.min(end, rigAt(depth) - 22);
      // A short access ladder serves the mouth of an excavated pump bay.
      // Its top and foot are both visible; the rest of the shaft is open rock.
      for (const site of structures) {
        if (site.kind !== 'pump') continue;
        const y = site.landingY, foot = y + 34;
        if (y > frontier - 34 || foot < top || y > bottom) continue;
        const wall = site.side > 0 ? site.left : site.left + site.width;
        const inside = site.side * (Math.min(wallAt(y), wallAt(foot)) - 9);
        const leftRail = site.side > 0 ? inside - 7 : inside;
        rect(Math.min(wall,inside), y, Math.abs(wall-inside)+1, 3, palette.woodShadow);
        rect(Math.min(wall,inside), y, Math.abs(wall-inside)+1, 1, palette.woodLight);
        rect(leftRail, y+2, 2, 32, palette.steel); rect(leftRail+7, y+2, 2, 32, palette.steel);
        for (let rung=y+5; rung<foot; rung+=8) rect(leftRail+2, rung, 5, 2, palette.wood);
      }
      if (!directMode) { rect(-11, begin, 1, cableEnd - begin, palette.steel); rect(-9, begin, 1, cableEnd - begin, palette.deep); }
      for (const { y, half, side, lampX } of supports) {
        if (directMode) {
          const bracketEnd=side*(half+2);
          rect(Math.min(lampX,bracketEnd),y+8,Math.abs(lampX-bracketEnd)+1,2,palette.woodShadow);
          rect(bracketEnd,y+7,2,5,palette.steel);
        } else art.drawSupport(ctx, -half - 4, y, half * 2 + 8);
        if (lampX !== null) art.drawLamp(ctx, lampX, y + 16, true);
      }
      if (frontier >= top - 2 && frontier <= bottom + 2) rect(-wallAt(frontier), frontier, wallAt(frontier) * 2, 1, palette.earthLight);
    }
    function candidates(top, bottom) {
      const minimum = Math.max(0, (top - SURFACE - 55) / PIXELS_PER_METER);
      const maximum = Math.min(depth + 8, observedTarget, (bottom - SURFACE + 55) / PIXELS_PER_METER);
      const found = [];
      for (let i = lowerBound(nodes, minimum); i < nodes.length && nodes[i].depth <= maximum + EPSILON; i++) if (nodes[i].renderable) found.push(nodes[i]);
      return found.slice(-MAX_DRAWN_NODES);
    }
    function environments(top, bottom) {
      // The work-history mine already has wall ecology and buried industrial sites.
      if (!expedition || directMode) return;
      for (let band = Math.floor((top - 36) / 62); band <= Math.ceil((bottom + 32) / 62); band++) {
        const side = band % 2 ? -1 : 1, floor = band * 62 + Math.abs(band % 3) * 7;
        if (nearChamber(side, floor, 65)) continue;
        const biome = BIOMES[biomeAt(floor)], x = side * (wallAt(floor) + 12), variant = Math.abs(band * 7) % 6;
        if (typeof expedition.drawDressing === 'function') expedition.drawDressing(ctx, biome, x, floor, variant, Math.floor(animationTime / 360));
        if (typeof expedition.drawSeam === 'function') expedition.drawSeam(ctx, biome, -side * (wallAt(floor) + 17), floor + 27, variant, 0);
      }
      // Larger landmarks are uncommon and half the former size, embedded in rock.
      if (typeof expedition.drawEnvironment !== 'function') return;
      for (let band = Math.floor((top - 44) / 270); band <= Math.ceil((bottom + 44) / 270); band++) {
        const floor = band * 270 + 104, side = band % 2 ? -1 : 1, x = side * (wallAt(floor) + 35);
        if (floor < top || floor - 44 > bottom) continue;
        if (nearChamber(side, floor, 95)) continue;
        const biome = BIOMES[biomeAt(floor)], variant = Math.abs(band) % 2;
        smallSprite('environment:' + biome + variant, 96, 88, (c, a, b) => expedition.drawEnvironment(c, biome, a, b, variant, 0), x, floor);
        polygon([[x-25,floor-3],[x-15,floor-1],[x-7,floor+2],[x+19,floor+1],[x+25,floor-3],[x+29,floor+5],[x-27,floor+5]], backs[biomeAt(floor)]);
      }
    }
    function nearChamber(side, y, margin = 80) { return chambers.some(item => item.sign === side && item.depth <= Math.min(depth, observedTarget) + EPSILON && Math.abs(item.y - y) < margin); }
    function placedX(x, y, radius) {
      const side = Math.sign(x) || 1;
      if (nearChamber(side, y, 70) && !nearChamber(-side, y, 70)) x = -x;
      else if (nearChamber(side, y, 70)) x = side * (wallAt(y) + radius + 2);
      return clamp(x, -width / (2 * scale) + radius + 7, width / (2 * scale) - radius - 7);
    }
    function artifactLayout(top = -Infinity, bottom = Infinity) {
      if (directMode) return indexedRange(directLayout().placed, top - 8, bottom + (getWorkSprite ? 80 : 42), 'y').filter(item => item.depth <= Math.min(depth, observedTarget) + EPSILON);
      const reached = artifacts.filter(item => item.depth <= Math.min(depth, observedTarget) + EPSILON);
      const placed = reached.filter(item => item.kind !== 'work-finding').map(item => ({ ...item, x: placedX(item.x, item.y, 16) }));
      const findings = reached.filter(item => item.kind === 'work-finding'); if (!findings.length) return placed;
      const occupied = placed.map(item => ({ left: item.x - 20, right: item.x + 20, top: item.y - 36, bottom: item.y + 5 }));
      const roomWidth = width < 1120 ? 48 : 112, roomHeight = width < 1120 ? 56 : 72;
      for (const item of chambers) if (item.depth <= depth + EPSILON) {
        const x = item.sign * Math.min(130, Math.max(roomWidth / 2 + 20, Math.floor(width / (2 * scale) - roomWidth / 2 - 5)));
        occupied.push({ left: x - roomWidth / 2 - 2, right: x + roomWidth / 2 + 2, top: item.y - roomHeight - 2, bottom: item.y + 5 });
      }
      for (const item of nodes) if (item.renderable && item.depth <= depth + EPSILON) {
        const x = placedX(item.x, item.y, 11);
        occupied.push({ left: x - 13, right: x + 13, top: item.y - 25, bottom: item.y + 4 });
      }
      // Findings keep their source depth. Only their wall niches are packed;
      // all comparisons use world bounds, independent of camera or input order.
      const slots = new Map();
      for (const item of findings) {
        const slot = slots.get(item.date) || 0; slots.set(item.date, slot + 1);
        const preferred = (slot + hash(item.date)) % 2 ? 1 : -1;
        const distance = Math.max(0, Math.min(item.y - (SURFACE + 32), 800));
        let result = null;
        for (let offset = 0; offset <= distance + 4 && !result; offset += 4) {
          const y = item.y - Math.min(offset, distance);
          const lanes = width < 700 ? [62] : [104, 152];
          for (const lane of lanes) for (const side of [preferred, -preferred]) {
            if (result) break;
            const x = Math.round(side * Math.min(lane, width / (2 * scale) - 24));
            const bounds = { left: x - 20, right: x + 20, top: y - 35, bottom: y + 5 };
            if (occupied.some(other => bounds.left < other.right && bounds.right > other.left && bounds.top < other.bottom && bounds.bottom > other.top)) continue;
            result = { ...item, x, y }; occupied.push(bounds); placed.push(result);
          }
          if (offset >= distance) break;
        }
      }
      return placed.sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
    }
    function chamberLayout(top, bottom) {
      const compact = width < 1120, w = compact ? 48 : 112, h = compact ? 56 : 72;
      const reach = Math.min(depth, observedTarget), placed = [], occupied = [];
      // The newest overlapping room is shown; all records remain in the app list.
      const ordered = chambers.slice().reverse();
      if (focusedRoom) { const index = ordered.findIndex(item => item.id === focusedRoom); if (index > 0) ordered.unshift(...ordered.splice(index, 1)); }
      for (const item of ordered) {
        if (item.depth > reach + EPSILON || item.y < top - 4 || item.y - h > bottom + 4) continue;
        if (occupied.some(other => other.sign === item.sign && Math.abs(other.y - item.y) < h + 14)) continue;
        const x = item.sign * Math.min(130, Math.max(w / 2 + 20, Math.floor(width / (2 * scale) - w / 2 - 5)));
        occupied.push(item); placed.push({ ...item, x, w, h, compact });
        if (placed.length >= 8) break;
      }
      return placed.reverse();
    }
    function stationLayout(top, bottom, displayedArtifacts = artifactLayout()) {
      const reached = reachedTracks(); if (!reached.length) return [];
      const reach = Math.min(depth, observedTarget), occupied = [], placed = [];
      const roomWidth = width < 1120 ? 48 : 112, roomHeight = width < 1120 ? 56 : 72;
      // Use world bounds, not viewport hits: panning must not move a facility or
      // let it cover a provenance target as that target enters the screen.
      for (const item of chambers) if (item.depth <= reach + EPSILON) {
        const x = item.sign * Math.min(130, Math.max(roomWidth / 2 + 20, Math.floor(width / (2 * scale) - roomWidth / 2 - 5)));
        occupied.push({ left: x - roomWidth / 2 - 3, right: x + roomWidth / 2 + 3, top: item.y - roomHeight - 3, bottom: item.y + 4 });
      }
      for (const item of displayedArtifacts) {
        occupied.push({ left: item.x - 20, right: item.x + 20, top: item.y - 36, bottom: item.y + 5 });
      }
      for (const item of nodes) if (item.renderable && item.depth <= reach + EPSILON) {
        const x = placedX(item.x, item.y, 11);
        occupied.push({ left: x - 14, right: x + 14, top: item.y - 26, bottom: item.y + 5 });
      }
      const order = ['relay', 'sorter', 'garden'];
      for (const item of reached.sort((a, b) => a.depth - b.depth || order.indexOf(a.id) - order.indexOf(b.id))) {
        const sourceY = Math.round(tipAt(item.depth) - 3), preferred = item.id === 'sorter' ? 1 : -1;
        const compact = width < 1120 || nearChamber(-1, sourceY, 70) || nearChamber(1, sourceY, 70);
        const radius = compact ? 16 : 32, h = compact ? 28 : 44, step = h + 8;
        const minimumY = Math.min(sourceY, SURFACE + h), distance = Math.min(sourceY - minimumY, step * 64);
        let result = null;
        for (let offset = 0; offset <= distance + step && !result; offset += step) {
          const y = sourceY - Math.min(offset, distance);
          for (const side of [preferred, -preferred]) {
            const x = Math.round(side * Math.min(wallAt(y) + radius + 4, width / (2 * scale) - radius - 6));
            const bounds = { left: x - radius - 3, right: x + radius + 3, top: y - h - 3, bottom: y + 4 };
            if (occupied.some(other => bounds.left < other.right && bounds.right > other.left && bounds.top < other.bottom && bounds.bottom > other.top)) continue;
            result = { ...item, x, y, compact, radius, h }; occupied.push(bounds); break;
          }
          if (offset >= distance) break;
        }
        // In an exceptionally crowded shallow segment, keep its source in the
        // field journal rather than painting over an unrelated clickable item.
        if (result) placed.push(result);
      }
      return placed.filter(item => item.y >= top - 2 && item.y - item.h <= bottom + 2);
    }
    function drawLife(top, bottom, stations) {
      if (!life) return;
      if (typeof life.drawStation === 'function') for (const item of stations) {
        rect(item.x - item.radius - 2, item.y, item.radius * 2 + 4, 3, backs[biomeAt(item.y)]);
        life.drawStation(ctx, item.x, item.y, item.id, reduced ? 0 : Math.floor(animationTime / 250), item.compact);
      }
      if (typeof life.drawDrone === 'function' && reachedTracks().some(item => item.id === 'sorter')) {
        const x = width < 700 ? -8 : -28, y = rigAt(depth) - (width < 700 ? 38 : 14) + (reduced || !working() ? 0 : Math.round(Math.sin(animationTime / 230) * 2));
        if (y >= top && y - 16 <= bottom) {
          rect(x - 7, y + 3, 14, 2, shade);
          life.drawDrone(ctx, x, y, reduced ? 0 : Math.floor(animationTime / 130), working());
        }
      }
    }
    function scanOverlay() {
      if (scanRemaining <= 0 || !scanOrigin) return;
      const unit = Math.max(1, scale), color = palette.tealLight || '#8cd8c3';
      ctx.save(); ctx.fillStyle = color;
      if (!reduced) {
        const radius = scanOrigin.radius * (1 - scanRemaining / 2), centreX = width / 2, centreY = (scanOrigin.y - Math.floor(cameraY)) * scale;
        ctx.globalAlpha = Math.min(.8, scanRemaining * .7);
        for (let i = 0; i < 72; i++) {
          const angle = i * Math.PI / 36, x = centreX + Math.cos(angle) * radius * scale, y = centreY + Math.sin(angle) * radius * scale;
          ctx.fillRect(Math.round(x / unit) * unit, Math.round(y / unit) * unit, unit, unit);
        }
      }
      ctx.globalAlpha = 1;
      const found = new Set(scanResults.map(item => item.type + ':' + item.id));
      for (const hit of hits) if (found.has(hit.key)) {
        const w = hit.hitWidth || 25 * scale, h = hit.hitHeight || 28 * scale;
        const left = Math.round(hit.screenX - w / 2), right = Math.round(hit.screenX + w / 2), top = Math.round(hit.screenY - h / 2), bottom = Math.round(hit.screenY + h / 2), length = 4 * unit;
        for (const [x, y, sx, sy] of [[left,top,1,1],[right,top,-1,1],[left,bottom,1,-1],[right,bottom,-1,-1]]) {
          ctx.fillRect(x + (sx < 0 ? -length : 0), y, length, unit);
          ctx.fillRect(x, y + (sy < 0 ? -length : 0), unit, length);
        }
      }
      ctx.restore();
    }
    function drawChamber(item) {
      const { x, y, w, h, sign } = item, a = x - w / 2, b = x + w / 2;
      const wall = sign * (wallAt(y - 10) - 2), door = x - sign * (w / 2 - 5), left = Math.min(wall, door), right = Math.max(wall, door);
      polygon([[a+6,y-h-6],[b-9,y-h-6],[b+5,y-h+10],[b+8,y-9],[b+2,y+7],[a-8,y+5],[a-9,y-h+21]], backs[biomeAt(y)]);
      polygon([[a+4,y-h],[b-6,y-h],[b+2,y-h+12],[b+1,y+1],[a-2,y+2],[a-5,y-h+17]], shade);
      // A physical branch with a floor, two rails and a ceiling cable joins the shaft.
      rect(left - 2, y - 25, right - left + 4, 26, backs[biomeAt(y)]);
      rect(left, y - 21, right - left, 20, shade);
      rect(left, y - 1, right - left, 4, palette.earthShadow);
      for (let tie = Math.ceil(left / 7) * 7; tie < right; tie += 7) rect(tie, y - 10, 2, 10, palette.woodShadow);
      rect(left, y - 8, right - left, 1, palette.steel); rect(left, y - 3, right - left, 1, palette.steel);
      rect(left, y - 20, right - left, 1, palette.steel); rect(left + 1, y - 18, right - left - 2, 1, palette.deep);
      if (expedition && typeof expedition.drawChamber === 'function') expedition.drawChamber(ctx, x, y, item.theme, item.variant, item.level, Math.floor(animationTime / 300), item.compact);
      else { rect(a+3, y-h+3, w-6, h-4, shade); art.drawLamp(ctx, x, y-h+12, true); rect(a+7, y-8, w-14, 6, palette.woodShadow); }
      // Rock overlaps the room silhouette; the lower lip ties its floor to the geology.
      polygon([[a-4,y-h+3],[a+8,y-h+3],[a+5,y-h+10],[a+2,y-h+12],[a+2,y-20],[a-5,y-13]], backs[biomeAt(y)]);
      polygon([[b-7,y-h+1],[b+4,y-h+1],[b+5,y-9],[b-2,y-7],[b-2,y-h+15],[b-8,y-h+9]], backs[biomeAt(y)]);
      polygon([[a-4,y],[a+7,y-1],[a+13,y+2],[b-9,y+1],[b-3,y-3],[b+6,y+4],[b+3,y+8],[a-5,y+6]], palette.earthShadow);
      rect(a + 8, y + 2, w - 18, 1, palette.earthLight);
      const key = 'room:' + item.id;
      if (selected === key || hovered === key) { rect(a+10,y-h+4,7,1,palette.shine); rect(b-17,y-h+4,7,1,palette.shine); }
      const screenX = Math.round(width / 2) + x * scale + drawShake.x, screenY = (y - h / 2 - Math.floor(cameraY)) * scale + drawShake.y;
      const clipLeft = Math.max(0, screenX - w * scale / 2), clipRight = Math.min(width, screenX + w * scale / 2);
      const clipTop = Math.max(0, screenY - h * scale / 2), clipBottom = Math.min(height, screenY + h * scale / 2);
      const hit = unobstructedArea({ left: clipLeft, right: clipRight, top: clipTop, bottom: clipBottom });
      if (hit) hits.push({ ...item, key, type: 'room', title: item.name, screenX: (hit.left + hit.right) / 2, screenY: (hit.top + hit.bottom) / 2, hitWidth: hit.right - hit.left, hitHeight: hit.bottom - hit.top });
    }
    // A chipped opening leaves the subject intact in the middle. A few large
    // stepped facets follow the wall's pixel grid, including on narrow screens.
    function pocketPath(left, top, w, h) {
      ctx.beginPath();
      for (let i=0; i<POCKET_CONTOUR.length; i++) {
        const x = left + Math.round(w * POCKET_CONTOUR[i][0]), y = top + Math.round(h * POCKET_CONTOUR[i][1]);
        if (i) ctx.lineTo(x,y); else ctx.moveTo(x,y);
      }
      ctx.closePath();
    }
    function drawWorkPocket(item, sprite, effect) {
      const factor = Math.min(item.artWidth / sprite.width, item.artHeight / sprite.height);
      const w = Math.max(1, Math.round(sprite.width * factor)), h = Math.max(1, Math.round(sprite.height * factor));
      const floor = item.y, left = Math.round(item.x - w / 2), top = floor - h;
      const media = item.visualType === 'image' || item.visualType === 'video';
      const bed = BIOMES[biomeAt(floor)], gp = geology?.palette || {};
      const stone = gp[bed+'Mid'] || palette.earth, dark = gp[bed+'Shadow'] || backs[biomeAt(floor)];
      const lip = gp[bed+'Light'] || palette.earthLight;
      const color = sprite.lightColor;
      const bounds = {left, right:left+w, top, bottom:floor, color};
      if (effect) effect.artBounds = bounds;
      const right = left+w;
      if (media) {
        pocketPath(left-4,top-4,w+8,h+9); ctx.fillStyle = dark; ctx.fill();
        pocketPath(left-2,top-2,w+4,h+5); ctx.fillStyle = shade; ctx.fill();
      } else {
        // Only cut the foot of the shelf; the surrounding strata show through
        // the open spaces in a bird, wheel, circuit or other loose object.
        const footLeft=left+Math.round(w*.15), footRight=right-Math.round(w*.12);
        polygon([[footLeft-2,floor],[footLeft+2,floor-2],[footRight-3,floor-2],[footRight+2,floor],
          [footRight-2,floor+2],[footLeft+4,floor+3]],dark);
      }
      if (!effect || effect.age >= 135) {
        const progress = effect ? clamp((effect.age - 135) / 500, 0, 1) : 1;
        const arc = 4 * progress * (1 - progress);
        ctx.save();
        ctx.translate(-Math.sign(item.x) * Math.round(arc * 3), -Math.round(arc * 7));
        if (media) { pocketPath(left,top,w,h); ctx.clip(); }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sprite,left,top,w,h);
        ctx.restore();
      }
      const ridge = Math.max(3,Math.round(w*.13));
      rect(left+1,floor-1,ridge,3,stone);
      rect(left+ridge,floor+1,ridge+1,2,dark);
      rect(right-ridge-1,floor-2,ridge,2,lip);
      if (media && color) {
        const reflection='rgb('+color.join(',')+')';
        ctx.save(); ctx.globalAlpha=.45;
        rect(left+ridge+2,top+1,ridge,1,reflection);
        rect(right-ridge-3,floor-1,ridge,1,reflection);
        rect(right+1,top+Math.round(h*.45),2,3,reflection);
        ctx.restore();
      }
      window.GalleryArt?.draw(ctx,item,depth,opts.gallery);
      return bounds;
    }
    function workshop(item) {
      const x = item.x, floor = item.y, a = x - 20, b = x + 20;
      const effect = effects.find(effect => effect.type === 'assembly' && effect.id === item.id);
      if (directMode && getWorkSprite && item.artWidth) {
        const media = item.visualType === 'image' || item.visualType === 'video';
        const sprite = getWorkSprite(item.id, media ? 'stage' : 'wall');
        if (sprite?.width > 0 && sprite.height > 0) return drawWorkPocket(item, sprite, effect);
        if (effect) effect.artBounds = null;
      }
      if (directMode) polygon([[a+4,floor-29],[a+7,floor-33],[b-6,floor-32],[b-2,floor-22],[b-2,floor-2],[b-8,floor+3],[a+3,floor+2],[a+1,floor-17]], backs[biomeAt(floor)]);
      else polygon([[a+7,floor-34],[b-8,floor-34],[b-3,floor-25],[b,floor-6],[b-6,floor+2],[a+3,floor+1],[a,floor-18]], backs[biomeAt(floor)]);
      rect(a + 5, floor - 20, 30, 20, shade);
      const pop = effect?.direct ? clamp((effect.age - 135) / 500, 0, 1) : 0;
      const arc = 4 * pop * (1 - pop);
      const settle = effect?.direct ? -Math.round(arc * 12) : effect && !reduced ? -Math.round(Math.sin(Math.min(1, effect.age / 650) * Math.PI) * 4) : 0;
      const y = floor + settle, assembled = !effect || effect.age >= 350 || reduced;
      if (item.kind === 'work-finding') {
        const px = x - Math.sign(x) * Math.round(arc * 5);
        if (effect?.direct && effect.age < 135) return;
        if (outputArt && typeof outputArt.draw === 'function') outputArt.draw(ctx, px, y, item.visualType, item.variant);
        else {
          polygon([[px-9,y-9],[px-5,y-15],[px+6,y-16],[px+11,y-10],[px+8,y-3],[px-5,y-2]],palette.steel);
          polygon([[px-6,y-11],[px-3,y-14],[px+5,y-14],[px+7,y-11]],palette.shine);
          rect(px-2,y-6,5,2,palette.deep);
        }
      }
      else if (expedition && typeof expedition.drawRelic === 'function') expedition.drawRelic(ctx, x, y, item.recipeId, item.variant, 0, assembled);
      else if (expedition && typeof expedition.drawArtifact === 'function') smallSprite('artifact:' + signature(item) + assembled, 56, 64, (c, a, b) => expedition.drawArtifact(c, a, b, item.recipeId, item.variant, 0, assembled), x, y);
      else art.drawCrystal(ctx, x, y - 2, item.visualKind || item.kind, 0);
      // A foreground lip leaves the object seated in the wall rather than on a stage.
      const bed = BIOMES[biomeAt(floor)], material = directMode ? (geology?.palette[bed + 'Mid'] || palette.earth) : palette.earth;
      rect(a + 2, floor - 1, 9, 3, material); rect(b - 9, floor - 3, 8, 5, directMode ? backs[biomeAt(floor)] : palette.earthShadow);
      rect(a + 4, floor + 2, 31, 2, directMode ? (geology?.palette[bed + 'Light'] || palette.earthLight) : palette.earthLight);
      if (directMode) { rect(a + 6, floor + 5, 4, 1, backs[biomeAt(floor)]); rect(b - 8, floor + 4, 3, 2, material); }
      if(directMode)window.GalleryArt?.draw(ctx,item,depth,opts.gallery);
    }
    function layerMarkers(top, bottom) {
      // These are recorded daily amounts and a source-contribution scale, never
      // spendable fuel or additional progress. The marker stays at its world depth.
      const visible = indexedRange(layers, Math.max(0, (top - SURFACE - 56) / PIXELS_PER_METER), Math.min(depth, (bottom - SURFACE) / PIXELS_PER_METER), 'depthStart');
      for (const layer of visible.slice(-64)) {
        if (layer.depthStart > depth + EPSILON || layer.depthEnd <= layer.depthStart) continue;
        const y = Math.round(tipAt(layer.depthStart) + 8);
        if (y + 46 < top || y > bottom) continue;
        if (directMode) {
          const x = -wallAt(y) + 4; rect(x, y + 8, 8, 1, palette.steel);
          ctx.font = '6px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = palette.shine;
          ctx.fillText(layer.date, x + 11, y + 5); continue;
        }
        if (chambers.length) {
          const x = -wallAt(y) + 2;
          rect(x, y, 24, 8, palette.woodShadow);
          ctx.font = '6px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = palette.shine;
          ctx.fillText(layer.date.slice(5).replace('-', '.'), x + 12, y + 1);
          continue;
        }
        const x = (hash(layer.date) % 2 ? -1 : 1) * 69 - 21;
        rect(x - 3, y - 4, 48, 44, shade);
        rect(x, y, 42, 10, palette.woodShadow); rect(x + 1, y + 1, 40, 1, palette.woodLight);
        ctx.font = 'bold 7px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = palette.shine;
        ctx.fillText(layer.date.slice(5).replace('-', '.'), x + 21, y + 2);
        rect(x + 3, y + 12, 7, 2, palette.steel); rect(x + 1, y + 14, 11, 16, palette.steel); rect(x + 3, y + 16, 7, 12, palette.deep);
        if (layer.tokens !== null && layer.tokens > 0) { rect(x + 3, y + 19, 7, 9, palette.tealLight || palette.shine); rect(x + 4, y + 19, 2, 9, palette.shine); }
        const amount = layer.tokens === null ? '—' : layer.tokens >= 1000000 ? (layer.tokens / 1000000).toFixed(1).replace('.0', '') + 'm' : layer.tokens >= 1000 ? (layer.tokens / 1000).toFixed(1).replace('.0', '') + 'k' : String(Math.floor(layer.tokens));
        ctx.textAlign = 'left'; ctx.fillStyle = palette.shine; ctx.fillText(amount, x + 16, y + 20);
        const extent = layer.usageDepth + layer.evidenceDepth, total = layer.depthEnd - layer.depthStart;
        const usageWidth = extent > 0 ? Math.round(42 * layer.usageDepth / extent) : 0;
        rect(x, y + 34, 42, 4, palette.deep);
        rect(x, y + 34, usageWidth, 3, palette.tealLight || palette.steel); rect(x + usageWidth, y + 34, 42 - usageWidth, 3, palette.woodLight);
        const marker = Math.round(41 * clamp((depth - layer.depthStart) / total, 0, 1));
        rect(x + marker, y + 33, 1, 6, palette.shine);
      }
    }
    function drawRockBreak(effect) {
      const x = effect.x, y = effect.y - 16, t = effect.age;
      const bed = BIOMES[biomeAt(y)], gp = geology?.palette || {};
      const outer = gp[bed+'Shadow'] || backs[biomeAt(y)], stone = gp[bed+'Mid'] || palette.earth;
      const edge = gp[bed+'Light'] || palette.earthLight;
      const burst = clamp((t - 120) / 555, 0, 1);
      // Two fitted, irregular plates cover the artwork at contact. Their
      // shared fault opens before the plates fly off on separate trajectories.
      const fault = [[1,-18],[-3,-10],[1,-6],[-4,1],[2,7],[-1,17]];
      const plates = [
        [[-17,-12],[-14,-17],...fault,[-11,16],[-15,13],[-20,13],[-21,6],[-18,1],[-20,-5]],
        [[13,-14],[18,-12],[20,-5],[17,1],[20,7],[16,13],[10,15],...fault.slice().reverse()]
      ];
      if (burst < .88) {
        for (let i=0; i<2; i++) {
          const sign = i ? 1 : -1, travel = Math.round(burst * (i ? 26 : 21));
          const dx = x + sign * travel, dy = y + Math.round(-30 * burst + 42 * burst * burst);
          const shrink = 1 - burst * .8;
          ctx.save(); ctx.globalAlpha = 1 - burst * burst;
          const shape = plates[i].map(([a,b]) => [dx+a*shrink, dy+b*shrink]);
          polygon(shape, stone);
          const ledge = i ? [[3,-12],[11,-13],[16,-10],[13,-8],[6,-9]]
            : [[-17,-7],[-12,-12],[-6,-13],[-9,-8],[-14,-6]];
          polygon(ledge.map(([a,b])=>[dx+a*shrink,dy+b*shrink]),edge);
          const seam = i ? [[3,6],[12,5],[17,2],[14,7],[6,9]]
            : [[-18,7],[-14,7],[-9,3],[-5,3],[-8,7],[-15,10]];
          polygon(seam.map(([a,b])=>[dx+a*shrink,dy+b*shrink]),outer);
          ctx.restore();
        }
        if (t <= 190) {
          // The dark fault grows across the plate in three short segments.
          const segments = Math.min(fault.length-1, 1+Math.floor(t/24));
          for (let i=0; i<segments; i++) {
            const [a,b] = fault[i], [c,d] = fault[i+1];
            polygon([[x+a,y+b],[x+a+2,y+b],[x+c+1,y+d],[x+c-1,y+d]], outer);
          }
        }
      }
      if (!burst || burst >= 1) return;
      ctx.save();ctx.globalAlpha = 1 - burst * burst;
      const seed = hash(effect.id);
      for (let i=0; i<14; i++) {
        const n = (seed % 73 + i*19) % 73, sign = i%2 ? 1 : -1;
        const xx = Math.round(x + sign*(4 + (9+n*.45)*burst));
        const yy = Math.round(y - 9 + i%5*4 - (17+n*.34)*burst + (35+n*.2)*burst*burst);
        const size = 2+n%4;
        rect(xx, yy, size, size-1, i%4 ? stone : edge);
        rect(xx+1, yy-1, size-1, 1, edge);
      }
      ctx.restore();
    }
    function feedback() {
      for (const effect of effects) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        if (effect.type === 'collect') {
          const destination = rigAt(depth) + 8;
          const color = effect.kind === 'asset' ? (palette.violetLight || palette.shine) : effect.kind === 'document' ? (palette.amberLight || palette.shine) : (palette.emeraldLight || palette.shine);
          for (let i = 0; i < 5; i++) {
            const t = clamp((progress - i * .065) / .72, 0, 1), inverse = 1 - t;
            if (t === 1) continue;
            const x = inverse * inverse * effect.x + 2 * inverse * t * (effect.x * .6 + (effect.x < 0 ? -20 : 20));
            const y = inverse * inverse * effect.y + 2 * inverse * t * (effect.y - 31 - i * 3) + t * t * destination;
            rect(x + (i % 2), y, i < 2 ? 3 : 2, i < 2 ? 3 : 2, color);
          }
          if (progress < .3) for (let i = 0; i < 6; i++) rect(effect.x + Math.cos(i * 1.05) * progress * 50, effect.y + Math.sin(i * 1.05) * progress * 35, 2, 2, palette.earthLight);
          if (progress > .65 && progress < .9) { rect(-17, destination - 2, 4, 1, color); rect(13, destination - 2, 4, 1, color); }
        } else if (effect.type === 'assembly') {
          if (effect.direct) {
            const box=effect.artBounds;
            if (box) {
              ctx.save();
              ctx.translate(effect.x,(box.top+box.bottom)/2);
              ctx.scale(Math.max(.4,(box.right-box.left)/38),Math.max(.4,(box.bottom-box.top)/32));
              ctx.translate(-effect.x,16-effect.y);
            }
            drawRockBreak(effect);
            if (box) ctx.restore();
            continue;
          }
          if (progress < .5) for (let i = 0; i < 8; i++) {
            const side = i % 2 ? -1 : 1, x = effect.x + side * (9 + progress * 34 + i % 3);
            const y = effect.y - 12 - i % 4 * 4 + progress * progress * 90;
            rect(x, y, 2 + i % 2, 2, i % 3 ? palette.earthLight : palette.shine);
          }
          if (progress > .3 && progress < .65) rect(effect.x - 2, effect.y - 29, 4, 1, palette.shine);
        } else if (effect.type === 'stratum' && progress < .9) {
          const span = 24 + progress * 160; rect(-span, effect.y - 2, span * 2, 1, palette.shine); rect(-span * .7, effect.y + 2, span * 1.4, 1, palette.steel);
        }
      }
    }
    function room(node) {
      const floor = node.floor, a = node.x - 15, b = node.x + 15;
      polygon([[a+7,floor-25],[b-5,floor-25],[b,floor-16],[b-3,floor+2],[a+3,floor+3],[a,floor-15]], backs[biomeAt(floor)]);
      rect(a + 5, floor - 13, 20, 14, shade);
      rect(a, floor + 1, 10, 3, palette.earth); rect(b - 8, floor - 1, 8, 4, palette.earthShadow);
    }
    function syncControls() {
      const key = hits.map(node => `${node.key}:${node.title}`).join('|');
      if (key === controlsKey) return;
      controlsKey = key;
      const existing = new Map(Array.from(accessible.children).map(button => [button.dataset.hitKey, button]));
      hits.forEach((node, index) => {
        let button = existing.get(node.key);
        if (!button) {
          const id = node.key; button = document.createElement('button'); button.type = 'button'; button.dataset.discoveryId = node.id; button.dataset.hitKey = id;
          button.addEventListener('focus', () => { selected = id; hovered = null; draw(); });
          button.addEventListener('blur', () => { selected = null; draw(); });
          button.addEventListener('click', () => openNode(id)); button.addEventListener('keydown', onKey);
        }
        button.textContent = `${node.title} · ${labels().source}`;
        if (accessible.children[index] !== button) accessible.insertBefore(button, accessible.children[index] || null);
        existing.delete(node.key);
      });
      existing.forEach(button => button.remove());
      if (selected && !hits.some(node => node.key === selected)) selected = null;
    }
    function tooltip() {
      if (typeof opts.onHover === 'function') return;
      const node = hits.find(item => item.key === (hovered || selected));
      if (!node) return;
      const title = Array.from(node.title).slice(0, width < 600 ? 15 : 25).join('');
      ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const w = Math.min(width - 24, Math.max(112, ctx.measureText(title).width + 22));
      const x = clamp(node.screenX - w / 2, 12, width - w - 12), y = clamp(node.screenY - 55, 14, height - 42);
      ctx.fillStyle = palette.woodLight; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), 31);
      ctx.fillStyle = shade; ctx.fillRect(Math.round(x + 2), Math.round(y + 2), Math.round(w - 4), 27);
      ctx.fillStyle = palette.shine; ctx.fillText(title, x + 11, y + 15, w - 22);
    }
    function findingLabels() {
      const origin = cameraMode === 'inspect' ? height / 2 : (rigAt(depth) - Math.floor(cameraY)) * scale;
      const nearest = hits.filter(item => item.kind === 'work-finding').sort((a, b) => Math.abs(a.screenY - origin) - Math.abs(b.screenY - origin));
      const placed = [], limit = width < 700 ? 2 : 3;
      ctx.save(); ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const item of nearest) {
        if (placed.length >= limit) break;
        if (effects.some(effect => effect.direct && effect.id === item.id && effect.age < 500)) continue;
        const chars = Array.from(item.name), maximum = width < 700 ? 8 : 12;
        const title = chars.slice(0, maximum).join('') + (chars.length > maximum ? '…' : '');
        const w = Math.min(width < 700 ? 108 : 154, Math.max(46, ctx.measureText(title).width + 12));
        const x = clamp(item.screenX - w / 2, 8, width - w - 8), y = item.screenY + (item.hitHeight ? item.hitHeight/2 + 2*scale : 17*scale) + 3;
        const bounds = { left: x, right: x + w, top: y, bottom: y + 19 };
        const targets = hits.filter(other => other.id !== item.id).map(other => {
          const w = other.hitWidth || (other.type === 'artifact' ? 34 : 24) * scale, h = other.hitHeight || 34 * scale;
          return { left: other.screenX - w / 2, right: other.screenX + w / 2, top: other.screenY - h / 2, bottom: other.screenY + h / 2 };
        });
        if (y < 8 || y + 19 > height - 8 || [...occluders, ...placed, ...targets].some(other => bounds.left < other.right && bounds.right > other.left && bounds.top < other.bottom && bounds.bottom > other.top)) continue;
        if (!directMode) { ctx.fillStyle = shade; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), 19); }
        else { ctx.shadowColor='#06151e';ctx.shadowBlur=3;ctx.shadowOffsetY=1; }
        ctx.fillStyle = directMode ? '#edf1e9' : palette.shine;
        ctx.fillText(title, Math.round((x+w/2)*ratio)/ratio, Math.round((y+10)*ratio)/ratio, w-8);
        placed.push(bounds);
      }
      ctx.restore();
    }
    function draw() {
      if (!drawable()) return;
      const top = Math.floor(cameraY), bottom = top + height / scale;
      const moving = working(), impulse = !directMode || Math.floor(animationTime / (boostRemaining > 0 ? 40 : 75)) % 5 < 2;
      const shake = moving && impulse && cameraMode === 'follow' ? (boostRemaining > 0 ? 2 : 1) : 0;
      drawShake = { x: shake ? Math.round(Math.sin(animationTime * .067) * shake) : 0, y: shake ? Math.round(Math.cos(animationTime * .097) * shake) : 0 };
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = shade; ctx.fillRect(0, 0, width, height);
      ctx.save(); ctx.translate(Math.round(width / 2) + drawShake.x, drawShake.y); ctx.scale(scale, scale); ctx.translate(0, -top);
      const terrainView = { top, bottom, halfWidth: width / (2 * scale), biomeAt, wallAt, frontier: tipAt(depth), cameraY: top, time: animationTime, reduced };
      if (directMode) detailedTerrain(top, bottom); else if (geology) geology.drawTerrain(ctx, terrainView); else terrain(top, bottom);
      const depthStructures = directMode && geology?.drawDepthStructures ? geology.drawDepthStructures(ctx, terrainView) : [];
      const supports = shaftSupports(top, bottom);
      environments(top, bottom); shaft(top, bottom, supports, depthStructures); if (directMode) { wallEcology(top, bottom); geology?.drawInfrastructure?.(ctx, terrainView); }
      const displayedArtifacts = artifactLayout(top, bottom), stations = stationLayout(top, bottom, displayedArtifacts);
      if (life && typeof life.drawAmbient === 'function' && reachedTracks().some(item => item.id === 'garden')) life.drawAmbient(ctx, { ...terrainView, avoid: stations.map(item => ({ left: item.x - item.radius, right: item.x + item.radius, top: item.y - item.h, bottom: item.y })) });
      const shown = candidates(top, bottom).map(node => ({ ...node, x: placedX(node.x, node.y, 11) })), pockets = new Set();
      for (const node of shown) if (node.depth <= depth + EPSILON) { const key = `${node.floor}:${Math.sign(node.x)}`; if (!pockets.has(key)) { room(node); pockets.add(key); } }
      hits = [];
      const visibleChambers = chamberLayout(top, bottom);
      visibleChambers.forEach(drawChamber);
      for (const node of shown) {
        if (node.depth > depth + EPSILON) {
          if (expedition && typeof expedition.drawVein === 'function') {
            const approach = clamp(1 - (node.depth - depth) / 8, 0, 1), exposure = 7 + Math.round(approach * 17);
            ctx.save(); ctx.beginPath(); ctx.rect(node.veinX - 17, node.y - 24, 34, exposure); ctx.clip();
            expedition.drawVein(ctx, node.veinX, node.y, node.kind, 1 + node.slot % 3, false, 0); ctx.restore();
            if (approach > .65) {
              polygon([[node.veinX-10,node.y-15],[node.veinX-3,node.y-12],[node.veinX-6,node.y-7],[node.veinX+5,node.y-3],[node.veinX-3,node.y-9],[node.veinX-1,node.y-13]], shade);
            }
          }
          continue;
        }
        art.drawCrystal(ctx, node.x, node.y, node.kind, Math.floor(animationTime / 350));
        const key = 'mineral:' + node.id;
        const focused = selected === key || hovered === key;
        if (focused) {
          rect(node.x - 11, node.y - 21, 5, 1, palette.shine); rect(node.x - 11, node.y - 21, 1, 5, palette.shine);
          rect(node.x + 7, node.y - 21, 5, 1, palette.shine); rect(node.x + 11, node.y - 21, 1, 5, palette.shine);
          rect(node.x - 11, node.y + 3, 5, 1, palette.shine); rect(node.x + 7, node.y + 3, 5, 1, palette.shine);
        }
        const screenX = Math.round(width / 2) + node.x * scale + drawShake.x, screenY = (node.y - 8 - top) * scale + drawShake.y;
        if (screenX > -12 && screenX < width + 12 && screenY > 0 && screenY < height) hits.push({ ...node, key, type: 'mineral', screenX, screenY });
      }
      for (const item of displayedArtifacts.filter(item => item.y >= top - 8 && item.y - (item.artHeight || 34) <= bottom + 8).slice(-16)) {
        const artBox = workshop(item);
        // The world pixels recoil on impact. Keep the reading and pointer
        // anchors in camera coordinates so an edge never oscillates under a
        // resting pointer or in and out of a HUD collision.
        const key = 'artifact:' + item.id, screenX = Math.round(width / 2) + item.x * scale;
        const centerY = artBox ? (artBox.top+artBox.bottom)/2 : item.y-15;
        const screenY = (centerY - top) * scale;
        if (selected === key || hovered === key) {
          const a=artBox?.left ?? item.x-17, b=artBox?.right ?? item.x+17, y=artBox ? artBox.top-3 : item.y-32;
          rect(a,y,5,1,palette.shine); rect(b-5,y,5,1,palette.shine);
        }
        const hitWidth = artBox ? Math.max(24,(artBox.right-artBox.left)*scale) : 0, hitHeight = artBox ? Math.max(24,(artBox.bottom-artBox.top)*scale) : 0;
        if (screenX > -16-hitWidth/2 && screenX < width+16+hitWidth/2 && screenY > -hitHeight/2 && screenY < height+hitHeight/2) {
          hits.push({ ...item, title: item.name, key, type: 'artifact', screenX, screenY, hitRadius: 18 * scale, hitWidth, hitHeight, artBox });
        }
      }
      layerMarkers(top, bottom);
      drawLife(top, bottom, stations);
      if (!lighting || !lightingEnabled) contactLight(); excavationFace();
      const recoil = moving ? (directMode ? [-2, -1, 1, 0, 0][Math.floor(animationTime / (boostRemaining > 0 ? 40 : 75)) % 5] : (Math.floor(animationTime / (boostRemaining > 0 ? 40 : 75)) % 4 === 0 ? -2 : 0)) : 0;
      (directMode && art.drawRigHeavy ? art.drawRigHeavy : art.drawRig)(ctx, 0, Math.round(rigAt(depth)) + recoil, Math.floor(animationTime / 105), moving);
      feedback(); drawDebris();
      if (geology) geology.drawForeground(ctx, terrainView);
      ctx.restore();
      if (lighting) {
        const lights = [
          { x: 0, y: rigAt(depth) - 15, radius: directMode ? 46 : 58, color: [255, 218, 153], strength: directMode ? .95 : 1.1, kind: 'lamp' },
          { x: 0, y: tipAt(depth) - 15, radius: directMode ? (boostRemaining > 0 ? 80 : 64) : (boostRemaining > 0 ? 96 : 76), color: [255, 206, 123], strength: directMode ? (boostRemaining > 0 ? 1.4 : 1.1) : (boostRemaining > 0 ? 1.6 : 1.3), kind: 'headlamp', direction: Math.PI / 2 }
        ];
        if (directMode) lights.push({ x: 0, y: tipAt(depth) - 2, radius: 25, color: [255, 191, 86], strength: moving ? 1.25 : .7, kind: 'headlamp', direction: Math.PI / 2 });
        for (const chamber of visibleChambers) {
          lights.push({ x: chamber.x, y: chamber.y - chamber.h * .48, radius: chamber.w * .58, color: chamber.theme === 'energy' ? [110, 231, 209] : chamber.theme === 'studio' ? [191, 180, 255] : [255, 216, 145], strength: 1.12, kind: 'room' });
        }
        for (const { y, lampX } of supports) {
          if (lampX !== null) lights.push({ x: lampX, y: y + 16, radius: 52, color: [255, 190, 101], strength: 1.05, kind: 'lamp' });
        }
        const crystalColors = { code: [92, 255, 173], document: [255, 191, 90], asset: [182, 132, 255], other: [91, 204, 255] };
        for (const node of shown) if (node.depth <= depth + EPSILON) lights.push({ x: node.x, y: node.y - 10, radius: 38, color: crystalColors[node.kind], strength: 1.05, kind: 'crystal' });
        for (const item of hits.filter(hit => hit.type === 'artifact')) {
          const box=item.artBox;
          lights.push({x:item.x, y:box ? (box.top+box.bottom)/2 : item.y-13,
            radius:box ? Math.max(30,Math.max(box.right-box.left,box.bottom-box.top)*.65) : directMode ? 26 : 33,
            color:box?.color || (item.visualType === 'memory' ? [148,216,211] : [255,217,147]),
            strength:box ? .92 : directMode ? .55 : .8, kind:'lamp'});
        }
        for (const item of stations) lights.push({ x: item.x - (item.compact ? 11 : 22), y: item.y - (item.compact ? 18 : 27), radius: item.compact ? 24 : 36, color: [255, 206, 132], strength: .65, kind: 'lamp' });
        for (const structure of depthStructures) lights.push(...structure.lights);
        for (const effect of effects) if (effect.direct && effect.age > 90 && effect.age < 650) {
          const flash = clamp((effect.age-90)/90,0,1) * (1-(effect.age-90)/560);
          lights.push({x:effect.x,y:effect.y-14,radius:34,color:[248,204,141],strength:.85*flash,kind:'lamp'});
        }
        const openings = visibleChambers.map(room => ({ left: room.x - room.w / 2, right: room.x + room.w / 2, top: room.y - room.h, bottom: room.y }));
        for (const structure of depthStructures) openings.push(structure.opening);
        for (const node of shown) if (node.depth <= depth + EPSILON) openings.push({ left: node.x - 14, right: node.x + 14, top: node.y - 26, bottom: node.y + 4 });
        for (const item of hits.filter(hit => hit.type === 'artifact')) openings.push(item.artBox || { left: item.x - 19, right: item.x + 19, top: item.y - 35, bottom: item.y + 4 });
        for (const item of stations) openings.push({ left: item.x - item.radius, right: item.x + item.radius, top: item.y - item.h, bottom: item.y + 3 });
        lighting.render(ctx, { width, height, scale, cameraY: top, frontier: tipAt(depth), wallAt, biomeAt, lights, rooms: openings, time: animationTime, reduced, enabled: lightingEnabled });
      }
      scanOverlay(); findingLabels(); tooltip(); syncControls(); publishHover();
    }
    function tick(now) {
      frame = 0;
      if (!needsFrames()) return;
      if (lastTick !== null && now - lastTick < FRAME_MS - .01) { frame = requestAnimationFrame(tick); return; }
      // Depth uses foreground seconds, not a capped frame delta. Only physics
      // uses a capped step; stop() discards hidden/paused wall time.
      const elapsed = lastTick === null ? 0 : Math.max(0, (now - lastTick) / 1000); lastTick = now;
      const physicsElapsed = Math.min(elapsed, .1);
      const previousScan = scanRemaining, previousCooldown = scanCooldown;
      scanRemaining = Math.max(0, scanRemaining - elapsed); scanCooldown = Math.max(0, scanCooldown - elapsed);
      if (reduced) {
        if (previousScan > 0 && scanRemaining === 0) draw();
        if (now - scanTelemetryAt >= 1000 || (previousCooldown > 0 && scanCooldown === 0)) { scanTelemetryAt = now; emit(true); }
        start(); return;
      }
      if (playback && playback.pendingStart) beginReplay();
      effects.forEach(effect => { effect.age += elapsed * 1000; }); effects = effects.filter(effect => effect.age < effect.life);
      flushReassemblies();
      const wasTravelling = hasTravel();
      if (wasTravelling) {
        const accelerated = cameraMode === 'follow' ? Math.min(elapsed, boostRemaining) : 0;
        advanceTo(Math.min(travelTarget(), depth + (elapsed + accelerated * (BOOST_MULTIPLIER - 1)) * travelSpeed()));
        animationTime += elapsed * 1000;
      }
      boostRemaining = Math.max(0, boostRemaining - elapsed); boostCooldown = Math.max(0, boostCooldown - elapsed);
      advanceDebris(physicsElapsed, wasTravelling);
      if (cameraMode === 'follow') {
        const wanted = wantedCamera();
        cameraY = Math.max(cameraY, cameraY + (wanted - cameraY) * (1 - Math.exp(-elapsed * 9)));
        if (wanted - cameraY < .04) cameraY = wanted;
      }
      const arrived = wasTravelling && depth + EPSILON >= travelTarget();
      if (arrived) { depth = travelTarget(); boostRemaining = 0; if (playback) resolveReplay(); if (depth + EPSILON >= observedTarget) boostCooldown = 0; }
      draw(); emit(arrived || (wasTravelling && discoveryHold) || !needsFrames()); start();
    }
    function resize() {
      if (destroyed) return;
      const bounds = canvas.getBoundingClientRect(); hasSize = bounds.width > 0 && bounds.height > 0;
      if (!hasSize) { stop(); emit(true); return; }
      const center = cameraY + height / (2 * scale);
      width = bounds.width; height = bounds.height; scale = pixelScale(preferredZoom); invalidateLayout();
      refreshOcclusion();
      ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2.5, Math.sqrt(8400000 / (width * height))));
      const w = Math.round(width * ratio), h = Math.round(height * ratio);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      cameraY = cameraMode === 'follow' ? wantedCamera() : center - height / (2 * scale); clampCamera();
      draw(); emit(true); start();
    }
    function normalizeNodes(input) {
      const used = new Set();
      const result = input.slice(0, MAX_NODES).filter(node => {
        if (!node || node.id == null || !Number.isFinite(Number(node.depth)) || Number(node.depth) < 0) return false;
        const id = String(node.id); if (!id || used.has(id)) return false; used.add(id); return true;
      }).map(node => ({ id: String(node.id), title: String(node.title || '矿样来源').slice(0, 200), kind: kindOf(node.kind), depth: depthOf(node.depth) })).sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
      let previous = null, groupIndex = 0;
      for (const node of result) {
        const key = node.depth.toFixed(4); if (key !== previous) { previous = key; groupIndex = 0; }
        const slot = groupIndex % 4; node.slot = slot; node.x = (slot % 2 ? 1 : -1) * (slot < 2 ? 54 : 72); node.veinX = (slot % 2 ? 1 : -1) * (slot < 2 ? 18 : 32);
        node.floor = Math.round(tipAt(node.depth) - 4); node.y = node.floor - 1; node.renderable = groupIndex < 4; groupIndex++;
      }
      return result;
    }
    function normalizeArtifacts(input) {
      const ids = new Set(), findingDays = new Map(); let findingCount = 0;
      return input.slice(0, directMode ? 120000 : 512).filter(item => { if (!item || !item.id || item.depth == null || !Number.isFinite(Number(item.depth)) || Number(item.depth) < 0 || ids.has(String(item.id))) return false; ids.add(String(item.id)); return true; }).map(item => {
        const value = { id: String(item.id), date: String(item.date || ''), depth: depthOf(item.depth), recipeId: String(item.recipeId || 'survey'), name: String(item.name || '每日工坊产物').slice(0, 160), description: String(item.description || '').slice(0, 600), kindMask: clamp(Math.floor(finite(item.kindMask)), 0, 15), variant: clamp(Math.floor(finite(item.variant)), 0, 65535), evidenceIds: Object.freeze(Array.isArray(item.evidenceIds) ? item.evidenceIds.slice(0, 1024).map(String) : []) };
        value.visualKind = value.kindMask & 4 ? 'asset' : value.kindMask & 2 ? 'document' : value.kindMask & 1 ? 'code' : 'other';
        value.kind = item.kind === 'work-finding' ? 'work-finding' : value.visualKind;
        value.source = String(item.source || '').slice(0, 80);
        value.sourceLabel = String(item.sourceLabel || '').slice(0, 120); value.method = String(item.method || '').slice(0, 120);
        value.path = typeof item.path === 'string' ? item.path.slice(0, 4096) : null;
        for (const key of ['paths', 'memoryIds', 'outputIds', 'sourceIds']) value[key] = Object.freeze(Array.isArray(item[key]) ? item[key].slice(0, key === 'paths' ? 2048 : 128).filter(part => typeof part === 'string').map(part => part.slice(0, key === 'paths' ? 4096 : 400)) : []);
        value.visualType = OUTPUT_TYPES.includes(item.visualType) ? item.visualType : 'file';
        value.x = (hash(value.date || value.id) % 2 ? 1 : -1) * 64; value.y = Math.round(tipAt(value.depth) - 3); return value;
      }).sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id)).filter(item => {
        if (item.kind !== 'work-finding') return true;
        const count = findingDays.get(item.date) || 0;
        if (count >= (directMode ? 12 : 6) || findingCount >= (directMode ? 120000 : 84)) return false;
        findingDays.set(item.date, count + 1); findingCount++; return true;
      });
    }
    function normalizeRooms(input) {
      const used = new Set(), themes = ['energy', 'workshop', 'archive', 'studio', 'observatory', 'audio', 'garden', 'gate'];
      return input.slice(0, 128).filter(item => {
        if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 240 || item.depth == null || !Number.isFinite(Number(item.depth)) || Number(item.depth) < 0 || used.has(item.id)) return false;
        if (!['left', 'right'].includes(item.side) || !['usage', 'work', 'files'].includes(item.kind) || !themes.includes(item.theme)) return false;
        used.add(item.id); return true;
      }).map(item => ({ id: item.id, date: String(item.date || '').slice(0, 10), depth: depthOf(item.depth), y: Math.round(tipAt(depthOf(item.depth)) - 3),
        side: item.side, sign: item.side === 'left' ? -1 : 1, kind: item.kind, theme: item.theme, name: String(item.name || '工作侧洞').slice(0, 120), description: String(item.description || '').slice(0, 800),
        level: clamp(Math.floor(finite(item.level)), 0, 3), variant: clamp(Math.floor(finite(item.variant)), 0, 2)
      })).sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
    }
    function normalizeTracks(input) {
      const used = new Set();
      return input.slice(0, 16).filter(item => {
        if (!item || !['relay', 'sorter', 'garden'].includes(item.id) || item.unlocked !== true || typeof item.depth !== 'number' || !Number.isFinite(item.depth) || item.depth < 0 || used.has(item.id)) return false;
        used.add(item.id); return true;
      }).map(item => ({ id: item.id, unlocked: true, depth: depthOf(item.depth) }));
    }
    function normalizeLayers(input) {
      return input.slice(0, 36500).filter(item => item && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && Number.isFinite(Number(item.depthStart)) && Number.isFinite(Number(item.depthEnd))).map(item => ({
        date: item.date, depthStart: depthOf(item.depthStart), depthEnd: Math.max(depthOf(item.depthStart), depthOf(item.depthEnd)),
        artifactId: item.artifactId == null ? null : String(item.artifactId), tokens: item.tokens == null || !Number.isFinite(Number(item.tokens)) ? null : Math.max(0, finite(item.tokens)),
        usageDepth: depthOf(item.usageDepth), evidenceDepth: depthOf(item.evidenceDepth)
      })).sort((a, b) => a.depthStart - b.depthStart || a.date.localeCompare(b.date));
    }
    function point(event) { const bounds = canvas.getBoundingClientRect(); return { x: (event.clientX - bounds.left) * width / (bounds.width || 1), y: (event.clientY - bounds.top) * height / (bounds.height || 1) }; }
    function nodeAt(position) {
      let nearest = null, distance = Infinity;
      for (const node of hits) {
        const dx = node.screenX - position.x, dy = node.screenY - position.y, d = dx ** 2 + dy ** 2;
        const inside = node.hitWidth ? Math.abs(dx) < node.hitWidth / 2 && Math.abs(dy) < node.hitHeight / 2 : d < (node.hitRadius || 28) ** 2;
        if (inside && d < distance) { distance = d; nearest = node; }
      }
      return nearest;
    }
    function openNode(key) {
      if (discoveryHold) return;
      const item = hits.find(node => node.key === key); if (!item || !drawable()) return;
      if (item.type === 'room' && (!chambers.some(room => room.id === item.id) || item.depth > Math.min(depth, observedTarget) + EPSILON)) return;
      if (item.kind === 'work-finding' && typeof opts.onInspect === 'function') {
        opts.onInspect(sourcePayload(item)); return;
      }
      const callback = item.type === 'room' ? opts.onRoom : item.type === 'artifact' ? opts.onArtifact : opts.onDiscovery;
      if (typeof callback === 'function') callback(item.id);
    }
    function rigHit(p) { const y = (p.y - drawShake.y) / scale - (rigAt(depth) - Math.floor(cameraY)); return Math.abs(p.x - width / 2 - drawShake.x) <= (directMode ? 27 : 20) * scale && y >= (directMode ? -44 : -25) && y <= 25; }
    function inspect(next) {
      if (discoveryHold) return;
      if (playback) { if (!directMode) return; resolveReplay(); }
      const before=cameraY;
      cameraMode='inspect'; cameraY=next; clampCamera();
      const moved=Math.abs(cameraY-before)>.01;
      hovered=null; hoverPoint=null; selected=null; draw(); emit(true); start();
      return moved;
    }
    function setView(value) {
      if (destroyed || !value || typeof value !== 'object') return false;
      if (Number.isFinite(value.cameraY)) inspect(value.cameraY);
      else if (Number.isFinite(value.depth)) inspect(tipAt(clamp(value.depth, 0, depth)) - height / (2 * scale));
      else return false;
      return true;
    }
    function jumpToDate(date) {
      const layer = layers.find(item => item.date === date);
      if (destroyed || !layer || layer.depthStart > depth + EPSILON) return false;
      return setView({ depth: (layer.depthStart + Math.min(depth, layer.depthEnd)) / 2 });
    }
    function setZoom(value) {
      if (destroyed || !Number.isFinite(value)) return scale / baseScale();
      const center = cameraY + height / (2 * scale);
      preferredZoom = clamp(value, .6, 1.6);
      scale = pixelScale(preferredZoom); invalidateLayout();
      cameraY = cameraMode === 'follow' ? wantedCamera() : center - height / (2 * scale); clampCamera();
      hovered = null; hoverPoint = null; draw(); emit(true); start(); return scale / baseScale();
    }
    function stepZoom(direction) {
      return setZoom((scale + Math.sign(direction)) / baseScale());
    }
    function onDown(event) {
      if (discoveryHold || pointer || event.isPrimary === false || (event.button != null && event.button !== 0)) return;
      const p = point(event); pointer = { id: event.pointerId, x: p.x, y: p.y, camera: cameraY, at: performance.now(), moved: false, target: nodeAt(p)?.key || null, rig: rigHit(p) };
      const edit=opts.gallery?.editing(),hit=nodeAt(p);
      if(edit && hit?.id===edit){pointer.exhibit=edit;pointer.row=opts.gallery.position(edit)?.row||0;}
      hoverPoint = null; hovered = null; publishHover();
      try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
      canvas.focus({ preventScroll: true });
    }
    function onMove(event) {
      if (discoveryHold) return;
      const p = point(event);
      if (pointer && pointer.id === event.pointerId) {
        if (Math.hypot(p.x - pointer.x, p.y - pointer.y) > 6) pointer.moved = true;
        if (pointer.moved && (!playback || directMode)) {
          canvas.style.cursor = 'grabbing';
          if(pointer.exhibit){
            const side=p.x<width/2?-1:1,row=clamp(pointer.row+Math.round((p.y-pointer.y)/(scale*24)),-4,4);
            if(!dragPreview||dragPreview.side!==side||dragPreview.row!==row){dragPreview={id:pointer.exhibit,side,row};invalidateLayout();draw();}
            return;
          }
          inspect(pointer.camera - (p.y - pointer.y) / scale);
        }
      } else if (event.pointerType !== 'touch') { hoverPoint = p; const node = nodeAt(p), id = node ? node.key : null; canvas.style.cursor = node || (rigHit(p) && boostReady()) ? 'pointer' : 'grab'; if (id !== hovered) { hovered = id; draw(); } else publishHover(); }
    }
    function release(event, cancelled) {
      if (!pointer || pointer.id !== event.pointerId) return;
      const previous = pointer; pointer = null; try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
      canvas.style.cursor = 'grab';
      if(previous.exhibit){
        const target=dragPreview;dragPreview=null;invalidateLayout();draw();
        if(!cancelled&&target)void opts.gallery.move(target.side,target.row);
        return;
      }
      if (!cancelled && !previous.moved && performance.now() - previous.at < 750) {
        const p = point(event), node = nodeAt(p);
        if (node && node.key === previous.target) { selected = node.key; hovered = null; draw(); openNode(node.key); }
        else if (!previous.target && !node && previous.rig && rigHit(p)) boost();
      }
    }
    function onUp(event) { release(event, false); }
    function onCancel(event) { release(event, true); }
    function onLeave() { hoverPoint = null; if (!pointer) { hovered = null; canvas.style.cursor = 'grab'; draw(); } publishHover(); }
    function onWheel(event) {
      if ((playback && !directMode) || depth <= 0) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
      event.preventDefault();
      if (delta) inspect(cameraY + delta / scale * .8);
    }
    function follow() { if (destroyed) return; cameraMode = 'follow'; focusedRoom = null; hovered = null; hoverPoint = null; selected = null; cameraY = wantedCamera(); draw(); emit(true); start(); }
    function onKey(event) {
      if (event.key === 'End') { event.preventDefault(); follow(); }
      else if (!playback && ['Home', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) {
        event.preventDefault(); const step = event.key === 'PageUp' || event.key === 'PageDown' ? height * .65 / scale : 32;
        const next=event.key==='Home' ? wantedCamera(0) : cameraY+(event.key==='ArrowUp'||event.key==='PageUp' ? -step : step);
        inspect(next);
      } else if (event.key === 'Escape') { hovered = null; selected = null; draw(); }
      else if (event.target === canvas && selected && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); if (!event.repeat) openNode(selected); }
      else if (event.target === canvas && (event.key === ' ' || event.code === 'Space')) { event.preventDefault(); if (!event.repeat) boost(); }
    }
    function onBlur() { hovered = null; hoverPoint = null; if (!accessible.contains(document.activeElement)) selected = null; draw(); publishHover(); }
    function visibility() {
      stop();
      if (!drawable()) { hovered = null; hoverPoint = null; publishHover(); }
      else {
        if (reduced) { settleReduced(); flushReassemblies(); }
        draw(); start();
      }
      emit(true);
    }
    function onMotion(event) {
      reduced = event.matches; stop();
      if (reduced) {
        if (opts.pauseAtFindings && localRun) pendingReducedReveal = true;
        resolveReplay(); if (!directMode) cameraMode = 'follow';
        effects = []; particles = []; boostRemaining = 0; boostCooldown = 0;
        settleReduced(); flushReassemblies();
      }
      draw(); emit(true); start();
    }
    const handlers = { pointerdown: onDown, pointermove: onMove, pointerup: onUp, pointercancel: onCancel, lostpointercapture: onCancel, pointerleave: onLeave, keydown: onKey, blur: onBlur };
    Object.entries(handlers).forEach(([name, handler]) => canvas.addEventListener(name, handler)); canvas.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('visibilitychange', visibility);
    if (motion) { if (motion.addEventListener) motion.addEventListener('change', onMotion); else if (motion.addListener) motion.addListener(onMotion); }
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (resizeObserver) resizeObserver.observe(canvas); else window.addEventListener('resize', resize);
    const intersectionObserver = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => { if (destroyed || !entries.length) return; intersecting = entries[entries.length - 1].isIntersecting; visibility(); }, { threshold: .01 }) : null;
    if (intersectionObserver) intersectionObserver.observe(canvas);

    const api = Object.freeze({
      setState(next) {
        if (destroyed || !next || typeof next !== 'object') return;
        const nextScope = next.scopeKey == null ? scopeKey : String(next.scopeKey).slice(0, 400);
        const target = next.depth == null ? observedTarget : depthOf(next.depth);
        const scopeChanged = nextScope !== scopeKey;
        const deferRemote = initialized && !scopeChanged && discoveryHold && next.reset === true && next.instant !== true && target >= depth;
        if (deferRemote) deferredFront = Math.max(deferredFront || depth, depthOf(next.startDepth));
        const reset = !initialized || (next.reset === true && !deferRemote) || scopeChanged;
        if (scopeChanged) { discoveryHold = false; localRun = false; deferredFront = null; }
        if (next.discoveryHold === true) discoveryHold = true;
        const retainedView = directMode && !scopeChanged && next.preserveView === true && cameraMode === 'inspect' && next.instant !== true ? cameraY : null;
        const incomingFindings = Array.isArray(next.workFindings) ? next.workFindings : Array.isArray(next.world?.workFindings) ? next.world.workFindings : null;
        if (incomingFindings !== null) directMode = true; else if (scopeChanged) directMode = false;
        if (['zh-CN', 'en', 'ja'].includes(next.locale)) locale = next.locale;
        updateLabels();
        if(scopeChanged || next.instant === true) { hoverPoint = null; hovered = null; }
        refreshOcclusion();
        const previousArtifacts = new Map(artifacts.map(item => [item.id, signature(item)]));
        if (reset) { pendingReducedReveal = false; revealSequence = 0; resolveReplay(); stop(); observedTarget = target; depth = Math.min(target, next.instant ? target : depthOf(next.startDepth ?? 0)); cameraMode = 'follow'; focusedRoom = null; clearScan(); seen = new Set(); replaySeen = new Set(); effects = []; particles = []; particleClock = 0; boostRemaining = 0; boostCooldown = 0; pendingReassemblies = []; }
        else observedTarget = Math.max(observedTarget, target);
        if (next.revealStart === true || (reset && next.discoveryHold === true && next.active)) localRun = true;
        if (reset && reduced && next.discoveryHold === true && next.active) pendingReducedReveal = true;
        if (directMode && reduced && initialized && !reset && !active && next.active === true && next.revealStart === true) pendingReducedReveal = true;
        scopeKey = nextScope; active = next.active == null ? active : Boolean(next.active);
        if (!active) { localRun = false; pendingReducedReveal = false; }
        if (!active && !playback) boostRemaining = 0;
        if (Array.isArray(next.discoveries)) nodes = normalizeNodes(next.discoveries);
        else if (scopeChanged) nodes = [];
        if (Array.isArray(next.artifacts)) artifacts = normalizeArtifacts(next.artifacts);
        else if (scopeChanged) artifacts = [];
        if (incomingFindings !== null) artifacts = normalizeArtifacts(incomingFindings.map(item => item && typeof item === 'object' ? { ...item, kind: 'work-finding' } : item));
        if (directMode) { nodes = []; artifacts = artifacts.filter(item => item.kind === 'work-finding'); }
        if (Array.isArray(next.layers)) layers = normalizeLayers(next.layers);
        else if (Array.isArray(next.world?.days)) layers = normalizeLayers(next.world.days);
        else if (scopeChanged) layers = [];
        if (Array.isArray(next.rooms)) chambers = normalizeRooms(next.rooms);
        else if (scopeChanged) chambers = [];
        if (Array.isArray(next.tracks)) tracks = normalizeTracks(next.tracks);
        else if (scopeChanged) tracks = [];
        if (directMode) { chambers = []; tracks = []; }
        invalidateLayout();
        if (focusedRoom && !chambers.some(item => item.id === focusedRoom && item.depth <= Math.min(depth, observedTarget) + EPSILON)) focusedRoom = null;
        hits = [];
        const currentSignatures = new Set(artifacts.map(signature));
        pendingReassemblies = pendingReassemblies.filter(item => currentSignatures.has(signature(item)));
        const currentMinerals = new Set(nodes.map(node => node.id)), currentArtifacts = new Set(artifacts.map(item => item.id));
        effects = effects.filter(effect => effect.type === 'stratum' || (effect.type === 'collect' ? currentMinerals.has(effect.id) : currentArtifacts.has(effect.id)));
        if (!reset && next.instant !== true) {
          const pendingKeys = new Set(pendingReassemblies.map(signature));
          for (const item of artifacts) {
            const key = signature(item), previous = previousArtifacts.get(item.id);
            if (item.depth <= depth + EPSILON && previous && previous !== key && !seen.has('artifact:' + key) && !pendingKeys.has(key)) {
              if (reduced && !frozen()) reveal('artifact', item, true);
              else { pendingReassemblies.push(item); pendingKeys.add(key); }
            }
          }
        }
        if (next.instant === true) { resolveReplay(); depth = observedTarget; cameraMode = 'follow'; pendingReducedReveal = false; }
        else if (reduced) { resolveReplay(); settleReduced(); }
        if (next.instant === true) { effects = []; particles = []; boostRemaining = 0; boostCooldown = 0; clearScan(); pendingReassemblies = []; }
        pruneScan();
        markReached();
        if (reset || (reduced && cameraMode === 'follow') || next.instant === true) cameraY = wantedCamera(); else if (cameraMode === 'inspect') clampCamera();
        if (retainedView !== null) { cameraMode = 'inspect'; cameraY = retainedView; clampCamera(); }
        initialized = true; if (!nodes.some(node => 'mineral:' + node.id === selected) && !artifacts.some(item => 'artifact:' + item.id === selected) && !chambers.some(item => 'room:' + item.id === selected)) selected = null;
        if (!needsFrames()) stop(); if (!drawable()) syncControls(); draw(); emit(true); start();
      },
      replay(from, to) {
        if (destroyed || discoveryHold) return Promise.resolve();
        resolveReplay(); stop(); const end = Math.min(observedTarget, depthOf(to)), beginning = Math.min(end, depthOf(from));
        if (reduced) { depth = observedTarget; cameraMode = 'follow'; cameraY = wantedCamera(); effects = []; pendingReassemblies = []; markReached(); draw(); emit(true); return Promise.resolve(); }
        if (beginning === end) return Promise.resolve();
        let resolve; const promise = new Promise(done => { resolve = done; });
        playback = { from: beginning, to: end, pendingStart: true, resolve }; cameraMode = 'follow';
        if (!frozen()) beginReplay(); draw(); emit(true); start(); return promise;
      },
      setPaused(value) {
        if (destroyed || paused === Boolean(value)) return;
        paused = Boolean(value); stop();
        if (reduced) { settleReduced(); flushReassemblies(); }
        draw(); emit(true); start();
      },
      setDiscoveryHold(value) {
        if (destroyed || discoveryHold === Boolean(value)) return;
        discoveryHold = Boolean(value); stop();
        // The crossing frame paints after every sibling's rock is in place.
        if (discoveryHold && notifyingFind) return;
        if (!discoveryHold && deferredFront !== null) {
          depth = Math.min(observedTarget, Math.max(depth, deferredFront));
          deferredFront = null; markReached();
          if (cameraMode === 'follow') cameraY = wantedCamera();
        }
        if (!discoveryHold && reduced) settleReduced();
        draw(); emit(true); start();
      },
      setPace(value) { if (destroyed || !Object.hasOwn(PACE_MULTIPLIERS, value)) return false; pace = value; emit(true); start(); return true; },
      boost,
      scan,
      focusRoom,
      focusTrack,
      focusArtifact,
      galleryPosition(id){const placed=directLayout().byId.get(id);return placed?{side:Math.sign(placed.x),row:opts.gallery?.position(id)?.row||0}:null;},
      refreshWorkArt() { if (!destroyed) draw(); },
      returnToDrill: follow,
      follow,
      setView,
      setZoom,
      stepZoom,
      jumpToDate,
      setLighting(value) { lightingEnabled = Boolean(value); draw(); },
      getLightingState() { return { enabled: lightingEnabled, ...(lighting?.getStats() || {}) }; },
      getState: snapshot,
      destroy() {
        if (destroyed) return; destroyed = true; hoverPoint = null; hovered = null; publishHover(); stop(); resolveReplay();
        lighting?.destroy();
        if (resizeObserver) resizeObserver.disconnect(); else window.removeEventListener('resize', resize); if (intersectionObserver) intersectionObserver.disconnect();
        document.removeEventListener('visibilitychange', visibility);
        if (motion) { if (motion.removeEventListener) motion.removeEventListener('change', onMotion); else if (motion.removeListener) motion.removeListener(onMotion); }
        Object.entries(handlers).forEach(([name, handler]) => canvas.removeEventListener(name, handler)); canvas.removeEventListener('wheel', onWheel);
        if (pointer) { try { canvas.releasePointerCapture(pointer.id); } catch (_) {} }
        accessible.remove(); tileCache.clear(); rockCache.clear(); spriteCache.clear(); directCache = null; pointer = null; nodes = []; artifacts = []; chambers = []; tracks = []; focusedRoom = null; clearScan(); layers = []; hits = []; effects = []; particles = []; boostRemaining = 0; boostCooldown = 0; pendingReassemblies = []; seen.clear(); replaySeen.clear();
        canvas.style.imageRendering = original.rendering; canvas.style.touchAction = original.touch; canvas.style.cursor = original.cursor;
        restore(canvas, 'tabindex', original.tabindex); restore(canvas, 'aria-label', original.label); restore(canvas, 'role', original.role);
        if (INSTANCES.get(canvas) === api) INSTANCES.delete(canvas);
      }
    });
    INSTANCES.set(canvas, api); resize(); emit(true); return api;
  }
  window.ExpeditionScene = Object.freeze({ create });
})();
