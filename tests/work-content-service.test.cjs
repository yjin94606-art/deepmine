'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {start}=require('../scripts/server.cjs');

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const url=(endpoint,file,version={})=>'/api/'+endpoint+'?'+new URLSearchParams({path:file,...version});
const key='isolated-work-content-tests';
async function fixture(t,prepare,outputDirs=[]){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'deepmine-work-story-'));
  const project=path.join(temp,'project');fs.mkdirSync(project);
  const context=await prepare(project);
  const {port,server}=await start({port:0,quiet:true,projectPath:project,scopePath:project,
    codexRoot:path.join(temp,'no-codex'),claudeRoot:path.join(temp,'no-claude'),
    sources:{codex:false,claude:false,imports:false},aiEnabled:false,ingestionKey:key,
    usageImports:[],outputDirs,fieldNews:{enabled:false},dataDirectory:path.join(temp,'storage')});
  t.after(async()=>{
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    if(path.dirname(temp)!==path.resolve(os.tmpdir()) || !path.basename(temp).startsWith('deepmine-work-story-'))throw Error('Unexpected fixture location');
    fs.rmSync(temp,{force:true,recursive:true});
  });
  const get=(route,options)=>fetch('http://127.0.0.1:'+port+route,options);
  return {get,project,...context};
}
function gitAt(project){
  const stamp=new Date(Date.now()-60000).toISOString();
  const env={...process.env,GIT_CONFIG_GLOBAL:path.join(project,'unconfigured'),GIT_CONFIG_NOSYSTEM:'1',
    GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_AUTHOR_DATE:stamp,
    GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid',GIT_COMMITTER_DATE:stamp};
  return (...args)=>execFileSync('git',['-C',project,...args],{encoding:'utf8',windowsHide:true,env}).trim();
}
const webpage=title=>'<html><head><title>'+title+'</title></head><body><main><h1>'+title+'</h1><p>可以沿着地图查看沿途的站点。</p></main><script>const internal = "RAW_SCRIPT_SENTINEL";</script></body></html>';

test('identically named Markdown works in two projects use their own recorded illustrations and retain historical Git drawings',async t=>{
  const note='work/study.md',drawing='work/pictures/shape.svg';
  const content='# An unfamiliar specimen\n\n![Study from above](<pictures/shape.svg>)\n\nThis sheet records the finished shape.';
  const original='<svg viewBox="0 0 30 30"><path fill="#56a9b2" d="M3 4 L23 8 L8 24 Z"/></svg>';
  const revised='<svg viewBox="0 0 30 30"><circle fill="#d16547" cx="15" cy="15" r="9"/></svg>';
  const make=(image,withGit)=>root=>{
    fs.mkdirSync(path.join(root,'work/pictures'),{recursive:true});
    fs.writeFileSync(path.join(root,drawing),image);
    const imageStamp=new Date(Date.now()-10000);fs.utimesSync(path.join(root,drawing),imageStamp,imageStamp);
    fs.writeFileSync(path.join(root,note),content);
    if(withGit){
      const git=gitAt(root);git('init','--quiet');git('add','work');git('commit','-qm','Record study');
      return {commit:git('rev-parse','HEAD')};
    }
    return {};
  };
  const first=await fixture(t,make(original,true),['work']);
  const second=await fixture(t,make(revised,false),['work']);
  const read=async(site,v)=>(await (await site.get(url('work-imprint',note,v))).json());
  const version={fingerprint:sha(content)};
  assert.equal((await read(first,version)).shapes[0].fill,'#56a9b2');
  assert.equal((await read(second,version)).shapes[0].fill,'#d16547');
  fs.writeFileSync(path.join(first.project,drawing),revised);
  assert.equal((await read(first,{commit:first.commit})).shapes[0].fill,'#56a9b2');
  assert.equal((await read(first,version)).kind,'excerpt');
});

test('a Markdown image cannot read an unobserved path, private path, remote URL, or drawing produced after the document',async t=>{
  const image='<svg viewBox="0 0 20 20"><rect width="10" height="20" fill="red"/></svg>';
  const refs=['../outside.svg','.hidden.svg','https://example.invalid/remote.svg','../work/private/secret-art.svg','later.svg'];
  const note='work/note.md',content='# Local report\n\n'+refs.map(r=>'![diagram]('+r+')').join('\n');
  const {get}=await fixture(t,root=>{
    fs.mkdirSync(path.join(root,'work/private'),{recursive:true});fs.writeFileSync(path.join(root,note),content);
    const earlier=new Date(Date.now()-20000);fs.utimesSync(path.join(root,note),earlier,earlier);
    for(const name of ['outside.svg','work/.hidden.svg','work/private/secret-art.svg','work/later.svg'])fs.writeFileSync(path.join(root,name),image);
    return {};
  },['work']);
  assert.notEqual((await (await get(url('work-imprint',note,{fingerprint:sha(content)}))).json())?.kind,'vector');
});

test('media descriptions use a matching localized download in a gallery; historical notes follow the selected commit',async t=>{
  const clip='exports/walk-en.mp4',bytes=Buffer.from('fixture video asset'),index='exports/index.html';
  const gallery=line=>'<section><p>'+line+'</p><figure><video src="walk-zh.mp4"></video><figcaption><a href="./walk-en.mp4">English</a></figcaption></figure></section>'+
    '<section><p>Unrelated lighthouse project.</p><figure><video src="other.mp4"></video></figure></section>';
  const {get,project,commit}=await fixture(t,root=>{
    const git=gitAt(root);git('init','--quiet');fs.mkdirSync(path.join(root,'exports'));
    fs.writeFileSync(path.join(root,clip),bytes);fs.writeFileSync(path.join(root,index),gallery('The tide first reaches the western pier.'));
    git('add','.');git('commit','-qm','Record premiere');
    fs.writeFileSync(path.join(root,index),gallery('The final edit opens on a sleeping otter.'));
    return {commit:git('rev-parse','HEAD')};
  },['exports']);
  const resolved=async version=>(await (await get(url('work-intro',clip,version))).json());
  assert.deepEqual(await resolved({fingerprint:sha(bytes)}),{title:'',summary:'The final edit opens on a sleeping otter.',contextSource:index});
  assert.match((await resolved({commit})).summary,/western pier/);
  fs.writeFileSync(path.join(project,index),gallery('Changed after the scan. Do not display these bytes.'));
  assert.equal(await resolved({fingerprint:sha(bytes)}),null);
});

test('audio from the selected version can be played and only its own observed captions are returned',async t=>{
  const name='exports/intro.wav',bytes=Buffer.from('sample recording');
  const {get}=await fixture(t,root=>{
    const dir=path.join(root,'exports');fs.mkdirSync(dir);
    fs.writeFileSync(path.join(root,name),bytes);
    fs.writeFileSync(path.join(dir,'intro.vtt'),'WEBVTT\n\n00:00:00.000 --> 00:00:01.750\nFootsteps on the wooden pier.\n\n00:00:02.000 --> 00:00:04.000\nThe buoy rings twice.');
    fs.writeFileSync(path.join(dir,'outro.vtt'),'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nThis is from a different recording.');
  },['exports']);
  const query={fingerprint:sha(bytes)};
  assert.equal((await get(url('preview',name))).status,400);
  const res=await get(url('preview',name,query));assert.equal(res.headers.get('content-type'),'audio/wav');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()),bytes);
  const note=await (await get(url('work-intro',name,query))).json();
  assert.equal(note.contextSource,'exports/intro.vtt');assert.match(note.summary,/Footsteps.*rings twice/);assert.doesNotMatch(note.summary,/different/);
});

