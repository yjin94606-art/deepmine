'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {draw}=require('../dist/work-subjects.js');

function render(label,text='') {
  const width=96,height=80,pixels=Array(width*height).fill('');
  const ctx={canvas:{width,height},fillStyle:'',fillRect(x,y,w,h){
    assert.ok(Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x+w<=width&&y+h<=height);
    for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)pixels[row*width+col]=this.fillStyle;
  }};
  return {painted:draw(ctx,{label,text}),pixels};
}

test('named subjects have distinct open silhouettes with no lettering or paper background',()=>{
  const silhouettes=new Set();
  for(const title of ['白鹭','折叠台灯','海角灯塔','玻璃温室','社区花圃','旅行自行车','列车','地下矿井']){
    const {painted,pixels}=render(title);
    assert.equal(painted,true,title);
    const fill=pixels.filter(Boolean);
    assert.ok(fill.length>150&&fill.length<pixels.length*.65,title);
    assert.ok(new Set(fill).size>=5,title);
    silhouettes.add(pixels.map(p=>p?'1':'0').join(''));
  }
  assert.equal(silhouettes.size,8);
});

test('only an observed subject can choose an illustration across languages',()=>{
  const bird=render('河口观鸟手记','三只白鹭走进芦苇荡。');
  assert.ok(bird.painted);
  assert.deepEqual(bird.pixels,render('Egret at the estuary').pixels);
  assert.deepEqual(bird.pixels,render('コサギの観察記録').pixels);
  assert.deepEqual(render('旧矿道').pixels,render('A mineshaft at dusk').pixels);
  for(const title of ['观鸟手记','路况报告','灯塔和温室','personal training schedule','Deepmine v1.0 release build']){
    const {painted,pixels}=render(title);
    assert.equal(painted,false,title);assert.ok(pixels.every(p=>!p));
  }
});
