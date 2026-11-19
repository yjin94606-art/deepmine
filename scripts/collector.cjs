'use strict';

// Local, read-only evidence collector. Never opens auth/config files, prompt
// records, tool payloads, or tracked file contents. The caller owns persistence.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const Adapters = require('./source-adapters.cjs');
const execFileAsync = promisify(execFile);
const TIMEZONE = 'Asia/Shanghai';
const MAX_FILES = 10000;
const MAX_COMMITS = 200;
const MAX_METADATA_LINE = 2 * 1024 * 1024;
const KEYS = {
  inputTokens: 'input_tokens', cachedInputTokens: 'cached_input_tokens',
  outputTokens: 'output_tokens', totalTokens: 'total_tokens',
  reasoningOutputTokens: 'reasoning_output_tokens', cacheWriteInputTokens: 'cache_write_input_tokens'
};
const METHOD = '按工作区筛选本地 Codex JSONL，各会话累计计数取增量。去重副本与重复快照后，按项目时区归入各天。输入包含缓存，输出包含推理。';

function canonicalPath(value) {
  const normalized=Adapters.canonical(value);
  if (!normalized) throw new TypeError('需要明确的本地项目、工作区和 Codex 目录。');
  return normalized;
}
const {inScope}=Adapters;
function projectIdentity(projectPath) {
  const canonical = canonicalPath(projectPath);
  return { id: crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16), label: path.posix.basename(String(projectPath).replace(/\\/g,'/').replace(/\/+$/,'')) || '本地项目' };
}
function dateOf(value, timezone = TIMEZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('采集时间无效。');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = type => parts.find(item => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function dateWindow(now, historyDays = 14, timezone = TIMEZONE) {
  if (!Number.isInteger(historyDays) || historyDays < 1 || historyDays > 10000) throw new TypeError('Invalid history window');
  const today = dateOf(now, timezone);
  const noon = new Date(today + 'T12:00:00Z');
  return Array.from({ length: historyDays }, (_, index) => {
    const date = new Date(noon);
    date.setUTCDate(date.getUTCDate() + 1 - historyDays + index);
    return date.toISOString().slice(0, 10);
  });
}
function emptyUsage(available) {
  return { ...Object.fromEntries(Object.keys(KEYS).map(key => [key, available ? 0 : null])), sessions: available ? 0 : null, quality: available ? 'observed' : 'unavailable' };
}
function validTimestamp(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function counters(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const result = {};
  for (const [key, source] of Object.entries(KEYS)) {
    const value = raw[source];
    if ((value === undefined || value === null) && ['cachedInputTokens', 'reasoningOutputTokens', 'cacheWriteInputTokens'].includes(key)) { result[key] = null; continue; }
    if (!Number.isSafeInteger(value) || value < 0) return null;
    result[key] = value;
  }
  if ((result.cachedInputTokens !== null && result.cachedInputTokens > result.inputTokens) || (result.reasoningOutputTokens !== null && result.reasoningOutputTokens > result.outputTokens) || result.inputTokens + result.outputTokens !== result.totalTokens) return null;
  return result;
}
function sourceKind(source) {
  if (typeof source === 'string') return source;
  if (source && source.subagent && source.subagent.thread_spawn) return 'worker';
  if (source && source.subagent && source.subagent.other === 'guardian') return 'guardian';
  return 'unknown';
}
function parseMetadata(raw, scopePath) {
  if (!raw || raw.type !== 'session_meta' || !raw.payload) return null;
  const payload = raw.payload;
  if (!inScope(payload.cwd, scopePath)) return null;
  if (typeof payload.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(payload.id) || !validTimestamp(raw.timestamp)) return null;
  const kind = sourceKind(payload.source);
  return { id: payload.id, createdAt: raw.timestamp, kind, excluded: kind === 'guardian' || kind === 'unknown' };
}
function parseTokenEvent(raw) {
  if (!raw || raw.type !== 'event_msg' || !raw.payload || raw.payload.type !== 'token_count' || !raw.payload.info || !validTimestamp(raw.timestamp)) return null;
  const total = counters(raw.payload.info.total_token_usage);
  const last = counters(raw.payload.info.last_token_usage);
  if (!total) return null;
  return { timestamp: raw.timestamp, ordinal: Number.isSafeInteger(raw.ordinal) && raw.ordinal >= 0 ? raw.ordinal : null, total, last };
}
function envelopeKind(line) {
  const prefix = line.slice(0, 512);
  const payload = prefix.search(/"payload"\s*:/);
  if (payload < 0) return null;
  const header = prefix.slice(0, payload);
  const match = /"type"\s*:\s*"([a-z_]+)"/.exec(header);
  if (!match) return null;
  if (match[1] === 'session_meta') return 'meta';
  if (match[1] === 'turn_context') return 'context';
  if (match[1] === 'event_msg' && /^"payload"\s*:\s*\{\s*"type"\s*:\s*"token_count"/.test(prefix.slice(payload))) return 'usage';
  return null;
}
function tuple(value) { return Object.keys(KEYS).map(key => value[key]).join(','); }
function equalCounters(a, b) { return Boolean(a && b && tuple(a) === tuple(b)); }
function subtract(next, previous) { return Object.fromEntries(Object.keys(KEYS).map(key => [key, next[key] === null || previous[key] === null ? null : next[key] - previous[key]])); }
function usableLast(event) { return event.last && Object.keys(KEYS).every(key => event.last[key] === null || event.total[key] === null || event.last[key] <= event.total[key]); }

// Pure aggregation keeps original cumulative baselines across date boundaries.
// Session ids identify active/archive copies; independent workers are not merged.
function aggregateSessions(sessionInputs, dates, now, timezone = TIMEZONE) {
  const buckets = new Map(dates.map(date => [date, { usage: emptyUsage(true), sessions: new Set() }]));
  const groups = new Map();
  const notes = new Set();
  let partial = false, usable = 0, events = 0, duplicates = 0;
  for (const session of sessionInputs) {
    if (!session || !session.meta || session.meta.excluded) continue;
    if (!groups.has(session.meta.id)) groups.set(session.meta.id, { meta: session.meta, events: [], partial: false });
    const group = groups.get(session.meta.id);
    if (group.meta.createdAt !== session.meta.createdAt || group.meta.kind !== session.meta.kind) { group.partial = true; notes.add('同一会话副本的元数据不一致，结果按不完整记录显示。'); }
    group.events.push(...session.events);
    group.partial ||= Boolean(session.partial);
  }
  for (const group of groups.values()) {
    partial ||= group.partial;
    const seen = new Set();
    const ordinalSeen = new Map();
    let previous = null, sessionUsable = false;
    const ordered = group.events.slice().sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || (a.ordinal ?? 0) - (b.ordinal ?? 0));
    for (const event of ordered) {
      if (Date.parse(event.timestamp) > now.getTime()) continue;
      const fingerprint = `${event.timestamp}|${tuple(event.total)}`;
      if (seen.has(fingerprint)) { duplicates++; continue; }
      seen.add(fingerprint);
      if (event.ordinal !== null) {
        const old = ordinalSeen.get(event.ordinal);
        if (old && old !== fingerprint) { partial = true; notes.add('发现冲突的会话序号，已跳过该条计数。'); continue; }
        ordinalSeen.set(event.ordinal, fingerprint);
      }
      if (Date.parse(event.timestamp) < Date.parse(group.meta.createdAt)) { previous = event.total; continue; }
      if (event.outsideScope) { previous=event.total; continue; }
      let delta, eventPartial = group.partial || Object.values(event.total).some(value => value === null);
      if (event.reentered && previous && !equalCounters(event.total,previous) && !equalCounters(subtract(event.total,previous),event.last)) {
        // A gap that straddles two directories cannot all be attributed to
        // this work. Keep only the measured call after returning to it.
        delta=usableLast(event)?event.last:null;
        eventPartial=true;
      } else if (!previous) {
        if (equalCounters(event.total, event.last)) delta = event.total;
        else {
          delta = usableLast(event) ? event.last : null;
          eventPartial = true;
          notes.add('部分会话首条计数包含继承历史或缺少起点；仅计可识别的最后一次调用，未补算整个累计值。');
        }
      } else if (Object.keys(KEYS).some(key => event.total[key] !== null && previous[key] !== null && event.total[key] < previous[key])) {
        delta = usableLast(event) ? event.last : null;
        eventPartial = true;
        notes.add('检测到累计计数重置；已重建基线，此段用量可能不完整。');
      } else delta = subtract(event.total, previous);
      previous = event.total;
      partial ||= eventPartial;
      if (!delta) continue;
      sessionUsable = true;
      if (delta.totalTokens === 0) { duplicates++; continue; }
      // Counter increments must retain the same overlap identities as snapshots.
      if (delta.inputTokens + delta.outputTokens !== delta.totalTokens || (delta.cachedInputTokens !== null && delta.cachedInputTokens > delta.inputTokens) || (delta.reasoningOutputTokens !== null && delta.reasoningOutputTokens > delta.outputTokens)) {
        partial = true;
        notes.add('部分计数增量不满足输入/输出包含关系，已跳过不一致条目。');
        continue;
      }
      const bucket = buckets.get(dateOf(event.timestamp, timezone));
      if (!bucket) continue;
      events++;
      bucket.sessions.add(group.meta.id);
      for (const key of Object.keys(KEYS)) {
        if (delta[key] === null || bucket.usage[key] === null) { bucket.usage[key] = null; continue; }
        const next = bucket.usage[key] + delta[key];
        if (Number.isSafeInteger(next)) bucket.usage[key] = next;
        else { partial = true; bucket.usage.quality = 'partial'; notes.add('用量数值超过安全整数范围，已停止累加异常项。'); }
      }
      if (eventPartial) bucket.usage.quality = 'partial';
    }
    if (sessionUsable) usable++;
  }
  if (duplicates) notes.add(`已忽略 ${duplicates} 条重复或未增长的累计快照。`);
  if (!usable && groups.size) notes.add('工作区日志尚无可用的 Token 计数，不能据此推断零用量。');
  for (const bucket of buckets.values()) {
    if (!usable) bucket.usage = emptyUsage(false);
    else {
      bucket.usage.sessions = bucket.sessions.size;
      if (partial) bucket.usage.quality = 'partial';
    }
  }
  return { days: dates.map(date => ({ date, usage: buckets.get(date).usage })), sessions: groups.size, usableSessions: usable, events, partial, notes: [...notes] };
}

async function listRollouts(codexRoot) {
  const result = [], notes = [];
  let available = false, partial = false;
  async function walk(dir) {
    let children;
    try { children = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch (error) {
      if (error.code !== 'ENOENT') { partial = true; notes.push('部分本地日志目录不可读取。'); }
      return;
    }
    available = true;
    for (const child of children) {
      if (result.length >= MAX_FILES) { partial = true; notes.push('日志文件超过扫描上限，本次结果不完整。'); return; }
      const filename = path.join(dir, child.name);
      if (child.isDirectory()) await walk(filename);
      else if (child.isFile() && child.name.endsWith('.jsonl')) result.push(filename);
      // Symlinks are not followed outside the explicitly selected Codex root.
    }
  }
  await walk(path.join(codexRoot, 'sessions'));
  await walk(path.join(codexRoot, 'archived_sessions'));
  return { files: result, available, partial, notes: [...new Set(notes)] };
}
const rolloutCache = new Map();
async function readRollout(filename, scopePath) {
  const cacheKey=filename+'\0'+canonicalPath(scopePath);
  let stat;try{stat=await fs.promises.stat(filename);}catch{return {meta:null,events:[],partial:true};}
  const signature=[stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
  const cached=rolloutCache.get(cacheKey);if(cached?.signature===signature)return cached.value;
  const input = fs.createReadStream(filename, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let meta = null, partial = false, first = true, selected=true, reentered=false;
  const events = [];
  try {
    for await (const line of lines) {
      const kind = envelopeKind(line);
      if (first) {
        first = false;
        if (kind !== 'meta' || line.length > MAX_METADATA_LINE) return { meta: null, events: [], partial: true };
        let raw;
        try { raw = JSON.parse(line); } catch { return { meta: null, events: [], partial: true }; }
        if (!raw.payload || typeof raw.payload.cwd !== 'string') return { meta: null, events: [], partial: true };
        if (!inScope(raw.payload.cwd, scopePath)) return null;
        meta = parseMetadata(raw, scopePath);
        if (!meta) return { meta: null, events: [], partial: true };
        if (meta.excluded) return null;
        continue;
      }
      if (meta && kind==='context') {
        let raw;
        try { if(line.length<=MAX_METADATA_LINE)raw=JSON.parse(line); } catch {}
        if (!raw) {partial=true;selected=false;}
        else if (raw.payload && Object.hasOwn(raw.payload,'cwd')) {
          const next=inScope(raw.payload.cwd,scopePath);
          if(next && !selected)reentered=true;
          selected=next;
        }
        continue;
      }
      // No JSON.parse occurs for response_item, tool payload, or ordinary event records.
      if (!meta || kind !== 'usage') continue;
      if (line.length > MAX_METADATA_LINE) { partial = true; continue; }
      let raw;
      try { raw = JSON.parse(line); } catch { partial = true; continue; }
      const event = parseTokenEvent(raw);
      if (event) {
        if (!selected)event.outsideScope=true;
        else if(reentered){event.reentered=true;reentered=false;}
        events.push(event);
      }
      else if (raw.payload && raw.payload.info !== null) partial = true;
    }
  } catch { partial = true; }
  finally { lines.close(); input.destroy(); }
  const value=meta ? { meta, events, partial } : { meta: null, events: [], partial: true };
  const after=await fs.promises.stat(filename).catch(()=>null);
  if(!partial&&after&&after.size===stat.size&&after.mtimeMs===stat.mtimeMs&&events.length<=20000){rolloutCache.set(cacheKey,{signature,value});if(rolloutCache.size>64)rolloutCache.delete(rolloutCache.keys().next().value);}
  return value;
}

function classifyFile(filename) {
  const extension = path.posix.extname(filename.replace(/\\/g, '/')).toLowerCase();
  if (['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.html', '.css', '.scss', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.cs', '.vue', '.svelte', '.sh', '.ps1', '.sql'].includes(extension)) return 'code';
  if (['.md', '.mdx', '.txt', '.rst', '.doc', '.docx', '.pdf', '.ppt', '.pptx', '.odt'].includes(extension)) return 'document';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.mp3', '.wav', '.ogg', '.mp4', '.webm', '.woff', '.woff2', '.ttf', '.glb'].includes(extension)) return 'asset';
  return 'other';
}
function parseWorkingTree(raw) {
  const rows = raw.split('\0');
  let modified = 0, untracked = 0;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!row) continue;
    const status = row.slice(0, 2);
    if (status === '??') untracked++;
    else if (status !== '!!') modified++;
    if (/[RC]/.test(status)) index++; // -z rename/copy rows carry a second path.
  }
  return { modified, untracked, status: 'observed' };
}
async function git(projectPath, args) {
  const result = await execFileAsync('git', ['-C', projectPath, ...args], { shell: false, windowsHide: true, timeout: 10000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' } });
  return result.stdout;
}
async function collectGit(projectPath, identity, dates, now, timezone = TIMEZONE) {
  const result = { source: { status: 'missing', branch: null, head: null, notes: [] }, evidence: [], workingTree: { modified: null, untracked: null, status: 'unavailable' } };
  try { await git(projectPath, ['rev-parse', '--show-toplevel']); }
  catch (error) {
    result.source.status = error.code === 'ENOENT' || /not a git repository|cannot change to/.test(String(error.stderr)) ? 'missing' : 'error';
    result.source.notes.push('当前项目的 Git 元数据不可用，不能推断已完成的成果数量。');
    return result;
  }
  result.source.status = 'connected';
  const basics = await Promise.allSettled([
    git(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    git(projectPath, ['rev-parse', '--verify', 'HEAD']),
    git(projectPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'])
  ]);
  result.source.branch = basics[0].status === 'fulfilled' ? basics[0].value.trim() : 'detached';
  result.source.head = basics[1].status === 'fulfilled' ? basics[1].value.trim() : null;
  if (basics[2].status === 'fulfilled') result.workingTree = parseWorkingTree(basics[2].value);
  else result.source.notes.push('工作区修改状态读取失败，临时改动数量未知。');
  if (!result.source.head) {
    result.source.notes.push('Git 仓库尚无提交；这只表示没有代码快照记录。');
    return result;
  }
  result.source.notes.push('提交是可验证的代码快照，不等于功能完成、测试通过或已发布；日期使用提交者记录时间。');
  try {
    // --since-as-filter avoids stopping traversal early at unusual commit dates.
    const since = new Date(dates[0] + 'T00:00:00Z'); since.setUTCDate(since.getUTCDate() - 1);
    const limitCommits = dates.length > 31 ? 2000 : MAX_COMMITS;
    const raw = await git(projectPath, ['log', '--since-as-filter=' + since.toISOString(), '--until=' + now.toISOString(), '--max-count=' + (limitCommits + 1), '--format=%H%x00%h%x00%cI%x00%s%x00', '--', '.']);
    const pieces = raw.split('\0');
    const commits = [];
    for (let index = 0; index + 3 < pieces.length; index += 4) {
      const hash = pieces[index].trim(), shortHash = pieces[index + 1], timestamp = pieces[index + 2], title = pieces[index + 3];
      if (!/^[a-f0-9]{40,64}$/.test(hash) || !validTimestamp(timestamp) || !dates.includes(dateOf(timestamp, timezone))) continue;
      commits.push({ hash, shortHash, timestamp, title: title.trim().slice(0, 200) || 'Git 提交快照' });
    }
    if (commits.length > limitCommits) result.source.notes.push(`扫描范围内提交超过 ${limitCommits} 条；仅保留最近记录，提交证据不完整。`);
    let remainingFiles = 20000;
    for (const commit of commits.slice(0, limitCommits)) {
      let files = [];
      try {
        const names = await git(projectPath, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-z', '-r', '--no-renames', '--relative', commit.hash, '--', '.']);
        const paths = [...new Set(names.split('\0').filter(Boolean))];
        const limit = Math.min(2000, remainingFiles);
        if (paths.length > limit) result.source.notes.push('提交文件清单超过单项 2000 / 总计 20000 项上限，文件证据不完整。');
        files = paths.slice(0, limit).map(name => ({ path: name, kind: classifyFile(name) }));
        remainingFiles -= files.length;
      } catch { result.source.notes.push('部分提交的文件清单读取失败；不能据此判断该提交没有文件变化。'); }
      result.evidence.push({ id: `git:${identity.id}:${commit.hash}`, kind: 'git-commit', ...commit, files });
    }
  } catch {
    result.source.status = 'error';
    result.source.notes.push('Git 提交历史读取失败，提交数量未知；未使用模拟成果代替。');
  }
  result.source.notes = [...new Set(result.source.notes)];
  return result;
}

async function collect(options) {
  options = options || {};
  const { projectPath, scopePath = projectPath, codexRoot = Adapters.defaults().codexRoot } = options;
  canonicalPath(projectPath); canonicalPath(scopePath); canonicalPath(codexRoot);
  if (!inScope(projectPath, scopePath)) throw new TypeError('项目必须位于明确选择的工作区内。');
  const now = options.now === undefined ? new Date() : new Date(options.now);
  if (!Number.isFinite(now.getTime())) throw new TypeError('采集时间无效。');
  const timezone = options.timezone || TIMEZONE;
  const dates = dateWindow(now, options.historyDays || 14, timezone), identity = projectIdentity(projectPath);
  const warnings = [];
  const gitPromise = collectGit(projectPath, identity, dates, now, timezone);
  const extraPromise = Adapters.collectAdditional({ ...options, projectPath, scopePath, dates, now });
  // Keep a fast adapter failure handled while the existing Codex scan is awaited.
  // The original rejection is still propagated at the await below.
  extraPromise.catch(() => {});
  const scan = options.sources?.codex === false ? { files: [], available: false, partial: false, notes: ['Codex 来源已关闭。'] } : await listRollouts(codexRoot);
  const sessions = [];
  for (const filename of scan.files) {
    const session = await readRollout(filename, scopePath);
    if (session && !session.meta && session.partial) {
      scan.partial = true;
      const note = '部分日志在读取归属信息前失败或截断，无法确认其工作区；本次覆盖范围按不完整处理。';
      if (!scan.notes.includes(note)) scan.notes.push(note);
    }
    if (session && session.meta) sessions.push(session);
  }
  const totals = aggregateSessions(sessions, dates, now, timezone);
  const codex = { status: !scan.available ? (scan.partial ? 'error' : 'missing') : !totals.sessions ? 'missing' : !totals.usableSessions || totals.partial || scan.partial ? 'partial' : 'connected', sessions: totals.sessions, events: totals.events, method: METHOD, notes: [...scan.notes, ...totals.notes] };
  if (!totals.sessions) codex.notes.push('未找到所选工作区的可用 Codex 日志；Token 用量未知。');
  codex.notes.push('只读取会话归属、时间和 Token 计数；不读取对话内容、工具载荷或凭据；guardian 与未知子代理来源不纳入计数。');
  codex.notes.push('仅反映本机可读日志；已删除、尚未写入及其他设备的调用不在覆盖范围内。');
  if (scan.partial) for (const day of totals.days) if (day.usage.quality !== 'unavailable') day.usage.quality = 'partial';
  const additional = await extraPromise;
  const codexSource = { id: 'codex', label: 'Codex', ...codex, status: options.sources?.codex === false ? 'disabled' : codex.status };
  const allUsage = [{ source: codexSource, days: totals.days, sessions: totals.sessions, events: totals.events }, ...additional];
  const usageDays = Adapters.combineUsage(allUsage, dates);
  const active = allUsage.filter(source => source.days?.some(day => day.usage.quality !== 'unavailable'));
  // sources.codex is retained as the schema-v1 compatibility aggregate. Its method
  // names this explicitly; usageSources retains each provider's actual status.
  const compatibility = active.length && (active.length > 1 || active[0].source.id !== 'codex') ? {
    status: active.some(item => item.source.status === 'partial') ? 'partial' : 'connected',
    sessions: active.reduce((sum, item) => sum + (item.sessions || 0), 0), events: active.reduce((sum, item) => sum + (item.events || 0), 0),
    method: '本机已观测 AI 来源的用量合计；各来源身份、覆盖范围与计量方法见 usageSources。此兼容字段名不表示所有计数来自 Codex。',
    notes: ['仅合计有可用计数的来源；未连接和关闭的来源不按零计入，也不代表全账户账单。']
  } : codex;
  if (!active.length) warnings.push('尚未取得所选项目的 AI 用量；未知不等于零。');
  else if (active.some(item => item.source.status === 'partial')) warnings.push('部分已观测 AI 用量来源不完整，请查看来源说明。');
  const repo = await gitPromise;
  if (repo.source.status !== 'connected') warnings.push('Git 提交证据不可用，不能据此推断没有成果。');
  if (repo.source.notes.some(note => /不完整|失败|前 2000/.test(note))) warnings.push('部分 Git 证据可能不完整，请查看来源说明。');
  const byProviderDate=allUsage.map(provider=>({id:provider.source.id,byDate:new Map(provider.days.map(day=>[day.date,day.usage]))}));
  const days=usageDays.map(day=>{
    const known=byProviderDate.filter(provider=>provider.byDate.has(day.date));
    const sourceTokenTotals=Object.fromEntries(known.map(provider=>[provider.id,provider.byDate.get(day.date).totalTokens]));
    const usageSourceIds=known.filter(provider=>sourceTokenTotals[provider.id]>0).map(provider=>provider.id);
    return {...day,sourceTokenTotals,usageSourceIds,evidence:repo.evidence.filter(item=>dateOf(item.timestamp,timezone)===day.date)};
  });
  return { schemaVersion: 1, kind: 'deepmine-evidence', collectedAt: now.toISOString(), timezone, project: identity, providerUsage: allUsage.map(item => ({ source: item.source, days: item.days, sessions: item.sessions, events: item.events })), history: dates.length > 31 ? { enabled: true, revision: 0 } : undefined, sources: { codex: compatibility, git: repo.source }, usageSources: allUsage.map(item => ({ id: item.source.id, label: item.source.label, status: item.source.status, method: item.source.method, notes: item.source.notes })), days, workingTree: repo.workingTree, warnings };
}

module.exports = { collect, canonicalPath, inScope, projectIdentity, dateOf, dateWindow, counters, parseMetadata, parseTokenEvent, aggregateSessions, classifyFile, parseWorkingTree, envelopeKind, readRollout };