test('art on the mine wall comes from the selected file version or observed commit',async t=>{
  const file='exports/survey.csv';
  const old='地点,数量\n北,2\n南,9\n东,16\n';
  const latest='地点,数量\n北,300\n南,3\n东,7\n西,450\n';
  const {get,project,commit}=await fixture(t,root=>{
    const git=gitAt(root);git('init','--quiet');
    fs.mkdirSync(path.join(root,'exports'));fs.writeFileSync(path.join(root,file),old);
    git('add',file);git('commit','-qm','Record first survey');
    fs.writeFileSync(path.join(root,file),latest);
    return {commit:git('rev-parse','HEAD')};
  },['exports']);
  const route=url('work-imprint',file,{fingerprint:sha(latest)});
  const now=await get(route);
  assert.equal(now.status,200);assert.equal(now.headers.get('X-Deepmine-Preview'),'verified-fingerprint');
  const oldVersion=await get(url('work-imprint',file,{commit}));
  assert.equal(oldVersion.status,200);assert.equal(oldVersion.headers.get('X-Deepmine-Preview'),'commit-blob');
  const current=await now.json(),before=await oldVersion.json();
  assert.ok(current && before);assert.notDeepEqual(current,before);
  const missingVersion=await get(url('work-imprint',file));assert.equal(missingVersion.status,400);
  const head=await get(route,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  fs.writeFileSync(path.join(project,file),old);
  assert.equal((await get(route)).status,409);
});

test('a Git work introduction belongs to the selected historical blob, including when the working file is gone',async t=>{
  const file='001.html';
  const {first,second,get,project}=await fixture(t,project=>{
    const git=gitAt(project);git('init','--quiet');
    const commit=title=>{fs.writeFileSync(path.join(project,file),webpage(title));git('add',file);git('commit','-qm','Update');return git('rev-parse','HEAD');};
    const first=commit('湖边自行车路线'),second=commit('山间观鸟路线');
    fs.writeFileSync(path.join(project,file),webpage('CURRENT_WORKING_TREE'));
    return {first,second};
  });
  const a=await get(url('work-intro',file,{commit:first}));
  assert.equal(a.status,200);assert.match(a.headers.get('content-type'),/^application\/json/);
  const old=await a.json();assert.deepEqual(Object.keys(old).sort(),['summary','title']);
  assert.equal(old.title,'湖边自行车路线');assert.doesNotMatch(JSON.stringify(old),/山间观鸟|CURRENT_WORKING_TREE|RAW_SCRIPT_SENTINEL|<html>/);
  fs.unlinkSync(path.join(project,file));
  const b=await get(url('work-intro',file,{commit:second}));assert.equal(b.status,200);assert.equal((await b.json()).title,'山间观鸟路线');
  assert.equal((await get(url('work-intro',file,{commit:'a'.repeat(40)}))).status,404);
});

test('SDK-only content is read only when the registered path and the current bytes match its exact fingerprint',async t=>{
  const file='007.html',bytes=webpage('海鸟观察手册'),fingerprint=sha(bytes);
  const {get,project}=await fixture(t,p=>{fs.writeFileSync(path.join(p,file),bytes);fs.writeFileSync(path.join(p,'unobserved.html'),bytes);});
  const sent=await get('/api/events',{method:'POST',headers:{'Content-Type':'application/json','X-Deepmine-Key':key},
    body:JSON.stringify({schemaVersion:1,id:'submission-7',source:'external-studio',projectPath:project,sessionId:'session',
      timestamp:new Date(Date.now()-1000).toISOString(),kind:'output',output:{title:file,files:[file],type:'web',fingerprint}})});
  assert.equal(sent.status,200);
  const route=url('work-intro',file,{fingerprint});
  const good=await get(route);assert.equal(good.status,200);assert.equal(good.headers.get('x-deepmine-preview'),'verified-fingerprint');
  assert.equal((await good.json()).title,'海鸟观察手册');
  for(const [q,status] of [[url('work-intro',file),400],[url('work-intro',file,{commit:'a'.repeat(40),fingerprint}),400],
    [url('work-intro','unobserved.html',{fingerprint}),404],[url('work-intro','../007.html',{fingerprint}),404]]){
    const res=await get(q);assert.equal(res.status,status);
    assert.doesNotMatch(await res.text(),/海鸟|<html>|RAW_SCRIPT_SENTINEL/);
  }
  assert.equal((await get(route,{headers:{Origin:'https://outside.invalid'}})).status,403);
  fs.writeFileSync(path.join(project,file),webpage('海岛观察手册'));
  for(const method of ['HEAD','GET']){
    const res=await get(route,{method});assert.equal(res.status,409);assert.doesNotMatch(await res.text(),/海岛|海鸟|<html>/);
  }
});

test('private filenames get no introduction even if their names were present in a Git commit',async t=>{
  const {get,commit}=await fixture(t,project=>{
    const git=gitAt(project);git('init','--quiet');fs.mkdirSync(path.join(project,'.notes'));
    for(const name of ['secrets.md','.notes/private.md','normal.md'])fs.writeFileSync(path.join(project,name),'# PrivateTitleSentinel\n\nPrivateBodySentinel');
    git('add','.');git('commit','-qm','fixture');return {commit:git('rev-parse','HEAD')};
  });
  for(const file of ['secrets.md','.notes/private.md','../normal.md','C:/unobserved.md']){
    const res=await get(url('work-intro',file,{commit}));assert.equal(res.status,404,file);
    assert.doesNotMatch(await res.text(),/PrivateTitleSentinel|PrivateBodySentinel/);
  }
});

test('a playable video preview must specify an observed version and honors its actual MIME type',async t=>{
  const file='exports/001.webm', bytes=Buffer.from('1a45dfa39f4286810142f7810142f2810442f381084282847765626d4287810442858102','hex');
  const {get,project}=await fixture(t,p=>{fs.mkdirSync(path.join(p,'exports'));fs.writeFileSync(path.join(p,file),bytes);},['exports']);
  assert.equal((await get(url('preview',file))).status,400);
  const route=url('preview',file,{fingerprint:sha(bytes)});
  const response=await get(route);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'video/webm');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  const head=await get(route,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  fs.writeFileSync(path.join(project,file),Buffer.alloc(bytes.length,0));
  assert.equal((await get(route)).status,409);
});

test('numbered files scanned from a project explain the code function and CSV columns on their snapshot and service entries',async t=>{
  const files={'exports/001.csv':'城市,销量,月份\n私人行值哨兵,22,10月\n',
    'exports/001.js':"const {createHash}=require('node:crypto');\nfunction bytesDigest(input){return createHash('sha256').update(input).digest('hex');}"};
  const {get}=await fixture(t,p=>{fs.mkdirSync(path.join(p,'exports'));for(const [name,bytes] of Object.entries(files))fs.writeFileSync(path.join(p,name),bytes);},['exports']);
  const snapshot=await (await get('/api/snapshot')).json();
  for(const [file,bytes] of Object.entries(files)){
    const entry=snapshot.outputs.find(x=>x.files.includes(file));
    assert.ok(entry);assert.equal(entry.fingerprint,sha(bytes));
    const response=await get(url('work-intro',file,{fingerprint:entry.fingerprint}));
    assert.equal(response.status,200);
    const copy=await response.json();
    assert.equal(copy.title,entry.title);assert.equal(copy.summary,entry.summary);
    assert.doesNotMatch(copy.title+' '+copy.summary,/001\.|私人行值哨兵/);
    if(file.endsWith('.csv')){assert.match(copy.title,/城市/);assert.match(copy.summary,/销量/);}
    else {assert.match(copy.title,/指纹/);assert.match(copy.summary,/内容|辨认|文件/);}
  }
});
