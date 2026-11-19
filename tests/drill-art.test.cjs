'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../dist/drill-art.js'),'utf8');
class Surface{
  constructor(width,height){this.width=width;this.height=height;this.pixels=new Map();this.stack=[];const s=this;
    this.ctx={fillStyle:'#000000',imageSmoothingEnabled:true,x:0,y:0,
      save(){s.stack.push([this.fillStyle,this.imageSmoothingEnabled,this.x,this.y]);},restore(){[this.fillStyle,this.imageSmoothingEnabled,this.x,this.y]=s.stack.pop();},translate(x,y){this.x+=x;this.y+=y;},
      fillRect(x,y,w,h){assert.ok([x,y,w,h].every(Number.isInteger));for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)s.put(col+this.x,row+this.y,this.fillStyle);},
      drawImage(image,sx,sy,w,h,dx,dy,dw,dh){assert.equal(w,dw);assert.equal(h,dh);assert.equal(this.imageSmoothingEnabled,false);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const color=image.pixels.get((sx+x)+':'+(sy+y));if(color)s.put(dx+x+this.x,dy+y+this.y,color);}}
    };
  }
  put(x,y,color){assert.ok(x>=0&&x<this.width&&y>=0&&y<this.height,'native sprite bounds');this.pixels.set(x+':'+y,color);}
  getContext(){return this.ctx;}
}
function load(cached){const scope={module:{exports:{}},...(cached?{OffscreenCanvas:Surface}:{})};vm.runInNewContext(source,scope);return scope.module.exports;}
function render(art,frame,working=true){const s=new Surface(52,68);art.drawRigHeavy(s.ctx,26,44,frame,working);return s;}
test('heavy machine keeps its fixed palette, native bounds and downward contact anchor',()=>{
  const art=load(false),colors=new Set(Object.values(art.palette));assert.equal(art.heavyBounds.anchorY+23,67);
  for(let frame=0;frame<4;frame++){const s=render(art,frame);assert.ok(s.pixels.size>1700);assert.ok([...s.pixels.values()].every(c=>colors.has(c)));assert.ok(s.pixels.has('25:67'));assert.equal(s.ctx.fillStyle,'#000000');assert.equal(s.stack.length,0);}
});
test('heavy cached frames exactly match direct pixel primitives including stable idle',()=>{
  const direct=load(false),cached=load(true);for(let frame=-1;frame<8;frame++)for(const working of [true,false]){
    const a=render(direct,frame,working),b=render(cached,frame,working);assert.deepEqual(b.pixels,a.pixels);assert.equal(b.ctx.imageSmoothingEnabled,true);
  }
});
test('working drill collars and shoes animate inside a stable industrial silhouette',()=>{
  const art=load(false),frames=Array.from({length:4},(_,i)=>render(art,i).pixels);assert.equal(new Set(frames.map(p=>JSON.stringify([...p]))).size,4);
  for(let frame=1;frame<4;frame++){assert.deepEqual([...render(art,frame,false).pixels], [...render(art,0,false).pixels]);for(const x of [0,51])assert.ok([...frames[frame].keys()].some(k=>k.startsWith(x+':')));}
});
