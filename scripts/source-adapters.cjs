'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const FIELDS = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'totalTokens', 'reasoningOutputTokens', 'cacheWriteInputTokens'];
const MAX_FILES = 4000, MAX_LINES = 200000, MAX_LINE = 2 * 1024 * 1024, MAX_FILE = 128 * 1024 * 1024, MAX_TOKENS = 1e12;
const CLAUDE_METHOD = '按 cwd 筛选 Claude Code 本机 projects JSONL；assistant message/request 标识去重，重复流式记录取一致的最大计数。输入包含普通输入、缓存读取与缓存写入；不代表账单。';
const IMPORT_METHOD = '读取显式配置的 NDJSON 单次调用计数；项目路径必须一致，source + id 去重，冲突条目不计入。';
function defaults(home = os.homedir(), env = process.env, platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  return { codexRoot: env.CODEX_HOME || p.join(home, '.codex'), claudeRoot: env.CLAUDE_CONFIG_DIR || p.join(home, '.claude') };
}
function canonical(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) return null;
  // A rollout's recorded path has its own path grammar. Do not resolve a
  // missing drive or relative directory against the collector process.
  const slashed=value.replace(/\\/g,'/');
  let win=slashed;
  if (/^\/\/\?\/unc\//i.test(win)) win='//'+win.slice(8);
  else if (/^\/\/\?\/[a-z]:\//i.test(win)) win=win.slice(4);
  else if (/^\/\/[?.]\//.test(win)) return null;
  if (/^[a-z]:\//i.test(win) || /^\/\/[^/]+\/[^/]+/.test(win)) {
    const result=path.win32.normalize(win).replace(/\\/g,'/').toLowerCase();
    return /^[a-z]:\/$/.test(result)?result:result.replace(/\/+$/,'');
  }
  if (!value.startsWith('/')) return null;
  return path.posix.normalize(value).replace(/\/+$/,'') || '/';
}
function inScope(value, root) {
  const a=canonical(value), b=canonical(root);
  if (!a || !b || (b==='/' && a.startsWith('//'))) return false;
  return a===b || a.startsWith(b.endsWith('/')?b:b+'/');
}
function dateOf(timestamp, timezone = 'Asia/Shanghai') { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp)); }
function timestamp(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)); }
function id(value) { return typeof value === 'string' && /^[A-Za-z0-9._:/-]{1,160}$/.test(value); }
function count(value) { return Number.isSafeInteger(value) && value >= 0 && value <= MAX_TOKENS; }
function emptyUsage(available) { return { ...Object.fromEntries(FIELDS.map(key => [key, available ? 0 : null])), sessions: available ? 0 : null, quality: available ? 'observed' : 'unavailable' }; }
function claudeEvent(raw, scopePath) {
  if (!raw || raw.type !== 'assistant' || !inScope(raw.cwd, scopePath)) return null;
  const message = raw.message, usage = message?.usage;
  if (!id(raw.sessionId) || !id(message?.id) || !timestamp(raw.timestamp) || !usage || typeof usage !== 'object') return { invalid: true };
  if (raw.requestId !== undefined && !id(raw.requestId)) return { invalid: true };
  if (!count(usage.input_tokens) || !count(usage.output_tokens)) return { invalid: true };
  const read = usage.cache_read_input_tokens, write = usage.cache_creation_input_tokens;
  if ((read !== undefined && !count(read)) || (write !== undefined && !count(write))) return { invalid: true };
  const allInput = read === undefined || write === undefined ? null : usage.input_tokens + read + write;
  if (allInput !== null && (!count(allInput) || !count(allInput + usage.output_tokens))) return { invalid: true };
  return {
    sourceId: 'claude-code', key: raw.requestId ? `request:${raw.requestId}` : `message:${message.id}`, messageId: message.id,
    sessionId: raw.sessionId, timestamp: raw.timestamp, project: canonical(raw.cwd),
    usage: { inputTokens: allInput, cachedInputTokens: read ?? null, outputTokens: usage.output_tokens, totalTokens: allInput === null ? null : allInput + usage.output_tokens, reasoningOutputTokens: null, cacheWriteInputTokens: write ?? null }, partial: allInput === null
  };
}
function importEvent(raw, projectPath) {
  const project=canonical(projectPath);
  if (!project || !raw || typeof raw !== 'object' || Array.isArray(raw) || canonical(raw.projectPath) !== project) return null;
  const allowed = ['schemaVersion', 'id', 'source', 'projectPath', 'timestamp', 'sessionId', 'usage'];
  if (Object.keys(raw).some(key => !allowed.includes(key)) || raw.schemaVersion !== 1 || !id(raw.id) || !id(raw.sessionId) || !/^[a-z][a-z0-9-]{0,39}$/.test(raw.source) || ['codex', 'claude', 'claude-code'].includes(raw.source) || !timestamp(raw.timestamp)) return { invalid: true };
  const u = raw.usage;
  if (!u || typeof u !== 'object' || Array.isArray(u) || Object.keys(u).some(key => !['inputTokens', 'cachedInputTokens', 'outputTokens', 'totalTokens'].includes(key))) return { invalid: true };
  if (![u.inputTokens, u.outputTokens, u.totalTokens].every(count) || !(u.cachedInputTokens === null || count(u.cachedInputTokens)) || u.inputTokens + u.outputTokens !== u.totalTokens || (u.cachedInputTokens !== null && u.cachedInputTokens > u.inputTokens)) return { invalid: true };
  return { sourceId: `import:${raw.source}`, key: raw.id, sessionId: raw.sessionId, timestamp: raw.timestamp, project: canonical(raw.projectPath), usage: { inputTokens: u.inputTokens, cachedInputTokens: u.cachedInputTokens, outputTokens: u.outputTokens, totalTokens: u.totalTokens, reasoningOutputTokens: null, cacheWriteInputTokens: null }, partial: u.cachedInputTokens === null };
}
async function listClaude(root) {
  const result = { files: [], available: false, partial: false };
  let entries = 0;
  async function walk(directory, depth) {
    if (depth > 6 || entries >= MAX_FILES * 4) { result.partial = true; return; }
    let stat, children;
    try { stat = await fs.promises.lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) return; children = await fs.promises.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') result.partial = true; return; }
    result.available = true;
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++entries > MAX_FILES * 4 || result.files.length >= MAX_FILES) { result.partial = true; return; }
      if (child.name.startsWith('.') || child.isSymbolicLink()) continue;
      const filename = path.join(directory, child.name);
      if (child.isDirectory()) await walk(filename, depth + 1);
      else if (child.isFile() && child.name.endsWith('.jsonl')) result.files.push(filename);
    }
  }
  await walk(path.join(root, 'projects'), 0); return result;
}
async function readEvents(filename, parser, isClaude, remaining) {
  const result = { events: [], partial: false, available: false };
  let stat;
  try { stat = await fs.promises.lstat(filename); } catch { result.partial = true; return result; }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_FILE) { result.partial = true; return result; }
  result.available = true;
  const input = fs.createReadStream(filename, { encoding: 'utf8' }), lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (--remaining.lines < 0) { result.partial = true; break; }
      if (!line.trim()) continue;
      if (line.length > MAX_LINE) { result.partial = true; continue; }
      // User/tool rows are skipped; assistant bodies are discarded after extracting counters.
      if (isClaude && !/"type"\s*:\s*"assistant"/.test(line)) continue;
      let raw; try { raw = JSON.parse(line); } catch { result.partial = true; continue; }
      const event = parser(raw);
      if (event?.invalid) result.partial = true;
      else if (event) result.events.push(event);
    }
  } catch { result.partial = true; }
  finally { lines.close(); input.destroy(); }
  return result;
}
function aggregate(events, dates, now, sourceId, kind, scanPartial = false, timezone = 'Asia/Shanghai') {
  const groups = new Map(), aliases = new Map(), notes = new Set(); let partial = scanPartial;
  for (const event of events) {
    if (event.sourceId !== sourceId || Date.parse(event.timestamp) > now.getTime()) continue;
    let key = event.key;
    if (kind === 'claude') {
      const messageKey = 'message:' + event.messageId, oldMessage = aliases.get(messageKey), oldRequest = aliases.get(event.key);
      if (oldMessage && oldRequest && oldMessage !== oldRequest) {
        groups.set(oldMessage, false); groups.set(oldRequest, false); partial = true; notes.add('调用标识关联出现冲突，已排除相关调用。'); continue;
      }
      key = oldMessage || oldRequest || event.key;
      aliases.set(messageKey, key); aliases.set(event.key, key);
    }
    const previous = groups.get(key);
    if (previous === false) continue;
    if (!previous) { groups.set(key, event); continue; }
    const scopeConflict = previous.project !== event.project || previous.sessionId !== event.sessionId || dateOf(previous.timestamp, timezone) !== dateOf(event.timestamp, timezone);
    const equal = FIELDS.every(field => previous.usage[field] === event.usage[field]);
    if (!scopeConflict && equal) continue;
    const dominates = (a, b) => FIELDS.every(field => a[field] === b[field] || (a[field] !== null && b[field] !== null && a[field] >= b[field]));
    if (!scopeConflict && kind === 'claude' && previous.messageId === event.messageId && (dominates(event.usage, previous.usage) || dominates(previous.usage, event.usage))) {
      if (dominates(event.usage, previous.usage)) groups.set(key, event);
      continue;
    }
    groups.set(key, false); partial = true; notes.add('相同调用标识出现冲突，已排除该调用，未重复累计。');
  }
  const usable = [...groups.values()].filter(Boolean), buckets = new Map(dates.map(date => [date, { usage: emptyUsage(Boolean(usable.length)), sessions: new Set() }]));
  let eventCount = 0;
  for (const event of usable) {
    const bucket = buckets.get(dateOf(event.timestamp, timezone)); if (!bucket) continue;
    eventCount++; bucket.sessions.add(event.sessionId); partial ||= event.partial;
    for (const key of FIELDS) {
      const next = bucket.usage[key] === null || event.usage[key] === null ? null : bucket.usage[key] + event.usage[key];
      if (next !== null && !count(next)) { bucket.usage[key] = null; partial = true; notes.add('计数超过支持范围，该字段保留未知。'); }
      else bucket.usage[key] = next;
    }
  }
  if (!usable.length) notes.add('没有可识别的所选项目调用计数，未知不等于零。');
  if (scanPartial) notes.add('日志有不可读取、截断、过大或格式不受支持的条目，结果不完整。');
  for (const bucket of buckets.values()) if (usable.length) { bucket.usage.sessions = bucket.sessions.size; bucket.usage.quality = partial ? 'partial' : 'observed'; }
  return { days: dates.map(date => ({ date, usage: buckets.get(date).usage })), usable: usable.length, events: eventCount, sessions: new Set(usable.map(event => event.sessionId)).size, partial, notes: [...notes] };
}
async function collectAdditional({ projectPath, scopePath = projectPath, claudeRoot = defaults().claudeRoot, usageImports = [], sources = {}, dates, now, timezone = 'Asia/Shanghai' }) {
  const results = [], remaining = { lines: MAX_LINES };
  if (sources.claude === false) results.push({ source: { id: 'claude-code', label: 'Claude Code', status: 'disabled', method: CLAUDE_METHOD, notes: ['此来源已关闭。'] }, days: [] });
  else {
    const scan = await listClaude(claudeRoot), events = []; let partial = scan.partial;
    for (const file of scan.files) { const read = await readEvents(file, raw => claudeEvent(raw, scopePath), true, remaining); events.push(...read.events); partial ||= read.partial; if (remaining.lines < 0) break; }
    const total = aggregate(events, dates, now, 'claude-code', 'claude', partial, timezone);
    const status = !scan.available ? scan.partial ? 'error' : 'missing' : !total.usable ? total.partial ? 'partial' : 'missing' : total.partial ? 'partial' : 'connected';
    results.push({ ...total, source: { id: 'claude-code', label: 'Claude Code', status, method: CLAUDE_METHOD, notes: [...total.notes, '仅本机可读日志；不包含删除记录或其他设备。只提取归属、标识、时间与计数，不保留或发送正文。'] } });
  }
  if (sources.imports !== false && usageImports.length) {
    const events = []; let partial = false;
    if (usageImports.length > 20) throw new TypeError('通用导入文件最多 20 个。');
    for (const file of [...new Set(usageImports)]) {
      if (typeof file !== 'string' || !/\.(jsonl|ndjson)$/i.test(file)) throw new TypeError('通用用量导入需要明确的 .jsonl/.ndjson 文件。');
      const read = await readEvents(file, raw => importEvent(raw, projectPath), false, remaining); events.push(...read.events); partial ||= read.partial;
      if (remaining.lines < 0) break;
    }
    const ids = [...new Set(events.map(event => event.sourceId))].sort();
    if (!ids.length) results.push({ source: { id: 'generic-import', label: '通用用量导入', status: partial ? 'partial' : 'missing', method: IMPORT_METHOD, notes: ['未找到当前项目的有效单次调用记录，未知不等于零。'] }, days: [] });
    for (const sourceId of ids) {
      const total = aggregate(events, dates, now, sourceId, 'import', partial, timezone);
      results.push({ ...total, source: { id: sourceId, label: `导入 · ${sourceId.slice(7)}`, status: !total.usable || total.partial ? 'partial' : 'connected', method: IMPORT_METHOD, notes: [...total.notes, '导入者负责提供真实单次调用计数；应用不验证其来自哪款产品，也不读取产品账号。'] } });
    }
  }
  return results;
}
function combineUsage(results, dates) {
  const bySource=results.map(result=>new Map((result.days||[]).map(day=>[day.date,day.usage])));
  return dates.map(date => {
    const usages = bySource.map(days=>days.get(date)).filter(usage => usage && usage.quality !== 'unavailable'), usage = emptyUsage(true);
    if (!usages.length) return { date, usage: emptyUsage(false) };
    let overflow = false;
    for (const key of [...FIELDS, 'sessions']) {
      usage[key] = usages.some(item => item[key] === null) ? null : usages.reduce((sum, item) => sum + item[key], 0);
      if (usage[key] !== null && !count(usage[key])) { usage[key] = null; overflow = true; }
    }
    usage.quality = overflow || usages.some(item => item.quality !== 'observed') ? 'partial' : 'observed';
    return { date, usage };
  });
}
module.exports = { defaults, canonical, inScope, listClaude, claudeEvent, importEvent, aggregate, collectAdditional, combineUsage, emptyUsage };
