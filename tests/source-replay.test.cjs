'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {overview,play}=require('../dist/source-replay.js');

const date='2026-11-18',at=date+'T08:00:00Z';
const item={id:'found',visualType:'document',date,depth:12,paths:['a.md','b.md','c.md'],evidenceIds:[]};
function output(id,name,source,quote){
  return {id,sourceId:'local-files',type:'document',timestamp:at,files:[name],fingerprint:id.padEnd(64,'a'),
    traces:source?[{path:name,sourceId:source,producedAt:at,request:quote}]:[],contentVersion:1,title:'Work',summary:'Notes'};
}
function snapshot(){return {mode:'live',timezone:'Asia/Shanghai',days:[],outputs:[
  output('1','a.md','codex'),output('2','b.md','codex','记下今天的观察。'),output('3','c.md','claude-code','A different request.')]};}

test('the live source reopens the exact matching work from a group and counts unique verified versions',()=>{
  const s=snapshot();s.outputs.push({...s.outputs[1],id:'another-observation'});
  const result=overview(s,[item],'codex',13);
  assert.equal(result.count,2);assert.equal(result.work.member.path,'b.md');
  assert.equal(result.work.member.trace.request,'记下今天的观察。');
});
test('an unexcavated work never becomes a replay and fictional data cannot enter the live source view',()=>{
  const s=snapshot();assert.equal(overview(s,[item],'codex',5).work,null);
  assert.deepEqual(overview({...s,mode:'demo'},[item],'codex',99),{count:0,work:null});
  assert.equal(overview(s,[item],'not-connected',99).count,0);
});
test('playback uses an inactive, separate scene with only a view callback and stops at the recorded depth',async()=>{
  let opts,initial,range,done,destroyed=false,shown=0;
  const create=(_,options)=>{opts=options;return {setState(value){initial=value;},replay(a,b){range=[a,b];return new Promise(resolve=>{done=resolve;});},destroy(){destroyed=true;}};};
  const stop=play(create,{}, {item,locale:'en',title:'The work',layers:[],onDepth:()=>{},onReady:()=>shown++});
  assert.deepEqual(Object.keys(opts),['onProgress']);assert.equal(initial.active,false);assert.equal(initial.workFindings[0].id,item.id);
  assert.deepEqual(range,[0,12]);done();await Promise.resolve();assert.equal(shown,1);stop();assert.equal(destroyed,true);
});
test('closing a replay cancels a later reveal without firing the live mine',async()=>{
  let resolve,finished=false;
  const stop=play(()=>({setState(){},replay(){return new Promise(r=>{resolve=r;});},destroy(){resolve();}}),{},
    {item,locale:'en',title:'Work',layers:[],onDepth:()=>{},onReady:()=>{finished=true;}});
  stop();await Promise.resolve();assert.equal(finished,false);
});
