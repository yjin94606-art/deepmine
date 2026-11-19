'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync(require.resolve('../dist/cavern-geology.js'),'utf8');
class Surface {
  constructor(w,h){this.width=w;this.height=h;this.data=new Array(w*h).fill(null);this.ctx=new Context(this);}
  getContext(){return this.ctx;}
}
class Context {
  constructor(canvas){this.canvas=canvas;this.x=0;this.y=0;this.fillStyle='#000000';this.imageSmoothingEnabled=true;this.stack=[];}
  save(){this.stack.push([this.x,this.y,this.fillStyle,this.imageSmoothingEnabled]);}
  restore(){[this.x,this.y,this.fillStyle,this.imageSmoothingEnabled]=this.stack.pop();}
  translate(x,y){assert(Number.isInteger(x)&&Number.isInteger(y));this.x+=x;this.y+=y;}
  put(x,y,c){assert(Number.isInteger(x)&&Number.isInteger(y));assert(x>=0&&x<this.canvas.width&&y>=0&&y<this.canvas.height,'pixel outside viewport: '+[x,y]);assert(/^#[a-f0-9]{6}$/.test(c));this.canvas.data[y*this.canvas.width+x]=c;}
  fillRect(x,y,w,h){assert([x,y,w,h].every(Number.isInteger),'noninteger primitive');assert(w>=0&&h>=0);for(let j=0;j<h;j++)for(let i=0;i<w;i++)this.put(x+this.x+i,y+this.y+j,this.fillStyle);}
  drawImage(src,sx,sy,sw,sh,dx,dy,dw,dh){assert.equal(this.imageSmoothingEnabled,false);assert.equal(sw,dw);assert.equal(sh,dh);assert([sx,sy,sw,sh,dx,dy].every(Number.isInteger));assert(sx>=0&&sy>=0&&sx+sw<=src.width&&sy+sh<=src.height);for(let j=0;j<sh;j++)for(let i=0;i<sw;i++){const c=src.data[(sy+j)*src.width+sx+i];if(c)this.put(dx+this.x+i,dy+this.y+j,c);}}
}
function load(cached){const scope={module:{exports:{}}};if(cached)scope.OffscreenCanvas=Surface;vm.runInNewContext(code,scope);return scope.module.exports;}
const direct=load(false),cached=load(true),palette=new Set(Object.values(direct.palette));
assert.equal(Object.keys(direct.palette).length,52);assert.equal(palette.size,52);
function render(api,options,foreground=false){const s=new Surface(options.halfWidth*2,options.bottom-options.top);s.ctx.translate(options.halfWidth,-options.top);api[foreground?'drawForeground':'drawTerrain'](s.ctx,options);assert.equal(s.ctx.imageSmoothingEnabled,true);assert.equal(s.ctx.stack.length,0);return s;}
let count=0;
for(const b of [0,1,2,3,'roots','aquifer','crystal','ruins'])for(const halfWidth of [65,156,240]){
  const o={top:231,bottom:512,halfWidth,frontier:397,biomeAt:()=>b,wallAt:y=>37+Math.round(Math.sin(y/48)*7)};
  const a=render(direct,o),c=render(cached,o);assert.deepEqual(c.data,a.data,'cached pixels differ');
  for(let y=o.top;y<o.bottom;y++)for(let x=-halfWidth;x<halfWidth;x++){
    const start=Math.floor(y/4)*4,cut=y<=o.frontier+1?Math.max(...[0,1,2,3].map(n=>o.wallAt(start+n)))+2:0,pixel=a.data[(y-o.top)*2*halfWidth+x+halfWidth];
    assert.equal(Boolean(pixel),!(cut&&x>=-cut&&x<cut),'shaft clipping or earth coverage');if(pixel)assert(palette.has(pixel));
  }
  const fg=render(cached,o,true);for(let y=o.top;y<o.bottom;y++)for(let x=-halfWidth;x<halfWidth;x++)if(fg.data[(y-o.top)*2*halfWidth+x+halfWidth])assert(Math.abs(x)>=134&&(x< -Math.max(134,halfWidth-38)||x>=Math.max(134,halfWidth-38)),'foreground overlaps room safe area');count++;
}
// Crops must be stable in world coordinates across scrolling and viewport width.
for(let b=0;b<4;b++){
  const o={top:-63,bottom:301,halfWidth:210,frontier:127,biomeAt:()=>b,wallAt:y=>42+Math.round(Math.sin(y/51)*4)};
  const a=render(cached,o),s=render(cached,{...o,top:29,bottom:227,cameraY:900,time:9921,reduced:true}),n=render(cached,{...o,halfWidth:150});
  for(let y=29;y<227;y++)assert.deepEqual(s.data.slice((y-29)*420,(y-28)*420),a.data.slice((y+63)*420,(y+64)*420),'scroll changed world texture');
  for(let y=-63;y<301;y++)assert.deepEqual(n.data.slice((y+63)*300,(y+64)*300),a.data.slice((y+63)*420+60,(y+63)*420+360),'width changed world texture');count+=2;
}
const transition={top:30,bottom:410,halfWidth:197,frontier:193,wallAt:()=>44,biomeAt:y=>Math.min(3,Math.max(0,Math.floor(y/100)))};
assert.deepEqual(render(direct,transition).data,render(cached,transition).data);count++;
const before=render(cached,{...transition,biomeAt:()=>0}).data;
cached.setColors({rootsBase:'#aa9977',bogus:'#ffffff',rootsDeep:'bad'});
assert.equal(cached.palette.rootsBase,'#aa9977');assert.equal(cached.palette.rootsDeep,direct.palette.rootsDeep);assert.equal(cached.palette.bogus,undefined);
const after=render(cached,{...transition,biomeAt:()=>0}).data;assert.notDeepEqual(before,after);assert(after.includes('#aa9977'));count++;
console.log(`${count} geology scenarios passed: integer pixels, bounds, palette, complete earth coverage, protected shaft/rooms, cache parity, scrolling/width continuity and palette invalidation.`);
// Retaining ribs are decorative world geometry: no pixels beyond the reached
// cave and no movement when a camera crops the same world location differently.
function infrastructure(o){const s=new Surface(o.halfWidth*2,o.bottom-o.top);s.ctx.translate(o.halfWidth,-o.top);direct.drawInfrastructure(s.ctx,o);assert.equal(s.ctx.stack.length,0);assert.equal(s.ctx.imageSmoothingEnabled,true);return s;}
for(const halfWidth of [65,240]){
  const start=11*864;
  const o={top:start,bottom:start+600,halfWidth,frontier:start+420,biomeAt:y=>Math.floor(y/160)%4,wallAt:()=>halfWidth===65?25:44},a=infrastructure(o),crop=infrastructure({...o,top:start+100,bottom:start+350});
  assert(a.data.some(Boolean));for(let y=0;y<600;y++)for(let x=-halfWidth;x<halfWidth;x++){const pixel=a.data[y*halfWidth*2+x+halfWidth];if(pixel){assert(start+y<o.frontier-40,'no supports in unexcavated ground');assert(Math.abs(x)>o.wallAt(),'industrial ribs leave shaft clear');assert(palette.has(pixel));}}
  assert.deepEqual(crop.data,a.data.slice(100*halfWidth*2,350*halfWidth*2));
  assert(infrastructure({...o,frontier:0}).data.every(pixel=>pixel===null));
}
console.log('2 industrial geometry scenarios passed: reached-only, protected shaft, mobile bounds, deterministic world cropping.');
function structures(api,o){const s=new Surface(o.halfWidth*2,o.bottom-o.top);s.ctx.translate(o.halfWidth,-o.top);const plans=api.drawDepthStructures(s.ctx,o);assert.equal(s.ctx.stack.length,0);assert.equal(s.ctx.imageSmoothingEnabled,true);return{surface:s,plans};}
const depthDirect=load(false),depthCached=load(true);
for(const halfWidth of [65,97,240])for(const [depth,kind] of [[330,'fault'],[1200,'talus'],[3840,'pump'],[2100,null]]){
  const o={top:depth-170,bottom:depth+150,halfWidth,frontier:depth+150,biomeAt:()=>3,wallAt:()=>halfWidth<134?25:44},a=structures(depthDirect,o),b=structures(depthCached,o);
  assert.deepEqual(a.surface.data,b.surface.data,'cached pixels differ');
  assert.equal(a.plans[0]?.kind ?? null,kind);assert.equal(a.surface.data.some(Boolean),Boolean(kind));
  for(const item of a.plans){
    assert(item.left>=-halfWidth&&item.left+item.width<=halfWidth);
    assert.equal(item.lights.length,kind==='pump'?1:0);
    assert.equal(Number.isFinite(item.landingY),kind==='pump');
    for(const light of item.lights)assert(light.x>=item.left&&light.x<=item.left+item.width);
  }
  for(let y=o.top;y<o.bottom;y++)for(let x=-25;x<25;x++)assert.equal(a.surface.data[(y-o.top)*halfWidth*2+x+halfWidth],null,'deep portal leaves main drill axis clear');
  const crop=structures(depthCached,{...o,top:o.top+30,bottom:o.bottom-40});assert.deepEqual(crop.surface.data,b.surface.data.slice(30*halfWidth*2,-40*halfWidth*2));
}
// Count the generated sites without retaining a raster for the entire history.
const brush={save(){},restore(){},fillRect(){}};
const sites=depthDirect.drawDepthStructures(brush,{top:0,bottom:36*864,halfWidth:260,frontier:36*864});
const pumps=sites.filter(site=>site.kind==='pump');
assert.equal(pumps.length,4);
assert(pumps.every((site,i)=>!i||site.band-pumps[i-1].band>=5));
assert(sites.length<25,'keep at least a third of the shaft sections free of large set pieces');
console.log('Natural faults, talus, pump ladders and quiet stretches passed material, cache, scroll and density checks.');
