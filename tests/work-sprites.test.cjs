'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {create,preview,rasterize}=require('../dist/work-sprites.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('constrained devices defer the local image classifier until a work is inspected',()=>{
  const vm=require('node:vm'),fs=require('node:fs');
  const script=fs.readFileSync(require.resolve('../dist/visual-readings.js'),'utf8');
  function environment(navigator,bitmap){
    const posted=[];
    class Worker{
      postMessage(job){posted.push(job.key);}
    }
    const browser={navigator,Worker,OffscreenCanvas:class {},createImageBitmap:bitmap,
      AbortController,document:{addEventListener(){}},addEventListener(){},setTimeout(){},clearTimeout(){}};
    browser.window=browser;
    vm.runInNewContext(script,browser);
    return {readings:browser.VisualReadings,posted};
  }
  const picture={key:'painting',url:'/api/preview'};
  for(const device of [{connection:{saveData:true}},{deviceMemory:4}]){
    const {readings,posted}=environment(device,()=>{});
    readings.request(picture,0);
    assert.deepEqual(posted,[]);
    readings.request(picture,10);
    assert.deepEqual(posted,['painting']);
  }
  const limited=environment({},undefined);
  limited.readings.request(picture,10);
  assert.deepEqual(limited.posted,[]);
});

// Read pixel centres in a simulated canvas. Native drawImage handles the
// downsampling filter; these assertions exercise the palette and composition.
function canvas(){
  const out={};
  out.getContext=()=>({
    drawImage(source){out.source=source;},
    getImageData(){
      const data=new Uint8ClampedArray(out.width*out.height*4);
      for(let y=0;y<out.height;y++)for(let x=0;x<out.width;x++){
        data.set(out.source.colorAt((x+.5)/out.width,(y+.5)/out.height),4*(y*out.width+x));
      }
      return {data};
    },
    putImageData(image){out.data=image.data;}
  });
  return out;
}
const color=(sprite,x,y)=>Array.from(sprite.data.subarray(4*(y*sprite.width+x),4*(y*sprite.width+x)+4));

test('pixel objects trim blank margins before sampling the wall and stage while real images keep their framing',()=>{
  const source={width:96,height:80,pixelArtwork:true,colorAt:(x,y)=>x>=10/96&&x<85/96&&y>=6/80&&y<49/80?[220,180,110,255]:[0,0,0,0]};
  const rgba=new Uint8ClampedArray(96*80*4);
  for(let y=0;y<80;y++)for(let x=0;x<96;x++)rgba.set(source.colorAt((x+.5)/96,(y+.5)/80),4*(y*96+x));
  source.getContext=()=>({getImageData:()=>({data:rgba})});
  const crops=[];
  function drawCanvas(){
    const out=canvas(),ctx=out.getContext();
    ctx.drawImage=(input,...pos)=>{
      crops.push(pos);
      const [left,top,width,height]=pos.length===8?pos:[0,0,input.width,input.height];
      out.source={colorAt:(x,y)=>input.colorAt((left+x*width)/input.width,(top+y*height)/input.height)};
    };
    out.getContext=()=>ctx;
    return out;
  }
  const art=rasterize(source,drawCanvas);
  assert.deepEqual([art.stage.width,art.stage.height,art.wall.width,art.wall.height],[77,45,48,28]);
  for(const crop of crops)assert.deepEqual(crop.slice(0,4),[9,5,77,45]);
  assert.equal(color(art.stage,20,44)[3],0);assert.equal(color(art.stage,20,43)[3],255);
  const photo=rasterize({...source,pixelArtwork:false},drawCanvas);
  assert.deepEqual([photo.stage.width,photo.stage.height],[96,80]);
});

test('both sprite sizes keep the real image framing, colors, transparency and distinctive light',()=>{
  const source={width:1600,height:900,colorAt:(x,y)=>{
    if(x<.12)return [0,0,255,0];
    if(x>.82 && y<.28)return [247,170,24,255];
    return [20,54,66,y>.85?92:255];
  }};
  const art=rasterize(source,canvas);
  assert.deepEqual([art.wall.width,art.wall.height,art.stage.width,art.stage.height],[48,27,112,63]);
  for(const s of [art.stage,art.wall]){
    assert.equal(color(s,0,0)[3],0);
    assert.deepEqual(color(s,s.width-1,1),[247,170,24,255]);
    assert.deepEqual(color(s,s.width-1,s.height-1),[20,54,66,92]);
    assert.deepEqual(s.lightColor,art.light);
  }
  assert.deepEqual(art.light,[247,170,24]);
  const revised=rasterize({...source,colorAt:(x,y)=>source.colorAt(1-x,y)},canvas);
  assert.deepEqual(color(revised.wall,1,1),[247,170,24,255]);
  assert.notDeepEqual(revised.wall.data,art.wall.data);
});
test('small pixel art is not upsampled, tall images remain tall and fully clear pixels cast no light',()=>{
  const flat={width:8,height:4,colorAt:()=>[23,45,67,255]};
  const art=rasterize(flat,canvas);
  assert.deepEqual([art.stage.width,art.stage.height,art.wall.width,art.wall.height],[8,4,8,4]);
  assert.deepEqual(color(art.wall,1,1),[23,45,67,255]);
  const clear=rasterize({...flat,width:100,height:900,colorAt:()=>[255,0,200,0]},canvas);
  assert.deepEqual([clear.wall.width,clear.wall.height],[5,48]);
  assert.equal(clear.stage.lightColor,null);
  assert.equal(rasterize({...flat,width:0},canvas),null);
});
test('the palette is drawn from the selected work and is bounded independently of its resolution',()=>{
  const a=rasterize({width:256,height:256,colorAt:(x,y)=>[Math.round(x*255),Math.round(y*255),0,255]},canvas);
  const used=new Set();
  for(let i=0;i<a.stage.data.length;i+=4){
    assert.equal(a.stage.data[i+2],0);
    used.add(a.stage.data[i]*256+a.stage.data[i+1]);
  }
  assert.ok(used.size>20&&used.size<=40);
});
test('sources must point to a locally verified file version or a shipped demo image',()=>{
  const origin='http://127.0.0.1:4173',path='outputs/one.png',hash='f'.repeat(64);
  const p={path,url:'/api/preview?path=outputs%2Fone.png&fingerprint='+hash};
  assert.equal(preview(p,origin).version,'verified-fingerprint');
  assert.equal(preview({...p,url:p.url.replace('fingerprint','commit')},origin).version,'commit-blob');
  assert.equal(preview({...p,url:p.url+'&commit='+hash},origin),null);
  assert.equal(preview({...p,path:'other.png'},origin),null);
  for(const url of ['//other.tld/x','/api/work-intro?path=x','/api/preview?path=outputs%2Fone.png','/demo-assets/sample-02.png']){
    assert.equal(preview({...p,url},origin),null);
  }
  assert.ok(preview({demo:true,url:'/demo-assets/garden.png'},origin));
  assert.equal(preview({demo:true,url:'//example.org/demo-assets/garden.png'},origin),null);
});

