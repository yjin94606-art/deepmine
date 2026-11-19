'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http');
const { createCapture, createUsageParser, usageFor } = require('../scripts/api-capture.cjs');
const NOW = new Date('2026-11-18T04:00:00Z');
const chatUsage = { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, prompt_tokens_details: { cached_tokens: 60 }, completion_tokens_details: { reasoning_tokens: 10 } };
const chat = changes => ({ id: 'chatcmpl-1', object: 'chat.completion', choices: [{ message: { content: 'PRIVATE_REPLY' }, finish_reason: 'stop' }], usage: chatUsage, ...changes });
const response = () => ({ id: 'resp-1', status: 'completed', output: [], usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130, input_tokens_details: { cached_tokens: 60 }, output_tokens_details: { reasoning_tokens: 10 } } });
const anthropic = () => ({ id: 'msg-1', type: 'message', usage: { input_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 30, output_tokens: 40 } });
const gemini = () => ({ responseId: 'gemini-1', candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 60, candidatesTokenCount: 20, thoughtsTokenCount: 10, totalTokenCount: 130 } });
function sse(value, event) { return (event ? 'event: ' + event + '\n' : '') + 'data: ' + JSON.stringify(value) + '\n\n'; }
function parse(provider, flavor, content, stream = false, step = 3) { const parser = createUsageParser(provider, flavor, stream), bytes = Buffer.from(content); for (let i = 0; i < bytes.length; i += step) parser.push(bytes.subarray(i, i + step)); return parser.finish(); }
test('JSON protocols normalize cache and reasoning as overlapping counts, never added twice', () => {
  assert.equal(parse('openai', 'chat', JSON.stringify(chat())).usage.totalTokens, 130);
  assert.equal(parse('openai', 'responses', JSON.stringify(response())).usage.reasoningOutputTokens, 10);
  assert.deepEqual(parse('anthropic', 'messages', JSON.stringify(anthropic())).usage, { inputTokens: 150, cachedInputTokens: 100, outputTokens: 40, totalTokens: 190, reasoningOutputTokens: null, cacheWriteInputTokens: 30 });
  const usage = parse('gemini', 'generateContent', JSON.stringify(gemini())).usage; assert.equal(usage.inputTokens, 100); assert.equal(usage.outputTokens, 30); assert.equal(usage.totalTokens, 130); assert.equal(usage.reasoningOutputTokens, 10);
});
test('one-byte chunked chat SSE preserves UTF-8 and requires DONE after valid usage', () => {
  const content = sse({ id: 'chatcmpl-1', choices: [{ delta: { content: '像素矿井' } }] }) + sse({ id: 'chatcmpl-1', choices: [], usage: chatUsage }) + 'data: [DONE]\n\n';
  assert.equal(parse('openai', 'chat', content, true, 1).complete, true); assert.equal(parse('openai', 'chat', content.replace('data: [DONE]\n\n', ''), true).complete, false);
  assert.equal(parse('openai', 'chat', content.slice(0, -1), true).complete, false);
});
test('Responses SSE only records completed status, not incomplete or failed response events', () => {
  assert.equal(parse('openai', 'responses', sse({ type: 'response.completed', response: response() }, 'response.completed'), true).complete, true);
  for (const type of ['response.failed', 'response.incomplete']) assert.equal(parse('openai', 'responses', sse({ type, response: { ...response(), status: type.split('.')[1] } }, type), true).complete, false);
});
test('Anthropic message_start and message_delta usage merge without summing repeated output totals', () => {
  const body = sse({ type: 'message_start', message: { ...anthropic(), usage: { ...anthropic().usage, output_tokens: 1 } } }, 'message_start') + sse({ type: 'message_delta', usage: { output_tokens: 40 } }, 'message_delta') + sse({ type: 'message_delta', usage: { output_tokens: 40 } }, 'message_delta') + sse({ type: 'message_stop' }, 'message_stop');
  const result = parse('anthropic', 'messages', body, true); assert.equal(result.complete, true); assert.equal(result.usage.totalTokens, 190);
  assert.equal(parse('anthropic', 'messages', body.replace(sse({ type: 'message_stop' }, 'message_stop'), ''), true).complete, false);
});
test('Gemini SSE includes thinking in output and requires completion; malformed identities or arithmetic are refused', () => {
  assert.equal(parse('gemini', 'streamGenerateContent', sse(gemini()), true).complete, true);
  assert.equal(parse('gemini', 'streamGenerateContent', sse({ ...gemini(), candidates: [] }), true).complete, false);
  assert.equal(parse('openai', 'chat', sse(chat()) + sse(chat({ id: 'other-id' })) + 'data: [DONE]\n\n', true).complete, false);
  assert.equal(usageFor('openai', { ...chatUsage, total_tokens: 500 }, 'chat'), null);
  assert.equal(usageFor('anthropic', { input_tokens: 20, output_tokens: 40 }, 'messages'), null);
});
test('error events, malformed JSON, and oversized SSE metadata frames never become valid captured usage', () => {
  assert.equal(parse('openai', 'chat', sse(chat()) + sse({ error: { message: 'PRIVATE_ERROR' } }, 'error') + 'data: [DONE]\n\n', true).complete, false);
  assert.equal(parse('openai', 'chat', '{bad').complete, false);
  const parser = createUsageParser('openai', 'chat', true); parser.push(Buffer.from('data: ' + 'x'.repeat(2 * 1024 * 1024 + 10))); assert.equal(parser.finish().complete, false);
});
async function fixture(t, fetchImpl, options = {}) {
  const events = [], service = createCapture({ projectPath: '/work/project', providers: { openai: {}, anthropic: {}, gemini: {} }, fetchImpl, now: () => NOW, onEvent: async event => events.push(event), ...options });
  const server = http.createServer((req, res) => { service.handle(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }).catch(error => { res.destroy(error); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { service, events, port: server.address().port };
}
function request(port, endpoint = '/api/capture/openai/v1/chat/completions', { body = { model: 'test', messages: [{ role: 'user', content: 'PRIVATE_PROMPT' }] }, headers = {}, method = 'POST' } = {}) {
  return new Promise((resolve, reject) => { const req = http.request({ hostname: '127.0.0.1', port, path: endpoint, method, headers: { ...(method === 'GET' ? {} : { 'content-type': 'application/json' }), authorization: 'Bearer PRIVATE_TOKEN', ...headers } }, res => { const parts = []; res.on('data', chunk => parts.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts).toString('utf8') })); res.on('error', reject); }); req.on('error', reject); req.end(method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body)); });
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('proxy forwards only provider credentials to configured upstream and emits only sanitized counters', async t => {
  let captured; const { port, events, service } = await fixture(t, async (url, options) => { captured = { url: String(url), ...options }; return new Response(JSON.stringify(chat()), { headers: { 'content-type': 'application/json', 'set-cookie': 'PRIVATE_COOKIE' } }); });
  const result = await request(port, undefined, { headers: { cookie: 'PRIVATE_COOKIE', 'x-deepmine-source': 'cline', 'x-deepmine-session-id': 'session-3' } }); await settle();
  assert.equal(result.status, 200); assert.equal(captured.url, 'https://api.openai.com/v1/chat/completions'); assert.equal(captured.headers.authorization, 'Bearer PRIVATE_TOKEN'); assert.equal(captured.headers.cookie, undefined); assert.equal(captured.headers['x-deepmine-source'], undefined); assert.equal(result.headers['set-cookie'], undefined);
  assert.equal(events.length, 1); assert.equal(events[0].source, 'api-openai-cline'); assert.equal(events[0].sessionId, 'session-3'); assert.ok(!JSON.stringify(events).includes('PRIVATE')); assert.ok(!JSON.stringify(service.diagnostics()).includes('PRIVATE'));
});
test('stream bytes pass through unchanged while chat include_usage is requested and final usage recorded once', async t => {
  const body = sse({ id: 'chatcmpl-1', choices: [{ delta: { content: '像素' } }] }) + sse({ id: 'chatcmpl-1', usage: chatUsage }) + 'data: [DONE]\n\n';
  let sent; const { port, events } = await fixture(t, async (url, options) => { sent = JSON.parse(options.body); const bytes = Buffer.from(body); return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.subarray(i, i + 7)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } }); });
  const result = await request(port, undefined, { body: { model: 'test', stream: true, messages: [] } }); await settle(); assert.equal(result.body, body); assert.equal(sent.stream_options.include_usage, true); assert.equal(events.length, 1);
});
test('duplicate response ids including concurrent calls produce one usage event; changed usage conflicts', async t => {
  let changed = false; const { port, events, service } = await fixture(t, async () => new Response(JSON.stringify(chat(changed ? { usage: { ...chatUsage, completion_tokens: 31, total_tokens: 131 } } : {}))));
  await Promise.all([request(port), request(port)]); await settle(); assert.equal(events.length, 1); assert.equal(service.diagnostics().duplicates, 1);
  changed = true; await request(port); await settle(); assert.equal(events.length, 1); assert.equal(service.diagnostics().recent.at(-1).code, 'response-id-conflict');
});
test('missing usage, failed upstream and truncated stream do not manufacture usage events', async t => {
  let n = 0; const { port, events, service } = await fixture(t, async () => { n++; if (n === 1) return new Response(JSON.stringify(chat({ usage: undefined }))); if (n === 2) return new Response('PRIVATE_PROVIDER_ERROR', { status: 429 }); return new Response(sse(chat()), { headers: { 'content-type': 'text/event-stream' } }); });
  await request(port); await request(port); await request(port); await settle(); assert.equal(events.length, 0); assert.equal(service.diagnostics().missingUsage, 1); assert.equal(service.diagnostics().upstreamErrors, 1); assert.equal(service.diagnostics().truncated, 1); assert.ok(!JSON.stringify(service.diagnostics()).includes('PRIVATE'));
});
test('auth, host, origin, route, arbitrary target query and disabled provider boundaries reject before fetching', async t => {
  let calls = 0; const { port } = await fixture(t, async () => { calls++; return new Response('{}'); }, { providers: { openai: {} } });
  assert.equal((await request(port, undefined, { headers: { host: 'evil.invalid' } })).status, 403);
  assert.equal((await request(port, undefined, { headers: { origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await request(port, undefined, { headers: { authorization: '' } })).status, 401);
  assert.equal((await request(port, '/api/capture/openai/v1/chat/completions?url=https://evil.invalid')).status, 400);
  assert.equal((await request(port, '/api/capture/openai/v1/files')).status, 404);
  assert.equal((await request(port, '/api/capture/anthropic/v1/messages')).status, 503);
  assert.equal((await request(port, undefined, { headers: { 'x-deepmine-source': 'unverified-tool' } })).status, 400);
  assert.equal(calls, 0);
});
test('upstream redirects never forward credentials and unsafe base URLs cannot start', async t => {
  const { port, events } = await fixture(t, async (url, options) => { assert.equal(options.redirect, 'manual'); return new Response('', { status: 302, headers: { location: 'https://evil.invalid' } }); });
  assert.equal((await request(port)).status, 502); assert.equal(events.length, 0);
  for (const baseURL of ['http://remote.invalid/v1', 'https://user:password@api.openai.com/v1', 'https://api.openai.com/v1?key=PRIVATE']) assert.throws(() => createCapture({ projectPath: '/work/project', providers: { openai: { baseURL } } }), /Unsafe/);
});
test('Gemini auth query passes only to configured upstream and never into captured event or diagnostics', async t => {
  let target; const { port, events, service } = await fixture(t, async url => { target = new URL(url); return new Response(JSON.stringify(gemini())); });
  await request(port, '/api/capture/gemini/v1beta/models/gemini-test:generateContent?key=PRIVATE_GOOGLE_KEY', { headers: { authorization: '' }, body: { contents: [] } }); await settle();
  assert.equal(target.hostname, 'generativelanguage.googleapis.com'); assert.equal(target.searchParams.get('key'), 'PRIVATE_GOOGLE_KEY'); assert.equal(events.length, 1); assert.ok(!JSON.stringify([events, service.diagnostics()]).includes('PRIVATE_GOOGLE_KEY'));
});
test('a client abort after receiving a usage frame aborts upstream and does not record a successful call', async t => {
  let aborted = false; const { port, events, service } = await fixture(t, async (url, options) => new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from(sse(chat()))); options.signal.addEventListener('abort', () => { aborted = true; controller.error(new Error('aborted')); }, { once: true }); } }), { headers: { 'content-type': 'text/event-stream' } }));
  await new Promise(resolve => { const req = http.request({ hostname: '127.0.0.1', port, path: '/api/capture/openai/v1/chat/completions', method: 'POST', headers: { authorization: 'Bearer TEST', 'content-type': 'application/json' } }, res => { res.once('data', () => { res.destroy(); req.destroy(); resolve(); }); res.on('error', () => {}); }); req.on('error', () => resolve()); req.end(JSON.stringify({ stream: true })); });
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(aborted, true); assert.equal(events.length, 0); assert.equal(service.diagnostics().recent.at(-1).code, 'client-aborted');
});
test('closing or timeout aborts active upstream work with safe diagnostics and no usage', async t => {
  const { port, events, service } = await fixture(t, async (url, options) => new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(new Error('PRIVATE_UPSTREAM_TOKEN')), { once: true }); }), { timeoutMs: 10 });
  assert.equal((await request(port)).status, 502); assert.equal(events.length, 0); assert.equal(service.diagnostics().recent.at(-1).code, 'capture-timeout-or-closed');
  service.close(); assert.equal((await request(port)).status, 503);
});
test('storage failure does not change provider response and can retry without recording twice', async t => {
  let fails = true, saved = 0; const { port, service } = await fixture(t, async () => new Response(JSON.stringify(chat())), { onEvent: async () => { if (fails) throw new Error('PRIVATE_STORAGE_ERROR'); saved++; } });
  assert.equal((await request(port)).status, 200); await settle(); assert.equal(service.diagnostics().storageErrors, 1); assert.equal(service.diagnostics().recorded, 0);
  fails = false; await request(port); await settle(); assert.equal(saved, 1); assert.equal(service.diagnostics().recorded, 1);
});
test('request size is bounded before fetching and malformed request JSON cannot reach upstream', async t => {
  let calls = 0; const { port } = await fixture(t, async () => { calls++; return new Response('{}'); });
  assert.equal((await request(port, undefined, { body: '{broken' })).status, 400);
  const result = await request(port, undefined, { body: JSON.stringify({ input: 'x'.repeat(8 * 1024 * 1024) }) }); assert.equal(result.status, 413); assert.equal(calls, 0);
});
test('embeddings use prompt tokens as input and zero generated output with upstream request-id provenance', async t => {
  const { port, events } = await fixture(t, async url => { assert.equal(new URL(url).pathname,'/v1/embeddings'); return new Response(JSON.stringify({object:'list',data:[{embedding:[.1,.2]}],usage:{prompt_tokens:12,total_tokens:12}}),{headers:{'x-request-id':'embedding-request-1'}}); });
  assert.equal((await request(port,'/api/capture/openai/v1/embeddings',{body:{model:'test',input:'PRIVATE_INPUT'}})).status,200);await settle();assert.equal(events.length,1);assert.equal(events[0].id,'embedding-request-1');assert.equal(events[0].usage.inputTokens,12);assert.equal(events[0].usage.outputTokens,0);assert.equal(events[0].usage.totalTokens,12);
});
test('image generation JSON forwards images and only records supplied usage, never estimates tokens from image count',async t=>{
  let supplied=true;const{port,events,service}=await fixture(t,async url=>{assert.equal(new URL(url).pathname,'/v1/images/generations');return new Response(JSON.stringify({created:123,data:[{b64_json:'PRIVATE_IMAGE_BYTES'}],...(supplied?{usage:{input_tokens:10,output_tokens:90,total_tokens:100}}:{})}),{headers:{'x-request-id':supplied?'image-1':'image-2'}});});
  const first=await request(port,'/api/capture/openai/v1/images/generations',{body:{model:'test',prompt:'PRIVATE_PROMPT'}});await settle();assert.ok(first.body.includes('PRIVATE_IMAGE_BYTES'));assert.equal(events[0].usage.totalTokens,100);assert.ok(!JSON.stringify(events).includes('PRIVATE'));
  supplied=false;await request(port,'/api/capture/openai/v1/images/generations');await settle();assert.equal(events.length,1);assert.equal(service.diagnostics().missingUsage,1);
});

