(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(root);else root.CavernGeology=factory(root);})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  // Original geology: continuous folded strata, grouped cut faces and buried
  // material. Every shape is scan-converted to integer pixel runs, never noise.
  const defaults=Object.freeze({
    rootsDeep:'#393337',rootsShadow:'#665440',rootsBase:'#7b644d',rootsMid:'#897157',rootsLight:'#a28a66',rootsEdge:'#c1a77a',rootsFissure:'#2b3030',rootsDeposit:'#96815e',
    aquiferDeep:'#29444c',aquiferShadow:'#405f67',aquiferBase:'#4a6a71',aquiferMid:'#56787d',aquiferLight:'#719497',aquiferEdge:'#9ab7ae',aquiferFissure:'#203941',aquiferDeposit:'#a5bfb4',
    crystalDeep:'#3a3a54',crystalShadow:'#595870',crystalBase:'#66647f',crystalMid:'#75708b',crystalLight:'#9187a0',crystalEdge:'#b6a8bd',crystalFissure:'#2b3047',crystalDeposit:'#a193b1',
    ruinsDeep:'#30404d',ruinsShadow:'#485c67',ruinsBase:'#606c70',ruinsMid:'#747c79',ruinsLight:'#929b90',ruinsEdge:'#b5b9a5',ruinsFissure:'#233440',ruinsDeposit:'#a37d61',
    mossDark:'#3c5141',moss:'#61784c',mossLight:'#91a366',rootDark:'#513f37',root:'#806344',rootLight:'#aa8454',
    waterDark:'#285464',water:'#468b9a',waterLight:'#86bab5',crystalDark:'#4b6479',crystal:'#70a1ae',crystalGlow:'#a3cfca',
    purpleDark:'#6a5b87',purple:'#9e85b7',purpleLight:'#c4b0d4',copperDark:'#5b4948',copper:'#9b7157',copperLight:'#cba47c',metal:'#7f9291',bone:'#c5b798'
  });
  const names=['roots','aquifer','crystal','ruins'],cache=new Map(),structureCache=new Map(),CW=128,CH=96,MAX_CACHE=72;
  // A utility trench and a deeper side gallery share a long stretch of otherwise exposed rock.
  const SERVICE_SECTION=864;
  let palette=defaults;
  const int=(n,f=0)=>Number.isFinite(Number(n))?Math.round(Number(n)):f;
  const mod=(n,m)=>((n%m)+m)%m;
  function hash(x,y,s=0){let n=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^Math.imul(s|0,1442695041);n=Math.imul(n^(n>>>13),1274126177);return(n^(n>>>16))>>>0;}
  function options(raw){
    raw=raw||{};const top=int(raw.top),bottom=Math.max(top,int(raw.bottom,top+300)),half=Math.max(1,Math.min(2048,int(raw.halfWidth,240)));
    const at=typeof raw.biomeAt==='function'?raw.biomeAt:()=>0,wall=typeof raw.wallAt==='function'?raw.wallAt:()=>44;
    return{top,bottom,half,frontier:Number.isFinite(Number(raw.frontier))?Math.floor(Number(raw.frontier)):-Infinity,
      biome(y){const b=at(y);return typeof b==='string'?Math.max(0,names.indexOf(b)):Math.max(0,Math.min(3,int(b)));},
      wall(y){return Math.max(0,Math.min(160,int(wall(y),44)));}};
  }
  function tone(b,role){return palette[names[b]+role[0].toUpperCase()+role.slice(1)];}
  function cutoff(y,o){
    if(y>o.frontier+1)return 0;
    const start=Math.floor(y/4)*4;let width=0;for(let at=start;at<start+4;at++)width=Math.max(width,o.wall(at));return width+2;
  }
  function painter(ctx,ox,oy,bounds,biome,guard){
    const [left,top,right,bottom]=bounds;
    function span(x,y,w,col){
      if(y<top||y>=bottom)return;const end=Math.min(right,x+w);x=Math.max(left,x);if(end<=x)return;
      ctx.fillStyle=col[0]==='#'?col:tone(biome(y),col);
      const cut=guard?guard(y):0;
      if(cut){if(x< -cut)ctx.fillRect(x-ox,y-oy,Math.max(0,Math.min(end,-cut)-x),1);if(end>cut)ctx.fillRect(Math.max(x,cut)-ox,y-oy,end-Math.max(x,cut),1);}
      else ctx.fillRect(x-ox,y-oy,end-x,1);
    }
    function rect(x,y,w,h,col){x=int(x);y=int(y);w=int(w);h=int(h);for(let at=Math.max(y,top);at<Math.min(y+h,bottom);at++)span(x,at,w,col);}
    function poly(points,col){
      const lo=Math.max(top,Math.min(...points.map(p=>p[1]))),hi=Math.min(bottom,Math.max(...points.map(p=>p[1])));
      for(let y=lo;y<hi;y++){const cuts=[],at=y+.5;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[j],b=points[i];if((a[1]<=at&&b[1]>at)||(b[1]<=at&&a[1]>at))cuts.push(a[0]+(at-a[1])*(b[0]-a[0])/(b[1]-a[1]));}cuts.sort((a,b)=>a-b);for(let i=0;i+1<cuts.length;i+=2){const x=Math.ceil(cuts[i]-.5),end=Math.ceil(cuts[i+1]-.5);span(x,y,end-x,col);}}
    }
    function line(x0,y0,x1,y1,col,width=1){const dx=Math.abs(x1-x0),dy=-Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1;let e=dx+dy;for(;;){rect(x0,y0,width,width,col);if(x0===x1&&y0===y1)break;const twice=2*e;if(twice>=dy){e+=dy;x0+=sx;}if(twice<=dx){e+=dx;y0+=sy;}}}
    return{span,rect,poly,line};
  }
  function fold(band,x){const h=hash(band,7,1);return Math.round(band*68+(h%13)-6+Math.sin(x/97+(h%63)/10)*10+Math.sin(x/223+band*.68)*15+x*((h%5)-2)/90);}
  function strata(p,x,y,w,h){
    const first=Math.floor((y-120)/68),last=Math.ceil((y+h+120)/68),from=Math.floor((x-16)/16)*16,to=x+w+16;
    for(let band=first;band<=last;band++){
      const upper=[],lower=[],lip=[],split=[];
      for(let xx=from;xx<=to;xx+=16){const yy=fold(band,xx);upper.push([xx,yy]);lower.unshift([xx,fold(band+1,xx)]);lip.unshift([xx,yy+2]);split.unshift([xx,yy+5]);}
      p.poly(upper.concat(lower),mod(band,4)===0?'mid':'base');
      p.poly(upper.concat(split),'shadow');p.poly(upper.concat(lip),mod(band,3)===1?'light':'mid');
    }
  }
  function slabs(p,x,y,w,h){
    for(let row=Math.floor((y-75)/44);row<=Math.floor((y+h+60)/44);row++)for(let col=Math.floor((x-110)/72);col<=Math.floor((x+w+90)/72);col++){
      const seed=hash(col,row,13);if(seed%6===0)continue;
      const xx=col*72+mod(row,2)*31+(seed%21)-10,yy=row*44+(seed>>>8)%19-8,bw=34+(seed>>>13)%29,bh=19+(seed>>>19)%17,k=seed%4;
      // Open planes join the underlying bed. No enclosing outline or repeated
      // round boulder shape: four directional fracture families interlock.
      if(k===0){
        p.poly([[xx,yy+8],[xx+15,yy],[xx+bw,yy+3],[xx+bw-11,yy+bh],[xx+7,yy+bh-4]],'mid');
        p.poly([[xx,yy+8],[xx+15,yy],[xx+bw,yy+3],[xx+bw-16,yy+7],[xx+17,yy+5],[xx+3,yy+12]],'light');
        p.poly([[xx+bw-9,yy+6],[xx+bw-11,yy+bh],[xx+bw-19,yy+bh+3]],'shadow');
      }else if(k===1){
        p.poly([[xx,yy+bh],[xx+7,yy+10],[xx+21,yy+8],[xx+29,yy],[xx+bw,yy+2],[xx+bw-5,yy+bh]],'mid');
        p.poly([[xx+6,yy+12],[xx+20,yy+10],[xx+28,yy+2],[xx+32,yy+2],[xx+23,yy+13],[xx+9,yy+16]],'shadow');
        p.poly([[xx+11,yy+bh],[xx+31,yy+bh-3],[xx+bw,yy+bh-8],[xx+bw-3,yy+bh-3],[xx+29,yy+bh+1]],'shadow');
      }else if(k===2){
        p.poly([[xx,yy+2],[xx+bw-12,yy],[xx+bw,yy+bh-7],[xx+bw-12,yy+bh],[xx+9,yy+bh-3]],'base');
        p.poly([[xx+5,yy+3],[xx+bw-13,yy+2],[xx+bw-7,yy+9],[xx+10,yy+7]],'mid');
        p.poly([[xx+10,yy+9],[xx+21,yy+16],[xx+28,yy+15],[xx+bw-4,yy+bh],[xx+26,yy+bh-3],[xx+17,yy+19]],'shadow');
      }else{
        p.poly([[xx,yy+bh-5],[xx+9,yy],[xx+19,yy+6],[xx+27,yy+2],[xx+bw,yy+bh-7],[xx+bw-8,yy+bh]],'mid');
        p.poly([[xx+2,yy+bh-6],[xx+10,yy+2],[xx+15,yy+6],[xx+7,yy+bh-3]],'light');
        p.poly([[xx+20,yy+9],[xx+27,yy+5],[xx+bw-3,yy+bh-7],[xx+bw-8,yy+bh-4]],'shadow');
      }
      if(seed%3===0){p.poly([[xx+11,yy+bh+2],[xx+17,yy+bh-3],[xx+26,yy+bh-1],[xx+23,yy+bh+5]],'shadow');p.poly([[xx+13,yy+bh+1],[xx+18,yy+bh-2],[xx+24,yy+bh]],'mid');}
    }
  }
  function shard(p,x,y,size,color,highlight){p.poly([[x-size,y],[x-size,y-size*2],[x-1,y-size*3],[x+size,y-size*2+2],[x+size-1,y-2],[x,y+2]],color);p.poly([[x-size+1,y-size*2],[x-1,y-size*3+2],[x-1,y-1],[x-size+2,y-2]],highlight);}
  function cavity(p,x,y,seed,b){
    const w=35+seed%15,h=19+(seed>>>7)%11;
    p.poly([[x,y+10],[x+12,y],[x+w-14,y-3],[x+w,y+6],[x+w+4,y+h-7],[x+w-8,y+h],[x+10,y+h+2],[x-3,y+h-7]],'deep');
    p.poly([[x+6,y+11],[x+16,y+4],[x+w-15,y+3],[x+w-5,y+11],[x+w-8,y+h-5],[x+13,y+h-4]],'fissure');
    p.poly([[x-3,y+h-7],[x+10,y+h-4],[x+w-8,y+h-6],[x+w+3,y+h-10],[x+w-8,y+h],[x+10,y+h+2]],'mid');
    p.poly([[x,y+10],[x+12,y],[x+w-14,y-3],[x+w-20,y+1],[x+15,y+4],[x+5,y+13]],'light');
    if(b===0){
      p.poly([[x+3,y+6],[x+11,y+1],[x+23,y+1],[x+23,y+4],[x+16,y+6],[x+12,y+11],[x+5,y+11]],palette.mossDark);p.rect(x+10,y+3,8,2,palette.moss);
      p.line(x+14,y+2,x+17,y+13,palette.rootDark,3);p.line(x+17,y+13,x+12,y+23,palette.rootDark,2);p.line(x+16,y+4,x+26,y+9,palette.root,1);
      if(seed%2){for(let i=0;i<4;i++){const px=x+w-21+i*3,py=y+h-12+i;p.line(px,py,px+2,py-4,palette.bone,1);}p.line(x+w-22,y+h-11,x+w-9,y+h-7,palette.rootLight,1);}
    }else if(b===1){
      p.poly([[x+9,y+h-8],[x+20,y+h-11],[x+w-12,y+h-10],[x+w-5,y+h-6],[x+w-15,y+h-4],[x+13,y+h-4]],palette.waterDark);p.rect(x+18,y+h-9,w-35,2,palette.water);p.rect(x+16,y+h-5,10,1,palette.waterLight);
      p.rect(x+w-18,y+5,2,h-15,palette.waterDark);p.rect(x+w-18,y+6,1,7,palette.water);
    }else if(b===2){
      shard(p,x+16,y+h-6,3,palette.purpleDark,palette.purple);shard(p,x+29,y+h-5,4,palette.crystalDark,palette.crystal);shard(p,x+40,y+h-5,2,palette.purpleDark,palette.purple);
    }else{
      p.line(x+9,y+h-8,x+w-10,y+9,palette.copperDark,5);p.line(x+11,y+h-9,x+w-10,y+9,palette.copper,2);
      p.rect(x+15,y+h-13,4,7,palette.metal);p.rect(x+w-18,y+10,3,7,palette.ruinsDeep);
    }
  }
  function pockets(p,x,y,w,h,at){
    for(let row=Math.floor((y-90)/138);row<=Math.ceil((y+h+50)/138);row++)for(let col=Math.floor((x-110)/184);col<=Math.ceil((x+w+80)/184);col++){
      const seed=hash(col,row,73);if(seed%4===0)continue;
      const xx=col*184+(row%2)*61+(seed%37)-16,yy=row*138+29+(seed>>>8)%35;
      // Cavity mouths stay off the central access route; uncut strata still
      // carries slabs there, so the approaching excavation front is substantial.
      if(Math.abs(xx+32)<67)continue;cavity(p,xx,yy,seed,at(yy));
    }
  }
  function deposits(p,x,y,w,h,at){
    for(let row=Math.floor((y-36)/58);row<=Math.ceil((y+h+36)/58);row++)for(let col=Math.floor((x-70)/92);col<=Math.ceil((x+w+50)/92);col++){
      const seed=hash(col,row,211);if(seed%3!==0)continue;
      const xx=col*92+(seed%31)-9,yy=row*58+(seed>>>7)%29,b=at(yy);
      p.poly([[xx,yy+10],[xx+9,yy+5],[xx+19,yy+6],[xx+26,yy],[xx+30,yy+2],[xx+21,yy+10],[xx+11,yy+9],[xx+3,yy+13]],'shadow');
      if(b===0){p.poly([[xx+2,yy+8],[xx+9,yy+5],[xx+18,yy+6],[xx+15,yy+9],[xx+7,yy+10]],palette.mossDark);p.rect(xx+7,yy+6,6,2,palette.moss);}
      else if(b===1){p.rect(xx+10,yy+7,8,2,palette.waterDark);p.rect(xx+20,yy+4,3,5,palette.waterDark);p.rect(xx+20,yy+5,1,2,palette.water);}
      else if(b===2){p.poly([[xx+7,yy+8],[xx+10,yy+3],[xx+14,yy+5],[xx+14,yy+9]],palette.purpleDark);p.rect(xx+10,yy+4,2,3,palette.purple);p.rect(xx+22,yy+3,3,2,palette.crystal);}
      else{p.line(xx+4,yy+10,xx+21,yy+5,palette.copperDark,2);p.rect(xx+14,yy+6,5,2,palette.copper);}
    }
  }
  function fractureFields(p,x,y,w,h,at){
    for(let row=Math.floor((y-100)/83);row<=Math.ceil((y+h+70)/83);row++)for(let col=Math.floor((x-120)/115);col<=Math.ceil((x+w+90)/115);col++){
      const seed=hash(col,row,335),xx=col*115+mod(row,2)*44+(seed%23)-9,yy=row*83+(seed>>>8)%29,b=at(yy);
      if(b===0){
        // Branching roots belong to long fault lines, with foliage at junctions.
        const ax=xx+15,ay=yy+4;
        p.line(ax,ay,ax+7,ay+20,palette.rootDark,4);p.line(ax+7,ay+20,ax-2,ay+42,palette.rootDark,3);
        p.line(ax+4,ay+15,ax+27,ay+26,palette.rootDark,3);p.line(ax+27,ay+26,ax+34,ay+45,palette.rootDark,2);
        p.line(ax+1,ay+3,ax+8,ay+19,palette.root,2);p.line(ax+9,ay+21,ax+25,ay+27,palette.root,1);
        p.poly([[ax-5,ay+3],[ax+2,ay],[ax+6,ay+6],[ax+1,ay+10],[ax-6,ay+9]],palette.mossDark);p.rect(ax-3,ay+3,4,2,palette.moss);
        if(seed%2===0){p.poly([[xx+47,yy+42],[xx+54,yy+34],[xx+66,yy+35],[xx+70,yy+43],[xx+62,yy+49],[xx+51,yy+47]],'shadow');for(let i=0;i<4;i++)p.line(xx+52+i*4,yy+40+i,xx+54+i*4,yy+36+i,palette.bone,1);}
      }else if(b===1){
        // Erosion channels are predominantly vertical, with mineral lips below.
        p.poly([[xx+8,yy],[xx+16,yy+7],[xx+12,yy+22],[xx+20,yy+33],[xx+16,yy+50],[xx+10,yy+54],[xx+13,yy+34],[xx+6,yy+23],[xx+11,yy+8]],'shadow');
        p.line(xx+11,yy+7,xx+9,yy+22,palette.waterDark,2);p.line(xx+9,yy+22,xx+16,yy+34,palette.waterDark,2);p.line(xx+16,yy+34,xx+13,yy+45,palette.water,1);
        p.poly([[xx+3,yy+49],[xx+16,yy+46],[xx+30,yy+50],[xx+38,yy+48],[xx+33,yy+54],[xx+16,yy+53]],'light');
        p.poly([[xx+4,yy+53],[xx+17,yy+51],[xx+30,yy+54],[xx+35,yy+53],[xx+30,yy+57],[xx+14,yy+56]],'shadow');
        p.line(xx+43,yy+18,xx+59,yy+12,'shadow',2);p.line(xx+59,yy+12,xx+69,yy+16,'shadow',2);p.rect(xx+49,yy+15,5,1,'deposit');
      }else if(b===2){
        // Shale cleaves into thin diagonal blades around an embedded vein.
        for(let i=0;i<3;i++){const sx=xx+i*8,sy=yy+34+i*4;p.poly([[sx,sy],[sx+25,sy-29],[sx+32,sy-31],[sx+10,sy+1]],i===1?'mid':'shadow');p.line(sx+3,sy-2,sx+24,sy-25,i===1?'light':'mid',1);}
        p.line(xx+12,yy+41,xx+44,yy+12,palette.purpleDark,3);p.line(xx+19,yy+35,xx+29,yy+26,palette.purple,1);
        shard(p,xx+40,yy+18,2,palette.crystalDark,palette.crystal);shard(p,xx+20,yy+37,2,palette.purpleDark,palette.purple);
      }else{
        // Connected, partly buried conduits replace repeated isolated pipe icons.
        const ly=yy+19,offset=seed%3===0?-10:seed%3===1?13:0,elbow=24+(seed>>>4)%14;
        p.line(xx+1,ly,xx+elbow,ly,palette.copperDark,4);p.line(xx+elbow,ly,xx+elbow+13,ly+offset,palette.copperDark,4);p.line(xx+elbow+13,ly+offset,xx+69,ly+offset,palette.copperDark,4);
        p.line(xx+2,ly,xx+elbow,ly,palette.copper,1);p.line(xx+elbow,ly,xx+elbow+13,ly+offset,palette.copper,1);p.line(xx+elbow+13,ly+offset,xx+67,ly+offset,palette.copper,1);
        p.rect(xx+15,ly-2,4,8,palette.metal);p.rect(xx+54,ly+offset-2,4,8,palette.metal);
        if(seed%2){p.line(xx+elbow,ly,xx+elbow,yy-8,palette.copperDark,3);p.rect(xx+elbow-2,yy-3,7,3,palette.copper);}
        p.poly([[xx-2,ly+1],[xx+7,ly-2],[xx+13,ly+3],[xx+10,ly+9],[xx+1,ly+6]],'mid');p.poly([[xx+58,ly+offset+2],[xx+69,ly+offset-3],[xx+76,ly+offset],[xx+71,ly+offset+10],[xx+63,ly+offset+9]],'mid');
        p.poly([[xx+12,yy+49],[xx+30,yy+41],[xx+52,yy+44],[xx+46,yy+48],[xx+29,yy+46],[xx+18,yy+53]],'shadow');
      }
    }
  }
  function paintChunk(p,x,y,o){
    p.rect(x,y,CW,CH,'base');strata(p,x,y,CW,CH);slabs(p,x,y,CW,CH);fractureFields(p,x,y,CW,CH,o.biome);pockets(p,x,y,CW,CH,o.biome);deposits(p,x,y,CW,CH,o.biome);
  }
  function makeCanvas(){
    try{let c;if(typeof root.OffscreenCanvas==='function')c=new root.OffscreenCanvas(CW,CH);else if(root.document){c=root.document.createElement('canvas');c.width=CW;c.height=CH;}if(!c)return null;const ctx=c.getContext('2d');if(!ctx)return null;ctx.imageSmoothingEnabled=false;return{canvas:c,ctx};}catch(_){return null;}
  }
  function chunk(x,y,o){
    let sig=0;for(let at=y;at<y+CH;at++)sig=(Math.imul(sig,31)+o.biome(at))|0;
    const key=x+','+y+','+sig;if(cache.has(key))return cache.get(key);
    const item=makeCanvas();if(!item)return null;
    paintChunk(painter(item.ctx,x,y,[x,y,x+CW,y+CH],o.biome),x,y,o);cache.set(key,item.canvas);if(cache.size>MAX_CACHE)cache.delete(cache.keys().next().value);return item.canvas;
  }
  function blit(ctx,image,x,y,o){
    const left=Math.max(x,-o.half),right=Math.min(x+CW,o.half),top=Math.max(y,o.top),bottom=Math.min(y+CH,o.bottom);if(left>=right||top>=bottom)return;
    for(let yy=top;yy<bottom;){const cut=cutoff(yy,o);let end=yy+1;while(end<bottom&&cutoff(end,o)===cut)end++;
      const draw=(a,b)=>{if(b>a)ctx.drawImage(image,a-x,yy-y,b-a,end-yy,a,yy,b-a,end-yy);};
      if(cut){draw(left,Math.min(right,-cut));draw(Math.max(left,cut),right);}else draw(left,right);yy=end;
    }
  }
  function drawTerrain(ctx,raw){
    const o=options(raw),smooth=ctx.imageSmoothingEnabled;ctx.save();ctx.imageSmoothingEnabled=false;
    try{for(let y=Math.floor(o.top/CH)*CH;y<o.bottom;y+=CH)for(let x=Math.floor(-o.half/CW)*CW;x<o.half;x+=CW){const image=typeof ctx.drawImage==='function'?chunk(x,y,o):null;if(image)blit(ctx,image,x,y,o);else paintChunk(painter(ctx,0,0,[Math.max(x,-o.half),Math.max(y,o.top),Math.min(x+CW,o.half),Math.min(y+CH,o.bottom)],o.biome,yy=>cutoff(yy,o)),x,y,o);}}
    finally{ctx.imageSmoothingEnabled=smooth;ctx.restore();}
  }
  function drawForeground(ctx,raw){
    const o=options(raw),inner=Math.max(134,o.half-38);if(inner>=o.half)return;
    ctx.save();try{for(const side of [-1,1]){const l=side<0?-o.half:inner,r=side<0?-inner:o.half,p=painter(ctx,0,0,[l,o.top,r,o.bottom],o.biome);
      for(let band=Math.floor((o.top-100)/116);band<=Math.ceil((o.bottom+20)/116);band++){
        const seed=hash(side,band,419),y=band*116+(seed%51),edge=side*o.half,width=o.half-inner,tip=side*(inner+8+seed%13);
        p.poly([[edge,y-16],[tip+side*8,y-12],[tip+side*8,y-3],[tip,y+3],[tip+side*3,y+15],[tip+side*11,y+18],[tip+side*10,y+35],[edge,y+43]],'deep');
        p.poly([[edge,y-13],[tip+side*10,y-9],[tip+side*9,y-1],[tip+side*3,y+4],[tip+side*7,y+8],[edge,y+1]],'shadow');
        p.poly([[tip+side*12,y+19],[edge,y+12],[edge,y+26],[tip+side*12,y+28]],'fissure');
        p.line(tip+side*6,y+4,tip+side*8,y+12,'mid',1);
        if(o.biome(y)===0&&width>20){p.line(edge-side*8,y+8,edge-side*15,y+22,palette.rootDark,2);p.line(edge-side*14,y+21,edge-side*10,y+34,palette.root,1);}
      }
    }}finally{ctx.restore();}
  }
  // Non-interactive retaining ribs and utility trenches belong to the shaft,
  // never to the source inventory. Their world coordinates survive scrolling.
  function drawInfrastructure(ctx,raw){
    const o=options(raw),end=Math.min(o.bottom,o.frontier-40);if(end<=o.top)return;
    ctx.save();try{
      const p=painter(ctx,0,0,[-o.half,o.top,o.half,end],o.biome);
      for(let band=Math.max(0,Math.floor((o.top-240)/SERVICE_SECTION));band<=Math.floor(end/SERVICE_SECTION);band++){
        const seed=hash(band,8,773),y=band*SERVICE_SECTION+86+seed%103,side=(seed>>>10)%2?-1:1;
        if((seed>>>17)%5!==0)continue;
        if(y<72||y-52>end||y+45<o.top)continue;
        const near=side*(o.wall(y)+6),reach=Math.min(78,Math.max(20,o.half-Math.abs(near)-8)),far=near+side*reach;
        // The trough is cut into a deep backing plane; rock toes bury its ends.
        const left=Math.min(near,far),right=Math.max(near,far);
        p.poly([[left,y-32],[left+12,y-39],[right-5,y-34],[right,y-19],[right-9,y+19],[left+4,y+24]],'deep');
        p.poly([[left+3,y-29],[right-7,y-29],[right-12,y+15],[left+8,y+18]],'fissure');
        p.line(near,y+15,far,y-26,palette.copperDark,5);p.line(near,y+14,far,y-27,palette.metal,2);
        p.line(near+side*3,y+15,far+side*2,y-26,'shadow',1);
        for(let i=1;i<4;i++){const x=Math.round(near+(far-near)*i/4),yy=Math.round(y+15-41*i/4);p.rect(x-2,yy-3,5,6,'deep');p.rect(x-1,yy-3,3,1,palette.bone);}
        // Small pressure housings and rivets supply mechanical scale cues.
        const bx=near+side*9;p.rect(bx-5,y-13,10,15,'deep');p.rect(bx-4,y-12,8,12,palette.copperDark);p.rect(bx-3,y-11,6,2,palette.metal);p.rect(bx-1,y-7,3,4,seed%2?palette.water:palette.copperLight);p.rect(bx,y-7,1,2,palette.bone);
        p.poly([[left,y+16],[left+11,y+14],[left+20,y+24],[left+4,y+29]],'mid');
        p.poly([[right-17,y-32],[right-7,y-39],[right+4,y-36],[right+6,y-25],[right-6,y-20]],'base');
        p.line(left+3,y+18,left+13,y+17,'light',1);p.line(right-6,y-36,right+2,y-33,'light',1);
      }
    }finally{ctx.restore();}
  }
  function structurePlans(o){
    const result=[];
    for(let band=Math.max(0,Math.floor((o.top-560)/SERVICE_SECTION));band<=Math.floor(o.bottom/SERVICE_SECTION);band++){
      const seed=hash(band,17,1207),side=(seed>>>12)%2?-1:1,y=band*SERVICE_SECTION+300+seed%180;
      // One pump in the middle five slots of each nine-section district. Even across
      // district boundaries two maintenance sites cannot appear in consecutive slots.
      const pump=band%9===2+hash(Math.floor(band/9),6,1901)%5;
      const seam=(band+hash(Math.floor(band/4),9,391))%4;
      if(!pump&&seam>1)continue;
      if(y+70<o.top||y-112>o.bottom)continue;
      const kind=pump?'pump':seam===0?'fault':'talus';
      const near=o.wall(y)+9,far=o.half-(o.half<134?5:28);
      const w=Math.min(pump?136:60+seed%56,far-near);
      if(w<23)continue;
      const compact=w<83,h=pump?(compact?72:95):kind==='fault'?21+seed%17:33+seed%23;
      const left=side>0?near:-near-w,top=y-h+12;
      if(top>o.frontier+40)continue;
      const item={id:'structure:'+band,kind,band,seed,side,left,top,width:w,height:h,biome:o.biome(y),compact,drain:seed%3!==0,
        opening:{left:left+5,right:left+w-5,top:top+Math.round(h*.24),bottom:top+h-8},lights:[]};
      if(pump){
        item.lights.push({x:side>0?left+13:left+w-13,y:top+29,radius:compact?30:47,color:[255,186,98],strength:1.05,kind:'lamp'});
        item.landingY=top+h-12;
      }
      result.push(item);
    }
    return result;
  }
  function paintStructure(p,item){
    const w=item.width,h=item.height,small=item.compact,b=item.biome;
    const X=x=>item.side>0?item.left+x:item.left+w-x,Y=y=>item.top+y;
    const poly=(points,c)=>p.poly(points.map(q=>[X(q[0]),Y(q[1])]),c),r=(x,y,ww,hh,c)=>p.rect(item.side>0?X(x):X(x+ww),Y(y),ww,hh,c),line=(a,b,c,d,color,width=1)=>p.line(X(a),Y(b),X(c),Y(d),color,width);
    if(item.kind!=='pump'){
      // A narrow split cuts diagonally through a bed; a slumped ledge has an
      // overhang and a pile of fallen slabs. Both pick up the surrounding rock tones.
      const rock=(points,role)=>poly(points.map(([x,y])=>[Math.round(x*w/100),Math.round(y*h/100)]),tone(b,role));
      if(item.kind==='fault'){
        const bend=35+item.seed%21;
        rock([[0,72],[bend,35],[68,40],[96,7],[100,14],[71,59],[bend+3,54],[6,94]],'deep');
        rock([[0,72],[bend,35],[68,40],[96,7],[68,46],[bend,42],[1,80]],'mid');
        rock([[4,80],[bend+3,46],[69,49],[85,30],[71,55],[bend+4,51],[6,89]],'fissure');
      }else{
        const lip=37+item.seed%24;
        rock([[0,54],[19,26],[lip,22],[69,5],[94,16],[100,37],[83,63],[74,74],[40,88],[9,84]],'deep');
        rock([[7,56],[23,36],[lip,32],[70,17],[87,22],[72,45],[35,64],[13,74]],'fissure');
        rock([[0,54],[19,26],[lip,22],[69,5],[93,16],[69,13],[lip,30],[21,32]],'mid');
        rock([[14,79],[31,58],[47,57],[39,75],[26,84]],'base');
        rock([[36,84],[51,67],[75,56],[85,59],[79,72],[55,85]],'shadow');
        rock([[38,81],[51,67],[75,56],[85,59],[69,64],[52,72]],'mid');
      }
      return;
    }
    if(w<64){
      poly([[2,25],[8,13],[w-4,9],[w-1,20],[w-3,h-16],[5,h-6]],tone(b,'deep'));
      r(7,18,w-13,3,palette.copperDark);r(7,20,3,h-30,palette.metal);
      r(10,27,7,7,tone(b,'fissure'));r(11,28,5,4,palette.copperLight);r(12,28,3,3,palette.bone);
      line(6,h-12,w-5,h-16,palette.metal,2);
      return;
    }
    // A continuous dark cut, then two nested silhouettes establish near, middle
    // and distant planes. The farther gallery contains no source or reward.
    poly([[0,31],[8,16],[21,7],[w-17,3],[w-2,19],[w,71],[w-8,h-9],[19,h-1],[5,h-13]],tone(b,'deep'));
    poly([[7,32],[18,21],[w-23,12],[w-10,24],[w-11,h-18],[17,h-9],[10,h-23]],tone(b,'fissure'));
    poly([[19,38],[29,27],[w-25,24],[w-17,32],[w-19,h-29],[24,h-22]],tone(b,'deep'));
    // Far pillars, an upper maintenance walk and a cool channel disappear into
    // the cut. Perspective slopes converge rather than forming a flat sticker.
    const distant=Math.max(15,w-27);
    for(let n=0;n<(small?2:4);n++){const x=22+n*Math.max(7,Math.floor((w-48)/4));r(x,31,3,h-61,tone(b,'deep'));r(x+3,31,1,h-64,palette.water);}
    line(20,43,distant,34,palette.water,2);line(20,47,distant,38,tone(b,'fissure'),2);
    if(!small){
      poly([[w-54,40],[w-45,33],[w-31,36],[w-29,h-44],[w-52,h-36]],tone(b,'fissure'));
      line(w-51,43,w-46,38,palette.water);line(w-46,38,w-34,40,palette.water);
      r(w-43,45,3,2,palette.waterLight);r(w-41,47,1,4,palette.water);
      line(23,53,w-28,44,tone(b,'deep'),3);line(23,53,w-28,44,palette.water,1);
      // A distant pump and pipe bend sit behind the near brace and rock toes.
      r(32,h-53,12,20,tone(b,'deep'));r(34,h-52,8,16,palette.waterDark);r(34,h-51,6,2,palette.water);
      r(39,h-47,2,3,palette.waterLight);line(41,h-35,53,h-35,palette.water,2);line(53,h-35,53,h-45,palette.water,2);
    }
    poly([[19,h-29],[w-17,h-39],[w-13,h-19],[22,h-12]],tone(b,'deep'));
    if(item.drain){
      poly([[20,h-22],[w-20,h-35],[w-13,h-27],[20,h-12]],palette.waterDark);
      line(23,h-20,w-20,h-31,palette.water,2);line(25,h-17,w-17,h-28,palette.waterLight);
      for(let n=0;n<(small?2:5);n++){const x=23+n*Math.max(5,Math.floor((w-49)/5));r(x,h-21-Math.floor(n*1.6),4,1,palette.water);}
    }else{
      line(18,h-18,w-20,h-36,palette.metal);line(22,h-13,w-15,h-28,palette.copper);for(let n=0;n<4;n++){const x=23+n*Math.max(6,Math.floor((w-50)/4));line(x,h-18-n*2,x+5,h-12-n*2,palette.copperDark,2);}
    }
    // The portal is a load-bearing frame, bolted through wide rock shoulders.
    const beam=Math.max(25,w-14);r(7,17,beam-5,7,tone(b,'fissure'));r(8,17,beam-7,2,palette.metal);r(8,20,beam-7,3,palette.copperDark);
    r(9,24,7,h-37,tone(b,'fissure'));r(9,24,2,h-39,palette.metal);r(12,25,2,h-40,palette.copperDark);
    r(beam-6,21,6,h-39,tone(b,'deep'));r(beam-5,23,1,h-41,palette.copper);
    const diagonal=small?16:31;line(15,25,15+diagonal,49,palette.copperDark,5);line(16,25,16+diagonal,48,palette.metal,2);
    line(beam-8,26,beam-8-diagonal,49,tone(b,'deep'),4);line(beam-8,26,beam-8-diagonal,48,palette.copper,1);
    for(let x=11;x<beam-4;x+=small?11:20){r(x,20,2,2,tone(b,'fissure'));r(x,20,1,1,palette.bone);}
    for(const yy of [28,h-27]){r(8,yy,8,6,palette.copperDark);r(10,yy+1,2,2,palette.bone);r(14,yy+4,1,1,palette.metal);}
    // Warm work light is mounted to this near frame; the lightmap lights its
    // neighboring ledge. Sparse warm pixels do not bleach the distant blue.
    r(10,27,7,7,tone(b,'fissure'));r(11,28,5,4,palette.copperLight);r(12,28,3,3,palette.bone);r(10,34,7,2,palette.copperDark);
    r(15,h-12,Math.max(10,w-35),3,palette.copperDark);r(16,h-12,Math.max(8,w-38),1,palette.copperLight);
    // Uneven rock toes occlude the floor and the outer beam ends.
    poly([[0,h-23],[12,h-29],[23,h-18],[31,h-14],[28,h-5],[12,h-1],[0,h-7]],tone(b,'base'));
    poly([[w-25,6],[w-13,0],[w,7],[w,29],[w-10,27],[w-18,19]],tone(b,'shadow'));
    poly([[w-26,h-17],[w-14,h-23],[w,h-17],[w,h],[w-29,h]],tone(b,'deep'));
    if(!small){const rock=Math.round(w*.57);poly([[rock-14,2],[rock+8,1],[rock+24,8],[rock+20,22],[rock+7,25],[rock-7,15]],tone(b,'shadow'));poly([[rock-7,15],[rock+7,25],[rock+20,22],[rock+16,29],[rock+4,28]],tone(b,'deep'));line(rock-9,4,rock+5,3,tone(b,'mid'));}
    line(2,h-22,10,h-25,tone(b,'light'));line(12,h-25,23,h-17,tone(b,'mid'));line(w-21,8,w-12,4,tone(b,'mid'));
  }
  function structureRaster(item){
    const key=[item.band,item.width,item.height,item.biome,item.side].join(':');if(structureCache.has(key))return structureCache.get(key);
    let c;try{if(typeof root.OffscreenCanvas==='function')c=new root.OffscreenCanvas(item.width,item.height);else if(root.document){c=root.document.createElement('canvas');c.width=item.width;c.height=item.height;}if(!c)return null;const context=c.getContext('2d');if(!context)return null;context.imageSmoothingEnabled=false;paintStructure(painter(context,item.left,item.top,[item.left,item.top,item.left+item.width,item.top+item.height],()=>item.biome),item);structureCache.set(key,c);if(structureCache.size>48)structureCache.delete(structureCache.keys().next().value);return c;}catch(_){return null;}
  }
  function drawDepthStructures(ctx,raw){
    const o=options(raw),plans=structurePlans(o),smooth=ctx.imageSmoothingEnabled;ctx.save();ctx.imageSmoothingEnabled=false;
    try{for(const item of plans){const c=typeof ctx.drawImage==='function'?structureRaster(item):null;
      if(c){const top=Math.max(o.top,item.top),bottom=Math.min(o.bottom,item.top+item.height);if(bottom>top)ctx.drawImage(c,0,top-item.top,item.width,bottom-top,item.left,top,item.width,bottom-top);}
      else paintStructure(painter(ctx,0,0,[-o.half,o.top,o.half,o.bottom],()=>item.biome),item);
    }}finally{ctx.imageSmoothingEnabled=smooth;ctx.restore();}return plans;
  }
  function setColors(patch){
    const next={...palette};if(patch&&typeof patch==='object')for(const key of Object.keys(defaults))if(typeof patch[key]==='string'&&/^#[0-9a-f]{6}$/i.test(patch[key]))next[key]=patch[key].toLowerCase();palette=Object.freeze(next);cache.clear();structureCache.clear();return palette;
  }
  return Object.freeze({get palette(){return palette;},drawTerrain,drawForeground,drawInfrastructure,drawDepthStructures,setColors,clearCache(){cache.clear();structureCache.clear();}});
});
