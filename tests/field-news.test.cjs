'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createService, normalizeFeed, safeURL, calendarDate } = require('../scripts/field-news.cjs');
const NOW = new Date('2026-11-18T04:00:00Z'), DATE = '2026-11-18', ZONE = 'Asia/Shanghai';
const source = { id: 'public-news-skill', label: 'Public source supplied by skill', url: 'https://example.com/news', language: 'zh-CN' };
const item = (changes = {}) => ({ id: 'story-1', title: 'A dated public announcement', url: 'https://example.com/news/one', publishedAt: '2026-11-18T02:00:00Z', ...changes });
const feed = (changes = {}) => ({ schemaVersion: 1, date: DATE, timezone: ZONE, generatedAt: NOW.toISOString(), source, items: [item()], ...changes });
const story = (id, changes = {}) => ({ id, type: 'story', time: Date.parse('2026-11-18T01:00:00Z') / 1000, title: 'Public &amp; dated ' + id, url: 'https://example.com/story/' + id, ...changes });
const options = changes => ({ enabled: true, timezone: ZONE, now: () => NOW, ...changes });
async function temp(t) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'deepmine-news-')); t.after(async () => { if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('deepmine-news-')) throw new Error('Unsafe cleanup'); await fs.rm(directory, { recursive: true, force: true }); }); return directory; }
function mockStories(stories, { onCall = () => {}, top } = {}) { return async (url, init) => { onCall(url, init); if (url.endsWith('topstories.json')) return new Response(JSON.stringify(top || stories.map(value => value.id))); const id = Number(/item\/(\d+)\.json$/.exec(url)?.[1]); return new Response(JSON.stringify(stories.find(value => value.id === id) || null)); }; }

test('all sources are disabled by default and enabled services wait for a real unlock or explicit request', async () => {
  let calls = 0; const fetchImpl = async () => { calls++; throw new Error('PRIVATE'); };
  assert.equal((await createService({ fetchImpl }).get({ explicit: true })).status, 'disabled');
  const service = createService(options({ fetchImpl })); assert.equal((await service.get()).status, 'disabled'); assert.equal((await service.get({ force: true })).status, 'disabled'); assert.equal(calls, 0);
});

test('local skill feeds win without network and refresh immediately instead of waiting for public cache expiry', async t => {
  const directory = await temp(t), filename = path.join(directory, 'today.json'); await fs.writeFile(filename, JSON.stringify(feed())); let calls = 0;
  const service = createService(options({ feedPath: 'today.json', configDirectory: directory, fetchImpl: async () => { calls++; throw new Error(); } }));
  const first = await service.get({ unlocked: true }); assert.equal(first.status, 'ready'); assert.equal(first.source.method, 'local-skill-feed'); assert.equal(first.items[0].language, 'zh-CN'); assert.equal(first.items[0].rank, undefined);
  await fs.writeFile(filename, JSON.stringify(feed({ items: [item({ title: 'Updated sourced headline' })] })));
  assert.equal((await service.get({ unlocked: true })).items[0].title, 'Updated sourced headline'); assert.equal(calls, 0);
  assert.equal((await createService(options({ enabled: false, feedPath: filename })).get({ explicit: true })).status, 'disabled');
});

test('feed timestamps, timezone, duplicate items, URLs and bounded summaries are verified without fabricated ranking', () => {
  const result = normalizeFeed(feed({ items: [item(), item(), item({ id: 'two' }), item({ id: 'old', url: 'https://example.com/old', publishedAt: '2026-11-17T01:00:00Z' }), item({ id: 'future', url: 'https://example.com/future', publishedAt: '2026-11-18T05:00:00Z' }), item({ id: 'unsafe', url: 'http://localhost/secret' }), item({ id: 'huge', summary: 'x'.repeat(401) })] }), { date: DATE, timezone: ZONE, now: NOW });
  assert.equal(result.valid, true); assert.equal(result.items.length, 1); assert.equal(result.rejected, 4); assert.equal(result.items[0].rank, undefined);
  for (const changes of [{ date: '2026-11-17' }, { timezone: 'UTC' }, { generatedAt: '2026-02-30T00:00:00Z' }, { generatedAt: '2026-11-18T06:00:00Z' }, { source: { ...source, url: 'file:///secret' } }]) assert.equal(normalizeFeed(feed(changes), { date: DATE, timezone: ZONE, now: NOW }).valid, false);
});

