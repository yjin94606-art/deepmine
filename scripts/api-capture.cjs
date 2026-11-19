'use strict';
const crypto = require('node:crypto');
const { once } = require('node:events');
const { normalizeUsage, normalizeEvent, projectIdentity } = require('./event-ingest.cjs');
const DEFAULT_BASE_URLS = Object.freeze({ openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta' });
const CLIENT_TAGS = Object.freeze(['cursor', 'opencode', 'cline', 'continue', 'aider', 'custom']);
const MAX_BODY = 8 * 1024 * 1024, MAX_FRAME = 2 * 1024 * 1024, MAX_JSON = 8 * 1024 * 1024;
function integer(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 1e12; }
function usageFor(provider, raw, flavor) {
  if (!raw || typeof raw !== 'object') return null;
  let usage;
  if (provider === 'openai') {
    const chat = flavor === 'chat', embedding = flavor === 'embeddings', input = chat || embedding ? raw.prompt_tokens : raw.input_tokens, output = embedding ? 0 : chat ? raw.completion_tokens : raw.output_tokens;
    usage = { inputTokens: input, cachedInputTokens: (chat ? raw.prompt_tokens_details : raw.input_tokens_details)?.cached_tokens ?? null, outputTokens: output, totalTokens: raw.total_tokens, reasoningOutputTokens: (chat ? raw.completion_tokens_details : raw.output_tokens_details)?.reasoning_tokens ?? null };
  } else if (provider === 'anthropic') {
    if (![raw.input_tokens, raw.output_tokens, raw.cache_read_input_tokens, raw.cache_creation_input_tokens].every(integer)) return null;
    const input = raw.input_tokens + raw.cache_read_input_tokens + raw.cache_creation_input_tokens;
    usage = { inputTokens: input, cachedInputTokens: raw.cache_read_input_tokens, cacheWriteInputTokens: raw.cache_creation_input_tokens, outputTokens: raw.output_tokens, totalTokens: input + raw.output_tokens, reasoningOutputTokens: null };
  } else if (provider === 'gemini') {
    if (![raw.promptTokenCount, raw.totalTokenCount, raw.candidatesTokenCount].every(integer) || (raw.toolUsePromptTokenCount !== undefined && !integer(raw.toolUsePromptTokenCount)) || (raw.thoughtsTokenCount !== undefined && !integer(raw.thoughtsTokenCount))) return null;
    const input = raw.promptTokenCount + (raw.toolUsePromptTokenCount ?? 0), output = raw.totalTokenCount - input;
    if (output < raw.candidatesTokenCount + (raw.thoughtsTokenCount ?? 0)) return null;
    usage = { inputTokens: input, cachedInputTokens: raw.cachedContentTokenCount ?? null, outputTokens: output, totalTokens: raw.totalTokenCount, reasoningOutputTokens: raw.thoughtsTokenCount ?? null };
  } else return null;
  try { return normalizeUsage(usage); } catch { return null; }
}
function routeFor(pathname) {
  if (pathname === '/api/capture/openai/v1/chat/completions') return { provider: 'openai', flavor: 'chat', suffix: '/chat/completions' };
  if (pathname === '/api/capture/openai/v1/responses') return { provider: 'openai', flavor: 'responses', suffix: '/responses' };
  if (pathname === '/api/capture/openai/v1/embeddings') return { provider: 'openai', flavor: 'embeddings', suffix: '/embeddings' };
  if (pathname === '/api/capture/openai/v1/images/generations') return { provider: 'openai', flavor: 'images', suffix: '/images/generations' };
  if (pathname === '/api/capture/anthropic/v1/messages') return { provider: 'anthropic', flavor: 'messages', suffix: '/messages' };
  if (pathname === '/api/capture/anthropic/v1/messages/count_tokens') return { provider: 'anthropic', flavor: 'count_tokens', suffix: '/messages/count_tokens', method: 'POST', metered: false };
  const gemini = /^\/api\/capture\/gemini\/v1beta\/models\/([A-Za-z0-9._-]{1,160}):(generateContent|streamGenerateContent)$/.exec(pathname);
  if (gemini) return { provider: 'gemini', flavor: gemini[2], suffix: `/models/${gemini[1]}:${gemini[2]}` };
  const models = /^\/api\/capture\/(openai|anthropic|gemini)\/(v1|v1beta)\/models(?:\/([^/]+))?$/.exec(pathname);
  if (!models || models[2] !== (models[1] === 'gemini' ? 'v1beta' : 'v1')) return null;
  let modelId;
  if (models[3]) {
    try { modelId = decodeURIComponent(models[3]); } catch { return null; }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(modelId) || (models[1] !== 'openai' && modelId.includes(':'))) return null;
  }
  return { provider: models[1], flavor: modelId ? 'model' : 'models', suffix: '/models' + (modelId ? '/' + encodeURIComponent(modelId) : ''), method: 'GET', metered: false };
}
function localhost(hostname) { return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname); }
function upstreamBase(provider, setting) {
  const url = new URL(setting.baseURL || DEFAULT_BASE_URLS[provider]);
  if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !localhost(url.hostname))) throw new Error('Unsafe capture upstream configuration');
  if (url.pathname === '/') url.pathname = provider === 'gemini' ? '/v1beta' : '/v1';
  url.pathname = url.pathname.replace(/\/+$/, ''); return url;
}
function createUsageParser(provider, flavor, isStream) {
  let responseId = null, usage = null, terminal = !isStream, invalid = false, anthropicUsage = {}, pending = '', data = [], eventName = '', json = '';
  const decoder = new TextDecoder();
  function identify(value) { if (typeof value !== 'string') return; if (responseId && responseId !== value) invalid = true; else responseId = value; }
  function consume(value, type) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { invalid = true; return; }
    if (value.error || type === 'error' || ['response.failed', 'response.incomplete', 'response.error'].includes(type || value.type)) { invalid = true; return; }
    if (provider === 'openai' && ['chat', 'embeddings', 'images'].includes(flavor)) {
      identify(value.id);
      if (value.usage) { usage = usageFor(provider, value.usage, flavor); if (!usage) invalid = true; }
    } else if (provider === 'openai') {
      const response = value.response || value;
      identify(response.id);
      if (response.usage) { usage = usageFor(provider, response.usage, flavor); if (!usage) invalid = true; }
      if (isStream && (type || value.type) === 'response.completed' && response.status === 'completed') terminal = true;
      if (!isStream && response.status !== 'completed') invalid = true;
    } else if (provider === 'anthropic') {
      const eventType = type || value.type;
      if (!isStream || eventType === 'message_start') {
        const message = value.message || value;
        identify(message.id);
        if (message.usage) anthropicUsage = { ...message.usage };
      }
      if (eventType === 'message_delta' && value.usage) anthropicUsage = { ...anthropicUsage, ...value.usage };
      if (eventType === 'message_stop') terminal = true;
      usage = usageFor(provider, anthropicUsage, flavor);
    } else {
      identify(value.responseId);
      if (value.usageMetadata) { usage = usageFor(provider, value.usageMetadata, flavor); if (!usage) invalid = true; }
      if (value.candidates?.some(candidate => typeof candidate.finishReason === 'string')) terminal = true;
    }
  }
  function frame() {
    if (!data.length) { eventName = ''; return; }
    const body = data.join('\n'); data = [];
    if (body.trim() === '[DONE]') { if (provider === 'openai' && flavor === 'chat') terminal = true; eventName = ''; return; }
    try { consume(JSON.parse(body), eventName); } catch { invalid = true; }
    eventName = '';
  }
  function line(value) {
    if (!value) { frame(); return; }
    if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
    else if (value.startsWith('event:')) eventName = value.slice(6).trim();
    if (data.reduce((size, item) => size + item.length, 0) > MAX_FRAME) { invalid = true; data = []; }
  }
  return {
    push(chunk) {
      if (invalid) return;
      const value = decoder.decode(chunk, { stream: true });
      if (!isStream) { json += value; if (json.length > MAX_JSON) { json = ''; invalid = true; } return; }
      pending += value;
      let index; while ((index = pending.indexOf('\n')) !== -1) { line(pending.slice(0, index).replace(/\r$/, '')); pending = pending.slice(index + 1); }
      if (pending.length > MAX_FRAME) { pending = ''; invalid = true; }
    },
    finish() {
      const tail = decoder.decode();
      if (!isStream) { try { consume(JSON.parse(json + tail)); } catch { invalid = true; } }
      else { pending += tail; if (pending.trim() || data.length) invalid = true; }
      return { responseId, usage, complete: terminal && !invalid, invalid };
    }
  };
}
function createCapture({ projectPath, projectId = projectIdentity(projectPath), providers = {}, onEvent = async () => {}, fetchImpl = globalThis.fetch, now = () => new Date(), timeoutMs = 180000, maxIds = 50000 } = {}) {
  const configured = new Map(), controllers = new Set(), seen = new Map(); let closed = false;
  const counts = { recorded: 0, duplicates: 0, rejected: 0, missingUsage: 0, truncated: 0, upstreamErrors: 0, storageErrors: 0, nonMetered: 0 }, recent = [];
  for (const provider of Object.keys(DEFAULT_BASE_URLS)) if (providers[provider] && providers[provider].enabled !== false) configured.set(provider, upstreamBase(provider, providers[provider]));
  function diagnostic(code, provider) { if (recent.length === 30) recent.shift(); recent.push({ code, provider, timestamp: now().toISOString() }); }
  function end(res, status, code) { if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: code })); }
  async function handle(req, res) {
    let url; try { url = new URL(req.url, 'http://127.0.0.1'); } catch { return false; }
    if (!url.pathname.startsWith('/api/capture/')) return false;
    const route = routeFor(url.pathname);
    if (!route) { end(res, 404, 'unsupported-capture-route'); return true; }
    const provider = route.provider, base = configured.get(provider), remote = req.socket?.remoteAddress;
    let host; try { host = new URL('http://' + req.headers.host).hostname; } catch { host = ''; }
    const origin = req.headers.origin;
    if (!localhost(host) || (remote && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) || (origin && !['http://' + req.headers.host, 'https://' + req.headers.host].includes(origin)) || req.headers['sec-fetch-site'] === 'cross-site') { counts.rejected++; end(res, 403, 'local-client-required'); return true; }
    if (closed || !base) { end(res, 503, 'capture-provider-disabled'); return true; }
    const method = route.method || 'POST';
    if (req.method !== method) { counts.rejected++; end(res, 405, 'capture-method-not-allowed'); return true; }
    if (req.headers['content-encoding'] || (method === 'POST' && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))) { counts.rejected++; end(res, 415, 'json-post-required'); return true; }
    if (method === 'GET' && (req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0'))) { counts.rejected++; end(res, 400, 'get-body-not-supported'); return true; }
    const tag = req.headers['x-deepmine-source'];
    if (tag !== undefined && !CLIENT_TAGS.includes(tag)) { counts.rejected++; end(res, 400, 'unknown-client-tag'); return true; }
    const sessionId = req.headers['x-deepmine-session-id'];
    if (sessionId !== undefined && (typeof sessionId !== 'string' || !/^[A-Za-z0-9._:/-]{1,160}$/.test(sessionId))) { counts.rejected++; end(res, 400, 'invalid-session-id'); return true; }
    const allowedQuery = new Set(provider === 'gemini' ? ['key', ...(route.flavor === 'models' ? ['pageSize', 'pageToken'] : route.flavor === 'streamGenerateContent' ? ['alt'] : [])] : provider === 'anthropic' && route.flavor === 'models' ? ['limit', 'after_id', 'before_id'] : []);
    if ([...url.searchParams].some(([key, value]) => !allowedQuery.has(key) || url.searchParams.getAll(key).length !== 1 || !value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) ||
      (url.searchParams.has('alt') && url.searchParams.get('alt') !== 'sse') ||
      ['limit', 'pageSize'].some(key => url.searchParams.has(key) && (!/^\d{1,4}$/.test(url.searchParams.get(key)) || Number(url.searchParams.get(key)) < 1 || Number(url.searchParams.get(key)) > 1000))) { counts.rejected++; end(res, 400, 'unsupported-query'); return true; }
    const headers = method === 'POST' ? { 'content-type': 'application/json' } : {};
    const permitted = provider === 'openai' ? ['authorization', 'openai-organization', 'openai-project', 'idempotency-key'] : provider === 'anthropic' ? ['x-api-key', 'authorization', 'anthropic-version', 'anthropic-beta'] : ['x-goog-api-key', 'authorization'];
    for (const name of permitted) if (typeof req.headers[name] === 'string') headers[name] = req.headers[name];
    if (!(headers.authorization || headers['x-api-key'] || headers['x-goog-api-key'] || (provider === 'gemini' && url.searchParams.get('key')))) { counts.rejected++; end(res, 401, 'provider-credentials-required'); return true; }
    const controller = new AbortController(); controllers.add(controller);
    controller.signal.addEventListener('abort', () => { if (!req.complete) req.destroy(); }, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs); timer.unref?.();
    let downstreamAborted = false, responseFinished = false;
    const abort = () => { downstreamAborted = true; controller.abort(); };
    const onClose = () => { if (!responseFinished) abort(); };
    req.once('aborted', abort); res.once('close', onClose);
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) { counts.rejected++; end(res, 413, 'request-too-large'); return true; } chunks.push(chunk); }
      let body;
      if (method === 'POST') {
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { counts.rejected++; end(res, 400, 'invalid-json'); return true; }
        if (!body || typeof body !== 'object' || Array.isArray(body)) { counts.rejected++; end(res, 400, 'invalid-json'); return true; }
        if (provider === 'openai' && route.flavor === 'chat' && body.stream === true) body.stream_options = { ...(body.stream_options || {}), include_usage: true };
      } else if (size) { counts.rejected++; end(res, 400, 'get-body-not-supported'); return true; }
      const target = new URL(base.toString()); target.pathname = base.pathname + route.suffix;
      for (const [key, value] of url.searchParams) target.searchParams.set(key, value);
      if (route.flavor === 'streamGenerateContent') target.searchParams.set('alt', 'sse');
      const upstream = await fetchImpl(target, { method, headers, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}), signal: controller.signal, redirect: 'manual' });
      if (upstream.status >= 300 && upstream.status < 400) { counts.upstreamErrors++; diagnostic('upstream-redirect-refused', provider); end(res, 502, 'upstream-redirect-refused'); return true; }
      const contentType = upstream.headers.get('content-type') || 'application/octet-stream', stream = /text\/event-stream/i.test(contentType), parser = route.metered === false ? null : createUsageParser(provider, route.flavor, stream);
      const responseHeaders = { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
      for (const name of ['x-request-id', 'request-id']) if (upstream.headers.get(name)) responseHeaders[name] = upstream.headers.get(name);
      res.writeHead(upstream.status, responseHeaders);
      if (upstream.body) for await (const chunk of upstream.body) {
        if (controller.signal.aborted) throw new Error('capture-aborted');
        if (upstream.ok && parser) parser.push(chunk);
        if (!res.write(Buffer.from(chunk))) await once(res, 'drain', { signal: controller.signal });
      }
      if (downstreamAborted || controller.signal.aborted) throw new Error('capture-aborted');
      const delivery = once(res, 'finish', { signal: controller.signal }); res.end(); await delivery; responseFinished = true;
      if (!upstream.ok) { counts.upstreamErrors++; diagnostic('upstream-non-success', provider); return true; }
      // Model metadata and token estimates are not successful model-generation usage.
      if (!parser) { counts.nonMetered++; return true; }
      const parsed = parser.finish();
      if (!parsed.complete) { counts.truncated++; diagnostic('incomplete-or-invalid-response', provider); return true; }
      const responseId = parsed.responseId || upstream.headers.get('x-request-id') || upstream.headers.get('request-id');
      if (!parsed.usage || typeof responseId !== 'string' || !/^[A-Za-z0-9._:/-]{1,160}$/.test(responseId)) { counts.missingUsage++; diagnostic('missing-usage-or-response-id', provider); return true; }
      const source = 'api-' + provider + (tag ? '-' + tag : ''), key = provider + '/' + responseId, fingerprint = crypto.createHash('sha256').update(JSON.stringify(parsed.usage)).digest('hex');
      if (seen.has(key)) { const previous = seen.get(key); if (previous.fingerprint === fingerprint) { await previous.pending; counts.duplicates++; } else { counts.rejected++; diagnostic('response-id-conflict', provider); } return true; }
      if (seen.size >= maxIds) { counts.rejected++; diagnostic('capture-id-capacity', provider); return true; }
      const event = normalizeEvent({ schemaVersion: 1, id: responseId, source, projectPath, projectId, timestamp: now().toISOString(), sessionId: sessionId || 'api:' + responseId, kind: 'usage', usage: parsed.usage }, { projectPath, projectId, now: now() });
      const record = { fingerprint, pending: null };
      record.pending = Promise.resolve().then(() => onEvent(event)).then(() => { counts.recorded++; }).catch(() => { seen.delete(key); counts.storageErrors++; diagnostic('capture-storage-failed', provider); });
      seen.set(key, record); await record.pending; return true;
    } catch {
      counts.truncated++; diagnostic(downstreamAborted ? 'client-aborted' : controller.signal.aborted ? 'capture-timeout-or-closed' : 'upstream-stream-failed', provider);
      if (!res.destroyed && !res.writableEnded) { if (!res.headersSent) end(res, 502, 'capture-failed'); else res.destroy(); }
      return true;
    } finally { clearTimeout(timer); controllers.delete(controller); req.removeListener('aborted', abort); res.removeListener('close', onClose); }
  }
  return { handle, diagnostics: () => ({ ...counts, enabledProviders: [...configured.keys()], activeRequests: controllers.size, recent: recent.map(item => ({ ...item })) }), close() { closed = true; for (const controller of controllers) controller.abort(); } };
}
module.exports = { createCapture, createUsageParser, usageFor, routeFor, DEFAULT_BASE_URLS, CLIENT_TAGS };
