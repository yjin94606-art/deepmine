'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { configure } = require('../scripts/setup.cjs');
function isolated(root) { return { appRoot: root, env: { DEEPMINE_DATA_DIR: path.join(root, '.deepmine') } }; }
function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepmine-setup-')); t.after(() => { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('deepmine-setup-')) throw new Error('Unsafe fixture cleanup'); fs.rmSync(root, { recursive: true, force: true }); }); const project = path.join(root, 'project'); fs.mkdirSync(project); return { root, project }; }
test('field news settings preserve the skill feed and independently control public fallback', async t => {
  const {root, project} = fixture(t);
  const run = (...args) => configure(['--project', project, ...args], isolated(root));
  const settings = () => JSON.parse(fs.readFileSync(path.join(root, '.deepmine/config.json'))).fieldNews;
  await run('--news-feed', 'news/today.json', '--local-news-only');
  assert.deepEqual(settings(), {feedPath:'news/today.json', publicEnabled:false});
  await run('--no-news');
  assert.equal(settings().enabled, false);
  await assert.rejects(run('--news', '--no-news'));
  assert.equal(settings().enabled, false);
  await run('--news', '--public-news');
  assert.deepEqual(settings(), {feedPath:'news/today.json', publicEnabled:true, enabled:true});
});
test('setup writes only chosen app config with portable project and source options', async t => { const { root, project } = fixture(t); const result = await configure(['--project', project, '--outputs', 'exports,images', '--no-ai', '--no-claude'], isolated(root)); assert.equal(result.configured, true); const config = JSON.parse(fs.readFileSync(path.join(root, '.deepmine/config.json'))); assert.equal(config.projectPath, project); assert.equal(config.scopePath, project); assert.deepEqual(config.outputDirs, ['exports', 'images']); assert.equal(config.ai.enabled, false); assert.equal(config.sources.claude, false); assert.ok(!fs.existsSync(path.join(project, '.deepmine'))); });
test('setup rejects ambiguous project and output escapes without writing configuration', async t => { const { root, project } = fixture(t); await assert.rejects(configure([], isolated(root)), /project/); for (const directory of ['../private', '.ssh', 'node_modules', '/absolute', 'C:/private']) await assert.rejects(configure(['--project', project, '--outputs', directory], isolated(root)), /相对目录/); assert.ok(!fs.existsSync(path.join(root, '.deepmine/config.json'))); });
test('setup preserves existing model configuration and never overwrites malformed config', async t => { const { root, project } = fixture(t); const dir = path.join(root, '.deepmine'); fs.mkdirSync(dir); const file = path.join(dir, 'config.json'); fs.writeFileSync(file, JSON.stringify({ ai: { enabled: false, model: 'chosen-model' } })); await configure(['--project', project, '--claude'], isolated(root)); assert.deepEqual(JSON.parse(fs.readFileSync(file)).ai, { enabled: false, model: 'chosen-model' }); fs.writeFileSync(file, '{broken'); await assert.rejects(configure(['--project', project], isolated(root)), /没有覆盖/); assert.equal(fs.readFileSync(file, 'utf8'), '{broken'); });
test('setup configures local calendar, explicit memory collection and API routes without credentials',async t=>{const{root,project}=fixture(t);await configure(['--project',project,'--timezone','America/Los_Angeles','--locale','ja','--history-days','730','--memories','--capture','openai,anthropic','--openai-base-url','https://provider.example/v1'],isolated(root));const config=JSON.parse(fs.readFileSync(path.join(root,'.deepmine/config.json'),'utf8'));assert.equal(config.timezone,'America/Los_Angeles');assert.equal(config.locale,'ja');assert.equal(config.historyDays,730);assert.equal(config.memories.enabled,true);assert.equal(config.capture.providers.openai.baseURL,'https://provider.example/v1');assert.equal(config.ai.enabled,false);assert.ok(!JSON.stringify(config).includes('apiKey'));});
test('setup rejects invalid calendars, excessive history and credential-bearing upstream URLs',async t=>{const{root,project}=fixture(t);for(const pair of [['--timezone','Invalid/Zone'],['--history-days','10001'],['--locale','<script>'],['--capture','unknown'],['--openai-base-url','https://user:secret@provider.example/v1']])await assert.rejects(configure(['--project',project,...pair],isolated(root)));assert.ok(!fs.existsSync(path.join(root,'.deepmine/config.json')));});
