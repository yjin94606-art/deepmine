(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./evidence-core.js'));
  else root.DailyArtifactCore = factory(root.EvidenceCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';
  if (!C || typeof C.validateSnapshot !== 'function') throw new Error('请先加载 evidence-core.js。');
  const freeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  const catalog = freeze([
    { id: 'engine', name: '引擎', hint: '动力、运行时、处理流程或性能相关工作。' },
    { id: 'archive', name: '书卷', hint: '知识整理、文档库或资料归档。' },
    { id: 'prism', name: '彩晶灯塔', hint: '视觉设计、色彩、图像或界面呈现。' },
    { id: 'compass', name: '罗盘', hint: '路线、导航、方向选择或规划。' },
    { id: 'rover', name: '机器人', hint: '自动化助手、任务执行或探索机器人。' },
    { id: 'drill', name: '钻头', hint: '深入处理、数据挖掘或钻进机械。' },
    { id: 'projector', name: '投影仪', hint: '展示、可视化或演示工具。' },
    { id: 'observatory', name: '观测站', hint: '监测、指标、日志或系统观测。' },
    { id: 'pickaxe', name: '矿镐', hint: '挖矿游戏、采集玩法或矿井建设。' },
    { id: 'gamepad', name: '手柄', hint: '游戏玩法、操控、关卡或交互娱乐。' },
    { id: 'quill', name: '羽毛笔', hint: '写作、编辑、叙事或文字工具。' },
    { id: 'telescope', name: '望远镜', hint: '研究、检索、发现或远景探索。' },
    { id: 'key', name: '钥匙', hint: '登录、身份、权限或访问控制。' },
    { id: 'seedling', name: '幼苗', hint: '初始化、培育、种植或成长主题。' },
    { id: 'bridge', name: '桥梁', hint: '接口连接、集成、迁移或系统互通。' },
    { id: 'musicbox', name: '音乐盒', hint: '音乐、音频、节奏或声音相关工作。' }
  ]);
  const itemTypes = freeze(catalog.map(item => item.id));
  const outputSchema = freeze({
    type: 'object', additionalProperties: false,
    properties: {
      objectType: { type: 'string', enum: itemTypes.slice() },
      name: { type: 'string', minLength: 1, maxLength: 24 },
      summary: { type: 'string', minLength: 1, maxLength: 180 },
      meaning: { type: 'string', minLength: 1, maxLength: 100 },
      evidenceIds: { type: 'array', minItems: 1, maxItems: 40, uniqueItems: true, items: { type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' } }
    },
    required: ['objectType', 'name', 'summary', 'meaning', 'evidenceIds']
  });
  const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
  const SHA_K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function sha256(text) {
    const bytes = new TextEncoder().encode(text), size = Math.ceil((bytes.length + 9) / 64) * 64;
    const data = new Uint8Array(size); data.set(bytes); data[bytes.length] = 0x80;
    const view = new DataView(data.buffer), bits = bytes.length * 8;
    view.setUint32(size - 8, Math.floor(bits / 4294967296)); view.setUint32(size - 4, bits >>> 0);
    const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], w = new Uint32Array(64);
    const rotate = (v, n) => (v >>> n) | (v << (32 - n));
    for (let offset = 0; offset < size; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        w[i] = (w[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) >>> 0;
      }
      let [a,b,c,d,e,f,g,j] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (j + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) >>> 0;
        const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        j = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      [a,b,c,d,e,f,g,j].forEach((value, index) => { h[index] = (h[index] + value) >>> 0; });
    }
    return h.map(value => value.toString(16).padStart(8, '0')).join('');
  }
  function prepare(raw, date) {
    const snapshot = C.validateSnapshot(raw), target = date === undefined ? C.today(snapshot.collectedAt) : date;
    if (typeof target !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(target)) throw new Error('需要有效的工作日期。');
    const day = snapshot.days.find(item => item.date === target);
    if (snapshot.sources.git.status !== 'connected' || !day || !day.evidence.some(item => item.files.length)) return null;
    const commits = day.evidence.slice().sort((a, b) => a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0);
    return { snapshot, date: target, commits };
  }
  function sourceFingerprint(prepared) {
    return sha256(JSON.stringify({ projectId: prepared.snapshot.project.id, date: prepared.date, commits: prepared.commits }));
  }
  function fingerprint(snapshot, date) {
    const prepared = prepare(snapshot, date);
    return prepared ? sourceFingerprint(prepared) : null;
  }
  function buildInput(snapshot, date) {
    const prepared = prepare(snapshot, date); if (!prepared) return null;
    const nonempty = prepared.commits.filter(item => item.files.length), selected = nonempty.slice(0, 40);
    const allFiles = new Map(), visibleFiles = new Map();
    for (const commit of nonempty) for (const file of commit.files) {
      if (allFiles.has(file.path) && allFiles.get(file.path) !== file.kind) throw new Error('同一天的文件分类冲突。');
      allFiles.set(file.path, file.kind);
    }
    for (const commit of selected) for (const file of commit.files) visibleFiles.set(file.path, file.kind);
    const files = [...visibleFiles.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, 300).map(([path, kind]) => ({ path, kind }));
    const sentPaths = new Set(files.map(file => file.path));
    return {
      schemaVersion: 1, projectId: prepared.snapshot.project.id, date: prepared.date, fingerprint: sourceFingerprint(prepared),
      commits: selected.map(item => ({ hash: item.hash, title: item.title, paths: item.files.filter(file => sentPaths.has(file.path)).map(file => file.path) })),
      files, totals: { commits: nonempty.length, files: allFiles.size },
      truncated: { commits: nonempty.length > selected.length, files: allFiles.size > files.length }
    };
  }
  function cleanText(value, limit, label) {
    if (typeof value !== 'string' || CONTROL.test(value) || value.length > limit || !value.trim()) throw new Error(`${label}格式无效。`);
    return value.trim();
  }
  function validateResult(raw, input) {
    if (!input || !Array.isArray(input.commits) || !input.commits.length || !Array.isArray(input.files) || !input.files.length) return null;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('藏品结果必须是对象。');
    const expected = outputSchema.required;
    if (Object.keys(raw).length !== expected.length || Object.keys(raw).some(key => !expected.includes(key)) || expected.some(key => !Object.prototype.hasOwnProperty.call(raw, key))) throw new Error('藏品结果字段不符合契约。');
    if (!itemTypes.includes(raw.objectType)) throw new Error('未知藏品类型。');
    const allowed = new Set(input.commits.map(commit => commit.hash));
    if (!Array.isArray(raw.evidenceIds) || !raw.evidenceIds.length || raw.evidenceIds.length > 40 || new Set(raw.evidenceIds).size !== raw.evidenceIds.length || raw.evidenceIds.some(id => typeof id !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(id) || !allowed.has(id))) throw new Error('藏品只能引用已发送的当天提交。');
    return { objectType: raw.objectType, name: cleanText(raw.name, 24, '名称'), summary: cleanText(raw.summary, 180, '工作简介'), meaning: cleanText(raw.meaning, 100, '象征说明'), evidenceIds: raw.evidenceIds.slice().sort() };
  }
  return Object.freeze({ catalog, itemTypes, outputSchema, buildInput, fingerprint, validateResult });
});
