'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createTreasure,parseTrending}=require('../scripts/treasure.cjs');

const top={name:'tide/atlas',description:'Maps & tide charts.',language:'Rust'};
const first='<article class="Box-row"><h2><a class="Link" href="/tide/atlas">tide / atlas</a></h2><p>Maps &amp; tide charts.</p><span itemprop="programmingLanguage">Rust</span></article>';
test('uses the first repository on GitHub daily, ignores navigation and later rankings, strips HTML',()=>{
  assert.deepEqual(parseTrending('<a href="/login">Login</a>'+first+first.replace('tide/atlas','later/row')),top);
  assert.throws(()=>parseTrending(first.replace('/tide/atlas','https://example.org/fake')+first));
  assert.throws(()=>parseTrending('<a href="/x/y">x/y</a>'));
});
test('only real daily digging unlocks a map; concurrent reads, repeated filing and restarts reuse the same dated map',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'deepmine-treasure-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const radio={date:'2026-10-17',meters:0};let calls=0;
  const settings={directory:dir,getRadio:async()=>({...radio}),readTop:async()=>{calls++;return top;}};
  const treasure=createTreasure(settings);
  assert.equal((await treasure.decode(radio.date)).status,'locked');assert.equal(calls,0);
  radio.meters=12;
  assert.equal((await treasure.state()).map,null);assert.equal(calls,0);
  const pair=await Promise.all([treasure.decode(radio.date),treasure.decode(radio.date)]);
  assert.deepEqual(pair[0],pair[1]);assert.equal(calls,1);
  await Promise.all([treasure.file(radio.date),treasure.file(radio.date)]);
  const old=radio.date;radio.date='2026-10-18';radio.meters=0;
  const reopened=createTreasure(settings);
  assert.equal((await reopened.state(old)).map.name,top.name);
  assert.deepEqual((await reopened.state()).entries,[{date:old,filed:true}]);assert.equal((await reopened.state()).map,null);
  assert.equal((await reopened.decode(old)).status,'locked');assert.equal(calls,1);
});
test('offline and midnight during decode preserve the opportunity without forging or backdating a map',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'deepmine-offline-map-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  let date='2026-05-16',clock=new Date('2026-05-16T12:00:00Z'),calls=0;
  const s=createTreasure({directory,now:()=>clock,getRadio:async()=>({date,meters:12}),readTop:async()=>{
    if(++calls===1)throw Error('offline');date='2026-05-17';return top;
  }});
  assert.equal((await s.decode(date)).status,'offline');assert.equal((await s.decode(date)).status,'offline');assert.equal(calls,1);
  clock=new Date(+clock+16000);assert.equal((await s.decode(date)).status,'expired');assert.deepEqual((await s.state()).entries,[]);
  assert.equal((await s.file('../2026-05-17')).status,'missing');
});
