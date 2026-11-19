'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {collectFiles}=require('../scripts/output-files.cjs'),C=require('../dist/evidence-core.js');
const NOW=new Date('2026-11-18T12:00:00+08:00');
test('promotes actual headings and column names from the exact bytes used for the fingerprint',async t=>{
  const root=await fixture(t),opts={projectPath:root,outputDirs:['exports'],now:NOW};
  const files={
    'draft.md':['---\ntitle: ignore me\n---\n~~~sh\n# pretend\n~~~\n# 河边的花市 ##\nPersonal paragraph','河边的花市'],
    'setext.md':['夜晚的码头\n=====\n正文','夜晚的码头'],
    'landing.html':['<html><head><script>const x="<title>Fake</title>"</script><meta content="<title>Not here</title>"><title>Moon &amp; Tide</title></head></html>','Moon & Tide'],
    'map.svg':['<svg><g><title>Part label</title></g><title>海岸手绘地图</title><path/></svg>','海岸手绘地图'],
    'numbers.csv':['"城市","销量",月份\r\n岸城,50,11\r\n','城市与销量表']
  };
  for(const [name,[body]]of Object.entries(files))await write(root,'exports/'+name,body);
  const result=await collectFiles(opts);
  assert.equal(result.outputs.length,Object.keys(files).length);
  for(const item of result.outputs){
    const [body,title]=files[path.basename(item.files[0])];
    assert.equal(item.title,title);assert.ok(item.summary);assert.equal(item.fingerprint,require('node:crypto').createHash('sha256').update(body).digest('hex'));
    assert.doesNotMatch(item.summary,/Personal paragraph|岸城|pretend|Fake|Part label/);
  }
  assert.deepEqual((await collectFiles(opts)).outputs,result.outputs);
  await write(root,'exports/draft.md','# 河边的夜市');
  const revised=(await collectFiles(opts)).outputs.find(x=>x.files[0]==='exports/draft.md');
  assert.equal(revised.title,'河边的夜市');assert.notEqual(revised.id,result.outputs.find(x=>x.files[0]===revised.files[0]).id);
});
test('leaves uncertain, binary, sensitive, out-of-scope and generic metadata alone',async t=>{
  const root=await fixture(t);
  const cases={'generic.md':'# README\n## Company plans','heading.md':'# token = abc','path.md':'# D:\\People\\alice\\notes',
    'sample.csv':'customer,password\nPat,sensitive','no_header.csv':'Ava,Lisa\nBea,Mai','wrong.csv':'city,price\nOne column',
    'body.html':'<body><title>Body example</title></body>','comments.svg':'<svg><!-- <title>fake</title> --><g><title>Layer</title></g></svg>',
    'program.js':'# Private heading','photo.png':'# A fake image title','binary.md':Buffer.from([35,32,0xff,0])};
  for(const [name,body] of Object.entries(cases))await write(root,'exports/'+name,body);
  await write(root,'private/secret.md','# Private title');
  const result=await collectFiles({projectPath:root,outputDirs:['exports'],now:NOW});
  assert.equal(result.outputs.length,Object.keys(cases).length);
  for(const out of result.outputs)assert.equal(out.title,path.basename(out.files[0]));
});
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'deepmine-output-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'exports'));return root;}
async function write(root,relative,content='example',at=NOW){const file=path.join(root,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);await fs.utimes(file,at,at);}
test('configured non-Git output directories yield real typed files and content fingerprints',async t=>{const root=await fixture(t);await write(root,'exports/report.pdf');await write(root,'exports/chart.png','picture');const r=await collectFiles({projectPath:root,projectId:'test-project',outputDirs:['exports'],now:NOW});assert.equal(r.status,'connected');assert.equal(r.outputs.length,2);assert.deepEqual(new Set(r.outputs.map(x=>x.type)),new Set(['document','image']));assert.ok(r.outputs.every(x=>x.projectId==='test-project'&&/^[a-f0-9]{64}$/.test(x.fingerprint)&&x.sourceId==='local-files'&&!x.files[0].includes(root)));});
test('no directories is disabled and does not scan project files',async t=>{const root=await fixture(t);await write(root,'private.txt');assert.equal((await collectFiles({projectPath:root,now:NOW})).status,'disabled');});
test('overlapping paths do not duplicate and content changes change fingerprint',async t=>{const root=await fixture(t);await write(root,'exports/nested/doc.md');const options={projectPath:root,outputDirs:['exports','exports/nested'],now:NOW};const a=await collectFiles(options);assert.equal(a.outputs.length,1);await write(root,'exports/nested/doc.md','changed');const b=await collectFiles(options);assert.notEqual(a.outputs[0].fingerprint,b.outputs[0].fingerprint);assert.notEqual(a.outputs[0].id,b.outputs[0].id);});
test('hidden paths, credentials, dependencies, future and expired files are excluded',async t=>{const root=await fixture(t);for(const file of ['exports/.env.txt','exports/.private/a.md','exports/credentials.txt','exports/node_modules/doc.md'])await write(root,file);await write(root,'exports/old.md','old',new Date('2026-11-01T00:00:00Z'));await write(root,'exports/future.md','future',new Date('2026-11-19T00:00:00Z'));await write(root,'exports/current.md');const r=await collectFiles({projectPath:root,outputDirs:['exports'],now:NOW});assert.deepEqual(r.outputs.map(x=>x.title),['current.md']);});
test('missing or outside output paths cannot expand collection scope',async t=>{const root=await fixture(t);const r=await collectFiles({projectPath:root,outputDirs:['../','not-here','.private'],now:NOW});assert.equal(r.status,'missing');assert.deepEqual(r.outputs,[]);});
test('schema preserves providers and non-Git observations without inventing Git evidence',()=>{const s=C.demoSnapshot(NOW);s.mode='live';s.outputs=[{id:'file:abc',projectId:s.project.id,sourceId:'local-files',timestamp:NOW.toISOString(),type:'document',title:'Article.md',files:['exports/Article.md'],summary:'Observed file',fingerprint:'a'.repeat(64)}];s.outputSource={status:'connected',notes:[]};s.usageSources=[{id:'claude-code',label:'Claude Code',status:'connected',method:'local usage',notes:[]}];const clean=C.validateSnapshot(s);assert.equal(clean.outputs[0].type,'document');assert.equal(clean.usageSources[0].label,'Claude Code');const projected=C.project(s);assert.equal(projected.depth,C.project({...s,outputs:[]}).depth);});
test('output validation rejects foreign projects, unsafe paths, fake hashes and future timestamps',()=>{for(const change of [{projectId:'other'},{files:['../secret.png']},{files:['C:/private.png']},{fingerprint:'fake'},{timestamp:'2030-01-01T00:00:00Z'},{type:'<script>'}]){const s=C.demoSnapshot(NOW);s.outputSource={status:'connected',notes:[]};s.outputs=[{id:'file:abc',projectId:s.project.id,sourceId:'local-files',timestamp:NOW.toISOString(),type:'image',title:'image.png',files:['exports/image.png'],summary:'Observed',fingerprint:'a'.repeat(64),...change}];assert.throws(()=>C.validateSnapshot(s));}});
test('unavailable file source and duplicate provider IDs cannot claim connected evidence',()=>{const s=C.demoSnapshot(NOW);s.usageSources=[1,2].map(()=>({id:'x',label:'x',status:'connected',method:'',notes:[]}));assert.throws(()=>C.validateSnapshot(s));delete s.usageSources;s.outputs=[{id:'file:abc',projectId:s.project.id,sourceId:'local-files',timestamp:NOW.toISOString(),type:'image',title:'image.png',files:['exports/image.png'],summary:'',fingerprint:'a'.repeat(64)}];assert.throws(()=>C.validateSnapshot(s));});
