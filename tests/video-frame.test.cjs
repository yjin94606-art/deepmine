'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const url='/api/preview?path=001.webm&fingerprint='+'a'.repeat(64);
const reader=import('../dist/video-frame.mjs');
function fixture(t,{version='verified-fingerprint',black=false,error=false}={}){
  const state={reads:0,urls:0,releases:0,seeks:0,cleared:0};
  const mock=(target,key,value)=>{
    const descriptor=Object.getOwnPropertyDescriptor(target,key);
    Object.defineProperty(target,key,{value,configurable:true,writable:true});
    t.after(()=>{if(descriptor)Object.defineProperty(target,key,descriptor);else delete target[key];});
  };
  class Video extends EventTarget {
    videoWidth=160;videoHeight=90;duration=5;readyState=2;time=0;
    set src(value){queueMicrotask(()=>this.dispatchEvent(new Event(error?'error':'loadeddata')));}
    get currentTime(){return this.time;}
    set currentTime(value){state.seeks++;this.time=value;queueMicrotask(()=>this.dispatchEvent(new Event('seeked')));}
    pause(){}
    load(){}
    removeAttribute(){state.cleared++;}
  }
  const ctx={drawImage(){},getImageData(){
    const data=Uint8Array.from({length:800},(_,i)=>black?0:Math.floor(i/4)%2===0?255:64);
    return {data};
  }};
  mock(global,'location',new URL('http://localhost:4123'));
  mock(global,'document',{createElement:tag=>tag==='video'?new Video():{getContext:()=>ctx}});
  mock(global,'fetch',async()=>{state.reads++;return new Response('fixture',{headers:{'Content-Type':'video/webm','X-Deepmine-Preview':version}});});
  mock(global,'createImageBitmap',async c=>({width:c.width,height:c.height}));
  mock(URL,'createObjectURL',()=>{state.urls++;return 'blob:fixture';});
  mock(URL,'revokeObjectURL',()=>{state.releases++;});
  return state;
}
test('a verified local video produces a bounded frame at the decoder timestamp and releases its object URL',async t=>{
  const state=fixture(t),{extractVideoFrame}=await reader;
  const {frame,time}=await extractVideoFrame(url,new AbortController().signal);
  assert.equal(frame.width,160);assert.ok(Math.abs(time-1.8)<.001);
  assert.equal(state.reads,1);assert.equal(state.cleared,1);assert.equal(state.releases,1);
});
test('the mine can show a real video frame without transferable bitmap support',async t=>{
  fixture(t);
  global.createImageBitmap=undefined;
  const {extractVideoFrame}=await reader;
  const result=await extractVideoFrame(url,new AbortController().signal);
  assert.equal(typeof result.frame.getContext,'function');
  assert.equal(result.frame.width,160);
});
test('a worker receives a transferable frame when it requests one',async t=>{
  fixture(t);
  const {extractVideoFrame}=await reader;
  const result=await extractVideoFrame(url,new AbortController().signal,{transfer:true});
  assert.deepEqual(result.frame,{width:160,height:90});
});
test('blank frames use at most three seeks and yield no suggested subject',async t=>{
  const state=fixture(t,{black:true}),{extractVideoFrame}=await reader;
  assert.equal(await extractVideoFrame(url,new AbortController().signal),null);
  assert.equal(state.seeks,3);assert.equal(state.releases,1);
});
test('an external URL, unversioned path, or ambiguous version is never fetched',async t=>{
  const state=fixture(t),{extractVideoFrame}=await reader;
  for(const unsafe of ['https://example.invalid'+url,'/api/preview?path=001.webm',url+'&commit='+'2'.repeat(40)]){
    await assert.rejects(extractVideoFrame(unsafe,new AbortController().signal));
  }
  assert.equal(state.reads,0);
});
test('a response without a matching verification header never reaches the decoder',async t=>{
  const state=fixture(t,{version:'current-file-not-commit-snapshot'}),{extractVideoFrame}=await reader;
  await assert.rejects(extractVideoFrame(url,new AbortController().signal));
  assert.equal(state.reads,1);assert.equal(state.urls,0);
});
test('a decoder error detaches the blob and revokes its URL',async t=>{
  const state=fixture(t,{error:true}),{extractVideoFrame}=await reader;
  await assert.rejects(extractVideoFrame(url,new AbortController().signal));
  assert.equal(state.urls,1);assert.equal(state.releases,1);assert.equal(state.cleared,1);
});
