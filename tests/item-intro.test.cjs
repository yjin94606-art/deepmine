'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {describe} = require('../dist/item-intro.js');
const finding = (type, ...paths) => ({visualType:type, date:'2026-11-18', paths});
const record = (id, path, title, summary) => ({id,files:[path],title,summary});

test('historic program checks and recordings are introduced from the meaning of their name',()=>{
  for(const [type,file,title] of [
    ['code','tests/core.test.cjs','核心逻辑测试'],['code','tests/mine-core.test.js','矿坑逻辑测试'],
    ['code','tests/collector.test.cjs','项目数据采集测试'],['code','src/collector.js','项目数据采集'],
    ['video','docs/workshop-demo-motion.webm','工坊演示录像'],['video','archive/mine-gameplay.webm','矿坑演示录像'],
    ['code','tests/a5d3c295.test.cjs','程序测试']
  ]){
    const copy=describe(finding(type,file),{},'zh-CN');
    assert.equal(copy.title,title);assert.match(copy.summary,/文件名/);
    assert.doesNotMatch(copy.title+copy.summary,/core|collector|\.cjs|webm|a5d3c295|测试通过|已通过/);
  }
});
test('readable titles in unrelated fields convey use but keep filename evidence explicit',()=>{
  for(const [type,file,subject] of [
    ['document','November-invoice.pdf','发票文档'],['table','invoice-2026.xlsx','发票记录表'],['audio','orchestra_rehearsal.wav','排练录音'],
    ['video','mixingWalkthrough.webm','分步讲解录像'],['slides','history-lesson.pptx','课程讲义'],['document','meeting-agenda.md','会议议程']
  ]){
    const item=finding(type,file), zh=describe(item,{},'zh-CN');
    assert.equal(zh.title,subject);assert.match(zh.summary,/文件名/);
    assert.match(describe(item,{},'en').summary,/file name/);assert.match(describe(item,{},'ja').summary,/ファイル名/);
  }
  for(const file of ['onCommitGenerated.cjs','ca17badecaca445678a.js','写作.b98cde88fb22.mjs']){
    const result=describe(finding('code',file),{},'zh-CN');
    assert.equal(result.title,'一段程序');assert.doesNotMatch(result.summary,/on Commit|b98cde|\.mjs|\.js/);
  }
});

test('every file kind gets a short introduction in the chosen language', () => {
  for (const kind of ['web','document','image','audio','video','slides','table','code','file']) {
    const item = finding(kind, 'exports/周五样稿.xyz');
    const variants = ['zh-CN','en','ja'].map(locale => describe(item, {}, locale));
    assert.equal(new Set(variants.map(v => v.summary)).size,3);
    for (const {title,summary} of variants) {
      assert.equal(title,'周五样稿');
      assert.ok(summary.includes('周五样稿'));
      assert.doesNotMatch(summary,/Token|SHA-256|\.xyz|完成|测试通过/);
    }
  }
});
test('a meaningful supplied title and short description concern the file being introduced', () => {
  const item = {...finding('image','exports/a.png','exports/b.png'),outputIds:['a','b','old-a']};
  const snapshot = {outputs:[
    {...record('a',item.paths[0],'北门导览图','图上标出了北门到花房的两条步道。请使用最新版。'),timestamp:'2026-11-18T12:00:00Z'},
    {...record('old-a',item.paths[0],'旧地图','旧图使用另一条路线。'),timestamp:'2026-11-18T10:00:00Z'},
    record('b',item.paths[1],'夜景地图','图上画着夜间灯光。')
  ]};
  const result = describe(item,snapshot,'zh-CN');
  assert.equal(result.title,'北门导览图');
  assert.match(result.summary,/两条步道/);
  assert.doesNotMatch(result.summary,/请使用|旧图|灯光|\.png/);
});
test('known collector notes are kept out of everyday copy', () => {
  const item = {...finding('document','docs/README.md'),outputIds:['a']};
  for (const note of ['已在配置的输出目录观察到此文件；日期取文件修改时间，未核验作者、生成工具或完成状态。','Cursor afterFileEdit 报告此文件发生编辑；指纹来自当前文件，日期取文件修改时间，不证明任务完成。','Observed file','Fictional sample for the interactive preview. No personal output was collected.']) {
    assert.deepEqual(describe(item,{outputs:[record('a',item.paths[0],'README.md',note)]},'zh-CN'),
      {title:'项目说明',summary:'想了解这个项目，可以从这份说明读起。'});
  }
});
test('names can explain purpose and groups use readable, distinct subjects', () => {
  const item = finding('code','src/route-planner.py','src/expedition-audio.js','src/i18n.js','src/other.js');
  assert.deepEqual(describe(item,{},'zh-CN'), {title:'路线规划脚本',summary:'这段程序用来规划路线。这一天的文件里还能找到声音播放和界面翻译。'});
  assert.match(describe(finding('code','tests/expedition-audio.test.cjs'),{},'zh-CN').summary,/声音播放.*是否按预期工作/);
  assert.doesNotMatch(describe(finding('code','src/a.cjs','src/raw-915ef9.js'),{},'zh-CN').summary,/915ef9/);
});
test('a short change note augments the item explanation and only uses matching file, date and hash', () => {
  const item = {...finding('code','src/route-planner.py'),evidenceIds:['right','another']};
  const entry = (hash,path,title) => ({hash,files:[{path}],title});
  const snapshot = {days:[
    {date:'2026-11-17', evidence:[entry('right',item.paths[0],'Wrong day')]},
    {date:item.date,evidence:[
      entry('right',item.paths[0],'fix(route): 绕开施工入口'),entry('another','src/unrelated.js','Sent everything'),entry('unrelated',item.paths[0],'Missing source ID')
    ]}
  ]};
  assert.equal(describe(item,snapshot,'zh-CN').summary,'这段程序用来规划路线。这次改动提到「绕开施工入口」。');
  snapshot.days[1].evidence[0].title = 'Update route-planner.py';
  assert.equal(describe(item,snapshot,'zh-CN').summary,'这段程序用来规划路线。');
});
test('conversation excerpts and sourced memories preserve the point, not opening filler or raw markup', () => {
  const item = {visualType:'audio',memoryIds:['one','two'],paths:[]};
  const snapshot = {memories:[{id:'one',method:'conversation-excerpt',title:'好的。', summary:'好的。已完成以下更新。验证结果如下。\n**声音**先默认关闭，想听的时候再打开。\n\n'+'无关'.repeat(200)},
    {id:'two',method:'agent-memory',summary:'给来访者留个说明。'}]};
  const result = describe(item,snapshot,'zh-CN');
  assert.equal(result.title,'对话里的一个想法');
  assert.match(result.summary,/声音先默认关闭，想听的时候再打开/);
  assert.match(result.summary,/另外 1/);
  assert.doesNotMatch(result.summary,/\*\*|无关|好的/);
  for (const locale of ['en','ja']) assert.match(describe(item,snapshot,locale).summary,/声音先默认关闭/);
});
test('unknown and archived findings still return plain text without modifying the record', () => {
  const item=finding('image','exports/<b>花园</b>.png'), snapshot={};
  const initial=JSON.stringify([item,snapshot]);
  for(const locale of ['zh-CN','en','ja']) {
    assert.doesNotMatch(JSON.stringify(describe(item,snapshot,locale)),/<\/?b>/);
    assert.ok(describe({},snapshot,locale).summary.length);
    assert.ok(describe({visualType:'memory',description:'候车时也能查看这份资料。'},snapshot,locale).summary.includes('候车'));
  }
  assert.equal(JSON.stringify([item,snapshot]),initial);
});
