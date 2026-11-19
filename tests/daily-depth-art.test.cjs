'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {readout,depthY}=require('../dist/daily-depth-art.js');

test('the cutaway scales today and the latest earlier stamped day on the same downward axis',()=>{
  const day='2026-11-19',previous={day:'2026-11-17',meters:102};
  const model=readout({day,meters:32,stamps:[{day,meters:32},previous,{day:'2026-11-12',meters:250}]});
  assert.equal(model.meters,32);
  assert.deepEqual(model.previous,previous);
  assert.ok(model.limit>=previous.meters);
  assert.ok(depthY(model.meters,model.limit)<depthY(previous.meters,model.limit));
  assert.equal(readout({day,meters:0,stamps:[]}).previous,null);
  assert.equal(readout(null),null);
});
