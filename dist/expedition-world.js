(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./evidence-core.js'), require('./daily-artifact-core.js'));
  else root.ExpeditionWorld = factory(root.EvidenceCore, root.DailyArtifactCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C, D) {
  'use strict';
  if (!C || typeof C.project !== 'function') throw new Error('请先加载 evidence-core.js。');

  const KINDS = Object.freeze(['code', 'document', 'asset', 'other']);
  const freezeRecipe = recipe => Object.freeze({ ...recipe, kinds: Object.freeze(recipe.kinds), masks: Object.freeze(recipe.masks) });
  const catalog = Object.freeze([
    { id: 'engine', name: '铜芯引擎', description: '代码矿样装配成一台铜色小引擎。', kinds: ['code'], masks: [1] },
    { id: 'archive', name: '琥珀书卷', description: '文档矿样封存在透亮的琥珀书卷中。', kinds: ['document'], masks: [2] },
    { id: 'prism', name: '彩晶灯塔', description: '素材矿样拼成一座折射彩光的小灯塔。', kinds: ['asset'], masks: [4] },
    { id: 'compass', name: '蓝钢罗盘', description: '其他文件的矿样构成蓝钢罗盘。', kinds: ['other'], masks: [8] },
    { id: 'rover', name: '测绘机器人', description: '代码与文档矿样组合成一台带地图的小机器人。', kinds: ['code', 'document'], masks: [3] },
    { id: 'drill', name: '萤石钻头', description: '代码与素材矿样组成一枚彩晶机械钻头。', kinds: ['code', 'asset'], masks: [5] },
    { id: 'projector', name: '星图投影仪', description: '文档与素材矿样组成一台星图投影仪。', kinds: ['document', 'asset'], masks: [6] },
    { id: 'observatory', name: '地心观测站', description: '多种文件类别的矿样组合成一座微型观测站。', kinds: KINDS.slice(), masks: [7, 9, 10, 11, 12, 13, 14, 15] }
  ].map(freezeRecipe));
  const recipesByMask = new Map(catalog.flatMap(recipe => recipe.masks.map(mask => [mask, recipe])));
  const biomes = Object.freeze([
    { id: 'roots', name: '苔根浅层', start: 0, end: 18 },
    { id: 'aquifer', name: '蓝水岩窟', start: 18, end: 44 },
    { id: 'crystal', name: '紫晶空洞', start: 44, end: 90 },
    { id: 'ruins', name: '旧日机库', start: 90, end: null }
  ].map(item => Object.freeze(item)));
  const roomThemes = Object.freeze(['energy', 'workshop', 'archive', 'studio', 'observatory', 'audio', 'garden', 'gate']);
  const ROOM_NAMES = Object.freeze({ energy: 'Codex 储能室', workshop: '机械工坊', archive: '文档书房', studio: '像素画室', observatory: '观测室', audio: '回声音室', garden: '育苗室', gate: '通行站' });
  const KIND_NAMES = Object.freeze({ code: '代码', document: '文档', asset: '素材', other: '其他' });
  const KIND_THEMES = Object.freeze({ code: 'workshop', document: 'archive', asset: 'studio', other: 'observatory' });
  const ITEM_THEMES = Object.freeze({
    engine: 'workshop', archive: 'archive', prism: 'studio', compass: 'observatory',
    rover: 'workshop', drill: 'workshop', projector: 'studio', observatory: 'observatory',
    pickaxe: 'workshop', gamepad: 'workshop', quill: 'archive', telescope: 'observatory',
    key: 'gate', seedling: 'garden', bridge: 'gate', musicbox: 'audio'
  });

  function biomeAt(depth) {
    const value = typeof depth === 'number' && Number.isFinite(depth) ? Math.max(0, depth) : 0;
    return biomes.find(item => item.end === null || value < item.end);
  }
  function stableHash(seed) {
    let value = 2166136261;
    for (let i = 0; i < seed.length; i++) value = Math.imul(value ^ seed.charCodeAt(i), 16777619) >>> 0;
    return value;
  }
  function variantFor(mask, paths) {
    // Only the observed file combination shapes this cosmetic variation.
    // Token amounts, commit splitting, and commit titles never improve a tier.
    return stableHash(JSON.stringify([mask, paths])) % 3;
  }

  function fileRecord(day, includedHashes) {
    const files = new Map(), evidenceIds = new Set();
    for (const entry of day.evidence) {
      if (includedHashes && !includedHashes.has(entry.hash)) continue;
      if (entry.files.length) evidenceIds.add(entry.hash);
      for (const file of entry.files) files.set(file.path, file.kind);
    }
    const fileCounts = Object.fromEntries(KINDS.map(kind => [kind, 0]));
    for (const kind of files.values()) fileCounts[kind]++;
    const rankedKinds = KINDS.filter(kind => fileCounts[kind]).sort((a, b) => fileCounts[b] - fileCounts[a] || KINDS.indexOf(a) - KINDS.indexOf(b));
    return {
      paths: [...files.keys()].sort(), evidenceIds: [...evidenceIds].sort(), fileCount: files.size, fileCounts,
      primaryKind: rankedKinds[0] || null, secondaryKind: rankedKinds[1] || null,
      kindMask: KINDS.reduce((mask, kind, index) => mask | (fileCounts[kind] ? 1 << index : 0), 0)
    };
  }
  function buildRooms(snapshot, projection, rawDays, artifacts) {
    const rooms = [], byDate = new Map(artifacts.map(artifact => [artifact.date, artifact]));
    for (const projected of projection.days) {
      const day = rawDays.get(projected.date), files = fileRecord(day), artifact = byDate.get(day.date);
      const mainSide = stableHash(JSON.stringify([snapshot.project.id, day.date])) % 2 ? 'left' : 'right';
      const span = projected.depthEnd - projected.depthStart;
      const empty = { paths: [], evidenceIds: [], fileCount: 0, fileCounts: Object.fromEntries(KINDS.map(kind => [kind, 0])), primaryKind: null, secondaryKind: null, kindMask: 0 };
      const make = (kind, fraction, record, theme, description, source) => ({
        id: `${snapshot.project.id}/${day.date}/room/${kind}`, projectId: snapshot.project.id, date: day.date,
        depth: Math.min(projected.depthEnd, Math.max(projected.depthStart, projected.depthStart + span * fraction)),
        side: kind === 'work' ? (mainSide === 'left' ? 'right' : 'left') : mainSide,
        kind, theme, name: ROOM_NAMES[theme], description, source: snapshot.mode === 'demo' ? 'demo' : source,
        evidenceIds: record.evidenceIds.slice(), paths: record.paths.slice(), fileCount: record.fileCount,
        fileCounts: { ...record.fileCounts }, primaryKind: record.primaryKind, secondaryKind: record.secondaryKind,
        // Preserve null measurements. A room never invents missing counters or infers output from usage.
        usage: Object.fromEntries(['inputTokens', 'cachedInputTokens', 'outputTokens', 'totalTokens', 'sessions'].map(key => [key, day.usage[key]])),
        variant: record.fileCount ? variantFor(record.kindMask, record.paths) : 0,
        // This controls furniture density only, not achievement quality, rarity, or rewards.
        level: record.fileCount ? Math.min(3, Math.floor(Math.log2(record.fileCount))) : 0,
        artifactId: kind === 'work' && artifact ? artifact.id : null
      });
      if (day.usage.totalTokens !== null && day.usage.totalTokens > 0) {
        const room = make('usage', 0.20, empty, 'energy', '当天 Codex 计量记录形成的储能陈设；仅表示用量，不代表工作成果。', 'codex');
        room.level = day.usage.totalTokens >= 75000 ? 3 : day.usage.totalTokens >= 25000 ? 2 : 1;
        rooms.push(room);
      }
      if (!files.fileCount) continue;
      // Accepted artifacts have already passed project/date/fingerprint/source/reference validation.
      // Derive rooms only after that validation; raw semantic envelopes never reach this layer.
      const semantic = artifact && artifact.semantic;
      const workFiles = semantic ? fileRecord(day, new Set(artifact.evidenceIds)) : files;
      const theme = semantic ? ITEM_THEMES[artifact.recipeId] : KIND_THEMES[files.primaryKind];
      rooms.push(make('work', 0.55, workFiles, theme,
        semantic ? artifact.description : `按当天 ${files.fileCount} 个去重文件的类别布置；以${KIND_NAMES[files.primaryKind]}为主，属于基础配方，非 AI 解读。`,
        semantic ? artifact.source : 'git'));
      const rankedKinds = KINDS.filter(kind => files.fileCounts[kind]).sort((a, b) => files.fileCounts[b] - files.fileCounts[a] || KINDS.indexOf(a) - KINDS.indexOf(b));
      // Select a different available file theme without rewriting the actual category statistics.
      const displayKind = rankedKinds.find(kind => KIND_THEMES[kind] !== theme) || files.primaryKind;
      const secondary = files.secondaryKind ? `，${KIND_NAMES[files.secondaryKind]}为辅` : '';
      const filing = make('files', 0.87, files, KIND_THEMES[displayKind],
        `采用${KIND_NAMES[displayKind]}主题布置；清单仍包含当天全部 ${files.fileCount} 个去重文件，实际以${KIND_NAMES[files.primaryKind]}为主${secondary}。完整提交引用可追溯。`, 'git');
      filing.displayKind = displayKind;
      filing.name = `${KIND_NAMES[displayKind]}文件整理室`;
      rooms.push(filing);
    }
    return rooms;
  }

  function build(input, _projection, semanticItems = []) {
    const snapshot = C.validateSnapshot(input);
    // Re-project this bounded snapshot rather than trust a stale optional view.
    // EvidenceCore remains the single authority for the 14-day depth rules.
    const projection = C.project(snapshot);
    const rawDays = new Map(snapshot.days.map(day => [day.date, day]));
    const layers = [], artifacts = [];
    for (const projected of projection.days) {
      if (projected.depthEnd <= projected.depthStart) continue;
      const day = rawDays.get(projected.date), files = new Map(), evidenceIds = new Set();
      if (snapshot.sources.git.status === 'connected') {
        for (const entry of day.evidence) {
          if (entry.files.length) evidenceIds.add(entry.hash);
          for (const file of entry.files) files.set(file.path, file.kind);
        }
      }
      const fileCounts = Object.fromEntries(KINDS.map(kind => [kind, 0]));
      for (const kind of files.values()) fileCounts[kind]++;
      const kindMask = KINDS.reduce((mask, kind, index) => mask | (fileCounts[kind] ? 1 << index : 0), 0);
      const discoveryIds = projection.discoveries.filter(item => item.date === day.date).map(item => item.id);
      const artifactId = kindMask ? `${snapshot.project.id}/${day.date}/artifact` : null;
      const evidenceDepth = files.size ? 18 : 0;
      layers.push({
        date: day.date, depthStart: projected.depthStart, depthEnd: projected.depthEnd,
        tokens: day.usage.totalTokens, usageDepth: projected.depthEnd - projected.depthStart - evidenceDepth,
        evidenceDepth, fileCounts, discoveryIds: discoveryIds.slice(), artifactId
      });
      if (!kindMask) continue;
      const recipe = recipesByMask.get(kindMask);
      artifacts.push({
        id: artifactId, date: day.date, depth: projected.depthEnd, recipeId: recipe.id,
        name: recipe.name, description: recipe.description, kindMask,
        variant: variantFor(kindMask, [...files.keys()].sort()),
        evidenceIds: [...evidenceIds].sort(), discoveryIds: discoveryIds.slice(), fileCount: files.size,
        source: 'rules', semantic: false
      });
    }
    if (D && Array.isArray(semanticItems) && semanticItems.length) {
      for (const artifact of artifacts) {
        const candidates = semanticItems.slice(0, 256).filter(item => item && item.projectId === snapshot.project.id && item.date === artifact.date);
        if (!candidates.length) continue;
        const payload = D.buildInput(snapshot, artifact.date); if (!payload) continue;
        let accepted = null;
        for (const item of candidates) {
          if (item.fingerprint !== payload.fingerprint || !['ai', 'demo'].includes(item.source) || (item.source === 'demo' && snapshot.mode !== 'demo')) continue;
          if (typeof item.generatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(item.generatedAt) || !Number.isFinite(Date.parse(item.generatedAt))) continue;
          try {
            const result = D.validateResult(item.result, payload); if (!result) continue;
            if (!accepted || Date.parse(item.generatedAt) > Date.parse(accepted.generatedAt)) accepted = { ...result, source: item.source, generatedAt: item.generatedAt };
          } catch (_) { /* Invalid or stale model output never overrides source-derived rules. */ }
        }
        if (accepted) Object.assign(artifact, {
          recipeId: accepted.objectType, name: accepted.name, description: accepted.summary, meaning: accepted.meaning,
          evidenceIds: accepted.evidenceIds.slice(), semantic: true, source: accepted.source, generatedAt: accepted.generatedAt,
          fingerprint: payload.fingerprint
        });
      }
    }
    return { layers, artifacts, catalog, rooms: buildRooms(snapshot, projection, rawDays, artifacts) };
  }

  function offsetDate(date, offset) {
    const value = new Date(date + 'T12:00:00Z');
    value.setUTCDate(value.getUTCDate() + offset);
    return value.toISOString().slice(0, 10);
  }
  function demoSnapshot(now = new Date()) {
    const instant = now instanceof Date ? now : new Date(now), current = C.today(instant);
    const definitions = [
      { input: 10000, cache: 6000, output: 4000, sessions: 1, title: '调整登录流程与权限检查', files: [['demo/auth/login.ts', 'code'], ['demo/auth/permissions.ts', 'code']] },
      { input: 14000, cache: 9000, output: 3000, sessions: 1, title: '撰写产品介绍与使用指南', files: [['demo/docs/introduction.md', 'document'], ['demo/docs/user-guide.md', 'document']] },
      { input: 28000, cache: 18000, output: 6000, sessions: 2, title: '绘制像素界面图标与调色板', files: [['demo/art/interface-icons.png', 'asset'], ['demo/art/palette.png', 'asset']] },
      { input: 42000, cache: 26000, output: 8000, sessions: 2, title: '整理资料检索工具与研究说明', files: [['demo/research/search.ts', 'code'], ['demo/research/notes.md', 'document']] },
      { input: 50000, cache: 30000, output: 8000, sessions: 3, title: '调整音频播放器与提示音', files: [['demo/audio/player.ts', 'code'], ['demo/audio/chime.wav', 'asset']] },
      { input: 76000, cache: 46000, output: 10000, sessions: 3, title: '制作挖矿游戏：钻机向下、镜头跟随与矿层展示', files: [['demo/mining/descent-scene.js', 'code'], ['demo/mining/layers.md', 'document'], ['demo/mining/ore.png', 'asset'], ['demo/mining/world.json', 'other']] }
    ];
    const days = definitions.map((definition, index) => {
      const date = offsetDate(current, index - definitions.length + 1), hash = String(index + 1).repeat(40);
      return {
        date,
        usage: { inputTokens: definition.input, cachedInputTokens: definition.cache, outputTokens: definition.output, totalTokens: definition.input + definition.output, reasoningOutputTokens: Math.floor(definition.output / 4), cacheWriteInputTokens: 0, sessions: definition.sessions, quality: 'observed' },
        evidence: [{ id: `git:fictional:${hash}`, kind: 'git-commit', timestamp: index === definitions.length - 1 ? instant.toISOString() : date + 'T12:00:00+08:00', hash, shortHash: hash.slice(0, 8), title: `演示（虚构）：${definition.title}`, files: definition.files.map(([path, kind]) => ({ path, kind })) }]
      };
    });
    return C.validateSnapshot({
      schemaVersion: 1, kind: 'deepmine-evidence', mode: 'demo', collectedAt: instant.toISOString(), timezone: C.TIMEZONE,
      project: { id: 'fictional-preview', label: '虚构演示项目 · 非个人数据' },
      sources: {
        codex: { status: 'connected', sessions: definitions.reduce((total, item) => total + item.sessions, 0), events: 24, method: 'fictional-demo-only', notes: ['六天工作记录均为虚构，仅用于主动选择的玩法预览。'] },
        git: { status: 'connected', branch: 'fictional-preview', head: '6'.repeat(40), notes: ['提交、文件和用量均不是用户的真实工作记录。'] }
      },
      days, workingTree: { modified: 0, untracked: 0, status: 'clean' },
      warnings: ['所有预览数据与藏品解读均为手工编写的虚构示例，不是真实 AI 生成或个人工作记录。']
    });
  }

  function demoInterpretations(input) {
    const snapshot = C.validateSnapshot(input);
    if (!D || snapshot.mode !== 'demo' || snapshot.project.id !== 'fictional-preview' || snapshot.days.length !== 6) return [];
    const interpretations = [
      ['key', '守门人的钥匙', '调整了登录流程与权限检查相关文件。', '钥匙对应身份验证与访问权限的工作主题。'],
      ['quill', '旅人的羽毛笔', '撰写了产品介绍与使用指南文档。', '羽毛笔象征将想法整理为清晰文字。'],
      ['prism', '晨光棱镜', '绘制了像素界面图标，并整理了调色板素材。', '棱镜对应这一天对色彩与视觉呈现的打磨。'],
      ['telescope', '寻路望远镜', '整理了资料检索工具与研究说明。', '望远镜象征寻找信息、拓展视野的工作。'],
      ['musicbox', '回声音乐盒', '调整了音频播放器与提示音素材。', '音乐盒对应声音播放与听觉反馈的工作主题。'],
      ['pickaxe', '开拓者矿镐', '为挖矿游戏加入向下钻进、跟随镜头与矿层展示。', '矿镐对应这一天构筑矿井与向下探索玩法的工作。']
    ];
    return snapshot.days.map((day, index) => {
      const payload = D.buildInput(snapshot, day.date); if (!payload) return null;
      const [objectType, name, summary, meaning] = interpretations[index];
      return { projectId: snapshot.project.id, date: day.date, fingerprint: payload.fingerprint, source: 'demo', generatedAt: snapshot.collectedAt,
        result: D.validateResult({ objectType, name, summary, meaning, evidenceIds: payload.commits.map(commit => commit.hash) }, payload) };
    }).filter(Boolean);
  }

  return Object.freeze({ build, demoSnapshot, demoInterpretations, catalog, biomes, biomeAt, roomThemes });
});
