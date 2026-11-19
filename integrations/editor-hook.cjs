'use strict';
// Cursor afterFileEdit observer. Nothing from edits/transcripts is persisted or sent.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const {settingsDirectory} = require('../scripts/data-directory.cjs');

const APP_ROOT = path.resolve(__dirname, '..');
const MAX_INPUT = 2 * 1024 * 1024;
const MAX_FILE = 32 * 1024 * 1024;
const TYPES = new Map(Object.entries({
  web: ['html', 'htm'], document: ['md', 'mdx', 'txt', 'pdf', 'docx', 'odt', 'rtf'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'aseprite'],
  audio: ['wav', 'mp3', 'ogg', 'flac', 'm4a'], video: ['mp4', 'webm', 'mov'],
  slides: ['pptx', 'odp'], table: ['csv', 'tsv', 'xlsx', 'ods'],
  code: ['js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'css', 'scss', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'cs', 'swift', 'lua', 'gd', 'vue', 'svelte', 'sql', 'sh', 'ps1']
}).flatMap(([type, extensions]) => extensions.map(extension => [extension, type])));
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function classify(file) { return TYPES.get(path.extname(file).slice(1).toLowerCase()) || 'file'; }
function fail(code) { const error = new Error(code); error.hookCode = code; throw error; }
function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function safeRelative(relative) {
  return typeof relative === 'string' && relative.length > 0 && relative.length <= 2048 &&
    !/[\u0000-\u001f\u007f:]/.test(relative) && !path.isAbsolute(relative) &&
    !relative.split(/[\\/]/).some(part => !part || part.startsWith('.') ||
      /^(?:node_modules|vendor|__pycache__|coverage|auth|config)(?:$|[._-])/i.test(part) ||
      /(?:credentials?|secrets?|api[_-]?keys?|auth[_-]?tokens?|passwords?)/i.test(part) ||
      /(?:^|[._-])(?:config|tokens?)(?:$|[._-])/i.test(part)) &&
    !/\.(?:pem|key|p12|pfx|kdbx|env)$/i.test(relative);
}
function opaqueId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value); }
async function smallText(filename, limit) {
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size > limit) fail('configuration-invalid');
  const value = await fs.readFile(filename, 'utf8');
  if (Buffer.byteLength(value) > limit) fail('configuration-invalid');
  return value;
}
async function configuration(directory) {
  let config;
  try { config = JSON.parse(await smallText(path.join(directory, 'config.json'), 64 * 1024)); }
  catch (error) { fail(error.code === 'ENOENT' ? 'configuration-missing' : 'configuration-invalid'); }
  if (!config || typeof config !== 'object' || Array.isArray(config) || typeof config.projectPath !== 'string' || !path.isAbsolute(config.projectPath)) fail('project-not-configured');
  let key = config.ingestionKey;
  if (key === undefined || key === null || key === '') {
    try { key = (await smallText(path.join(directory, 'ingestion.key'), 4096)).trim(); }
    catch { fail('ingestion-key-missing'); }
  }
  if (typeof key !== 'string' || key.length < 16 || key.length > 4096 || /[^\x21-\x7e]/.test(key)) fail('ingestion-key-invalid');
  return { projectPath: path.resolve(config.projectPath), key, settings:config };
}
async function fingerprintFile(projectPath, filePath, now) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || /[\u0000-\u001f\u007f]/.test(filePath)) fail('file-path-invalid');
  const candidate = path.resolve(filePath);
  if (!within(projectPath, candidate)) fail('outside-project');
  const relative = path.relative(projectPath, candidate).split(path.sep).join('/');
  if (!safeRelative(relative)) fail('file-excluded');
  const realRoot = await fs.realpath(projectPath);
  // Check each component: symlinks to other files inside the project are excluded too.
  let component = projectPath;
  for (const part of path.relative(projectPath, candidate).split(path.sep)) {
    component = path.join(component, part);
    if ((await fs.lstat(component)).isSymbolicLink()) fail('linked-file-excluded');
  }
  const real = await fs.realpath(candidate);
  if (!within(realRoot, real) || !safeRelative(path.relative(realRoot, real).split(path.sep).join('/'))) fail('outside-project');
  const before = await fs.lstat(candidate);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink > 1) fail('linked-file-excluded');
  if (before.size > MAX_FILE) fail('file-too-large');
  if (!Number.isFinite(before.mtimeMs) || before.mtimeMs > now.getTime()) fail('file-time-invalid');
  const handle = await fs.open(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink > 1 || opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs) fail('file-changed');
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024); let count = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      count += bytesRead;
      if (count > MAX_FILE || count > before.size) fail('file-changed');
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await fs.lstat(candidate), finalReal = await fs.realpath(candidate);
    if (count !== before.size || after.isSymbolicLink() || after.ino !== before.ino || after.dev !== before.dev || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || finalReal !== real) fail('file-changed');
    return { relative, fingerprint: hash.digest('hex'), timestamp: before.mtime.toISOString() };
  } finally { await handle.close(); }
}
function postEvent(event, key, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(event);
    let settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
    const req = http.request({ hostname: '127.0.0.1', port, path: '/api/events', method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Deepmine-Key': key } }, res => {
      let bytes = 0; const chunks = [];
      res.on('data', chunk => { bytes += chunk.length; if (bytes > 64 * 1024) { req.destroy(); finish(Object.assign(new Error(), { hookCode: 'service-response-invalid' })); } else chunks.push(chunk); });
      res.on('aborted', () => finish(Object.assign(new Error(), { hookCode: 'service-unavailable' })));
      res.on('error', () => finish(Object.assign(new Error(), { hookCode: 'service-unavailable' })));
      res.on('end', () => {
        if (res.statusCode !== 200) { finish(Object.assign(new Error(), { hookCode: res.statusCode === 401 || res.statusCode === 403 ? 'service-unauthorized' : 'event-not-saved' })); return; }
        let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { finish(Object.assign(new Error(), { hookCode: 'service-response-invalid' })); return; }
        if (!value || !['accepted', 'duplicate'].includes(value.status) || value.id !== event.id) { finish(Object.assign(new Error(), { hookCode: 'event-not-saved' })); return; }
        finish(null, { status: value.status });
      });
    });
    const timer = setTimeout(() => { req.destroy(); finish(Object.assign(new Error(), { hookCode: 'service-timeout' })); }, timeoutMs);
    req.on('error', () => finish(Object.assign(new Error(), { hookCode: 'service-unavailable' })));
    req.end(body);
  });
}
async function runHook(input, { appRoot = APP_ROOT, env = process.env, port, timeoutMs = 1500, now = new Date() } = {}) {
  try {
    if ((port!==undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) fail('options-invalid');
    if (!input || typeof input !== 'object' || Array.isArray(input) || input.hook_event_name !== 'afterFileEdit' || !opaqueId(input.conversation_id) || !opaqueId(input.generation_id)) fail('hook-input-invalid');
    const directory=settingsDirectory(appRoot,env);
    const config = await configuration(directory);
    const file = await fingerprintFile(config.projectPath, input.file_path, new Date(now));
    const event = {
      schemaVersion: 1, id: 'cursor:' + digest(JSON.stringify([config.projectPath, input.conversation_id, input.generation_id, file.relative, file.fingerprint])),
      source: 'cursor-hook', projectPath: config.projectPath, timestamp: file.timestamp,
      sessionId: 'cursor:' + digest(input.conversation_id), kind: 'output',
      output: { type: classify(file.relative), title: path.basename(file.relative).slice(0, 120), files: [file.relative], fingerprint: file.fingerprint,
        summary: 'Cursor afterFileEdit 报告此文件发生编辑；指纹来自当前文件，日期取文件修改时间，不证明任务完成。' }
    };
    const target=await require('../scripts/open-mine.cjs').runningMinePort(directory,config.settings,port,Number(env.PORT));
    if(target===null)fail('service-unavailable');
    return await postEvent(event, config.key, target, timeoutMs);
  } catch (error) { return { status: 'skipped', code: error.hookCode || 'file-unavailable' }; }
}
async function readInput(stream) {
  const chunks = []; let count = 0;
  for await (const chunk of stream) { count += Buffer.byteLength(chunk); if (count > MAX_INPUT) fail('hook-input-too-large'); chunks.push(Buffer.from(chunk)); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')); } catch { fail('hook-input-invalid'); }
}
async function main(args = process.argv.slice(2)) {
  let result;
  try {
    let port;
    if (args.length) { if (args.length !== 2 || args[0] !== '--port' || !/^\d+$/.test(args[1])) fail('options-invalid'); port = Number(args[1]); }
    result = await runHook(await readInput(process.stdin), { port });
  } catch (error) { result = { status: 'skipped', code: error.hookCode || 'hook-input-invalid' }; }
  if (result.status === 'skipped') process.stderr.write('[DEEPMINE Cursor hook] ' + result.code + '\n');
  process.stdout.write('{}\n');
}
module.exports = { runHook, classify, safeRelative, MAX_INPUT, MAX_FILE };
if (require.main === module) {
  // A stalled input pipe must not hold up the editor. Never emit Cursor control fields.
  const deadline = setTimeout(() => { process.stderr.write('[DEEPMINE Cursor hook] hook-timeout\n'); process.stdout.write('{}\n'); process.exit(0); }, 4000);
  main().catch(() => { process.stderr.write('[DEEPMINE Cursor hook] hook-failed\n'); process.stdout.write('{}\n'); }).finally(() => { clearTimeout(deadline); process.stdin.destroy(); process.exitCode = 0; });
}