test('model list/detail GET routes forward fixed paths without a body or any usage record', async t => {
  const calls = [], metadata = JSON.stringify({ data: [{ id: 'model-test' }], ...chat() });
  const { port, events, service } = await fixture(t, async (url, options) => { calls.push({ url: String(url), ...options }); return new Response(metadata, { headers: { 'content-type': 'application/json', 'set-cookie': 'PRIVATE_COOKIE' } }); });
  for (const endpoint of ['/openai/v1/models', '/openai/v1/models/ft%3Amodel-test%3Aorg%3Asuffix', '/anthropic/v1/models', '/anthropic/v1/models/claude-test', '/gemini/v1beta/models', '/gemini/v1beta/models/gemini-test']) {
    const response = await request(port, '/api/capture' + endpoint, { method: 'GET', headers: { cookie: 'PRIVATE_COOKIE', 'x-deepmine-source': 'continue' } });
    assert.equal(response.status, 200); assert.equal(response.body, metadata); assert.equal(response.headers['set-cookie'], undefined);
  }
  await settle(); assert.equal(calls.length, 6); assert.ok(calls.every(call => call.method === 'GET' && call.body === undefined && call.headers['content-type'] === undefined && call.headers.cookie === undefined && call.headers['x-deepmine-source'] === undefined));
  assert.equal(calls[1].url, 'https://api.openai.com/v1/models/ft%3Amodel-test%3Aorg%3Asuffix');
  assert.equal(events.length, 0); assert.equal(service.diagnostics().recorded, 0); assert.equal(service.diagnostics().missingUsage, 0); assert.equal(service.diagnostics().nonMetered, 6); assert.ok(!JSON.stringify(service.diagnostics()).includes('PRIVATE'));
});

