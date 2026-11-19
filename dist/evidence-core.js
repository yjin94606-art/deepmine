(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EvidenceCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TIMEZONE = 'Asia/Shanghai';
  const PERIOD_DAYS = 14;
  const FILE_KINDS = ['code', 'document', 'asset', 'other'];
  const LABELS = { code: '代码矿样', document: '文档矿样', asset: '视觉矿样', other: '其他变更' };
  const TOKEN_FIELDS = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'totalTokens', 'reasoningOutputTokens', 'cacheWriteInputTokens'];
  const MAX_TOKENS = 1000000000000;
  const MAX_COUNT = 1000000000;
  const dateFormats = new Map();

  function fail(message) { throw new Error(message); }
  function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象。`);
    return value;
  }
  function text(value, max, label, optional = false) {
    if (optional && (value === null || value === undefined)) return '';
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(`${label}格式无效或过长。`);
    const result = value.trim();
    if (!optional && !result) fail(`${label}不能为空。`);
    return result;
  }
  function identifier(value, label) {
    const result = text(value, 200, label);
    if (!/^[A-Za-z0-9._:/-]+$/.test(result)) fail(`${label}包含无效字符。`);
    return result;
  }
  function count(value, label, nullable = false, max = MAX_COUNT) {
    if (nullable && (value === null || value === undefined)) return null;
    if (!Number.isSafeInteger(value) || value < 0 || value > max) fail(`${label}必须是范围内的非负整数。`);
    return value;
  }
  function notes(value, label) {
    if (value === undefined || value === null) return [];
    const list = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(list) || list.length > 50) fail(`${label}格式无效或过多。`);
    return list.map(item => text(item, 1000, label, true));
  }
  function isDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + 'T12:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  function today(now = new Date(), timezone = TIMEZONE) {
    const date = now instanceof Date ? now : new Date(now);
    if (!Number.isFinite(date.getTime())) fail('时间无效。');
    if(!dateFormats.has(timezone)){if(dateFormats.size>=32)dateFormats.delete(dateFormats.keys().next().value);dateFormats.set(timezone,new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}));}
    const parts = dateFormats.get(timezone).formatToParts(date);
    const part = type => parts.find(item => item.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function offsetDate(date, offset) {
    const parsed = new Date(date + 'T12:00:00Z');
    parsed.setUTCDate(parsed.getUTCDate() + offset);
    return parsed.toISOString().slice(0, 10);
  }
  function timestamp(value, label) {
    const result = text(value, 50, label);
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(result) || !isDate(result.slice(0, 10))) fail(`${label}需要带时区的 ISO 时间。`);
    const date = new Date(result);
    if (!Number.isFinite(date.getTime())) fail(`${label}无效。`);
    return date.toISOString();
  }
  function hash(value, label, nullable = false) {
    if (nullable && (value === null || value === undefined || value === '')) return null;
    if (typeof value !== 'string' || !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(value)) fail(`${label}必须是完整 Git 哈希。`);
    return value.toLowerCase();
  }
  // One receipt per actual path in this output version. Original request text
  // is optional and is removed from public snapshots when sharing it is off.
  function outputTraces(raw, paths, collectedAt) {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > 20) fail('产出回执数量无效。');
    const seen = new Set();
    return raw.map(value => {
      object(value, '产出回执');
      if (!paths.includes(value.path) || seen.has(value.path) || !['create','edit'].includes(value.operation)) fail('回执的文件或操作无效。');
      seen.add(value.path);
      const producedAt = timestamp(value.producedAt, '生成时间');
      if (Date.parse(producedAt)>Date.parse(collectedAt)) fail('回执时间晚于采集时间。');
      const sourceRef = identifier(value.sourceRef, '回执编号');
      if (/^(?:\/|[A-Za-z]:[\\/]|[a-z]+:\/\/)/i.test(sourceRef)) fail('回执编号须为不含绝对路径的引用。');
      const trace = {path:value.path, sourceId:identifier(value.sourceId,'生成来源'), sourceRef, producedAt, operation:value.operation};
      if(value.workTokens!==undefined && Number.isSafeInteger(value.workTokens) && value.workTokens>=0)trace.workTokens=value.workTokens;
      if (value.title !== undefined) trace.title = text(value.title,120,'作品名称');
      if (value.request !== undefined || value.requestedAt !== undefined) {
        trace.requestedAt=timestamp(value.requestedAt,'请求时间');
        trace.request=text(value.request,440,'请求原话');
        if (trace.requestedAt>producedAt || /[\r\n\t]/.test(trace.request) || Array.from(trace.request).length>220) fail('请求和回执不匹配。');
      }
      return trace;
    });
  }
  function usage(input) {
    const raw = object(input, '用量');
    if (!['observed', 'partial', 'unavailable'].includes(raw.quality)) fail('用量质量标记无效。');
    const result = {};
    for (const name of TOKEN_FIELDS) result[name] = count(raw[name], name, true, MAX_TOKENS);
    result.sessions = count(raw.sessions, '会话数', true);
    result.quality = raw.quality;
    if (raw.quality === 'unavailable' && [...TOKEN_FIELDS, 'sessions'].some(name => result[name] !== null)) fail('不可用用量不能包含伪造的零值或其他计数。');
    if (result.inputTokens !== null && result.cachedInputTokens !== null && result.cachedInputTokens > result.inputTokens) fail('缓存输入不能超过总输入。');
    if (result.inputTokens !== null && result.cacheWriteInputTokens !== null && result.cacheWriteInputTokens > result.inputTokens) fail('缓存写入不能超过总输入。');
    if (result.outputTokens !== null && result.reasoningOutputTokens !== null && result.reasoningOutputTokens > result.outputTokens) fail('推理输出不能超过总输出。');
    if (result.totalTokens !== null && result.inputTokens !== null && result.outputTokens !== null && result.totalTokens !== result.inputTokens + result.outputTokens) fail('Token 总量必须等于输入加输出，不能再次加上缓存或推理。');
    return result;
  }
  function outputDeliveries(raw, paths, observedAt, collectedAt) {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length>paths.length) fail('作品交付数量无效。');
    const seen=new Set();
    return raw.map(value=>{
      object(value,'作品交付');
      if (!paths.includes(value.path)||seen.has(value.path)||!['codex','claude-code'].includes(value.sourceId)||
        !/^delivery:[a-f0-9]{64}$/.test(value.sourceRef)) fail('作品交付引用无效。');
      seen.add(value.path);
      const deliveredAt=timestamp(value.deliveredAt,'交付时间');
      if(deliveredAt<observedAt || deliveredAt>collectedAt)fail('作品交付时间无效。');
      const d={path:value.path,sourceId:value.sourceId,sourceRef:value.sourceRef,deliveredAt};
      if(value.label!==undefined)d.label=text(value.label,160,'交付链接文字');
      if(value.request!==undefined||value.requestedAt!==undefined){
        d.request=text(value.request,440,'交付请求');
        d.requestedAt=timestamp(value.requestedAt,'请求时间');
        if(d.requestedAt>deliveredAt||/[\r\n\t]/.test(d.request)||Array.from(d.request).length>220)fail('交付请求无效。');
      }
      return d;
    });
  }
  function files(input, bounds) {
    if (!Array.isArray(input) || input.length > 2000) fail('提交文件列表无效或过长。');
    bounds.files += input.length;
    if (bounds.files > (bounds.maxFiles || 20000)) fail('快照文件条目超过上限。');
    const unique = new Map();
    for (const raw of input) {
      object(raw, '文件证据');
      const path = text(raw.path, 2048, '文件路径').replace(/\\/g, '/');
      if (/^(?:\/|[A-Za-z]:)/.test(path) || path.split('/').some(part => part === '..' || !part) || /[\r\n\t]/.test(path)) fail('文件证据需要仓库相对路径。');
      if (!FILE_KINDS.includes(raw.kind)) fail('文件类别无效。');
      if (unique.has(path) && unique.get(path).kind !== raw.kind) fail('同一文件的类别存在冲突。');
      unique.set(path, { path, kind: raw.kind });
    }
    return [...unique.values()].sort((a, b) => compare(a.path, b.path));
  }

  function validateSnapshot(input) {
    const raw = object(input, '采集快照');
    if (raw.schemaVersion !== 1 || raw.kind !== 'deepmine-evidence') fail('这不是支持的深矿证据快照。');
    const timezone = text(raw.timezone, 100, '时区');
    try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date()); } catch { fail('快照时区无效。'); }
    if (raw.mode !== undefined && !['live', 'demo'].includes(raw.mode)) fail('快照模式无效。');
    const collectedAt = timestamp(raw.collectedAt, '采集时间'), endDate = today(collectedAt, timezone), historical = raw.history?.enabled === true;
    const rawProject = object(raw.project, '项目');
    const project = { id: identifier(rawProject.id, '项目编号'), label: text(rawProject.label, 160, '项目名称') };
    const rawSources = object(raw.sources, '来源');
    const codex = object(rawSources.codex, 'Codex 来源'), git = object(rawSources.git, 'Git 来源');
    if (!['connected', 'partial', 'missing', 'error'].includes(codex.status)) fail('Codex 来源状态无效。');
    if (!['connected', 'missing', 'error'].includes(git.status)) fail('Git 来源状态无效。');
    const sources = {
      codex: { status: codex.status, sessions: count(codex.sessions, '来源会话数'), events: count(codex.events, '来源事件数'), method: text(codex.method, 240, '采集方法', true), notes: notes(codex.notes, 'Codex 说明') },
      git: { status: git.status, branch: git.branch === null || git.branch === undefined ? null : text(git.branch, 240, 'Git 分支', true), head: hash(git.head, 'Git HEAD', true), notes: notes(git.notes, 'Git 说明') }
    };
    if (!Array.isArray(raw.days) || raw.days.length > (historical ? 10000 : 31)) fail('快照天数超过上限。');
    const dates = new Set(), commitIds = new Map(), commits = new Map(), bounds = { evidence: 0, files: 0, maxFiles: historical ? 500000 : 20000 };
    const days = raw.days.map(day => {
      object(day, '每日证据');
      if (!isDate(day.date) || day.date > endDate) fail('证据日期无效或晚于采集日期。');
      if (dates.has(day.date)) fail('快照包含重复日期。');
      dates.add(day.date);
      const normalizedUsage = usage(day.usage);
      if (!Array.isArray(day.evidence)) fail('每日证据必须是数组。');
      bounds.evidence += day.evidence.length;
      if (bounds.evidence > (historical ? 50000 : 1000)) fail('快照提交证据超过上限。');
      const evidence = [];
      for (const item of day.evidence) {
        object(item, '提交证据');
        if (item.kind !== 'git-commit') fail('不支持此证据类型。');
        const commitHash = hash(item.hash, '提交哈希'), id = identifier(item.id, '证据编号');
        const commitTime = timestamp(item.timestamp, '提交时间');
        if (today(commitTime, timezone) !== day.date) fail('提交时间与所属日期不一致。');
        const shortHash = text(item.shortHash, 16, '短提交哈希').toLowerCase();
        if (!/^[a-f0-9]{4,16}$/.test(shortHash) || !commitHash.startsWith(shortHash)) fail('短提交哈希与完整哈希不一致。');
        const entry = { id, kind: 'git-commit', timestamp: commitTime, hash: commitHash, shortHash, title: text(item.title, 240, '提交标题'), files: files(item.files, bounds) };
        if (commitIds.has(id) && commitIds.get(id) !== commitHash) fail('证据编号对应了不同提交。');
        commitIds.set(id, commitHash);
        if (commits.has(commitHash)) {
          const previous = commits.get(commitHash);
          if (JSON.stringify({ ...previous, id: '' }) !== JSON.stringify({ ...entry, id: '' })) fail('重复提交的元数据不一致。');
          continue;
        }
        commits.set(commitHash, entry);
        evidence.push(entry);
      }
      const usageSourceIds=day.usageSourceIds||[];if(!Array.isArray(usageSourceIds)||usageSourceIds.length>32)fail('每日用量来源无效。');
      let sourceTokenTotals;
      if (day.sourceTokenTotals!==undefined) {
        const totals=Object.entries(object(day.sourceTokenTotals,'每日各来源用量'));
        if (totals.length>32) fail('每日用量来源过多。');
        sourceTokenTotals=Object.fromEntries(totals.map(([id,total])=>[
          identifier(id,'每日用量来源'), count(total,'来源 Token 总量',true,MAX_TOKENS)
        ]));
      }
      let placements;
      if (day.placements) {
        const entries = Object.entries(object(day.placements, '发现位置'));
        if (entries.length > 12 || entries.some(([key, value]) =>
          !/^(?:finding\/(?:web|document|image|audio|video|slides|table|code|file)|memory\/[0-2])$/.test(key) ||
          !Number.isFinite(value) || value < 0 || value > 1000)) fail('发现位置无效。');
        placements = Object.fromEntries(entries);
      }
      return { date: day.date, usage: normalizedUsage, ...(placements ? {placements} : {}), evidence: evidence.sort((a, b) => compare(a.timestamp, b.timestamp) || compare(a.hash, b.hash)), ...(usageSourceIds.length?{usageSourceIds:[...new Set(usageSourceIds.map(id=>identifier(id,'每日用量来源')))]}:{}),...(sourceTokenTotals?{sourceTokenTotals}:{}) };
    }).sort((a, b) => compare(a.date, b.date));
    if (!historical && sources.git.status !== 'connected' && commits.size) fail('未连接的 Git 来源不能提供提交证据。');
    if (!historical && ['missing', 'error'].includes(sources.codex.status) && days.some(day => day.usage.quality !== 'unavailable')) fail('未连接的 Codex 来源不能提供已观测用量。');
    const tree = object(raw.workingTree, '工作区状态');
    if (!['connected', 'observed', 'clean', 'dirty', 'unavailable', 'missing', 'error'].includes(tree.status)) fail('工作区状态无效。');
    const workingTree = { modified: count(tree.modified, '工作区修改数', true), untracked: count(tree.untracked, '未跟踪文件数', true), status: tree.status };
    const usageSources = (raw.usageSources === undefined ? [] : raw.usageSources);
    if (!Array.isArray(usageSources) || usageSources.length > 32) fail('用量来源列表无效。');
    const sourceIds = new Set();
    const normalizedSources = usageSources.map(source => {
      object(source, '用量来源'); const id = identifier(source.id, '用量来源编号');
      if (sourceIds.has(id) || !['connected', 'partial', 'missing', 'error', 'disabled'].includes(source.status)) fail('用量来源重复或状态无效。');
      sourceIds.add(id);
      return { id, label: text(source.label, 100, '用量来源名称'), status: source.status, method: text(source.method, 1000, '来源方法', true), notes: notes(source.notes, '来源说明') };
    });
    for (const day of days) if (day.sourceTokenTotals) {
      for (const id of Object.keys(day.sourceTokenTotals)) if (!sourceIds.has(id)) fail('每日用量来源未登记。');
      const known=Object.values(day.sourceTokenTotals).reduce((sum,n)=>sum+(n??0),0);
      if (day.usage.totalTokens!==null && known>day.usage.totalTokens) fail('各来源计数超过当日总量。');
    }
    const outputSource = raw.outputSource === undefined ? { status: 'disabled', notes: [] } : object(raw.outputSource, '输出文件来源');
    if (!['connected', 'partial', 'missing', 'error', 'disabled'].includes(outputSource.status)) fail('输出文件来源状态无效。');
    const rawOutputs = raw.outputs === undefined ? [] : raw.outputs;
    if (!Array.isArray(rawOutputs) || rawOutputs.length > (historical ? 50000 : 1000)) fail('输出文件记录过多。');
    const outputIds = new Set(), outputTypes = ['web', 'document', 'image', 'audio', 'video', 'slides', 'table', 'code', 'file'];
    const outputs = rawOutputs.map(output => {
      object(output, '输出文件记录');
      const id = identifier(output.id, '输出编号'), projectId = identifier(output.projectId, '输出项目');
      const at = timestamp(output.timestamp, '输出时间');
      if (projectId !== project.id || outputIds.has(id) || Date.parse(at) > Date.parse(collectedAt)) fail('输出项目、编号或时间不匹配。');
      if (!outputTypes.includes(output.type) || !Array.isArray(output.files) || !output.files.length || output.files.length > 20 || output.files.some(file => typeof file !== 'string')) fail('输出类型或文件列表无效。');
      if (!/^[a-f0-9]{64}$/.test(output.fingerprint)) fail('输出指纹无效。');
      outputIds.add(id);
      const paths = files(output.files.map(path => ({ path, kind: 'other' })), { files: 0 }).map(file => file.path);
      const traces = outputTraces(output.traces,paths,collectedAt);
      const deliveries = outputDeliveries(output.deliveries,paths,at,collectedAt);
      return { id, projectId, sourceId: identifier(output.sourceId, '输出来源'), timestamp: at, type: output.type, title: text(output.title, 160, '输出名称'), files: paths, summary: text(output.summary, 500, '输出说明', true), fingerprint: output.fingerprint, ...(traces.length?{traces}:{}), ...(deliveries.length?{deliveries}:{}), ...(output.contentVersion===1 && output.sourceId==='local-files'?{contentVersion:1}:{}), ...(Number.isSafeInteger(output.byteLength) && output.byteLength>=0?{byteLength:output.byteLength}:{}) };
    });
    if (!historical && outputs.length && !['connected', 'partial'].includes(outputSource.status)) fail('未连接的输出文件来源不能提供记录。');
    const rawMemories = raw.memories || [], memoryIds = new Set();
    if (!Array.isArray(rawMemories) || rawMemories.length > 20000) fail('对话记忆过多。');
    const memories = rawMemories.map(item => {
      object(item, '对话记忆'); const id = identifier(item.id, '记忆编号'), at = timestamp(item.timestamp, '记忆时间');
      if (memoryIds.has(id) || item.projectId !== project.id || Date.parse(at) > Date.parse(collectedAt)) fail('记忆来源或时间不匹配。');
      memoryIds.add(id);
      if (!['agent-memory','conversation-excerpt'].includes(item.method)) fail('记忆方法无效。');
      return { id, projectId: project.id, timestamp: at, sourceId: identifier(item.sourceId, '记忆来源'), sourceRef: text(item.sourceRef, 240, '消息引用'), title: text(item.title, 160, '记忆标题'), summary: text(item.summary, 500, '记忆内容'), method: item.method, objectType: outputTypes.includes(item.objectType) ? item.objectType : 'memory' };
    });
    const preferences = { locale: /^(zh-CN|en|ja)$/.test(raw.preferences?.locale) ? raw.preferences.locale : null };
    const history = historical ? { enabled: true, startDate: days[0]?.date || endDate, endDate, dayCount: days.length, revision: count(raw.history.revision || 0, '历史版本'), capturedAt: raw.history.capturedAt ? timestamp(raw.history.capturedAt, '历史记录时间') : collectedAt } : undefined;
    const mining = raw.mining ? { earnedDepth: count(raw.mining.earnedDepth, '可开挖深度'), excavatedDepth: Math.max(0, Math.min(Number(raw.mining.excavatedDepth) || 0, Number(raw.mining.earnedDepth) || 0)), pendingDepth: Math.max(0, Number(raw.mining.pendingDepth) || 0), active: raw.mining.active === true, revision: count(raw.mining.revision || 0, '开挖版本'), lastSettledDate: isDate(raw.mining.lastSettledDate) ? raw.mining.lastSettledDate : null } : undefined;
    if (history && isDate(raw.history.pacingFrom)) history.pacingFrom = raw.history.pacingFrom;
    if (mining && raw.mining.radio && isDate(raw.mining.radio.date)) {
      const {date, meters, slots, claimed} = raw.mining.radio;
      if (Number.isFinite(meters) && meters >= 0 && Number.isInteger(slots) && slots >= 0 && slots <= 3 &&
          Number.isInteger(claimed) && claimed >= 0 && claimed <= slots) mining.radio = {date, meters, slots, claimed};
    }
    return { schemaVersion: 1, kind: 'deepmine-evidence', mode: raw.mode || 'live', collectedAt, timezone, project, sources, days, workingTree, usageSources: normalizedSources, outputs, memories, preferences, ...(history?{history}:{}), ...(mining?{mining}:{}), outputSource: { status: outputSource.status, notes: notes(outputSource.notes, '输出说明') }, warnings: notes(raw.warnings, '采集警告') };
  }

  function uncached(usage) {
    return usage && usage.inputTokens !== null && usage.cachedInputTokens !== null ? usage.inputTokens - usage.cachedInputTokens : null;
  }
  function knownTotal(days, field) {
    if (!days.length || days.some(day => day.usage[field] === null)) return null;
    return days.reduce((sum, day) => sum + day.usage[field], 0);
  }
  function stableHash(value){let n=2166136261;for(let i=0;i<value.length;i++)n=Math.imul(n^value.charCodeAt(i),16777619)>>>0;return n;}
  function classify(path,kind){
    const name=path.split('/').pop().toLowerCase();
    if(/\.(?:html?|xhtml|vue|svelte|astro)$/.test(name))return'web';
    if(/\.(?:md|mdx|rst|adoc|txt|org|pdf|docx?|odt|rtf|epub|tex)$/.test(name)||/^(?:readme|changelog|license|authors)(?:\.|$)/.test(name))return'document';
    if(/\.(?:png|jpe?g|gif|webp|svg|avif|bmp|tiff?|ico|aseprite|ase|psd|ai|xcf|kra|ora|sketch|fig|drawio)$/.test(name))return'image';
    if(/\.(?:wav|ogg|mp3|flac|m4a|aac|aiff?|opus|mid|midi)$/.test(name))return'audio';
    if(/\.(?:mp4|mov|webm|avi|mkv|m4v|mpeg|mpg)$/.test(name))return'video';
    if(/\.(?:pptx?|odp|key)$/.test(name))return'slides';
    if(/\.(?:xlsx?|xlsm|csv|tsv|ods|numbers|parquet)$/.test(name))return'table';
    if(/\.(?:[cm]?jsx?|tsx?|py|ipynb|rb|go|rs|java|kt|swift|cs|c|cc|cpp|h|hpp|lua|gd|sh|bash|zsh|ps1|bat|cmd|css|scss|sass|less|glsl|vert|frag|shader|sql|r)$/.test(name)||/^(?:makefile|dockerfile)$/.test(name))return'code';
    return kind==='document'?'document':'file';
  }
  function tokenMetres(tokens) {
    return tokens === null ? 0 : Math.min(300, Math.floor(14 * Math.log2(1 + tokens / 500)));
  }
  function project(input) {
    const snapshot = validateSnapshot(input), endDate = today(snapshot.collectedAt, snapshot.timezone), startDate = snapshot.history?.enabled ? snapshot.history.startDate : offsetDate(endDate, 1 - PERIOD_DAYS);
    const period = snapshot.days.filter(day => day.date >= startDate && day.date <= endDate);
    const sourceEvidence = [], discoveries = [], days = [];
    const outputsByDate=new Map(),memoriesByDate=new Map();
    // Keep the newest observed file type, including explicit SDK types for
    // extensionless files. WorkFindings uses the same timestamp / ID order.
    const recentOutputs = [...snapshot.outputs].sort((a,b) => b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id));
    for (const item of recentOutputs) {
      const date = today(item.timestamp, snapshot.timezone);
      if (!outputsByDate.has(date)) outputsByDate.set(date, new Map());
      const paths = outputsByDate.get(date);
      for (const file of item.files) if (!paths.has(file)) paths.set(file, item.type);
    }
    for (const item of snapshot.memories) {
      const date = today(item.timestamp, snapshot.timezone);
      if (!memoriesByDate.has(date)) memoriesByDate.set(date, new Set());
      memoriesByDate.get(date).add(stableHash(item.id) % 3);
    }
    let depth = 0;
    for (const day of period) {
      const depthStart = depth, noncached = uncached(day.usage);
      const hasUsageOperands = day.usage.quality !== 'unavailable' && noncached !== null && day.usage.outputTokens !== null;
      const extended = snapshot.history?.pacingFrom && day.date >= snapshot.history.pacingFrom;
      const usageDepth = extended ? tokenMetres(day.usage.totalTokens) : snapshot.history?.enabled ? (day.usage.totalTokens!==null?Math.min(18,Math.floor(Math.log2(1+day.usage.totalTokens/1000))*2):0) : hasUsageOperands ? Math.min(18, Math.floor(Math.log2(1 + (noncached + day.usage.outputTokens) / 1000)) * 2) : 0;
      const groups = new Map(FILE_KINDS.map(kind => [kind, { paths: new Set(), evidenceIds: new Set() }]));
      const dayPaths = new Map();
      for (const evidence of day.evidence) {
        sourceEvidence.push({ ...evidence, id: evidence.hash, sourceId: evidence.id, date: day.date });
        for (const file of evidence.files) {
          if (dayPaths.has(file.path) && dayPaths.get(file.path) !== file.kind) fail('同一天的同一文件出现相互冲突的分类。');
          dayPaths.set(file.path, file.kind);
          groups.get(file.kind).paths.add(file.path);
          groups.get(file.kind).evidenceIds.add(evidence.hash);
        }
      }
      const outputPaths = outputsByDate.get(day.date)||new Map();
      const memoryCount = memoriesByDate.get(day.date)?.size||0;
      // A day contributes once from its evidence sets, never from button presses.
      // Local output observations get a small fixed layer; they are not a completion score.
      let outputDepth = snapshot.history?.enabled ? (dayPaths.size ? 18 : outputPaths.size ? 12 : memoryCount ? 6 : 0) : (dayPaths.size ? 18 : 0);
      if (extended && outputDepth) {
        const types = new Set([...dayPaths].map(([name, kind]) => classify(name, kind)));
        for (const [name, type] of outputPaths) if (!dayPaths.has(name)) types.add(type);
        // One interval per distinct kind plus up to three conversation stops.
        outputDepth = 12 + 18 * (types.size + Math.min(3, memoryCount));
      }
      depth += usageDepth + outputDepth;
      const present = [...groups.entries()].filter(([, group]) => group.paths.size);
      present.forEach(([kind, group], index) => {
        discoveries.push({ id: `${snapshot.project.id}/${day.date}/${kind}`, depth: Math.round(depthStart + (depth - depthStart) * (index + 1) / (present.length + 1)), kind, title: LABELS[kind], date: day.date, evidenceIds: [...group.evidenceIds].sort(), count: group.paths.size });
      });
      days.push({ date: day.date, depthStart, depthEnd: depth, tokens: day.usage.totalTokens, usageDepth, outputDepth, hasEvidence: day.evidence.length > 0 || outputPaths.size > 0 || memoryCount > 0 });
    }
    const current = period.find(day => day.date === endDate), currentUsage = current?.usage;
    const todayFiles = Object.fromEntries(FILE_KINDS.map(kind => [kind, new Set()]));
    for (const entry of current?.evidence || []) for (const file of entry.files) todayFiles[file.kind].add(file.path);
    const gitKnown = snapshot.sources.git.status === 'connected';
    return {
      depth,
      today: { date: endDate, tokens: currentUsage?.totalTokens ?? null, uncachedTokens: uncached(currentUsage), cachedTokens: currentUsage?.cachedInputTokens ?? null, outputTokens: currentUsage?.outputTokens ?? null, sessions: currentUsage?.sessions ?? null, commits: gitKnown && current ? current.evidence.length : null, codeFiles: todayFiles.code.size, documentFiles: todayFiles.document.size, assetFiles: todayFiles.asset.size },
      totals: { tokens: knownTotal(period, 'totalTokens'), commits: gitKnown && period.length ? sourceEvidence.length : null, evidenceCount: sourceEvidence.length, days: period.length },
      discoveries, days, sourceEvidence
    };
  }

  function demoSnapshot(now = new Date()) {
    const instant = now instanceof Date ? now : new Date(now), date = today(instant), previous = offsetDate(date, -1);
    const evidence = (digit, at, title, paths) => ({ id: `git:fictional:${digit.repeat(40)}`, kind: 'git-commit', timestamp: at, hash: digit.repeat(40), shortHash: digit.repeat(8), title: `演示（虚构）：${title}`, files: paths });
    return validateSnapshot({
      schemaVersion: 1, kind: 'deepmine-evidence', mode: 'demo', collectedAt: instant.toISOString(), timezone: TIMEZONE,
      project: { id: 'fictional-preview', label: '虚构演示项目 · 非个人数据' },
      sources: { codex: { status: 'connected', sessions: 3, events: 6, method: 'fictional-demo-only', notes: ['所有数据均为虚构，仅在主动进入预览时使用。'] }, git: { status: 'connected', branch: 'fictional-preview', head: '2'.repeat(40), notes: ['不是本地仓库或真实提交。'] } },
      days: [
        { date: previous, usage: { inputTokens: 12000, cachedInputTokens: 7000, outputTokens: 3000, totalTokens: 15000, reasoningOutputTokens: 1000, cacheWriteInputTokens: 0, sessions: 1, quality: 'observed' }, evidence: [evidence('1', previous + 'T12:00:00+08:00', '调整样例采样器', [{ path: 'demo/sampler.js', kind: 'code' }, { path: 'demo/notes.md', kind: 'document' }])] },
        { date, usage: { inputTokens: 28000, cachedInputTokens: 18000, outputTokens: 6000, totalTokens: 34000, reasoningOutputTokens: 2000, cacheWriteInputTokens: 0, sessions: 2, quality: 'observed' }, evidence: [evidence('2', instant.toISOString(), '更新样例地图资源', [{ path: 'demo/map.js', kind: 'code' }, { path: 'demo/rig.png', kind: 'asset' }])] }
      ],
      workingTree: { modified: 0, untracked: 0, status: 'clean' }, warnings: ['预览数据是虚构的，不能代表实际用量、产出或质量。']
    });
  }
  function escapeHTML(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  function formatTokens(value) {
    if (!Number.isFinite(value) || value < 0) return '—';
    if (value >= 1e9) return (value / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (value >= 1e6) return (value / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (value >= 1e3) return (value / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.floor(value));
  }
  return Object.freeze({ TIMEZONE, PERIOD_DAYS, today, validateSnapshot, project, stableHash, classify, tokenMetres, demoSnapshot, escapeHTML, formatTokens });
});
