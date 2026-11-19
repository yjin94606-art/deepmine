(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(root);else root.OutputArt=factory(root);})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  // Original 32px output glyphs: direct file/media silhouettes, not loot recipes.
  const palette=Object.freeze({ink:'#243744',shadow:'#40515b',steel:'#778b91',edge:'#b6c4bd',paper:'#e9e7ce',white:'#fff4d5',paperShade:'#bdc5b2',blue:'#4c8ca8',blueDark:'#355d76',sky:'#76b9c5',teal:'#509c93',tealLight:'#96d4b7',tealDark:'#376960',gold:'#d8a448',goldLight:'#f3ce71',orange:'#c77b4b',brown:'#866448',brownLight:'#b78b5d',purple:'#8772a6',purpleLight:'#b6a4c8',purpleDark:'#594f78',green:'#6e9f6a',greenDark:'#4b785d',red:'#bb7467'});
  const P=palette,types=Object.freeze(['web','document','image','audio','video','slides','table','code','file','memory']),cache=new Map();
  const int=n=>Number.isFinite(Number(n))?Math.round(Number(n)):0;
  function painter(ctx,ox,oy){
    function rect(x,y,w,h,color){if(w<=0||h<=0)return;ctx.fillStyle=color;ctx.fillRect(ox+x,oy+y,w,h);}
    function poly(points,color){
      const low=Math.min(...points.map(p=>p[1])),high=Math.max(...points.map(p=>p[1]));
      for(let y=low;y<high;y++){const row=y+.5,cuts=[];for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[j],b=points[i];if((a[1]<=row&&b[1]>row)||(b[1]<=row&&a[1]>row))cuts.push(a[0]+(row-a[1])*(b[0]-a[0])/(b[1]-a[1]));}cuts.sort((a,b)=>a-b);for(let i=0;i+1<cuts.length;i+=2){const start=Math.ceil(cuts[i]-.5),end=Math.ceil(cuts[i+1]-.5);rect(start,y,end-start,1,color);}}
    }
    return{rect,poly};
  }
  function glyph(p,type,variant){
    const accent=[P.teal,P.blue,P.purple][variant],bright=[P.tealLight,P.sky,P.purpleLight][variant];
    const {rect,poly}=p;
    function disc(x,y,r,color){
      for(let dy=-r;dy<=r;dy++){
        const half=Math.floor(Math.sqrt(r*r-dy*dy));
        rect(x-half,y+dy,half*2+1,1,color);
      }
    }
    if(type==='web'){
      poly([[1,14],[6,5],[24,5],[31,12],[27,15],[27,26],[29,26],[29,29],[2,29],[2,26],[4,26],[4,14]],P.ink);
      rect(5,14,21,12,P.brownLight);
      for(let i=0;i<5;i++){
        const x=2+i*5;
        poly([[x,12],[x+4,6],[x+9,6],[x+5,12]],i%2?P.paper:P.red);
        rect(x,12,5,3,i%2?P.paperShade:P.orange);
      }
      rect(7,16,10,8,P.blueDark);rect(8,16,1,6,bright);rect(13,16,1,7,P.sky);
      rect(19,16,5,10,P.ink);rect(20,17,3,6,accent);rect(4,26,23,1,P.paperShade);
    }else if(type==='document'){
      poly([[2,21],[6,13],[8,12],[8,9],[5,9],[5,5],[27,5],[27,9],[24,9],[25,13],[30,21],[30,26],[26,28],[4,28],[1,25]],P.ink);
      rect(8,6,16,2,P.steel);rect(5,6,2,3,P.gold);rect(24,6,2,3,P.gold);
      poly([[5,17],[10,11],[22,11],[27,17],[29,23],[24,26],[3,24]],accent);
      rect(10,12,11,3,P.ink);rect(12,12,7,1,P.edge);
      poly([[7,17],[23,17],[26,22],[5,22]],P.shadow);
      for(let row=0;row<2;row++)for(let col=0;col<5;col++)rect(8+col*3-row,17+row*3,2,1,P.white);
      rect(10,23,11,1,bright);rect(4,26,21,1,P.tealDark);
    }else if(type==='image'){
      poly([[2,11],[5,8],[10,8],[12,4],[20,4],[23,8],[28,8],[30,11],[30,24],[26,27],[5,27],[2,24]],P.ink);
      rect(4,11,24,12,P.steel);rect(4,13,23,9,accent);rect(5,9,6,3,P.paper);
      rect(13,6,6,4,P.shadow);rect(14,6,4,2,P.sky);rect(25,10,2,2,P.goldLight);
      disc(17,17,8,P.ink);disc(17,17,6,P.edge);disc(17,17,4,P.blueDark);rect(15,14,3,2,P.white);
      rect(5,24,20,1,P.shadow);
    }else if(type==='audio'){
      poly([[1,10],[4,6],[26,6],[30,10],[30,24],[27,27],[4,27],[1,24]],P.ink);
      rect(3,10,25,14,accent);rect(5,8,20,2,bright);
      rect(6,12,20,7,P.shadow);disc(9,15,4,P.ink);disc(9,15,2,P.paper);disc(22,15,4,P.ink);disc(22,15,2,P.paper);
      rect(13,14,5,3,P.orange);poly([[7,25],[10,20],[22,20],[25,25]],P.steel);
      rect(10,23,2,2,P.ink);rect(20,23,2,2,P.ink);rect(4,22,1,2,P.goldLight);
    }else if(type==='video'){
      poly([[2,13],[6,9],[20,9],[22,12],[29,8],[31,9],[31,23],[29,24],[22,20],[19,23],[14,23],[20,30],[17,30],[12,25],[7,30],[4,30],[10,22],[4,22],[2,20]],P.ink);
      disc(8,8,6,P.ink);disc(17,7,6,P.ink);disc(8,8,4,P.steel);disc(17,7,4,P.steel);disc(8,8,2,P.shadow);disc(17,7,2,P.shadow);
      rect(4,13,16,7,accent);rect(5,13,12,1,bright);rect(6,16,5,2,P.gold);
      poly([[22,14],[29,10],[29,21],[22,18]],P.blueDark);rect(28,12,1,6,P.sky);
    }else if(type==='slides'){
      poly([[2,13],[8,10],[20,10],[24,14],[30,11],[31,13],[31,21],[29,22],[23,19],[21,23],[19,23],[24,29],[21,29],[16,24],[9,24],[5,29],[2,29],[7,23],[2,22]],P.ink);
      poly([[3,14],[8,11],[18,11],[22,14],[19,17],[3,17]],bright);
      rect(4,15,15,6,accent);rect(6,17,1,3,P.ink);rect(9,17,1,3,P.ink);rect(12,17,1,3,P.ink);
      poly([[3,10],[6,6],[16,5],[21,7],[20,11],[15,13],[6,13]],P.ink);
      poly([[5,9],[7,7],[16,6],[19,8],[15,10],[6,11]],P.edge);rect(10,8,5,1,P.shadow);
      rect(24,15,3,3,P.steel);rect(28,13,2,7,P.tealLight);
    }else if(type==='table'){
      poly([[2,23],[7,19],[30,19],[30,26],[25,30],[2,30]],P.ink);
      rect(3,25,22,3,P.steel);
      const heights=[9,17,12];
      for(let i=0;i<3;i++){
        const x=4+i*7,y=25-heights[i];
        poly([[x,y],[x+3,y-3],[x+8,y-3],[x+8,22],[x+5,25],[x,25]],P.ink);
        rect(x+1,y,4,24-y,i===1?P.gold:accent);
        poly([[x+1,y],[x+3,y-2],[x+7,y-2],[x+5,y]],i===1?P.goldLight:bright);
        poly([[x+5,y],[x+7,y-2],[x+7,22],[x+5,24]],i===1?P.orange:P.tealDark);
      }
    }else if(type==='code'){
      poly([[2,12],[11,5],[24,5],[30,11],[28,23],[20,28],[2,26]],P.ink);
      poly([[4,13],[12,7],[23,7],[27,11],[25,22],[18,25],[4,23]],accent);
      for(let i=0;i<5;i++){rect(5+3*i,23,2,3,P.gold);rect(9+i*3,9,1,3,P.paperShade);}
      poly([[8,15],[14,11],[21,11],[23,14],[18,20],[9,20]],P.ink);
      rect(12,14,7,3,P.steel);rect(14,14,4,1,P.paper);rect(5,18,2,3,bright);rect(21,19,3,2,P.goldLight);
    }else if(type==='memory'){
      poly([[12,5],[15,2],[27,2],[30,5],[30,13],[26,16],[28,21],[21,16],[14,16],[11,13]],P.ink);
      poly([[14,6],[16,4],[26,4],[28,6],[28,12],[24,14],[25,16],[21,14],[15,14],[13,12]],P.purple);
      poly([[1,13],[5,10],[19,10],[23,14],[23,22],[19,25],[12,25],[5,30],[6,25],[2,24],[1,21]],P.ink);
      poly([[3,15],[6,12],[18,12],[21,15],[21,21],[17,23],[11,23],[8,26],[8,23],[4,22]],accent);
      for(const x of [6,11,16])rect(x,17,2,2,bright);
    }else{
      poly([[3,12],[11,5],[29,5],[30,7],[30,21],[21,28],[3,27]],P.ink);
      poly([[5,12],[12,7],[27,7],[20,12]],P.gold);rect(5,13,15,12,P.orange);
      poly([[21,13],[28,8],[28,20],[21,25]],P.brown);
      poly([[8,12],[15,7],[18,7],[11,12]],P.goldLight);rect(8,13,3,11,P.gold);
      rect(14,16,4,3,P.ink);rect(15,16,2,1,P.edge);
    }
  }
  function draw(ctx,x,y,type,variant=0){
    type=types.includes(type)?type:'file';variant=((int(variant)%3)+3)%3;const left=int(x)-16,top=int(y)-31,key=type+variant;
    ctx.save();ctx.imageSmoothingEnabled=false;
    try{
      let image=cache.get(key);
      if(!image&&typeof ctx.drawImage==='function')try{let canvas;if(typeof root.OffscreenCanvas==='function')canvas=new root.OffscreenCanvas(32,32);else if(root.document){canvas=root.document.createElement('canvas');canvas.width=32;canvas.height=32;}const inner=canvas&&canvas.getContext('2d');if(inner){inner.imageSmoothingEnabled=false;glyph(painter(inner,0,0),type,variant);cache.set(key,canvas);image=canvas;}}catch(_){/* Canvas-less runtimes use the identical integer primitives. */}
      if(image)ctx.drawImage(image,left,top);else glyph(painter(ctx,left,top),type,variant);
    }finally{ctx.restore();}
  }
  return Object.freeze({palette,types,bounds:Object.freeze({width:32,height:32,anchorX:16,anchorY:31}),draw,clearCache(){cache.clear();}});
});