test('model pagination is allowlisted and uses only the configured provider upstream', async t => {
  const calls = [];
  const { port, events, service } = await fixture(t, async (url, options) => { calls.push({ url: new URL(url), options }); return new Response('{}'); }, { providers: { anthropic: { baseURL: 'http://127.0.0.1:12345/custom/v1' }, gemini: {} } });
  assert.equal((await request(port, '/api/capture/anthropic/v1/models?limit=20&after_id=claude-test', { method: 'GET', headers: { authorization: '', 'x-api-key': 'PRIVATE_CLAUDE_KEY', 'anthropic-version': '2023-06-01' } })).status, 200);
  assert.equal(calls[0].url.origin, 'http://127.0.0.1:12345'); assert.equal(calls[0].url.pathname, '/custom/v1/models'); assert.equal(calls[0].url.searchParams.get('after_id'), 'claude-test'); assert.equal(calls[0].options.headers['x-api-key'], 'PRIVATE_CLAUDE_KEY');
  assert.equal((await request(port, '/api/capture/gemini/v1beta/models?key=PRIVATE_GEMINI_KEY&pageSize=50&pageToken=next%2Bpage%3D', { method: 'GET', headers: { authorization: '' } })).status, 200);
  assert.equal(calls[1].url.hostname, 'generativelanguage.googleapis.com'); assert.equal(calls[1].url.searchParams.get('pageToken'), 'next+page='); assert.equal(calls[1].url.searchParams.get('key'), 'PRIVATE_GEMINI_KEY');
  await settle(); assert.equal(events.length, 0); assert.ok(!JSON.stringify(service.diagnostics()).includes('PRIVATE'));
});

