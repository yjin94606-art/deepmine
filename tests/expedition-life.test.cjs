'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync(require.resolve('../dist/expedition-life.js'),'utf8');
class Surface{constructor(w,h){this.width=w;this.height=h;this.data=new Array(w*h).fill(null);this.ctx=new Context(this);}getContext(){return this.ctx;}}
class Context{
 constructor(canvas){this.canvas=canvas;this.x=0;this.y=0;this.fillStyle='#000000';this.imageSmoothingEnabled=true;this.stack=[];}
 save(){this.stack.push([this.x,this.y,this.fillStyle,this.imageSmoothingEnabled]);}restore(){[this.x,this.y,this.fillStyle,this.imageSmoothingEnabled]=this.stack.pop();}translate(x,y){this.x+=x;this.y+=y;}
 put(x,y,c){assert(Number.isInteger(x)&&Number.isInteger(y),'noninteger pixel');assert(x>=0&&y>=0&&x<this.canvas.width&&y<this.canvas.height,'out of bounds '+[x,y]);assert(colors.has(c),'unknown color '+c);this.canvas.data[y*this.canvas.width+x]=c;}
 fillRect(x,y,w,h){assert([x,y,w,h].every(Number.isInteger));for(let j=0;j<h;j++)for(let i=0;i<w;i++)this.put(x+this.x+i,y+this.y+j,this.fillStyle);}
 drawImage(src,sx,sy,sw,sh,dx,dy,dw,dh){assert.equal(this.imageSmoothingEnabled,false);assert.equal(sw,dw);assert.equal(sh,dh);assert([sx,sy,sw,sh,dx,dy].every(Number.isInteger));assert(sx>=0&&sy>=0&&sx+sw<=src.width&&sy+sh<=src.height);for(let j=0;j<sh;j++)for(let i=0;i<sw;i++){const color=src.data[(sy+j)*src.width+sx+i];if(color)this.put(dx+this.x+i,dy+this.y+j,color);}}
}
function load(cached){const scope={module:{exports:{}}};if(cached)scope.OffscreenCanvas=Surface;vm.runInNewContext(code,scope);return scope.module.exports;}
const direct=load(false),cached=load(true),colors=new Set(Object.values(direct.palette)),types=['relay','sorter','garden'];let count=0;
assert.equal(colors.size,36);assert(Object.isFrozen(direct));assert(Object.isFrozen(direct.palette));
function check(method,args,w,h){const a=new Surface(w,h),b=new Surface(w,h);direct[method](a.ctx,...args);cached[method](b.ctx,...args);assert.deepEqual(a.data,b.data);assert(a.data.some(Boolean));assert.equal(b.ctx.imageSmoothingEnabled,true);assert.equal(b.ctx.stack.length,0);count++;return a;}
for(const compact of [false,true]){
 const w=compact?32:64,h=compact?28:44,masks=[];
 for(const type of types)for(let f=0;f<4;f++){const s=check('drawStation',[w/2,h-1,type,f,compact],w,h);if(f===0)masks.push(s.data.map(c=>c?'1':'0').join(''));}
 assert.equal(new Set(masks).size,3,'station silhouettes must differ');
}
const frames=[];for(const working of [false,true])for(let f=0;f<4;f++){const s=check('drawDrone',[9,15,f,working],18,16);if(working)frames.push(s.data.join(','));}assert.equal(new Set(frames).size,4);
function ambient(api,options){const s=new Surface(options.halfWidth*2,options.bottom-options.top);s.ctx.translate(options.halfWidth,-options.top);api.drawAmbient(s.ctx,options);assert.equal(s.ctx.imageSmoothingEnabled,true);assert.equal(s.ctx.stack.length,0);return s;}
for(const b of [0,1,2,3,'roots','aquifer','crystal','ruins'])for(let f=0;f<4;f++){
 const o={top:-30,bottom:450,halfWidth:140,frontier:358,biomeAt:()=>b,wallAt:y=>44+Math.round(Math.sin(y/40)*7),time:f*420};
 const a=ambient(direct,o),c=ambient(cached,o);assert.deepEqual(a.data,c.data);assert(a.data.some(Boolean));
 for(let y=o.top;y<o.bottom;y++)for(let x=-o.halfWidth;x<o.halfWidth;x++)if(a.data[(y-o.top)*280+x+140]){assert(Math.abs(x)>45,'ambient intrudes into shaft');assert(y<o.frontier-27,'ambient below frontier');}
 const cropped=ambient(cached,{...o,top:51,bottom:292});for(let y=51;y<292;y++)assert.deepEqual(cropped.data.slice((y-51)*280,(y-50)*280),a.data.slice((y+30)*280,(y+31)*280),'world pattern changes during scroll');
 const still=ambient(cached,{...o,reduced:true}),stillLater=ambient(cached,{...o,time:9999,reduced:true});assert.deepEqual(still.data,stillLater.data);count++;
}
const broad={top:0,bottom:400,halfWidth:120,frontier:900,biomeAt:()=>3,wallAt:()=>44};
const hidden=ambient(cached,{...broad,avoid:[{left:-120,right:120,top:0,bottom:400}]});assert(hidden.data.every(c=>!c));
const dormant=ambient(cached,{...broad,frontier:0});assert(dormant.data.every(c=>!c));
const reject=ambient(cached,{...broad,avoid:[{left:0,right:120,top:0,bottom:400}]});assert(reject.data.some(Boolean));for(let y=0;y<400;y++)assert(reject.data.slice(y*240+120,(y+1)*240).every(c=>!c));count+=3;
console.log(count+' life scenarios passed: sprite bounds, 36-color palette, cache parity, 3 distinct station silhouettes per size, 4 drone frames, scroll continuity, reduced motion, avoid zones, dormant mine.');
