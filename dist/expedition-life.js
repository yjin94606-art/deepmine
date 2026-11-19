(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(root);else root.ExpeditionLife=factory(root);})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  // Original grouped pixel assets. This module paints only: unlocks, evidence,
  // lights and interaction remain the responsibility of the scene/controller.
  const palette=Object.freeze({
    ink:'#182c3b',deep:'#293e4a',shadow:'#3e5057',steel:'#718b8c',steelLight:'#a9bcb1',
    copperDark:'#654a42',copper:'#aa7650',copperLight:'#d6a36a',wood:'#73563f',woodLight:'#aa8354',
    goldDark:'#90603d',gold:'#d6a34b',goldLight:'#f0c76e',cream:'#fff0bf',
    glassDark:'#285d69',glass:'#559d9d',glassLight:'#a5d6bd',waterDark:'#355d73',water:'#5399b7',
    mossDark:'#405448',moss:'#66895c',mossLight:'#9fba78',leafDark:'#42796a',leaf:'#65b893',leafLight:'#b3d8a4',
    violetDark:'#655378',violet:'#ad81b6',violetLight:'#ddbad7',rust:'#8f6252',pipe:'#8b9690',
    rock:'#52646d',rockLight:'#748283',soil:'#665c4e',pale:'#c8c6aa',amber:'#edb45d',warm:'#bd8255'
  });
  const P=palette,cache=new Map(),MAX_CACHE=100,names=['roots','aquifer','crystal','ruins'];
  const integer=(value,fallback=0)=>Number.isFinite(Number(value))?Math.round(Number(value)):fallback;
  const frameOf=value=>((Math.floor(Number(value)||0)%4)+4)%4;
  function hash(x,y){let n=Math.imul(x|0,374761393)^Math.imul(y|0,668265263);n=Math.imul(n^(n>>>13),1274126177);return(n^(n>>>16))>>>0;}
  function paint(ctx,ox,oy,w,h,clip){
    function rect(x,y,sw,sh,color){
      x=integer(x);y=integer(y);sw=integer(sw);sh=integer(sh);
      let l=Math.max(0,x),t=Math.max(0,y),r=Math.min(w,x+sw),b=Math.min(h,y+sh);
      if(clip){l=Math.max(l,clip.left-ox);t=Math.max(t,clip.top-oy);r=Math.min(r,clip.right-ox);b=Math.min(b,clip.bottom-oy);}
      if(r<=l||b<=t)return;ctx.fillStyle=color;ctx.fillRect(ox+l,oy+t,r-l,b-t);
    }
    function poly(points,color){
      const lo=Math.max(0,Math.min(...points.map(p=>p[1]))),hi=Math.min(h,Math.max(...points.map(p=>p[1])));
      for(let y=lo;y<hi;y++){const a=y+.5,cuts=[];for(let i=0,j=points.length-1;i<points.length;j=i++){const p=points[j],q=points[i];if((p[1]<=a&&q[1]>a)||(q[1]<=a&&p[1]>a))cuts.push(p[0]+(a-p[1])*(q[0]-p[0])/(q[1]-p[1]));}cuts.sort((a,b)=>a-b);for(let i=0;i+1<cuts.length;i+=2){const l=Math.ceil(cuts[i]-.5),r=Math.ceil(cuts[i+1]-.5);rect(l,y,r-l,1,color);}}
    }
    function line(x,y,endX,endY,color,width=1){const dx=Math.abs(endX-x),dy=-Math.abs(endY-y),sx=x<endX?1:-1,sy=y<endY?1:-1;let err=dx+dy;for(;;){rect(x,y,width,width,color);if(x===endX&&y===endY)break;const e=2*err;if(e>=dy){err+=dy;x+=sx;}if(e<=dx){err+=dx;y+=sy;}}}
    return{rect,poly,line};
  }
  function sprite(ctx,key,w,h,x,y,draw,clip){
    x=integer(x);y=integer(y);ctx.save();ctx.imageSmoothingEnabled=false;
    try{
      let image=cache.get(key);
      if(!image&&typeof ctx.drawImage==='function'){
        try{let canvas;if(typeof root.OffscreenCanvas==='function')canvas=new root.OffscreenCanvas(w,h);else if(root.document){canvas=root.document.createElement('canvas');canvas.width=w;canvas.height=h;}const inner=canvas&&canvas.getContext('2d');if(inner){inner.imageSmoothingEnabled=false;draw(paint(inner,0,0,w,h));image=canvas;cache.set(key,image);if(cache.size>MAX_CACHE)cache.delete(cache.keys().next().value);}}catch(_){/* Integer primitives remain available without a canvas atlas. */}
      }
      if(image){
        const l=clip?Math.max(x,clip.left):x,t=clip?Math.max(y,clip.top):y,r=clip?Math.min(x+w,clip.right):x+w,b=clip?Math.min(y+h,clip.bottom):y+h;
        if(r>l&&b>t)ctx.drawImage(image,l-x,t-y,r-l,b-t,l,t,r-l,b-t);
      }else draw(paint(ctx,x,y,w,h,clip));
    }finally{ctx.restore();}
  }
  function lamp(p,x,y){
    p.rect(x-3,y-4,7,2,P.steel);p.rect(x-2,y-2,5,6,P.ink);p.rect(x-1,y-1,3,3,P.amber);p.rect(x,y-1,1,2,P.cream);p.rect(x-3,y+4,7,1,P.copperDark);
  }
  function base(p,small){
    if(small){p.poly([[1,24],[29,24],[32,26],[31,28],[0,28],[0,26]],P.ink);p.rect(1,24,29,2,P.copperDark);p.rect(3,24,25,1,P.copper);p.rect(3,27,7,1,P.shadow);p.rect(23,27,6,1,P.shadow);return;}
    p.poly([[3,39],[58,39],[64,41],[61,44],[1,44],[0,42]],P.ink);p.rect(3,39,56,2,P.copperDark);p.rect(4,39,54,1,P.copper);p.rect(5,42,16,1,P.shadow);p.rect(46,42,12,1,P.shadow);
    p.rect(7,37,3,3,P.deep);p.rect(53,37,3,3,P.deep);p.rect(7,37,2,1,P.steel);
  }
  function crate(p,x,y,w=11,h=9){
    p.rect(x,y,w,h,P.ink);p.rect(x+1,y+1,w-2,h-2,P.wood);p.rect(x+1,y+1,w-2,1,P.woodLight);p.rect(x+2,y+3,w-4,2,P.copperDark);p.rect(x+2,y+2,1,h-4,P.copperLight);p.rect(x+w-3,y+2,1,h-4,P.copperLight);
  }
  function relay(p,f,small){
    base(p,small);
    if(small){
      p.rect(12,7,3,17,P.ink);p.rect(12,8,1,15,P.steel);p.rect(10,23,7,2,P.copperDark);
      p.poly([[5,2],[9,0],[19,0],[24,5],[22,10],[18,13],[12,11],[8,8]],P.ink);p.poly([[7,2],[10,1],[18,2],[22,5],[20,9],[16,10],[11,7]],P.copper);p.line(9,2,18,7,P.copperLight,1);p.rect(15,4,2,3,P.cream);p.line(15,5,19,2,P.steelLight,1);
      p.rect(19,15,11,10,P.ink);p.rect(20,16,9,7,P.copperDark);p.rect(21,17,6,4,P.glassDark);p.rect(22,18,3,1,P.glassLight);p.rect(27,17+f%2,1,2,P.amber);p.rect(21,23,7,1,P.steel);
      p.line(13,22,18,22,P.copper,1);p.rect(4,12,2,12,P.copperDark);lamp(p,5,9);return;
    }
    p.rect(26,14,5,24,P.ink);p.rect(27,15,2,22,P.steel);p.rect(22,36,13,3,P.deep);p.rect(23,36,11,1,P.copper);
    p.poly([[13,4],[19,0],[33,0],[43,8],[42,15],[35,22],[27,22],[20,17],[15,11]],P.ink);
    p.poly([[15,5],[20,2],[32,2],[40,9],[39,14],[34,19],[28,19],[22,15],[18,10]],P.copper);
    p.poly([[17,4],[21,2],[32,3],[37,7],[31,8],[25,7],[20,6]],P.copperLight);p.poly([[22,12],[29,15],[35,15],[33,19],[28,19]],P.copperDark);
    p.line(24,5,34,13,P.steelLight,1);p.line(27,14,35,6,P.deep,2);p.rect(33,5,3,3,P.cream);p.rect(35,5,1,1,f%2?P.glassLight:P.amber);
    p.rect(36,24,22,14,P.ink);p.rect(37,25,20,11,P.copperDark);p.rect(37,25,20,2,P.copper);p.rect(39,28,11,6,P.glassDark);p.rect(40,29,5,1,P.glassLight);p.rect(43,31,5,1,P.glass);p.rect(47,28,1,2,P.glassLight);
    p.rect(52,28,3,2,f%2?P.amber:P.gold);p.rect(52,32,2,2,P.glass);p.rect(39,36,16,2,P.steel);p.rect(39,36,7,1,P.steelLight);p.rect(38,38,3,2,P.deep);p.rect(54,38,3,2,P.deep);
    p.line(28,34,30,38,P.copperDark,2);p.line(30,38,35,38,P.copper,1);p.line(35,38,38,34,P.copper,1);
    crate(p,9,29,12,10);p.rect(8,20,3,10,P.copperDark);p.rect(8,20,1,9,P.copper);lamp(p,10,16);
  }
  function sorter(p,f,small){
    base(p,small);
    if(small){
      p.rect(3,19,26,6,P.ink);p.rect(4,20,24,3,P.shadow);p.rect(4,20,24,1,P.steel);for(let x=5+f%3;x<28;x+=5)p.rect(x,21,2,2,P.copper);p.rect(6,23,2,2,P.deep);p.rect(25,23,2,2,P.deep);
      p.rect(21,5,5,14,P.ink);p.rect(22,6,3,11,P.gold);p.rect(22,7,1,5,P.goldLight);p.rect(17,5,7,3,P.copperDark);p.line(18,7,14+(f%2)*2,12,P.gold,2);p.rect(13+(f%2)*2,12,5,2,P.steel);p.rect(13+(f%2)*2,14,1,3,P.steel);p.rect(17+(f%2)*2,14,1,2,P.steel);
      crate(p,6,13,7,6);p.rect(23,17,5,2,P.copper);p.rect(4,12,2,7,P.copperDark);lamp(p,5,9);return;
    }
    p.rect(7,29,51,10,P.ink);p.rect(8,30,49,6,P.shadow);p.rect(9,30,47,1,P.steel);p.rect(10,36,44,2,P.deep);p.rect(13,37,4,3,P.ink);p.rect(47,37,4,3,P.ink);
    for(let x=10+f%4;x<54;x+=7){p.rect(x,32,4,3,P.copperDark);p.rect(x,32,4,1,P.copperLight);}p.rect(8,32,2,3,P.steel);p.rect(55,32,2,3,P.steel);
    p.rect(46,8,8,20,P.ink);p.rect(47,9,6,18,P.gold);p.rect(48,10,2,14,P.goldLight);p.rect(49,23,4,4,P.goldDark);p.rect(44,26,12,3,P.deep);p.rect(45,26,10,1,P.steel);
    const elbow=f===1?3:f===3?-2:0;
    p.poly([[35,7],[48,7],[48,13],[42,14],[36,11]],P.ink);p.rect(36,8,11,3,P.copper);p.rect(36,8,9,1,P.copperLight);p.line(36,10,30+elbow,19,P.ink,5);p.line(37,11,32+elbow,19,P.gold,2);
    p.rect(28+elbow,18,9,4,P.steel);p.rect(29+elbow,18,7,1,P.steelLight);p.rect(28+elbow,21,2,5,P.deep);p.rect(35+elbow,21,2,5,P.deep);p.rect(30+elbow,25,2,1,P.steel);p.rect(33+elbow,25,2,1,P.steel);
    crate(p,13,20,12,10);p.poly([[33,28],[35,25],[40,24],[44,27],[43,30],[35,30]],P.copperDark);p.rect(36,25,4,2,P.copperLight);p.rect(39,27,4,2,P.copper);
    p.rect(4,21,7,8,P.ink);p.rect(5,22,5,5,P.copperDark);p.rect(6,23,3,2,P.glass);p.rect(8,20,3,2,P.copperDark);lamp(p,10,16);
    p.line(54,15,59,19,P.copperDark,2);p.line(59,19,59,35,P.copperDark,2);p.line(58,34,54,37,P.copper,1);
  }
  function mushroom(p,x,y,size,color){
    p.rect(x-1,y+1,2,size+1,P.pale);p.poly([[x-size,y],[x-size+2,y-3],[x+size-2,y-3],[x+size,y],[x+size,y+2],[x-size,y+2]],P.leafDark);p.rect(x-size+1,y,2*size-2,2,color);p.rect(x-1,y-2,2,1,P.leafLight);
  }
  function garden(p,f,small){
    base(p,small);
    if(small){
      p.rect(8,18,14,7,P.ink);p.rect(9,19,12,4,P.glassDark);p.rect(9,19,12,1,P.glassLight);p.rect(10,21,10,2,P.glass);p.rect(10,24,3,1,P.deep);p.rect(18,24,3,1,P.deep);
      mushroom(p,13,14,4,P.leaf);mushroom(p,19,16,2,P.mossLight);
      p.poly([[24,8],[28,8],[30,11],[30,23],[22,23],[22,11]],P.ink);p.rect(23,12,6,10,P.waterDark);p.rect(24,13,2,7,P.water);p.rect(23,11,6,1,P.steel);p.rect(25,8,3,2,P.copper);p.rect(26,16-f%3,1,1,P.glassLight);
      p.line(22,22,20,24,P.copper,1);p.rect(4,12,2,11,P.copperDark);lamp(p,5,9);return;
    }
    p.rect(17,28,29,10,P.ink);p.rect(18,29,27,7,P.glassDark);p.rect(19,30,25,5,P.glass);p.rect(19,30,25,1,P.glassLight);p.rect(20,32,2,2,P.glassLight);p.rect(39,33,4,1,P.waterDark);p.rect(19,37,5,3,P.deep);p.rect(39,37,5,3,P.deep);
    p.rect(19,25,25,3,P.soil);p.rect(20,25,24,1,P.mossDark);
    mushroom(p,26,17,6,P.leaf);mushroom(p,37,22,4,P.mossLight);p.line(19,26,17,21,P.mossDark,2);p.poly([[17,22],[13,21],[12,17],[16,18],[19,22]],P.leafDark);p.rect(15,19,2,1,P.mossLight);
    p.rect(17,11,2,16,P.copperDark);p.rect(43,11,2,16,P.copperDark);p.line(18,10,24,6,P.copper,1);p.rect(24,6,14,1,P.copperLight);p.line(38,6,44,11,P.copper,1);p.rect(20,12,1,7,P.glass);p.rect(40,10,1,6,P.glassDark);
    p.poly([[51,12],[57,12],[61,16],[61,35],[59,38],[49,38],[47,35],[47,16]],P.ink);p.rect(48,17,12,18,P.waterDark);p.rect(49,19,10,14,P.water);p.rect(49,19,2,12,P.glass);p.rect(48,16,12,2,P.steel);p.rect(48,34,12,2,P.steel);p.rect(50,13,8,3,P.copperDark);p.rect(51,13,6,1,P.copper);p.rect(52,10,4,3,P.deep);
    p.rect(54,27-f*2,1,2,P.glassLight);p.rect(57,22+(f%2)*3,1,1,P.glassLight);p.line(48,35,44,38,P.copperDark,2);p.line(44,38,36,38,P.copper,1);p.line(36,38,36,35,P.copper,1);
    crate(p,4,31,10,8);p.rect(8,20,3,11,P.copperDark);p.rect(8,20,1,9,P.copper);lamp(p,10,16);
  }
  function drawStation(ctx,x,y,type,frame=0,compact=false){
    type=['relay','sorter','garden'].includes(type)?type:'relay';const f=frameOf(frame),w=compact?32:64,h=compact?28:44;
    sprite(ctx,'station:'+type+':'+f+':'+Boolean(compact),w,h,integer(x)-w/2,integer(y)-h+1,p=>({relay,sorter,garden})[type](p,f,Boolean(compact)));
  }
  function drone(p,f,working){
    p.rect(3,3,12,2,P.ink);p.rect(4,3,10,1,P.steel);p.rect(3,2,2,4,P.deep);p.rect(13,2,2,4,P.deep);
    if(f%2){p.rect(0,2,7,1,P.steel);p.rect(11,2,7,1,P.steel);p.rect(3,0,1,5,P.copperLight);p.rect(14,0,1,5,P.copperLight);}else{p.rect(1,1,5,1,P.steelLight);p.rect(12,1,5,1,P.steelLight);p.rect(0,3,7,1,P.steel);p.rect(11,3,7,1,P.steel);}
    p.poly([[5,5],[13,5],[15,7],[15,11],[12,13],[6,13],[3,11],[3,7]],P.ink);p.rect(5,6,8,5,P.gold);p.rect(5,6,8,1,P.goldLight);p.rect(6,7,6,3,P.glassDark);p.rect(7,7,4,1,P.glassLight);p.rect(5,11,8,1,P.goldDark);p.rect(3,8,2,3,P.copper);p.rect(13,8,2,3,P.copper);
    p.rect(6,13,6,3,P.copperDark);p.rect(7,13,4,2,P.woodLight);p.rect(8,14,2,1,P.copper);p.rect(3,12,2,2,P.steel);p.rect(13,12,2,2,P.steel);
    if(working){p.rect(4,11,1,1,f<2?P.cream:P.amber);p.rect(13,11,1,1,f<2?P.amber:P.cream);}else p.rect(12,7,1,1,P.amber);
  }
  function drawDrone(ctx,x,y,frame=0,working=false){const f=working?frameOf(frame):0;sprite(ctx,'drone:'+f+':'+Boolean(working),18,16,integer(x)-9,integer(y)-15,p=>drone(p,f,Boolean(working)));}
  function ambient(p,b,variant,f){
    // Motifs grow from an opaque attachment cluster, never collectible markers.
    if(b===0&&variant===0){
      p.poly([[4,2],[12,0],[20,3],[18,7],[8,8],[2,5]],P.mossDark);p.rect(8,2,9,2,P.moss);p.line(9,6,13,13,P.wood,2);p.line(13,13,9,23,P.wood,2);p.line(13,13,18,18,P.wood,1);p.line(18,18,16,27,P.wood,1);p.rect(7,18,5,2,P.mossDark);p.rect(14,22,5,2,P.moss);p.rect(9,25,1,3,P.woodLight);
    }else if(b===0){
      p.poly([[2,28],[8,24],[17,25],[22,29],[18,32],[3,32]],P.shadow);p.rect(4,27,15,2,P.mossDark);mushroom(p,10,21,5,P.moss);mushroom(p,18,25,3,P.leaf);p.rect(7,21,2,1,P.mossLight);p.line(5,28,2,23,P.mossDark,1);
    }else if(b===1&&variant===0){
      p.poly([[3,2],[11,0],[21,3],[19,7],[6,6]],P.rock);p.rect(6,3,11,2,P.waterDark);p.rect(10,5,3,4,P.waterDark);p.rect(11,7,1,3,P.water);const drop=12+f*4;p.rect(11,drop,1,3,P.water);p.rect(11,drop+2,2,2,P.glass);p.poly([[4,29],[10,27],[19,28],[22,31],[6,32]],P.waterDark);p.rect(7,29,10,1,P.water);
    }else if(b===1){
      p.poly([[2,27],[6,23],[17,24],[21,29],[19,32],[4,32]],P.rock);p.rect(4,28,15,2,P.waterDark);p.line(7,26,10,20,P.mossDark,2);p.line(10,20,7,15,P.mossDark,1);p.line(15,27,14,18,P.leafDark,2);p.rect(5,18,5,2,P.leafDark);p.rect(13,20,5,2,P.moss);p.rect(10,28,7,1,P.water);
    }else if(b===2&&variant===0){
      p.poly([[3,27],[8,23],[17,25],[21,30],[14,32],[4,31]],P.rock);mushroom(p,10,20,5,P.violetDark);mushroom(p,18,24,3,P.violet);p.rect(7,20,2,1,P.violet);p.rect(16,24,2,1,P.violetLight);
    }else if(b===2){
      p.poly([[3,17],[9,13],[18,16],[21,21],[14,24],[5,22]],P.rock);p.line(5,18,17,20,P.shadow,2);const dx=f===1?1:f===3?-1:0;p.rect(10+dx,16,5,3,P.deep);p.rect(11+dx,16,3,2,P.glass);p.rect(12+dx,16,1,1,P.glassLight);p.rect(9+dx,15,1,1,P.shadow);p.rect(15+dx,15,1,1,P.shadow);p.rect(9+dx,19,1,1,P.shadow);p.rect(15+dx,19,1,1,P.shadow);
    }else if(variant===0){
      p.poly([[3,9],[8,6],[18,6],[22,10],[22,23],[18,26],[6,25],[2,21]],P.shadow);p.rect(5,9,15,14,P.copperDark);p.rect(5,9,15,2,P.copper);p.rect(7,12,11,9,P.deep);for(let yy=12;yy<21;yy+=3){p.rect(8,yy,9,1,P.pipe);p.rect(8,yy+1,9,1,P.rock);}p.rect(5,21,15,2,P.copperDark);p.rect(6,10,1,1,P.copperLight);p.rect(18,22,1,1,P.copperLight);
    }else{
      p.line(4,3,4,14,P.copperDark,3);p.line(4,14,12,22,P.copperDark,3);p.line(12,22,20,22,P.copperDark,3);p.line(4,3,4,14,P.copper,1);p.line(4,14,12,22,P.copper,1);p.rect(2,8,7,3,P.pipe);p.rect(14,20,3,7,P.pipe);p.rect(12,4,8,10,P.shadow);p.rect(13,5,6,7,P.copperDark);p.rect(14,6,4,4,P.deep);p.rect(15,7,2,1,f%2?P.moss:P.glassDark);
    }
  }
  function drawAmbient(ctx,raw){
    raw=raw||{};const top=integer(raw.top),bottom=Math.max(top,integer(raw.bottom,top+300)),half=Math.max(0,integer(raw.halfWidth,240)),frontier=Number.isFinite(Number(raw.frontier))?Math.floor(Number(raw.frontier)):-Infinity;
    const biome=typeof raw.biomeAt==='function'?raw.biomeAt:()=>0,wall=typeof raw.wallAt==='function'?raw.wallAt:()=>44,clip={left:-half,top,right:half,bottom};
    const avoid=Array.isArray(raw.avoid)?raw.avoid:[],f=raw.reduced?0:frameOf(Math.floor((Number(raw.time)||0)/420));let count=0;
    for(let row=Math.floor((top-40)/128);row<=Math.floor((bottom+32)/128)&&count<12;row++)for(const side of [-1,1]){
      const seed=hash(row,side),y=row*128+(side<0?16:73)+seed%19;if(y>frontier-28||y<top||y-31>=bottom)continue;
      const wallWidth=Math.max(0,integer(wall(y),44)),x=side*(wallWidth+23+seed%7),box={left:x-12,top:y-31,right:x+12,bottom:y+1};
      if(box.right<=-half||box.left>=half||avoid.some(a=>a&&box.left<a.right&&box.right>a.left&&box.top<a.bottom&&box.bottom>a.top))continue;
      const rawBiome=biome(y),b=typeof rawBiome==='string'?Math.max(0,names.indexOf(rawBiome)):Math.max(0,Math.min(3,integer(rawBiome))),variant=(seed>>>7)%2;
      sprite(ctx,'ambient:'+b+':'+variant+':'+f,24,32,box.left,box.top,p=>ambient(p,b,variant,f),clip);count++;
    }
  }
  return Object.freeze({palette,
    bounds:Object.freeze({station:Object.freeze({width:64,height:44}),compactStation:Object.freeze({width:32,height:28}),drone:Object.freeze({width:18,height:16})}),
    lights:Object.freeze({station:Object.freeze({x:-22,y:-27}),compactStation:Object.freeze({x:-11,y:-18}),garden:Object.freeze({x:9,y:-16}),compactGarden:Object.freeze({x:4,y:-11})}),
    drawStation,drawDrone,drawAmbient,clearCache(){cache.clear();}});
});
