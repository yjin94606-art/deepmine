'use strict';
const crypto = require('node:crypto');
const A = require('./source-adapters.cjs');
const TYPES = Object.freeze(['web', 'document', 'image', 'audio', 'video', 'slides', 'table', 'code', 'file']);
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function object(value, keys, code) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail(code); return value; }
function text(value, max, code) { if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(code); return value.trim(); }
function identifier(value, code) { if (typeof value !== 'string' || !/^[A-Za-z0-9._:/-]{1,200}$/.test(value)) fail(code); return value; }
function absolute(value) { return typeof value === 'string' && (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)); }
function projectIdentity(projectPath) { return crypto.createHash('sha256').update(A.canonical(projectPath)).digest('hex').slice(0, 16); }
function count(value, nullable = false) { if (nullable && value === null) return null; if (!Number.isSafeInteger(value) || value < 0 || value > 1e12) fail('invalid-usage'); return value; }
function normalizeUsage(raw) {
  object(raw, ['inputTokens', 'cachedInputTokens', 'outputTokens', 'totalTokens', 'reasoningOutputTokens', 'cacheWriteInputTokens'], 'unexpected-usage-field');
  const result = { inputTokens: count(raw.inputTokens), cachedInputTokens: count(raw.cachedInputTokens, true), outputTokens: count(raw.outputTokens), totalTokens: count(raw.totalTokens) };
  if (result.totalTokens !== result.inputTokens + result.outputTokens || (result.cachedInputTokens !== null && result.cachedInputTokens > result.inputTokens)) fail('inconsistent-usage');
  for (const field of ['reasoningOutputTokens', 'cacheWriteInputTokens']) if (raw[field] !== undefined) { result[field] = count(raw[field], true); if (result[field] !== null && result[field] > (field === 'reasoningOutputTokens' ? result.outputTokens : result.inputTokens)) fail('inconsistent-usage'); }
  return result;
}
function relativeFile(value) {
  const file = text(value, 2048, 'invalid-output-path').replace(/\\/g, '/');
  if (absolute(file) || file.split('/').some(part => !part || part === '..' || part.startsWith('.') || /^(?:node_modules|credentials?|secrets?|auth|config)$/i.test(part))) fail('invalid-output-path');
  return file;
}
function normalizeEvent(raw, { projectPath, projectId = projectIdentity(projectPath), now = new Date(), allowTraceRequests = false } = {}) {
  object(raw, ['schemaVersion', 'id', 'source', 'projectPath', 'projectId', 'timestamp', 'sessionId', 'kind', 'usage', 'output', 'memory'], 'unexpected-event-field');
  if (!absolute(projectPath) || !absolute(raw.projectPath) || A.canonical(raw.projectPath) !== A.canonical(projectPath) || (raw.projectId !== undefined && raw.projectId !== projectId)) fail('project-mismatch');
  if (raw.schemaVersion !== 1 || !['usage', 'output', 'memory'].includes(raw.kind)) fail('unsupported-event');
  if (typeof raw.source !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(raw.source) || ['codex', 'claude-code'].includes(raw.source)) fail('invalid-source');
  const timestamp = raw.timestamp;
  if (typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp)) || new Date(timestamp.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) !== timestamp.slice(0, 10) || Date.parse(timestamp) > new Date(now).getTime()) fail('invalid-timestamp');
  const event = { schemaVersion: 1, id: identifier(raw.id, 'invalid-id'), source: raw.source, projectId, timestamp: new Date(timestamp).toISOString(), sessionId: identifier(raw.sessionId, 'invalid-session'), kind: raw.kind };
  for (const kind of ['usage', 'output', 'memory']) if (kind !== raw.kind && raw[kind] !== undefined) fail('mixed-event-payload');
  if (raw.kind === 'usage') { event.projectPath = A.canonical(projectPath); event.usage = normalizeUsage(raw.usage); }
  if (raw.kind === 'output') {
    const out = object(raw.output, ['type', 'title', 'summary', 'files', 'fingerprint','receipt'], 'unexpected-output-field');
    if (!TYPES.includes(out.type) || !Array.isArray(out.files) || !out.files.length || out.files.length > 20 || !/^[a-f0-9]{64}$/.test(out.fingerprint)) fail('invalid-output');
    event.output = { type: out.type, title: text(out.title, 120, 'invalid-output-title'), files: [...new Set(out.files.map(relativeFile))].sort(), fingerprint: out.fingerprint };
    if (out.summary !== undefined) event.output.summary = text(out.summary, 500, 'invalid-output-summary');
    if (out.receipt !== undefined) {
      const r = object(out.receipt,['status','operation','path','sha256','sourceRef','requestedAt','request','title','usage'],'unexpected-receipt-field');
      const file=relativeFile(r.path), sourceRef=identifier(r.sourceRef,'invalid-receipt-reference');
      if (r.status!=='completed' || !['create','edit'].includes(r.operation) || r.sha256!==out.fingerprint ||
          event.output.files.length!==1 || event.output.files[0]!==file || absolute(sourceRef) || /^[a-z]+:\/\//i.test(sourceRef)) fail('invalid-output-receipt');
      const receipt={status:'completed',operation:r.operation,path:file,sha256:r.sha256,sourceRef};
      if(r.usage!==undefined)receipt.usage=normalizeUsage(r.usage);
      if (r.title!==undefined) receipt.title=text(r.title,120,'invalid-receipt-title');
      if (r.request!==undefined || r.requestedAt!==undefined) {
        const request=text(r.request,440,'invalid-receipt-request');
        if (Array.from(request).length>220 || typeof r.requestedAt!=='string' ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(r.requestedAt) ||
            !Number.isFinite(Date.parse(r.requestedAt)) || Date.parse(r.requestedAt)>Date.parse(event.timestamp) ||
            new Date(r.requestedAt.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==r.requestedAt.slice(0,10)) fail('invalid-receipt-time');
        if (allowTraceRequests) {receipt.requestedAt=new Date(r.requestedAt).toISOString();receipt.request=request;}
      }
      event.output.receipt=receipt;
    }
  }
  if (raw.kind === 'memory') {
    const memory = object(raw.memory, ['title', 'summary', 'objectType', 'sourceRef'], 'unexpected-memory-field');
    if (!['memory', ...TYPES].includes(memory.objectType)) fail('invalid-memory-type');
    const sourceRef = identifier(memory.sourceRef, 'invalid-memory-reference'); if (absolute(sourceRef)) fail('invalid-memory-reference');
    event.memory = { title: text(memory.title, 120, 'invalid-memory-title'), summary: text(memory.summary, 500, 'invalid-memory-summary'), objectType: memory.objectType, sourceRef };
  }
  return event;
}
function createIngest({ projectPath, projectId = projectIdentity(projectPath), onEvent = async () => {}, now = () => new Date(), maxIds = 50000, allowTraceRequests = false } = {}) {
  const records = new Map(); let accepted = 0, duplicates = 0, rejected = 0, failed = 0;
  async function ingest(raw) {
    let event;
    try { event = normalizeEvent(raw, { projectPath, projectId, now: now(), allowTraceRequests }); } catch (error) { rejected++; return { accepted: false, status: 'rejected', code: error.code || 'invalid-event' }; }
    const key = `${event.source}/${event.id}`, fingerprint = crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex'), previous = records.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) { rejected++; return { accepted: false, status: 'conflict', code: 'event-id-conflict' }; }
      const result = await previous.pending; if (result.accepted) { duplicates++; return { accepted: false, status: 'duplicate', id: event.id }; } return result;
    }
    if (records.size >= maxIds) { rejected++; return { accepted: false, status: 'rejected', code: 'event-capacity' }; }
    const record = { fingerprint, pending: null };
    record.pending = Promise.resolve().then(() => onEvent(event)).then(() => { accepted++; return { accepted: true, status: 'accepted', id: event.id }; }).catch(() => { failed++; records.delete(key); return { accepted: false, status: 'failed', code: 'event-storage-failed' }; });
    records.set(key, record); return record.pending;
  }
  return { ingest, diagnostics: () => ({ accepted, duplicates, rejected, failed, trackedIds: records.size }) };
}
module.exports = { normalizeEvent, normalizeUsage, createIngest, projectIdentity, TYPES };