test('the landscape keeps small painted features, the aspect ratio and the transparent surroundings',()=>{
  const high={width:1728,height:972,colorAt:(x,y)=>{
    if(y<.15)return [0,0,0,0];
    if(Math.floor(x*144)%2===1)return [243,159,40,255];
    return [22,51,64,255];
  }};
  const art=rasterize(high,canvas);
  assert.deepEqual([art.scene.width,art.scene.height],[288,162]);
  assert.deepEqual(color(art.scene,2,131),[243,159,40,255]);
  assert.deepEqual(color(art.scene,3,131),[243,159,40,255]);
  assert.deepEqual(color(art.scene,4,131),[22,51,64,255]);
  assert.equal(color(art.scene,4,1)[3],0);
  const imprint=rasterize(high,canvas,false);
  assert.equal(imprint.scene,imprint.stage);
});

const src=(id,kind='image')=>({key:id,url:'/api/preview?path='+id,kind});
function queue(){
  const running=[],changed=[];
  const cache=create({changed:key=>changed.push(key),load:(source,signal)=>new Promise((resolve,reject)=>{
    running.push({source,signal,resolve:()=>resolve({wall:source.key,stage:'large:'+source.key,light:[1,2,3]}),reject});
  })});
  return {running,changed,cache};
}
test('foreground images outrank pending wall work, duplicate visitors share one decoded pair',async()=>{
  const {cache,running,changed}=queue();
  const one=src('a'),two=src('b','video'),third=src('c'),featured=src('d','imprint');
  assert.equal(cache.status(one),'idle');
  for(const s of [one,two,third,featured])cache.request(s);
  cache.request(featured,10); cache.request(one,5);
  await tick();
  assert.deepEqual(running.map(x=>x.source.key),['a','b']);
  running[0].resolve();await tick();
  assert.equal(running[2].source,featured);
  assert.equal(cache.get(one),'a');
  assert.equal(cache.get(one,'stage'),'large:a');
  assert.deepEqual(cache.getAccent(one),[1,2,3]);
  assert.deepEqual(changed,['a']);
  cache.request(one);running[1].resolve();await tick();
  assert.equal(running[3].source,third);
  running[2].resolve();running[3].resolve();await tick();
  assert.equal(cache.status(third),'ready');
});
test('changing projects cancels requests and ignores stale pixels and asynchronous errors',async()=>{
  const {cache,running,changed}=queue();
  const image=src('same-key');
  cache.request(image);await tick();cache.reset();
  assert.equal(running[0].signal.aborted,true);
  cache.request(image);await tick();running[0].resolve();await tick();
  assert.equal(cache.status(image),'loading');
  assert.deepEqual(changed,[]);
  running[1].resolve();await tick();assert.equal(cache.get(image),'same-key');
  const next={...image,url:image.url+'-different-location'};
  cache.request(next);await tick();running[2].reject(Error('missing'));await tick();
  assert.equal(cache.status(next),'failed');
  assert.equal(cache.get(next),null);
  assert.equal(cache.get(image),'same-key');
  cache.request(next);await tick();assert.equal(running.length,3);
  cache.reset();assert.equal(cache.status(image),'idle');
});

test('an uninterruptible decoder cannot strand newer work behind its queue slot',async()=>{
  let notify;
  const completed=new Promise(done=>{notify=done;});
  const cache=create({timeoutMs:15,changed:key=>{if(key==='next')notify();},load:source=>{
    if(source.key.startsWith('stuck'))return new Promise(()=>{});
    return {wall:'next',stage:'next',light:null};
  }});
  cache.request(src('stuck-1'));cache.request(src('stuck-2'));cache.request(src('next'));
  await completed;
  assert.equal(cache.get(src('next')),'next');
  assert.equal(cache.status(src('stuck-1')),'failed');
  cache.reset();
});
