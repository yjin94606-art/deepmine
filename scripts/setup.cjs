'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { DEFAULT_BASE_URLS } = require('./api-capture.cjs');
const APP_ROOT = path.resolve(__dirname, '..');
const {settingsDirectory} = require('./data-directory.cjs');
const {projectIdentity}=require('./collector.cjs');
const {canonical}=require('./source-adapters.cjs');
const {randomUUID}=require('node:crypto');

async function readSettings(file) {
  try {
    const settings=JSON.parse(await fs.readFile(file,'utf8'));
    if (!settings || typeof settings!=='object' || Array.isArray(settings)) throw Error('Invalid configuration');
    return settings;
  } catch (error) {
    if (error.code==='ENOENT') return null;
    throw Error('现有应用配置无法读取；没有覆盖它。');
  }
}
async function writeSettings(filename,settings) {
  await fs.mkdir(path.dirname(filename),{recursive:true});
  const temporary=filename+'.'+randomUUID()+'.tmp';
  try {
    await fs.writeFile(temporary,JSON.stringify(settings,null,2)+'\n',{flag:'wx',mode:0o600});
    await fs.rename(temporary,filename);
  } finally { await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;}); }
}
function profileFile(directory,project) {
  return path.join(directory,'project-configs',projectIdentity(project).id+'.json');
}
async function savedProjectSettings(directory,project,current) {
  if (current?.projectPath && canonical(current.projectPath)===canonical(project)) return current;
  const saved=await readSettings(profileFile(directory,project));
  if (saved && canonical(saved.projectPath)!==canonical(project)) throw Error('Invalid saved project identity.');
  return saved;
}
async function selectSettings(directory,config) {
  const active=path.join(directory,'config.json');
  const previous=await readSettings(active);
  if (previous?.projectPath && canonical(previous.projectPath)!==canonical(config.projectPath)) {
    await writeSettings(profileFile(directory,previous.projectPath),previous);
  }
  await writeSettings(active,config);
}
async function savedProjectPaths(directory) {
  const base=path.join(directory,'project-configs');
  const entries=await fs.readdir(base).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  const recent=[];
  const active=await readSettings(path.join(directory,'config.json'));
  if(active?.projectPath)recent.push(active.projectPath);
  for(const entry of entries.filter(name=>/^[0-9a-f]{16}\.json$/.test(name))){
    const stored=await readSettings(path.join(base,entry));
    if(stored && typeof stored.projectPath==='string' && path.isAbsolute(stored.projectPath) &&
        path.basename(profileFile(directory,stored.projectPath))===entry)recent.push(stored.projectPath);
  }
  return [...new Set(recent)];
}
const HELP = "DEEPMINE local setup (Node.js 20+)\nnpm run setup -- --project \"/path/to/project\" [options]\n  --scope PATH          Session cwd boundary (default: project)\n  --codex-root PATH     Override CODEX_HOME or ~/.codex\n  --claude-root PATH    Override CLAUDE_CONFIG_DIR or ~/.claude\n  --usage-import FILES  Comma-separated per-call .ndjson/.jsonl files\n  --outputs DIRS        Comma-separated project-relative output directories\n  --timezone NAME       IANA timezone (default: this computer's timezone)\n  --locale VALUE        auto, zh-CN, en, ja (browser manual choice wins)\n  --history-days DAYS   Scan backfill: 1-10000, default 365; saved history persists\n  --memories            Opt into bounded project conversation excerpts\n  --no-memories         Stop future log-memory collection; keep saved history\n  --capture PROVIDERS   Enable comma-separated openai,anthropic,gemini proxies\n  --no-capture          Disable configured proxy providers\n  --openai-base-url URL     Fixed upstream for OpenAI-compatible routes\n  --anthropic-base-url URL  Fixed upstream for Anthropic Messages\n  --gemini-base-url URL     Fixed upstream for Gemini GenerateContent\n  --no-codex | --codex  Disable/enable Codex collection\n  --no-claude | --claude Disable/enable Claude Code collection\n  --no-imports | --imports Disable/enable configured generic imports\n  --no-ai | --ai       Disable/enable legacy optional Codex interpretation\nRecommended: --no-ai. New setup defaults to AI interpretation disabled.\nProxy capture and log memories are opt-in. Do not put credentials in upstream URLs.\nSettings use your local Deepmine data folder. DEEPMINE_DATA_DIR and existing installation-local configurations are supported.\n";
async function configure(args, { appRoot = APP_ROOT, env=process.env } = {}) {
  if (args.includes('--help') || args.includes('-h')) return { help: HELP + NEWS_HELP };
  const valued = new Set(['--project', '--scope', '--codex-root', '--claude-root', '--usage-import', '--outputs','--timezone','--locale','--history-days','--capture','--openai-base-url','--anthropic-base-url','--gemini-base-url']);
  const flags = new Set(['--no-codex', '--codex', '--no-claude', '--claude', '--no-imports', '--imports', '--no-ai', '--ai','--memories','--no-memories','--no-capture']);
  const values = new Map(), enabled = new Set();
  valued.add('--news-feed');
  for (const flag of ['--news','--no-news','--local-news-only','--public-news']) flags.add(flag);
  for (let i = 0; i < args.length; i++) {
    if (valued.has(args[i])) { const value = args[++i]; if (!value || value.startsWith('--')) throw new Error('选项需要一个路径值。'); values.set(args[i - 1], value); }
    else if (flags.has(args[i])) enabled.add(args[i]);
    else throw new Error('未知设置选项；运行 --help 查看用法。');
  }
  if (!values.has('--project')) throw new Error('请用 --project 明确选择这台电脑上的项目目录。');
  const projectPath = path.resolve(values.get('--project')), projectReal = await fs.realpath(projectPath);
  if (!(await fs.stat(projectReal)).isDirectory()) throw new Error('项目必须是存在的目录。');
  const scopePath = path.resolve(values.get('--scope') || projectPath), scopeReal = await fs.realpath(scopePath), scopeRelative = path.relative(scopeReal, projectReal);
  if (scopeRelative === '..' || scopeRelative.startsWith('..' + path.sep) || path.isAbsolute(scopeRelative)) throw new Error('工作区范围必须包含项目。');
  const directory = settingsDirectory(appRoot,env);
  const previous=await readSettings(path.join(directory,'config.json'));
  const config=await savedProjectSettings(directory,projectPath,previous) || (!previous?.projectPath && previous) || {};
  config.projectPath = projectPath; config.scopePath = scopePath;
  config.timezone=values.get('--timezone')||config.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
  try{new Intl.DateTimeFormat('en-US',{timeZone:config.timezone}).format(new Date());}catch{throw new Error('Invalid IANA timezone');}
  config.historyDays=Number(values.get('--history-days')||config.historyDays||365);
  if(!Number.isInteger(config.historyDays)||config.historyDays<1||config.historyDays>10000)throw new Error('history-days must be 1–10000');
  if(values.has('--locale')){const locale=values.get('--locale');if(!['auto','zh-CN','en','ja'].includes(locale))throw new Error('locale: auto, zh-CN, en, ja');config.locale=locale==='auto'?null:locale;}
  if(enabled.has('--memories')||enabled.has('--no-memories'))config.memories={enabled:enabled.has('--memories')};
  const newsFlags = ['--news','--no-news','--local-news-only','--public-news'];
  if (values.has('--news-feed') || newsFlags.some(flag => enabled.has(flag))) {
    if ((enabled.has('--news') && enabled.has('--no-news')) ||
        (enabled.has('--local-news-only') && enabled.has('--public-news'))) throw new Error('Choose one field news mode per setting.');
    config.fieldNews = {...config.fieldNews};
    if (values.has('--news-feed')) config.fieldNews.feedPath = values.get('--news-feed');
    if (enabled.has('--news') || enabled.has('--no-news')) config.fieldNews.enabled = enabled.has('--news');
    if (enabled.has('--local-news-only') || enabled.has('--public-news')) config.fieldNews.publicEnabled = enabled.has('--public-news');
  }
  if(values.has('--capture')){config.capture={providers:{}};for(const provider of values.get('--capture').split(',')){if(!['openai','anthropic','gemini'].includes(provider))throw new Error('capture: openai, anthropic, gemini');config.capture.providers[provider]={baseURL:DEFAULT_BASE_URLS[provider]};}}
  if(enabled.has('--no-capture'))config.capture={providers:{}};
  for(const provider of ['openai','anthropic','gemini'])if(values.has('--'+provider+'-base-url')){
    const url=new URL(values.get('--'+provider+'-base-url'));
    if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))))throw new Error('Upstream must be HTTPS, or an explicit loopback endpoint, without credentials');
    config.capture=config.capture||{providers:{}};config.capture.providers=config.capture.providers||{};config.capture.providers[provider]={baseURL:url.href};
  }
  for (const [flag, key] of [['--codex-root', 'codexRoot'], ['--claude-root', 'claudeRoot']]) if (values.has(flag)) config[key] = path.resolve(values.get(flag));
  if (values.has('--usage-import')) config.usageImports = values.get('--usage-import').split(',').map(value => path.resolve(value.trim()));
  if (values.has('--outputs')) {
    config.outputDirs = values.get('--outputs').split(',').map(value => value.trim().replace(/\\/g, '/'));
    if (config.outputDirs.some(value => value!=='.' && (!value || /^[A-Za-z]:|^\//.test(value) || value.split('/').some(part => !part || part.startsWith('.') || part === 'node_modules')))) throw new Error('输出目录须为项目内相对目录，不得包含隐藏目录、.. 或 node_modules。');
  } else if (!Array.isArray(config.outputDirs)) config.outputDirs = [];
  config.sources = { ...(config.sources || {}) };
  for (const key of ['codex', 'claude', 'imports']) { if (enabled.has('--no-' + key)) config.sources[key] = false; if (enabled.has('--' + key)) config.sources[key] = true; }
  if (enabled.has('--no-ai') || enabled.has('--ai')) config.ai = { ...(config.ai || {}), enabled: enabled.has('--ai') };
  if(!config.ai)config.ai={enabled:false};
  await selectSettings(directory,config);
  return { configured: true, outputDirectories: config.outputDirs.length, imports: config.usageImports?.length || 0 };
}
const NEWS_HELP = [
  '  --news-feed PATH       Skill JSON feed (relative to .deepmine/ or absolute)',
  '  --local-news-only      Use only the local skill feed',
  '  --public-news          Allow the public Hacker News fallback at unlock',
  '  --no-news | --news     Disable/enable the expedition radio',
  ''
].join('\n');
module.exports = { configure, settingsDirectory, savedProjectSettings, savedProjectPaths, selectSettings, readSettings, writeSettings, HELP: HELP + NEWS_HELP };
if (require.main === module) configure(process.argv.slice(2)).then(result => { console.log(result.help || '本机项目配置已保存至 '+path.join(settingsDirectory(),'config.json')+'。运行 npm start 启动深矿。'); }).catch(error => { console.error(error.message); process.exitCode = 1; });