test('URLs cannot target local/private services or transport embedded credentials; calendar uses the requested zone', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', 'http://localhost/a', 'http://localhost./a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://2130706433/a', 'https://10.0.0.1/a', 'https://host.internal/a', 'https://user:secret@example.com/a', 'https://example.com:8080/a', 'https://example.com/a?token=secret']) assert.equal(safeURL(url), null, url);
  assert.equal(safeURL('https://example.com/news?id=1'), 'https://example.com/news?id=1');
  assert.equal(calendarDate('2026-11-17T20:00:00Z', ZONE), DATE); assert.equal(calendarDate('2026-11-17T20:00:00Z', 'America/Los_Angeles'), '2026-11-17');
});

test('HN topstories preserves true list rank but only current-day story submissions survive', async () => {
  const records = [story(1, { time: Date.parse('2026-11-17T01:00:00Z') / 1000 }), story(2), story(3, { type: 'job' }), story(4, { deleted: true }), story(5, { time: Date.parse('2099-01-01') / 1000 }), story(6, { url: undefined }), story(7, { url: 'http://localhost/secret' })];
  const service = createService(options({ fetchImpl: mockStories(records) })), result = await service.get({ unlocked: true });
  assert.equal(result.status, 'ready'); assert.deepEqual(result.items.map(value => value.id), ['hn:2', 'hn:6']); assert.deepEqual(result.items.map(value => value.rank), [2, 6]); assert.equal(result.items[0].title, 'Public & dated 2'); assert.match(result.source.timestampMeaning, /submission/); assert.equal(result.items[1].url, 'https://news.ycombinator.com/item?id=6');
  const duplicates = createService(options({ fetchImpl: mockStories([story(1), story(2)], { top: [2, 2, 1] }) }));
  assert.deepEqual((await duplicates.get({ explicit: true })).items.map(value => value.rank), [1, 3]);
});

test('single-flight and cached copies prevent duplicate network work and caller mutation', async () => {
  let calls = 0; const service = createService(options({ fetchImpl: mockStories([story(1)], { onCall: () => calls++ }) }));
  const values = await Promise.all([service.get({ unlocked: true }), service.get({ unlocked: true }), service.get({ explicit: true })]); assert.equal(calls, 2); assert.equal(service.diagnostics().sharedRequests, 2);
  values[0].items[0].title = 'MUTATED'; const cached = await service.get({ unlocked: true }); assert.equal(cached.cached, true); assert.notEqual(cached.items[0].title, 'MUTATED'); assert.equal(calls, 2);
  await service.get({ explicit: true, force: true }); assert.equal(calls, 4);
});

test('bounded retry, failure cooldown and later recovery do not turn exceptions into fake news', async () => {
  let fail = true, calls = 0, current = NOW;
  const service = createService(options({ now: () => current, failureMs: 1000, fetchImpl: async (url, init) => { calls++; if (fail) throw new Error('PRIVATE_PROJECT_PATH'); return mockStories([story(1)])(url, init); } }));
  const first = await service.get({ unlocked: true }); assert.equal(first.status, 'error'); assert.equal(first.items.length, 0); assert.equal(calls, 2); assert.ok(!JSON.stringify(first).includes('PRIVATE'));
  assert.equal((await service.get({ explicit: true, force: true })).cached, true); assert.equal(calls, 2);
  fail = false; current = new Date(NOW.getTime() + 1001); assert.equal((await service.get({ unlocked: true })).status, 'ready'); assert.equal(calls, 4);
});

