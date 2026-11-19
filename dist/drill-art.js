(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.DrillArt = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  // Original pixel clusters, authored for one downward-facing drilling machine.
  // Every opaque pixel belongs to this fixed 38-color palette.
  const palette = Object.freeze({
    ink: '#182c3b', deep: '#273d4b', steel: '#6f8a8a', shine: '#fff0bf',
    earthShadow: '#74614f', earth: '#806b56', earthLight: '#8a745c',
    tealShadow: '#3c535a', teal: '#455d63', tealLight: '#4e676c',
    shaleShadow: '#505061', shale: '#5b596b', shaleLight: '#656375',
    bedrockShadow: '#2e4052', bedrock: '#374a59', bedrockLight: '#405462',
    goldShadow: '#74504a', gold: '#c9903f', goldLight: '#efc05f', goldHighlight: '#ffe09a',
    cabDark: '#285d69', cab: '#5da8a6', cabLight: '#a9dac4',
    woodShadow: '#4b3f44', wood: '#846043', woodLight: '#bc925d',
    emeraldShadow: '#247168', emerald: '#42b68b', emeraldLight: '#9ce0ac',
    amberShadow: '#a3693a', amber: '#e6aa4d', amberLight: '#ffe3a3',
    violetShadow: '#625082', violet: '#ab7ac6', violetLight: '#e3b9e1',
    blueShadow: '#325f8e', blue: '#5a9fd0', blueLight: '#a9d7e3'
  });
  const P = palette;
  const biomes = [
    [P.earthShadow, P.earth, P.earthLight],
    [P.tealShadow, P.teal, P.tealLight],
    [P.shaleShadow, P.shale, P.shaleLight],
    [P.bedrockShadow, P.bedrock, P.bedrockLight]
  ];
  const gems = [
    [P.emeraldShadow, P.emerald, P.emeraldLight],
    [P.amberShadow, P.amber, P.amberLight],
    [P.violetShadow, P.violet, P.violetLight],
    [P.blueShadow, P.blue, P.blueLight]
  ];
  const kinds = ['code', 'document', 'asset', 'other'];
  let atlas = null;
  let heavyAtlas = null;
  let heavyAttempted = false;
  let cacheAttempted = false;
  const mod4 = value => ((Math.floor(Number(value) || 0) % 4) + 4) % 4;
  const pixel = value => Math.round(Number(value) || 0);

  function rect(ctx, x, y, width, height, color) {
    if (width <= 0 || height <= 0) return;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
  }

  // Scan-convert even sloping facets into deliberate integer pixel runs. Canvas
  // polygon antialiasing never introduces a hidden fringe or extra palette colors.
  function shape(ctx, points, color, clip) {
    let low = Math.floor(Math.min.apply(null, points.map(p => p[1])));
    let high = Math.ceil(Math.max.apply(null, points.map(p => p[1])));
    if (clip) { low = Math.max(low, clip[1]); high = Math.min(high, clip[3]); }
    for (let y = low; y < high; y++) {
      const scan = y + .5, cuts = [];
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[j], b = points[i];
        if ((a[1] <= scan && b[1] > scan) || (b[1] <= scan && a[1] > scan)) cuts.push(a[0] + (scan - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      cuts.sort((a, b) => a - b);
      for (let i = 0; i + 1 < cuts.length; i += 2) {
        let x = Math.ceil(cuts[i] - .5), end = Math.ceil(cuts[i + 1] - .5);
        if (clip) { x = Math.max(x, clip[0]); end = Math.min(end, clip[2]); }
        rect(ctx, x, y, end - x, 1, color);
      }
    }
  }

  function paintRig(ctx, frame, working) {
    // 36 x 47. The point of the bit is row 46, never a side-mounted tool.
    const f = working ? mod4(frame) : 0;
    shape(ctx, [[2,14],[7,14],[7,16],[9,16],[9,31],[7,31],[7,34],[2,34],[2,32],[0,32],[0,17],[2,17]], P.ink);
    shape(ctx, [[29,14],[34,14],[34,17],[36,17],[36,32],[34,32],[34,34],[29,34],[29,31],[27,31],[27,16],[29,16]], P.ink);
    rect(ctx, 2, 17, 5, 14, P.deep); rect(ctx, 29, 17, 5, 14, P.deep);
    for (let y = 17; y < 31; y++) {
      if ((y + f) % 4 < 2) { rect(ctx, 1, y, 6, 1, P.steel); rect(ctx, 29, y, 6, 1, P.steel); }
    }
    rect(ctx, 2, 15, 4, 2, P.steel); rect(ctx, 30, 15, 4, 2, P.steel);
    rect(ctx, 3, 31, 4, 2, P.steel); rect(ctx, 29, 31, 4, 2, P.steel);
    // Shoulder silhouette, clipped lower armor and cool undersides.
    shape(ctx, [[8,12],[28,12],[28,15],[31,15],[31,25],[28,25],[28,29],[24,29],[24,32],[12,32],[12,29],[8,29],[8,25],[5,25],[5,15],[8,15]], P.ink);
    shape(ctx, [[8,15],[28,15],[28,17],[30,17],[30,23],[27,23],[27,27],[23,27],[23,30],[13,30],[13,27],[9,27],[9,23],[6,23],[6,17],[8,17]], P.gold);
    rect(ctx, 8, 15, 20, 3, P.goldLight); rect(ctx, 6, 17, 4, 5, P.goldLight);
    rect(ctx, 27, 18, 3, 5, P.goldShadow); rect(ctx, 23, 25, 4, 3, P.goldShadow);
    rect(ctx, 13, 28, 10, 2, P.goldShadow);
    rect(ctx, 8, 16, 3, 2, P.shine); rect(ctx, 25, 16, 3, 2, P.goldHighlight);
    // A fixed exhaust stub makes each working puff visibly originate on the rig.
    rect(ctx, 4, 10, 4, 6, P.ink); rect(ctx, 5, 11, 2, 4, P.steel);
    rect(ctx, 3, 9, 6, 2, P.deep); rect(ctx, 4, 9, 4, 1, P.steel);
    // Antenna, roof, cab and windscreen: the top-facing planes catch warm light.
    rect(ctx, 25, 0, 2, 8, P.ink); rect(ctx, 24, 0, 4, 2, working && f === 2 ? P.shine : P.goldLight);
    shape(ctx, [[12,1],[23,1],[23,3],[26,3],[26,14],[24,14],[24,18],[11,18],[11,15],[9,15],[9,5],[12,5]], P.ink);
    rect(ctx, 12, 3, 11, 3, P.goldHighlight); rect(ctx, 11, 5, 13, 2, P.goldLight);
    shape(ctx, [[12,7],[22,7],[22,8],[24,8],[24,14],[22,14],[22,16],[12,16],[12,14],[11,14],[11,9],[12,9]], P.cabDark);
    rect(ctx, 12, 8, 10, 6, P.cab); rect(ctx, 12, 8, 3, 5, P.cabLight);
    rect(ctx, 16, 8, 1, 6, P.cabLight); rect(ctx, 21, 9, 2, 5, P.cabDark);
    rect(ctx, 18, 12, 3, 3, P.deep); rect(ctx, 18, 11, 3, 1, P.goldLight);
    rect(ctx, 12, 16, 11, 2, P.goldLight); rect(ctx, 22, 5, 2, 2, P.gold);
    // Engine grille and two side pistons reinforce the vertical axis.
    rect(ctx, 12, 20, 12, 6, P.goldShadow); rect(ctx, 13, 20, 10, 1, P.goldHighlight);
    rect(ctx, 14, 22, 8, 3, P.deep); rect(ctx, 15, 22, 2, 2, P.steel); rect(ctx, 19, 22, 2, 2, P.steel);
    rect(ctx, 9, 21, 2, 6, P.steel); rect(ctx, 25, 21, 2, 6, P.steel);
    rect(ctx, 9, 21, 1, 3, P.shine); rect(ctx, 25, 21, 1, 3, P.cabLight);
    rect(ctx, 14, 30, 8, 4, P.ink); rect(ctx, 16, 30, 4, 4, P.steel); rect(ctx, 16, 30, 1, 3, P.shine);
    // Discrete helical bands rotate while the cone's outline stays unchanged.
    const widths = [18,18,16,16,14,14,12,12,10,8,6,4,2,2];
    for (let row = 0; row < widths.length; row++) {
      const w = widths[row], left = 18 - w / 2, y = 33 + row;
      rect(ctx, left, y, w, 1, P.ink);
      for (let x = left + 1; x < left + w - 1; x++) {
        const band = (x + row * 2 + f * 2) % 8;
        const color = band < 2 ? P.shine : band < 5 ? P.steel : P.deep;
        rect(ctx, x, y, 1, 1, color);
      }
    }
    rect(ctx, 17, 45, 1, 2, P.steel); rect(ctx, 17, 46, 1, 1, P.shine);
    if (working && f) {
      // Four-frame motion stays inside 36x47; the scene adds long-lived debris.
      const puffs = [null, [[4,6,3,2]], [[2,3,4,2],[4,5,3,2]], [[1,1,4,2],[3,3,3,1]]][f];
      for (const p of puffs) rect(ctx, p[0], p[1], p[2], p[3], f === 3 ? P.deep : P.steel);
      const chips = [null, [[7,36,2,2],[28,38,2,2]], [[4,39,3,2],[30,35,2,2]], [[1,41,2,2],[32,38,3,2]]][f];
      for (const p of chips) rect(ctx, p[0], p[1], p[2], p[3], P.earthLight);
      if (f === 2) rect(ctx, 11,39,2,1,P.goldHighlight);
    }
  }

  // 52 x 68 industrial rig. Its bit ends at the same world anchor as the
  // smaller machine: the extra mass grows upward, never beyond earned ground.
  function paintHeavy(ctx, frame, working) {
    const f = working ? mod4(frame) : 0;
    const r = (x,y,w,h,c) => rect(ctx,x,y,w,h,c);
    const poly = (p,c) => shape(ctx,p,c);
    // Long caterpillar units, individual shoes and recessed wheel hubs.
    for (const x of [0,42]) {
      poly([[x+2,20],[x+8,20],[x+10,23],[x+10,46],[x+8,49],[x+2,49],[x,46],[x,23]],P.ink);
      r(x+2,23,6,23,P.deep);
      for(let y=23;y<46;y++) if((y+f)%5<2) { r(x+1,y,8,1,P.steel);r(x+2,y,2,1,P.cabLight); }
      for(const y of [26,35,44]){r(x+3,y,4,3,P.ink);r(x+4,y,2,2,P.steel);}
    }
    // Structural spine and a broad beveled armor deck.
    poly([[13,15],[38,15],[38,20],[43,20],[43,39],[39,43],[36,48],[16,48],[13,43],[9,39],[9,20],[13,20]],P.ink);
    poly([[13,19],[38,19],[38,23],[41,23],[41,37],[36,42],[35,45],[17,45],[16,42],[11,37],[11,23],[13,23]],P.goldShadow);
    poly([[13,19],[38,19],[38,23],[41,23],[41,29],[35,36],[17,36],[11,29],[11,23],[13,23]],P.gold);
    r(14,19,23,3,P.goldLight);r(12,23,5,7,P.goldLight);r(37,24,3,8,P.goldShadow);
    r(14,20,5,1,P.shine);r(34,20,4,1,P.goldHighlight);
    // Twin exhaust manifolds with a thin insulated copper supply pipe.
    for(const x of [10,39]){r(x,7,4,15,P.ink);r(x+1,9,2,11,P.steel);r(x-1,7,6,3,P.deep);r(x,7,4,1,P.steel);r(x+1,13,1,5,P.shine);}
    r(35,4,2,14,P.ink);r(35,5,1,12,P.amberShadow);r(33,3,4,2,P.goldLight);
    // Raised cabin: dark gasket, framed aqua glazing, seat and instrument line.
    poly([[19,1],[31,1],[31,3],[35,3],[35,21],[31,24],[19,24],[16,21],[16,5],[19,5]],P.ink);
    r(19,3,12,3,P.goldHighlight);r(18,6,15,3,P.goldLight);r(19,9,12,11,P.cabDark);
    r(20,10,10,8,P.cab);r(20,10,3,7,P.cabLight);r(24,10,1,8,P.cabLight);
    r(29,10,2,10,P.deep);r(25,16,4,4,P.ink);r(25,15,4,1,P.goldLight);
    r(19,20,12,2,P.goldLight);r(20,21,10,1,P.goldShadow);
    r(30,0,2,3,P.ink);r(30,0,3,1,working&&f===2?P.shine:P.amber);
    // Cooling bank, bolts, ladders and an asymmetrical service compartment.
    r(18,26,16,11,P.ink);r(19,27,14,1,P.goldHighlight);r(19,29,14,7,P.deep);
    for(let x=20;x<33;x+=3){r(x,29,1,6,P.steel);r(x,29,1,2,P.cabLight);}
    r(12,33,4,8,P.deep);r(12,34,3,2,P.steel);r(12,38,3,1,P.goldLight);
    r(36,33,4,8,P.ink);r(37,34,2,6,P.cabDark);r(37,35,1,2,P.cabLight);
    for(const [x,y] of [[14,24],[36,24],[17,39],[33,39]]){r(x,y,2,2,P.deep);r(x,y,1,1,P.shine);}
    // Load-bearing rams flank the drill gearbox; rods shorten one pixel on impact.
    const compress=working&&f===1?1:0;
    for(const x of [16,32]){r(x,38,4,12,P.ink);r(x+1,39,2,6,P.steel);r(x+1,39,1,4,P.shine);r(x+1,45,2,7-compress,P.deep);r(x+1,46,1,5-compress,P.cabLight);}
    r(21,38,10,9,P.goldShadow);r(22,39,8,5,P.gold);r(23,40,6,1,P.goldLight);
    r(21,45,10,5,P.ink);r(23,45,6,4,P.steel);r(23,45,2,4,P.shine);
    // Shoulder lamps remain crisp, with their light projected by the scene.
    for(const x of [9,38]){r(x,29,6,4,P.ink);r(x+1,30,4,2,P.amber);r(x+1,30,3,1,P.shine);}
    // Eight stepped, rotating cutting collars around a substantial steel cone.
    const widths=[26,26,24,24,22,22,20,20,18,18,16,14,12,10,8,6,4,2,2];
    for(let row=0;row<widths.length;row++){
      const w=widths[row],left=26-w/2,y=49+row;r(left,y,w,1,P.ink);
      for(let x=left+1;x<left+w-1;x++){
        const band=(x+row*2+f*3)%11;r(x,y,1,1,band<2?P.shine:band<5?P.steel:band<8?P.deep:P.goldShadow);
      }
      if(row%3===0&&w>8){r(left,y,2,1,P.steel);r(left+w-3,y,2,1,P.cabLight);}
    }
    r(25,66,1,2,P.shine);
    if(working&&f){const y=6-f*2; r(9-f,y,3+f,1,P.steel);r(39+f,y+1,3,1,P.deep);if(f===2){r(7,53,3,2,P.earthLight);r(43,56,2,2,P.goldHighlight);}}
  }

  // Quiet tile variation: one blank, one broad cut, one faint trace, one short
  // cut. Sparse off-grid seams are supplied separately by ExpeditionArt.
  // All edges are uninterrupted base color, so variants can meet in any order.
  // Cave-edge shadows belong to the renderer, where the actual cut is known.
  const fracturePlans = [
    {
      shadow: [[4,9],[11,9],[11,10],[25,10],[25,12],[18,12],[18,13],[8,13],[8,12],[4,12]],
      lip: [5,9,6,1]
    },
    {
      shadow: [[6,21],[15,21],[15,20],[28,20],[28,23],[23,23],[23,24],[11,24],[11,23],[6,23]],
      lip: [16,20,10,1]
    },
    {
      shadow: [[3,16],[9,16],[9,14],[20,14],[20,15],[24,15],[24,17],[17,17],[17,18],[6,18],[6,17],[3,17]],
      lip: [10,14,8,1]
    },
    {
      shadow: [[10,6],[20,6],[20,7],[28,7],[28,9],[19,9],[19,10],[13,10],[13,9],[10,9]],
      lip: [11,6,7,1]
    }
  ];
  function paintTile(ctx, biome, variant) {
    const ramp = biomes[mod4(biome)], v = mod4(variant);
    rect(ctx, 0, 0, 32, 32, ramp[1]);
    if (v === 0) return;
    if (v === 2) { rect(ctx, 13,19,7,1,ramp[0]); return; }
    const plan = fracturePlans[v];
    shape(ctx, plan.shadow, ramp[0]);
    rect(ctx, plan.lip[0], plan.lip[1], plan.lip[2], plan.lip[3], ramp[2]);
  }

  function paintCrystal(ctx, kindIndex, frame) {
    const ramp = gems[kindIndex], f = mod4(frame);
    // Three connected shards, with one dominant vertical plane.
    shape(ctx, [[6,0],[9,0],[9,2],[11,2],[11,6],[13,6],[13,8],[14,8],[14,15],[12,15],[12,17],[9,17],[9,18],[4,18],[4,17],[1,17],[1,15],[0,15],[0,9],[2,9],[2,7],[4,7],[4,3],[6,3]], P.ink);
    shape(ctx, [[6,3],[7,3],[7,1],[9,1],[9,3],[10,3],[10,15],[8,15],[8,17],[5,17],[5,14],[4,14],[4,8],[6,8]], ramp[0]);
    rect(ctx, 6, 4, 3, 10, ramp[1]); rect(ctx, 6, 3, 2, 9, ramp[2]);
    rect(ctx, 7, 2, 1, 5, ramp[2]); rect(ctx, 5, 12, 2, 4, ramp[1]); rect(ctx, 8, 12, 2, 3, ramp[0]);
    rect(ctx, 1, 10, 3, 5, ramp[1]); rect(ctx, 2, 9, 2, 5, ramp[2]); rect(ctx, 3, 14, 2, 3, ramp[0]);
    rect(ctx, 11, 8, 2, 7, ramp[1]); rect(ctx, 11, 7, 1, 5, ramp[2]); rect(ctx, 10, 14, 2, 3, ramp[0]);
    rect(ctx, 5, 16, 4, 1, ramp[1]);
    if (f === 1) rect(ctx, 6, 4, 1, 2, P.shine);
    if (f === 2) rect(ctx, 6, 7, 2, 1, P.shine);
    if (f === 3) rect(ctx, 2, 10, 1, 2, P.shine);
  }

  function paintLamp(ctx, on) {
    rect(ctx, 4, 0, 1, 4, P.woodShadow);
    rect(ctx, 2, 2, 5, 2, P.deep); rect(ctx, 0, 4, 9, 2, P.ink);
    rect(ctx, 1, 4, 7, 1, P.steel); rect(ctx, 1, 6, 7, 5, P.ink);
    rect(ctx, 2, 6, 5, 4, on ? P.amber : P.deep);
    rect(ctx, 3, 6, 3, 3, on ? P.shine : P.steel);
    rect(ctx, 1, 10, 7, 2, P.woodShadow); rect(ctx, 2, 10, 5, 1, P.gold);
    rect(ctx, 3, 12, 3, 1, P.deep);
  }

  function makeCanvas(width, height) {
    let canvas;
    try {
      if (typeof root.OffscreenCanvas === 'function') canvas = new root.OffscreenCanvas(width, height);
      else if (root.document && root.document.createElement) { canvas = root.document.createElement('canvas'); canvas.width = width; canvas.height = height; }
      if (!canvas || typeof canvas.getContext !== 'function') return null;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.imageSmoothingEnabled = false;
      return { canvas, context };
    } catch (_) { return null; }
  }

  function translated(ctx, x, y, paint) {
    ctx.save(); ctx.translate(x, y);
    try { paint(ctx); } finally { ctx.restore(); }
  }
  function ensureAtlas() {
    if (cacheAttempted) return;
    cacheAttempted = true;
    const rig = makeCanvas(144, 47), tiles = makeCanvas(128, 128), crystals = makeCanvas(56, 72), lamps = makeCanvas(18, 13);
    if (!rig || !tiles || !crystals || !lamps) return;
    for (let frame = 0; frame < 4; frame++) translated(rig.context, frame * 36, 0, ctx => paintRig(ctx, frame, true));
    for (let biome = 0; biome < 4; biome++) for (let v = 0; v < 4; v++) translated(tiles.context, v * 32, biome * 32, ctx => paintTile(ctx, biome, v));
    for (let kind = 0; kind < 4; kind++) for (let frame = 0; frame < 4; frame++) translated(crystals.context, frame * 14, kind * 18, ctx => paintCrystal(ctx, kind, frame));
    paintLamp(lamps.context, false); translated(lamps.context, 9, 0, ctx => paintLamp(ctx, true));
    atlas = { rig: rig.canvas, tiles: tiles.canvas, crystals: crystals.canvas, lamps: lamps.canvas };
  }
  function blit(ctx, canvas, sx, sy, w, h, x, y) {
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    try { ctx.drawImage(canvas, sx, sy, w, h, x, y, w, h); }
    finally { ctx.imageSmoothingEnabled = smoothing; }
  }

  function drawRig(ctx, x, y, frame, working) {
    ensureAtlas();
    const f = working ? mod4(frame) : 0, px = pixel(x) - 18, py = pixel(y) - 23;
    if (atlas && typeof ctx.drawImage === 'function') blit(ctx, atlas.rig, f * 36, 0, 36, 47, px, py);
    else translated(ctx, px, py, c => paintRig(c, f, Boolean(working)));
  }
  function drawRigHeavy(ctx, x, y, frame, working) {
    if(!heavyAttempted){heavyAttempted=true;const item=makeCanvas(208,68);if(item){for(let f=0;f<4;f++)translated(item.context,f*52,0,c=>paintHeavy(c,f,true));heavyAtlas=item.canvas;}}
    const f=working?mod4(frame):0,px=pixel(x)-26,py=pixel(y)-44;
    if(heavyAtlas&&typeof ctx.drawImage==='function')blit(ctx,heavyAtlas,f*52,0,52,68,px,py);
    else translated(ctx,px,py,c=>paintHeavy(c,f,Boolean(working)));
  }
  function drawTile(ctx, x, y, biome, variant) {
    ensureAtlas();
    const b = mod4(biome), v = mod4(variant), px = pixel(x), py = pixel(y);
    if (atlas && typeof ctx.drawImage === 'function') blit(ctx, atlas.tiles, v * 32, b * 32, 32, 32, px, py);
    else translated(ctx, px, py, c => paintTile(c, b, v));
  }
  function drawCrystal(ctx, x, y, kind, frame) {
    ensureAtlas();
    const index = kinds.indexOf(kind), k = index < 0 ? 3 : index, f = mod4(frame), px = pixel(x) - 7, py = pixel(y) - 17;
    if (atlas && typeof ctx.drawImage === 'function') blit(ctx, atlas.crystals, f * 14, k * 18, 14, 18, px, py);
    else translated(ctx, px, py, c => paintCrystal(c, k, f));
  }
  function drawSupport(ctx, x, y, width) {
    const px = pixel(x), py = pixel(y), w = Math.max(12, pixel(width) || 64);
    translated(ctx, px, py, c => {
      rect(c, 0, 0, w, 4, P.woodShadow); rect(c, 1, 0, w - 2, 1, P.woodLight); rect(c, 1, 1, w - 2, 2, P.wood);
      rect(c, 0, 3, 5, 13, P.woodShadow); rect(c, w - 5, 3, 5, 13, P.woodShadow);
      rect(c, 1, 3, 2, 12, P.wood); rect(c, w - 4, 3, 2, 12, P.wood);
      rect(c, 1, 3, 1, 11, P.woodLight); rect(c, w - 4, 3, 1, 11, P.woodLight);
      if (w >= 24) {
        shape(c, [[5,4],[13,4],[13,6],[10,6],[10,8],[7,8],[7,10],[5,10]], P.wood);
        shape(c, [[w-5,4],[w-13,4],[w-13,6],[w-10,6],[w-10,8],[w-7,8],[w-7,10],[w-5,10]], P.woodShadow);
        rect(c, 6, 11, 2, 5, P.steel); rect(c, w - 8, 11, 2, 5, P.steel);
      }
      rect(c, 2, 1, 2, 2, P.steel); rect(c, w - 4, 1, 2, 2, P.steel);
    });
  }
  function drawLamp(ctx, x, y, on) {
    ensureAtlas();
    const lit = on !== false, px = pixel(x) - 4, py = pixel(y) - 7;
    if (atlas && typeof ctx.drawImage === 'function') blit(ctx, atlas.lamps, lit ? 9 : 0, 0, 9, 13, px, py);
    else translated(ctx, px, py, c => paintLamp(c, lit));
  }

  return Object.freeze({ palette, drawRig, drawRigHeavy, heavyBounds: Object.freeze({width:52,height:68,anchorX:26,anchorY:44}), drawTile, drawCrystal, drawSupport, drawLamp });
});