test('Anthropic count_tokens estimates pass through JSON but can never create billed usage', async t => {
  let captured;
  const { port, events, service } = await fixture(t, async (url, options) => { captured = { url: String(url), ...options }; return new Response(JSON.stringify({ input_tokens: 400, ...anthropic() }), { headers: { 'content-type': 'application/json', 'request-id': 'estimate-id' } }); });
  const result = await request(port, '/api/capture/anthropic/v1/messages/count_tokens', { headers: { authorization: '', 'x-api-key': 'PRIVATE_KEY', 'anthropic-version': '2023-06-01' }, body: { model: 'claude-test', messages: [{ role: 'user', content: 'PRIVATE_ESTIMATE_PROMPT' }] } });
  await settle(); assert.equal(result.status, 200); assert.equal(JSON.parse(result.body).input_tokens, 400); assert.equal(captured.url, 'https://api.anthropic.com/v1/messages/count_tokens'); assert.equal(captured.method, 'POST'); assert.ok(captured.body.includes('PRIVATE_ESTIMATE_PROMPT'));
  assert.equal(events.length, 0); assert.equal(service.diagnostics().recorded, 0); assert.equal(service.diagnostics().nonMetered, 1); assert.equal(service.diagnostics().missingUsage, 0); assert.ok(!JSON.stringify(service.diagnostics()).includes('PRIVATE'));
});