test('per-request and total timeouts bound unresponsive fetches; partial results are marked', async () => {
  let active = 0, maximum = 0;
  const fetchImpl = async (url, init) => {
    if (url.endsWith('topstories.json')) return new Response('[1,2,3,4,5,6]');
    active++; maximum = Math.max(maximum, active);
    try { const id = Number(/item\/(\d+)/.exec(url)[1]); if (id === 1) return new Response(JSON.stringify(story(id))); return await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })); } finally { active--; }
  };
  const service = createService(options({ fetchImpl, requestTimeoutMs: 15, totalTimeoutMs: 40 })); const began = Date.now(); const result = await service.get({ unlocked: true });
  assert.equal(result.status, 'ready'); assert.equal(result.partial, true); assert.equal(result.items.length, 1); assert.ok(maximum <= 3); assert.ok(Date.now() - began < 1000);
  const stalled = createService(options({ fetchImpl: () => new Promise(() => {}), requestTimeoutMs: 10, totalTimeoutMs: 25 })); assert.equal((await stalled.get({ explicit: true })).status, 'error');
});

test('only fixed public endpoints receive requests, with no project, credentials, article-body or personal fields', async () => {
  const calls = []; const service = createService(options({ projectPath: 'PRIVATE_PROJECT', snapshot: { secret: 'PRIVATE' }, fetchImpl: mockStories([story(1, { text: 'PRIVATE_ARTICLE_BODY', by: 'PRIVATE_USER' })], { onCall: (url, init) => calls.push({ url, init: { ...init, signal: undefined } }) }) }));
  const value = await service.get({ explicit: true, projectPath: 'PRIVATE' }); assert.equal(calls.length, 2); assert.ok(calls.every(call => call.url.startsWith('https://hacker-news.firebaseio.com/v0/'))); assert.ok(calls.every(call => call.init.credentials === 'omit' && call.init.redirect === 'error' && call.init.body === undefined)); assert.ok(!JSON.stringify([calls, value]).includes('PRIVATE'));
});

test('local-only mode never falls back to network; outdated or malformed local data is clearly rejected', async t => {
  const directory = await temp(t), filename = path.join(directory, 'feed.json'); let calls = 0;
  await fs.writeFile(filename, '{broken PRIVATE');
  const service = createService(options({ feedPath: filename, publicEnabled: false, fetchImpl: async () => { calls++; throw new Error(); } }));
  const value = await service.get({ explicit: true }); assert.equal(value.status, 'error'); assert.ok(value.notes.includes('feed-file-unreadable')); assert.equal(calls, 0);
  await fs.writeFile(filename, JSON.stringify(feed({ date: '2026-11-17' }))); assert.equal((await service.get({ explicit: true })).items.length, 0); assert.equal(calls, 0);
});

test('historical/future requests never pretend the current ranking is a historical archive; midnight invalidates cache', async () => {
  let current = NOW, calls = 0; const service = createService(options({ now: () => current, fetchImpl: mockStories([story(1)], { onCall: () => calls++ }) }));
  assert.equal((await service.get({ date: '2026-11-17', explicit: true })).status, 'empty'); assert.equal((await service.get({ date: '2026-11-19', explicit: true })).status, 'error'); assert.equal(calls, 0);
  assert.equal((await service.get({ explicit: true })).items.length, 1); current = new Date('2026-11-18T16:01:00Z'); const after = await service.get({ unlocked: true }); assert.equal(after.date, '2026-11-19'); assert.equal(after.status, 'empty'); assert.equal(after.items.length, 0); assert.equal(calls, 4);
});

test('closing an active service cancels lookup and later calls stay disabled', async () => {
  const service = createService(options({ fetchImpl: (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('PRIVATE')), { once: true })) }));
  const pending = service.get({ explicit: true }); await new Promise(resolve => setImmediate(resolve)); service.close(); const result = await pending; assert.equal(result.status, 'error'); assert.equal((await service.get({ explicit: true })).status, 'disabled'); assert.equal(service.diagnostics().active, 0);
});
