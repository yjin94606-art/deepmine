'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {describeBytes,captureContent,publicPath}=require('../scripts/work-content.cjs');
const Story=require('../dist/item-story.js');

test('a notebook, map, calendar and subtitles describe the work under an arbitrary filename',()=>{
  const cases=[
    ['001.ipynb',JSON.stringify({cells:[{cell_type:'markdown',source:['# 海水温度\n','按月份对照两个站点的温度。']},{cell_type:'code',source:'sensitive raw cell'}]}),'海水温度',/两个站点/],
    ['002.geojson',JSON.stringify({type:'FeatureCollection',name:'迁徙停留点',features:[{type:'Feature',geometry:{type:'Point'}}]}),'迁徙停留点',/1 个地理要素/],
    ['003.ics','BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:周末步行\r\nEND:VEVENT\r\nEND:VCALENDAR','周末步行的日程',/周末步行/],
    ['004.vtt','WEBVTT\n\n00:00.000 --> 00:02.000\n欢迎来听海边电台\n\n00:03.000 --> 00:04.000\n我们从渔港说起','「欢迎来听海边电台」的字幕',/从渔港说起/]
  ];
  for(const [name,example,title,pattern] of cases){
    const bytes=Buffer.from(example),copy=describeBytes(name,bytes),capture=captureContent(name,bytes.length);
    capture.push(bytes.subarray(0,8));capture.push(bytes.subarray(8));
    assert.deepEqual(capture.result(),copy); assert.equal(copy.title,title);
    assert.match(copy.summary,pattern);assert.doesNotMatch(copy.summary,/sensitive raw cell/);
  }
});

test('opaque structured formats do not treat arbitrary values as a work description',()=>{
  assert.equal(describeBytes('001.json',Buffer.from('{"session":"name","body":"private raw value"}')),null);
  assert.equal(describeBytes('001.json',Buffer.from('{"title":"Safe","description":"my secret value"}')),null);
  assert.equal(describeBytes('001.pdf',Buffer.from('random bytes')),null);
  for(const name of ['.env','../a.txt','folder/.env.json','secrets.json','/abs.md','C:/a.txt'])
    assert.equal(Boolean(publicPath(name)),false);
});

const date='2026-11-18',time=date+'T04:00:00Z';
function file(id,type,name,title,summary,extra={}){
  return {id,sourceId:'local-files',files:[name],timestamp:time,type,title,summary,fingerprint:id.padEnd(64,'a'),...extra};
}
function view(outputs,commits=[]){
  const snapshot={mode:'live',timezone:'Asia/Shanghai',project:{id:'p'},outputs,memories:[],days:[{date,evidence:commits}]};
  const item={date,visualType:'file',paths:[...new Set(outputs.flatMap(out=>out.files))],outputIds:outputs.map(o=>o.id),evidenceIds:commits.map(c=>c.hash)};
  return {item,snapshot};
}
test('the mine describes each work with its own type, full summary and receipt even inside a mixed group',()=>{
  const name='files/001.xlsx',note='记录花苗每周的株高。另一张工作表用来对照浇水间隔。';
  const outputs=[file('a','table',name,'花苗观察',note,{contentVersion:1,traces:[{path:name,sourceId:'codex',operation:'edit',producedAt:time,requestedAt:date+'T03:45:00Z',request:'帮我整理浇水观察。'}]}),
    file('b','code','files/002.py','路线规划','沿着站点查找换乘路线。',{contentVersion:1})];
  const {item,snapshot}=view(outputs), members=Story.works(item,snapshot);
  let copy=Story.describe(item,snapshot,'zh-CN',members[0]);
  assert.equal(copy.summary,note);assert.equal(copy.type,'table');assert.equal(copy.request,'帮我整理浇水观察。');
  assert.match(copy.output,/Codex 修改了「花苗观察」/);
  copy=Story.describe(item,snapshot,'zh-CN',members[1]);
  assert.equal(copy.type,'code');assert.equal(copy.request,'');assert.equal(copy.author,'');
});

test('SDK descriptions and verified video frames retain different evidence on identical bytes',()=>{
  const name='files/001.webm';
  const observed=file('a','video',name,'7 秒的视频','全长7秒。',{contentVersion:1});
  const event={...observed,id:'sdk:x',sourceId:'studio',contentVersion:undefined,title:'周末试玩录像',summary:'从营地走到河边的第一段试玩。'};
  for(const outputs of [[observed,event],[event,observed]]){
    const {item,snapshot}=view(outputs),members=Story.works(item,snapshot);
    assert.equal(members.length,1);
    const reading={title:['游戏片段','Game footage','ゲームの場面'],summary:['抽取的画面中可以看到游戏场景。','','']};
    const copy=Story.describe(item,snapshot,'zh-CN',members[0],reading);
    assert.equal(copy.title,'周末试玩录像');
    for(const fact of ['营地','游戏场景'])assert.ok(copy.summary.includes(fact));
    assert.doesNotMatch(copy.summary,/全长|7秒/);
    assert.match(copy.duration,/7秒/);
    assert.equal(Story.visualSource(item,snapshot,members[0]).kind,'video');
    assert.equal(copy.author,'');
  }
});
test('a current observation cannot hide a historic Git version with a different story',()=>{
  const name='files/001.md',output=file('a','document',name,'湿地观察','记录了河口的水鸟。',{contentVersion:1});
  const commit={files:[{path:name}],hash:'1'.repeat(40),timestamp:date+'T01:00:00Z',title:'记下迁徙观察'};
  const {item,snapshot}=view([output],[commit]),members=Story.works(item,snapshot);
  assert.equal(members.length,2);
  const old=members.find(m=>m.commit),current=members.find(m=>m.record);
  assert.equal(Story.contentSource(item,snapshot,current),null);
  const ref=Story.contentSource(item,snapshot,old);
  assert.match(ref.url,/commit=/);assert.doesNotMatch(ref.url,/fingerprint=/);
  const copy=Story.describe(item,snapshot,'zh-CN',old,null,{title:'秋天的迁徙',summary:'记下雁群启程的日期。'});
  assert.equal(copy.title,'秋天的迁徙');assert.equal(copy.summary,'记下雁群启程的日期。');assert.equal(copy.timeKind,'commit');
});