test('metadata routes enforce auth, origin, method and exact query/path boundaries before fetching', async t => {
  let calls = 0; const { port } = await fixture(t, async () => { calls++; return new Response('{}'); });
  const endpoint = '/api/capture/openai/v1/models';
  assert.equal((await request(port, endpoint, { method: 'GET', headers: { authorization: '' } })).status, 401);
  assert.equal((await request(port, endpoint, { method: 'GET', headers: { origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await request(port, endpoint, { method: 'GET', headers: { host: 'evil.invalid' } })).status, 403);
  assert.equal((await request(port, endpoint, { method: 'GET', headers: { 'transfer-encoding': 'chunked' } })).status, 400);
  assert.equal((await request(port, endpoint)).status, 405);
  assert.equal((await request(port, endpoint, { method: 'DELETE', body: '' })).status, 405);
  assert.equal((await request(port, '/api/capture/anthropic/v1/messages/count_tokens', { method: 'GET' })).status, 405);
  for (const tail of ['?url=https://evil.invalid', '?baseURL=https://evil.invalid', '/https:%2F%2Fevil.invalid', '/%2e%2e%2fsecret', '/model-test/other']) assert.ok([400, 404].includes((await request(port, endpoint + tail, { method: 'GET' })).status));
  for (const query of ['pageSize=0', 'pageSize=1001', 'pageSize=2&pageSize=3', 'pageToken=%0A', 'url=https://evil.invalid', 'alt=sse']) assert.equal((await request(port, '/api/capture/gemini/v1beta/models?' + query, { method: 'GET' })).status, 400);
  assert.equal(calls, 0);
});

test('non-metered routes refuse redirects and failed upstream estimates remain diagnostic only', async t => {
  let redirect = true;
  const { port, events, service } = await fixture(t, async (_url, options) => { assert.equal(options.redirect, 'manual'); return redirect ? new Response('', { status: 302, headers: { location: 'https://evil.invalid/PRIVATE_KEY' } }) : new Response('PRIVATE_PROVIDER_ERROR', { status: 429 }); });
  assert.equal((await request(port, '/api/capture/openai/v1/models', { method: 'GET' })).status, 502);
  redirect = false; assert.equal((await request(port, '/api/capture/anthropic/v1/messages/count_tokens')).status, 429); await settle();
  assert.equal(events.length, 0); assert.equal(service.diagnostics().nonMetered, 0); assert.equal(service.diagnostics().upstreamErrors, 2); assert.ok(!JSON.stringify(service.diagnostics()).includes('PRIVATE'));
});
