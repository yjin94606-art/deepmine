'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../dist/demo-records.js'),C=require('../dist/evidence-core.js'),W=require('../dist/work-findings.js');
test('every current sample finding has a short, distinct introduction in each interface language', () => {
  const snapshot = D.create('2026-11-18T12:00:00+08:00'), findings = W.build(snapshot);
  for (const locale of ['zh-CN','en','ja']) {
    const titles = new Set();
    for (const item of findings) {
      const copy = D.describeSample(item, snapshot, locale);
      assert.ok(copy.title && copy.summary && copy.summary !== copy.title);
      assert.ok(copy.summary.length < 140);
      titles.add(copy.title);
      if (locale === 'en' && item.outputIds.length) {
        const output = snapshot.outputs.find(output => output.id === item.outputIds[0]);
        assert.equal(copy.summary, output.summary);
      }
    }
    assert.equal(titles.size, 12);
  }
  const picture = findings.find(item => item.visualType === 'image');
  assert.equal(D.describeSample(picture,snapshot,'zh-CN').summary, '一条浅色小路穿过花圃，通向玻璃温室。');
  assert.deepEqual(D.describeSample(picture,snapshot,'zh-Hans'), D.describeSample(picture,snapshot,'zh-CN'));
  assert.match(picture.paths[0], /Garden-illustration\.png$/);
});
test('sample copy only appears for individual records with matching fictional provenance', () => {
  const snapshot = D.create('2026-11-18T12:00:00+08:00'), findings = W.build(snapshot);
  const picture = findings.find(item => item.visualType === 'image');
  for (const [item, state] of [
    [picture,{...snapshot,mode:'live'}],
    [picture,{...snapshot,project:{id:'older-example'}}],
    [{...picture,mode:'live'},snapshot],
    [{...picture,paths:[...picture.paths,'other.png']},snapshot],
    [{...picture,outputIds:['event:other']},snapshot],
    [{...picture,paths:['real/Garden-illustration.png']},snapshot],
    [{...picture,evidenceIds:['abc123']},snapshot],
    [picture,{...snapshot,outputs:snapshot.outputs.map(output => ({...output,sourceId:'local-files'}))}]
  ]) assert.equal(D.describeSample(item, state, 'zh-CN'), null);
  const memory = findings.find(item => item.memoryIds?.length);
  assert.equal(D.describeSample({...memory,memoryIds:[...memory.memoryIds,'new-note']},snapshot,'ja'),null);
  assert.equal(D.describeSample(memory,{...snapshot,memories:snapshot.memories.map(m=>({...m,sourceRef:'other-reference'}))},'en'),null);
});
test('current demo uses the actual history rules and explicitly fictional provenance',()=>{const snapshot=D.create('2026-11-18T12:00:00+08:00');assert.equal(snapshot.mode,'demo');assert.equal(snapshot.days.length,30);assert.equal(snapshot.history.enabled,true);assert.equal(new Set(snapshot.outputs.map(item=>item.type)).size,9);assert.ok(snapshot.memories.every(item=>item.summary.startsWith('Fictional')));const projection=C.project(snapshot);assert.equal(projection.days.length,30);assert.ok(projection.days.every(day=>day.outputDepth>=48));assert.ok(W.build(snapshot).every(item=>item.mode==='demo'));});
test('each fictional piece has its own offline flavor in three languages, including both illustrations and both memories',()=>{
  const snapshot=D.create('2026-11-18T12:00:00+08:00'),items=W.build(snapshot);
  for(const locale of ['zh-CN','en','ja']){
    const texts=new Set(),pictures=new Set(),memories=new Set();
    for(const item of items){
      const copy=D.describeSample(item,snapshot,locale),text=D.flavorFor(item,snapshot,locale);
      assert.equal(typeof text,'string');assert(text.length>7 && text.length<180);
      assert.notEqual(text,copy.summary);texts.add(text);
      if(item.visualType==='image')pictures.add(text);
      if(item.memoryIds?.length)memories.add(text);
    }
    assert.equal(texts.size,12);assert.equal(pictures.size,2);assert.equal(memories.size,2);
  }
  const pic=items.find(item=>item.visualType==='image'),record=snapshot.outputs.find(o=>o.id===pic.outputIds[0]);
  const selected={path:pic.paths[0],record};
  assert.equal(D.flavorFor(pic,snapshot,'zh-CN',selected),D.flavorFor(pic,snapshot,'zh-CN'));
  assert.equal(D.flavorFor(pic,snapshot,'zh-CN',{...selected,record:{...record,fingerprint:'f'.repeat(64)}}),null);
  assert.equal(D.flavorFor(pic,{...snapshot,mode:'live'},'zh-CN'),null);
  assert.equal(D.flavorFor({...pic,projectId:'user-project'},snapshot,'zh-CN'),null);
});
test('fictional creation stories reflect specific requests and revisions instead of printing dialogue',()=>{
  const snapshot=D.create('2026-11-18T12:00:00+08:00'),items=W.build(snapshot);
  const portrait=items.find(item=>item.paths?.some(path=>path.endsWith('/sample-02.png')));
  const podcast=items.find(item=>item.visualType==='audio');
  assert.ok(portrait.date<snapshot.days.at(-1).date);
  assert.match(D.flavorFor(portrait,snapshot,'zh-CN'),/挪了两回/);
  assert.match(D.flavorFor(podcast,snapshot,'en'),/opening line/);
  for(const [item,turns] of [[portrait,3],[podcast,2]]){
    for(const locale of ['zh-CN','en','ja']){
      const {short,discussion}=D.describeSample(item,snapshot,locale);
      assert.equal(discussion.length,turns);
      for(const [request,reply] of discussion){assert.ok(request && reply);assert.ok(!short.includes(request) && !short.includes(reply));}
    }
    assert.equal(D.describeSample(item,{...snapshot,mode:'live'},'en'),null);
  }
});

test('long history exposes every memory id without exceeding twelve visual groups per day',()=>{const snapshot=D.create('2026-11-18T12:00:00+08:00'),first=snapshot.memories[0];for(let i=0;i<60;i++)snapshot.memories.push({...first,id:'additional-memory:'+i,sourceRef:'message:'+i});const items=W.build(snapshot),ids=new Set(items.flatMap(item=>item.memoryIds||[]));assert.equal(ids.size,snapshot.memories.length);for(const date of snapshot.days.map(day=>day.date))assert.ok(items.filter(item=>item.date===date).length<=12);});
