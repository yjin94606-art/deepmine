'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const HN_API = 'https://hacker-news.firebaseio.com/v0/';
const HN_SOURCE = Object.freeze({ id: 'hacker-news', label: 'Hacker News · Top Stories', method: 'official-topstories', url: 'https://news.ycombinator.com/', language: 'en', timestampMeaning: 'HN story submission time, not the linked article publication time' });
const MAX_FEED = 256 * 1024, MAX_RESPONSE = 128 * 1024;
function text(value, limit) { return typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f<>]/.test(value) ? value.trim() : null; }
function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value; }
function calendarDate(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}
function timestamp(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !validDate(value.slice(0, 10))) return null;
  const time = Date.parse(value); return Number.isFinite(time) && time <= now.getTime() ? new Date(time).toISOString() : null;
}
function safeURL(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  let url; try { url = new URL(value); } catch { return null; }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || net.isIP(host) || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid|home|lan|onion)$/.test(host) ||
    [...url.searchParams.keys()].some(key => /^(?:key|api[_-]?key|token|access[_-]?token|auth|authorization|secret|password)$/i.test(key))) return null;
  return url.href;
}
function plainTitle(value) {
  if (typeof value !== 'string') return null;
  const decoded = value.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|#39|#x27);/gi, entity => ({ '&amp;': '&', '&lt;': '＜', '&gt;': '＞', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&#x27;': "'" })[entity.toLowerCase()]);
  return text(decoded, 240);
}
function sourceObject(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !/^[a-z][a-z0-9-]{0,63}$/.test(raw.id || '') || !text(raw.label, 100) || !safeURL(raw.url)) return null;
  return { id: raw.id, label: text(raw.label, 100), method: 'local-skill-feed', url: safeURL(raw.url), language: /^[a-z]{2}(?:-[A-Z]{2})?$/.test(raw.language || '') ? raw.language : 'und', timestampMeaning: 'Publication timestamp supplied by the external skill; retain the source link for verification' };
}
function normalizeFeed(raw, { date, timezone, now = new Date(), limit = 6 } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schemaVersion !== 1 || raw.date !== date || raw.timezone !== timezone || !validDate(date) || !Array.isArray(raw.items) || raw.items.length > 100) return { valid: false, code: 'feed-schema-or-date-invalid' };
  const source = sourceObject(raw.source), generatedAt = timestamp(raw.generatedAt, now);
  if (!source || !generatedAt || calendarDate(generatedAt, timezone) !== date) return { valid: false, code: 'feed-provenance-invalid' };
  const items = [], ids = new Set(), urls = new Set(); let rejected = 0;
  for (const item of raw.items) {
    const publishedAt = timestamp(item?.publishedAt, now), url = safeURL(item?.url), title = text(item?.title, 240);
    if (!item || typeof item !== 'object' || !/^[A-Za-z0-9._:/-]{1,160}$/.test(item.id || '') || !title || !url || !publishedAt || publishedAt > generatedAt || calendarDate(publishedAt, timezone) !== date || (item.summary !== undefined && !text(item.summary, 400))) { rejected++; continue; }
    if (ids.has(item.id) || urls.has(url)) continue;
    ids.add(item.id); urls.add(url);
    items.push({ id: source.id + ':' + item.id, title, url, publishedAt, sourceId: source.id, language: source.language, ...(item.summary ? { summary: text(item.summary, 400) } : {}) });
  }
  // External feeds do not get a fabricated popularity rank or score.
  return { valid: true, source, items: items.slice(0, limit), generatedAt, rejected };
}
function error(code, retryable = false) { return Object.assign(new Error(code), { newsCode: code, retryable }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function createService({ feedPath, configDirectory = path.resolve(__dirname, '..', '.deepmine'), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', enabled = false, publicEnabled = true, fetchImpl = globalThis.fetch, now = () => new Date(), cacheMs = 15 * 60 * 1000, failureMs = 30 * 1000, requestTimeoutMs = 1500, totalTimeoutMs = 6000, concurrency = 3, maxStories = 24, limit = 6 } = {}) {
  const caches = new Map(), pending = new Map(), controllers = new Set(); let closed = false;
  const counters = { networkRequests: 0, cacheHits: 0, sharedRequests: 0, failures: 0 };
  let timezoneValid = true; try { calendarDate(new Date(), timezone); } catch { timezoneValid = false; }
  const localPath = typeof feedPath === 'string' && feedPath ? path.resolve(configDirectory, feedPath) : null;
  concurrency = Math.max(1, Math.min(3, Math.trunc(concurrency) || 3)); maxStories = Math.max(1, Math.min(40, Math.trunc(maxStories) || 24)); limit = Math.max(1, Math.min(12, Math.trunc(limit) || 6));
  requestTimeoutMs = Math.max(10, Math.min(3000, Number(requestTimeoutMs) || 1500)); totalTimeoutMs = Math.max(10, Math.min(10000, Number(totalTimeoutMs) || 6000));
  cacheMs = Math.max(1000, Math.min(60 * 60 * 1000, Number(cacheMs) || 15 * 60 * 1000)); failureMs = Math.max(1000, Math.min(5 * 60 * 1000, Number(failureMs) || 30000));
  function base(date, status, notes = [], source = HN_SOURCE, time = new Date(now())) { return { status, date, timezone, source: { ...source }, items: [], fetchedAt: time.toISOString(), notes }; }
  async function fetchJSON(url, parentSignal) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (parentSignal.aborted || closed) throw error('news-request-cancelled');
      const controller = new AbortController(); const onAbort = () => controller.abort(); parentSignal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      let rejectAbort;
      const aborted = new Promise((_, reject) => { rejectAbort = () => reject(error('news-request-timeout', !parentSignal.aborted)); controller.signal.addEventListener('abort', rejectAbort, { once: true }); });
      try {
        counters.networkRequests++;
        const work = (async () => {
          let response;
          try { response = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal }); }
          catch { throw error('news-network-unavailable', true); }
          if (!response.ok) throw error(response.status === 429 ? 'news-rate-limited' : 'news-upstream-error', response.status >= 500 && response.status < 600);
          const chunks = []; let size = 0;
          if (response.body) for await (const chunk of response.body) {
            size += chunk.length; if (size > MAX_RESPONSE) throw error('news-response-too-large'); chunks.push(Buffer.from(chunk));
          }
          try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw error('news-response-invalid'); }
        })();
        return await Promise.race([work, aborted]);
      } catch (cause) { if (attempt || !cause.retryable || parentSignal.aborted || closed) throw cause; }
      finally { clearTimeout(timer); parentSignal.removeEventListener('abort', onAbort); controller.signal.removeEventListener('abort', rejectAbort); }
    }
  }
  async function readLocal(date, current) {
    if (!localPath) return null;
    try {
      const stat = await fs.lstat(localPath); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FEED) return { valid: false, code: 'feed-file-invalid' };
      const handle = await fs.open(localPath, 'r');
      try {
        const buffer = Buffer.alloc(MAX_FEED + 1), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > MAX_FEED) return { valid: false, code: 'feed-file-too-large' };
        return normalizeFeed(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')), { date, timezone, now: current, limit });
      } finally { await handle.close(); }
    } catch (cause) { return { valid: false, code: cause.code === 'ENOENT' ? 'feed-file-missing' : 'feed-file-unreadable' }; }
  }
  async function retrieve(date, current, local) {
    const notes = local ? [local.code] : [];
    if (publicEnabled !== true) return base(date, 'error', [...notes, 'Public fallback is disabled; no network lookup was made.'], HN_SOURCE, current);
    if (date !== calendarDate(current, timezone)) return base(date, 'empty', [...notes, 'Current topstories is not a historical popularity archive. No network lookup was made.'], HN_SOURCE, current);
    const controller = new AbortController(); controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), totalTimeoutMs);
    try {
      const top = await fetchJSON(HN_API + 'topstories.json', controller.signal);
      if (!Array.isArray(top) || top.length > 500 || top.some(id => !Number.isSafeInteger(id) || id <= 0)) throw error('news-topstories-invalid');
      const seen = new Set(), ids = top.map((id, index) => ({ id, rank: index + 1 })).filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; }).slice(0, maxStories), candidates = []; let cursor = 0, failed = 0, outOfDate = 0, invalid = 0;
      async function worker() {
        while (!controller.signal.aborted && cursor < ids.length) {
          const { id, rank } = ids[cursor++];
          try {
            const item = await fetchJSON(HN_API + 'item/' + id + '.json', controller.signal);
            if (!item || item.id !== id || item.type !== 'story' || item.dead || item.deleted || !Number.isSafeInteger(item.time) || item.time < 0 || item.time * 1000 > current.getTime()) { invalid++; continue; }
            const publishedAt = new Date(item.time * 1000).toISOString();
            if (calendarDate(publishedAt, timezone) !== date) { outOfDate++; continue; }
            const title = plainTitle(item.title), url = safeURL(item.url || 'https://news.ycombinator.com/item?id=' + id);
            if (!title || !url) { invalid++; continue; }
            candidates.push({ id: 'hn:' + id, title, url, publishedAt, sourceId: HN_SOURCE.id, language: 'en', rank, discussionUrl: 'https://news.ycombinator.com/item?id=' + id });
          } catch { failed++; }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
      const items = candidates.sort((a, b) => a.rank - b.rank).slice(0, limit);
      const unfinished = ids.length - cursor;
      if (failed || unfinished) notes.push('Some public stories were unavailable; only verified dated items are shown.');
      if (outOfDate || invalid) notes.push('Excluded ' + outOfDate + ' non-matching dates and ' + invalid + ' invalid, future, deleted or non-story records.');
      notes.push('Rank is the fetched HN topstories position; this is an English technology community source, not a global or Chinese popularity ranking.');
      return { ...base(date, items.length ? 'ready' : failed || unfinished ? 'error' : 'empty', notes, HN_SOURCE, current), items, partial: Boolean(failed || unfinished), checked: cursor };
    } catch (cause) { counters.failures++; return base(date, 'error', [...notes, cause.newsCode || 'news-unavailable'], HN_SOURCE, current); }
    finally { clearTimeout(timer); controllers.delete(controller); }
  }
  async function get({ date, unlocked = false, explicit = false, force = false } = {}) {
    let current; try { current = new Date(now()); if (!Number.isFinite(current.getTime())) throw new Error(); } catch { return { status: 'error', date: null, timezone, source: { ...HN_SOURCE }, items: [], fetchedAt: null, notes: ['clock-unavailable'] }; }
    if (!timezoneValid) return base(null, 'error', ['timezone-invalid'], HN_SOURCE, current);
    date = date || calendarDate(current, timezone);
    if (!validDate(date) || date > calendarDate(current, timezone)) return base(date, 'error', ['date-invalid-or-future'], HN_SOURCE, current);
    if (closed || enabled !== true) return base(date, 'disabled', ['Field news is disabled, including local feeds.'], HN_SOURCE, current);
    if (unlocked !== true && explicit !== true) return base(date, 'disabled', ['Waiting for the first unlocked field-news encounter or an explicit user request.'], HN_SOURCE, current);
    // A configured local file is checked before cache so skill refreshes appear immediately.
    const local = await readLocal(date, current);
    if (local?.valid) return { ...base(date, local.items.length ? 'ready' : 'empty', ['Supplied by a local external skill; publication dates and URLs passed validation.', ...(local.rejected ? [local.rejected + ' invalid or out-of-date items excluded.'] : [])], local.source, current), items: local.items, generatedAt: local.generatedAt };
    const cached = caches.get(date);
    if (cached && cached.expires > current.getTime() && (!(force === true && explicit === true) || cached.value.status === 'error')) { counters.cacheHits++; return { ...clone(cached.value), cached: true }; }
    if (pending.has(date)) { counters.sharedRequests++; return clone(await pending.get(date)); }
    const work = retrieve(date, current, local).then(value => {
      caches.set(date, { value: clone(value), expires: current.getTime() + (value.status === 'error' ? failureMs : cacheMs) });
      while (caches.size > 8) caches.delete(caches.keys().next().value); return value;
    }).catch(() => { counters.failures++; return base(date, 'error', ['news-unavailable'], HN_SOURCE, current); }).finally(() => pending.delete(date));
    pending.set(date, work); return clone(await work);
  }
  return { get, diagnostics: () => ({ ...counters, enabled: enabled === true && !closed, active: controllers.size }), close() { closed = true; for (const controller of controllers) controller.abort(); } };
}
module.exports = { createService, normalizeFeed, safeURL, calendarDate, HN_SOURCE };
if (require.main === module) {
  const args = process.argv.slice(2), allowed = new Set(['--live', '--feed', '--timezone', '--date']);
  (async () => {
    const values = {}; let live = false;
    for (let i = 0; i < args.length; i++) { if (!allowed.has(args[i])) throw error('unknown-option'); if (args[i] === '--live') live = true; else { const key = args[i].slice(2), value = args[++i]; if (!value || value.startsWith('--')) throw error('missing-option-value'); values[key] = value; } }
    const service = createService({ enabled: live || Boolean(values.feed), publicEnabled: live, feedPath: values.feed ? path.resolve(values.feed) : undefined, timezone: values.timezone });
    try { console.log(JSON.stringify(await service.get({ date: values.date, explicit: true }), null, 2)); } finally { service.close(); }
  })().catch(cause => { console.log(JSON.stringify({ status: 'error', items: [], notes: [cause.newsCode || 'news-unavailable'] })); process.exitCode = 1; });
}
