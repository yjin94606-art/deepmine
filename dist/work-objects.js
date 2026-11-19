(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory();
  else root.WorkObjects=factory();
})(globalThis,function(){
  'use strict';
  // Objects are cutouts on a 96 × 80 grid. Rasterize the same grid for the wall and reveal.
  const ink='#282633',shade='#414454',steel='#72778a',silver='#b5bcc0',ivory='#f9ecc9';
  const deep='#23545b',teal='#368a85',mint='#80d5ad',spark='#c9efb5';
  const walnut='#67434b',copper='#ac624b',amber='#ed9e59',gold='#ffd181';
  const plum='#5d466f',violet='#a077aa',lilac='#d7a7c7',red='#d36357';
  function brush(ctx){
    function rect(x,y,w,h,color){
      ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));
    }
    function polygon(points,color){
      const ys=points.map(point=>point[1]);
      for(let y=Math.floor(Math.min(...ys));y<Math.ceil(Math.max(...ys));y++){
        const cuts=[],pos=y+.5;
        for(let j=0,k=points.length-1;j<points.length;k=j++){
          const a=points[k],b=points[j];
          if((a[1]<=pos&&b[1]>pos)||(b[1]<=pos&&a[1]>pos))cuts.push(a[0]+(b[0]-a[0])*(pos-a[1])/(b[1]-a[1]));
        }
        cuts.sort((a,b)=>a-b);
        for(let i=1;i<cuts.length;i+=2){const left=Math.ceil(cuts[i-1]-.5);rect(left,y,Math.ceil(cuts[i]-.5)-left,1,color);}
      }
    }
    function disk(x,y,rx,ry,color){
      for(let dy=-ry;dy<=ry;dy++){const dx=Math.floor(rx*Math.sqrt(Math.max(0,1-(dy/ry)**2)));rect(x-dx,y+dy,dx*2+1,1,color);}
    }
    function wire(points,color,width=2){
      for(let i=1;i<points.length;i++){
        const [x,y]=points[i-1],[a,b]=points[i],n=Math.max(1,Math.abs(a-x),Math.abs(b-y));
        for(let j=0;j<=n;j++)rect(x+(a-x)*j/n,y+(b-y)*j/n,width,width,color);
      }
    }
    return {rect,polygon,disk,wire};
  }
  // Section through an isometric block, with a sunlit crown and shaded right face.
  function block(p,x,y,w,d,h,top,left,right){
    p.polygon([[x,y],[x+w,y],[x+w+d,y-d],[x+d,y-d]],top);
    p.rect(x,y,w,h,left);
    p.polygon([[x+w,y],[x+w+d,y-d],[x+w+d,y-d+h],[x+w,y+h]],right);
  }
  function typewriter(p){
    p.polygon([[7,53],[17,35],[22,34],[23,24],[17,24],[17,15],[25,12],[73,12],[78,16],[78,23],[74,26],[74,34],[82,40],[90,57],[90,64],[78,69],[19,69],[7,62]],ink);
    p.rect(24,16,48,7,steel);p.rect(25,15,45,2,silver);p.rect(28,20,38,5,shade);
    p.rect(14,15,8,11,ink);p.rect(15,16,5,6,amber);p.rect(74,16,7,8,copper);p.rect(75,16,5,2,gold);
    p.polygon([[19,37],[28,27],[69,27],[78,37],[81,45],[16,45]],teal);
    p.polygon([[26,34],[32,29],[65,29],[70,34],[63,38],[31,38]],deep);
    for(let i=0;i<9;i++)p.wire([[30+i*4,31],[41+i*2,36]],i%2?steel:silver,1);
    p.polygon([[17,40],[77,40],[86,57],[74,64],[14,61],[10,57]],mint);
    p.polygon([[22,40],[72,40],[79,52],[69,56],[17,55]],deep);
    for(let row=0;row<3;row++)for(let col=0;col<8;col++){
      const x=23+col*6+(row%2)*2,y=42+row*4;
      p.rect(x,y,4,3,ink);p.rect(x,y,3,1,row%2?ivory:spark);
    }
    p.rect(29,56,32,4,deep);p.rect(30,56,30,2,ivory);p.rect(14,61,63,4,teal);p.rect(20,66,8,3,shade);p.rect(69,66,7,3,shade);
  }
  function computer(p,info){
    // The chip and its solder contacts follow the file's declaration and flow-line structure.
    const rows=info.rows||[],values=info.values||[];
    block(p,10,51,61,15,8,teal,deep,ink);
    p.polygon([[10,50],[24,22],[74,17],[87,35],[72,51]],deep);
    p.polygon([[14,48],[26,25],[72,21],[82,34],[70,48]],teal);
    const pins=Math.min(9,Math.max(4,Math.ceil(rows.length/2)));
    for(let i=0;i<pins;i++){
      const x=24+i*5;
      p.wire([[x,49],[x+1,43],[x+6,38]],mint,1);
      p.rect(x-4,53,3,5,gold);
    }
    block(p,31,36,25,9,7,steel,ink,shade);p.rect(40,31,11,4,ivory);
    p.rect(61,26,8,4,amber);p.rect(59,31,11,3,copper);
    const lamps=rows.filter(r=>r.role==='flow').length;
    for(let j=0;j<Math.min(4,1+lamps);j++){p.rect(20+j*5,42,3,2,j<lamps?gold:mint);}
    for(let i=0;i<Math.min(values.length,5);i++)p.rect(46+i*5,44,3,1+Math.abs(values[i])%4,mint);
    p.rect(12,56,9,3,copper);p.rect(71,44,4,2,silver);
  }
  function route(p){
    block(p,12,53,55,17,6,'#416e59','#395447',ink);
    p.polygon([[12,52],[23,29],[32,31],[42,17],[54,32],[68,24],[84,35],[67,52]],'#58856a');
    p.polygon([[25,34],[32,23],[39,36],[31,32]],mint);p.polygon([[35,30],[42,17],[52,31],[43,26]],spark);
    p.polygon([[46,49],[51,39],[59,36],[64,26],[68,24],[63,38],[56,42],[51,52]],'#78bab8');
    p.wire([[23,48],[33,42],[39,45],[48,40],[47,35],[59,30],[71,31]],ink,4);
    p.wire([[23,47],[33,41],[39,44],[48,39],[47,34],[59,29],[71,30]],gold,2);
    for(const [x,y] of [[23,46],[71,30]]){
      p.polygon([[x-5,y-12],[x-3,y-15],[x+3,y-15],[x+6,y-12],[x+6,y-7],[x,y+1],[x-5,y-7]],ink);
      p.polygon([[x-3,y-11],[x-1,y-13],[x+3,y-13],[x+4,y-10],[x+3,y-7],[x,y-3],[x-3,y-8]],red);p.rect(x-1,y-11,3,3,ivory);
    }
  }
  function columns(p,values){
    // Draw each sampled value in order. The caps sit at the actual normalized height.
    const tally=Math.min(values.length,16),stride=Math.min(15,Math.floor(67/tally)),width=Math.max(2,stride-3);
    const start=Math.floor((90-stride*tally)/2);
    const bottom=Math.min(0,...values),axis=61+Math.round(bottom*.66);
    block(p,start-3,63,stride*tally+3,7,4,steel,shade,ink);
    if(bottom<0)p.rect(start-2,axis,stride*tally+2,1,silver);
    for(let i=0;i<tally;i++){
      const value=values[i],h=Math.round(Math.abs(value)*.66),x=start+i*stride;
      if(!h){p.rect(x,axis,width,1,silver);continue;}
      const y=value<0?axis:axis-h;
      block(p,x,y,width,Math.max(2,Math.min(5,stride-2)),h,i%3===2?gold:spark,i%3===2?amber:mint,i%3===2?copper:teal);
      if(width>5&&h>3)p.rect(x+1,y+1,1,h-2,i%3===2?gold:spark);
    }
  }
  function abacus(p,cells){
    p.polygon([[8,20],[17,14],[83,14],[89,19],[83,23],[12,24]],ink);
    p.rect(8,20,11,43,ink);p.rect(77,21,10,42,ink);p.rect(9,59,72,7,ink);
    p.polygon([[10,19],[18,16],[84,16],[80,21]],gold);p.rect(10,20,8,43,copper);p.rect(78,19,7,43,copper);
    // Cut the spaces between rods out of the silhouette.
    const rows=Math.min(5,Math.max(2,cells?.length||4));
    for(let i=0;i<rows;i++){
      const y=25+i*Math.floor(31/(rows-1));
      p.rect(18,y,60,2,silver);
      const count=Math.min(7,cells?.[i]?.filter(Boolean).length||3+i%3);
      for(let j=0;j<count;j++){const x=23+j*7;p.disk(x,y,3,4,i%2?violet:amber);p.rect(x-1,y-2,2,2,i%2?lilac:gold);}
    }
    p.rect(11,61,69,4,walnut);p.rect(18,59,59,3,amber);
  }
  function tape(p,peaks){
    p.polygon([[8,39],[12,36],[81,36],[87,42],[87,61],[80,66],[13,66],[8,61]],ink);
    p.polygon([[11,41],[17,38],[79,38],[84,42],[78,47],[11,47]],silver);
    p.rect(11,45,70,17,deep);p.rect(17,62,57,2,teal);
    for(const [x,y,r] of [[27,27,16],[65,26,18]]){
      p.disk(x,y+1,r+2,r+2,ink);p.disk(x,y,r,r,steel);p.disk(x,y-1,r-2,r-2,silver);
      for(let h=0;h<3;h++){const a=h*2.095-.8;p.disk(x+Math.round(Math.cos(a)*r*.51),y+Math.round(Math.sin(a)*r*.51),4,4,shade);}
      p.disk(x,y,3,3,ink);p.rect(x-1,y-1,2,2,gold);
    }
    p.wire([[12,29],[17,39],[26,42],[67,43],[79,38]],walnut,2);
    p.rect(14,46,59,14,ink);
    if(peaks?.length){
      for(let i=0;i<55;i++){
        const lo=Math.floor(i*peaks.length/55),hi=Math.max(lo+1,Math.floor((i+1)*peaks.length/55));
        const h=Math.round(6*Math.max(...peaks.slice(lo,hi))/63);
        p.rect(16+i,53-h,1,h*2+1,h>3?spark:mint);
      }
    }else {p.rect(18,51,20,4,amber);p.rect(43,51,24,4,amber);p.rect(26,48,2,7,ink);p.rect(58,47,2,8,ink);}
    p.rect(76,49,4,4,red);p.rect(76,56,4,3,amber);
  }
  function projector(p){
    p.wire([[26,51],[14,68]],ink,5);p.wire([[66,50],[77,67]],ink,5);p.wire([[45,52],[45,69]],shade,4);
    p.polygon([[11,31],[20,25],[55,25],[68,35],[68,52],[58,58],[17,58],[11,52]],ink);
    block(p,15,34,43,7,19,lilac,violet,plum);
    p.disk(36,24,18,8,ink);p.disk(36,22,18,7,lilac);p.disk(36,22,8,3,plum);
    for(let i=0;i<6;i++)p.rect(20+i*5,24,2,5,violet);
    p.polygon([[62,37],[72,36],[82,30],[88,34],[88,50],[82,53],[71,46],[62,46]],ink);
    p.rect(65,38,7,7,steel);p.disk(83,41,5,9,teal);p.disk(84,40,3,6,mint);p.rect(82,37,2,3,ivory);
    for(let i=0;i<5;i++)p.rect(19+i*4,41,2,9,plum);
    p.disk(48,42,4,4,walnut);p.disk(47,41,2,2,gold);
  }
  function camera(p,film){
    if(film){
      p.wire([[41,48],[22,68]],steel,3);p.wire([[43,48],[63,68]],steel,3);p.wire([[41,49],[40,69]],shade,3);
      for(const [x,y,r] of [[28,21,11],[51,17,14]]){
        p.disk(x,y,r+1,r+1,ink);p.disk(x,y,r-1,r-1,steel);
        for(const [dx,dy] of [[0,-5],[-4,3],[4,3]])p.disk(x+dx,y+dy,3,3,shade);
        p.rect(x-1,y-1,2,2,gold);
      }
      block(p,16,35,40,8,16,mint,teal,deep);p.rect(18,37,6,12,deep);p.rect(39,39,8,4,gold);
      p.polygon([[62,33],[70,32],[79,24],[84,26],[84,48],[77,49],[70,42],[62,42]],ink);
      p.polygon([[70,35],[78,29],[78,45],[70,39]],deep);p.rect(79,29,3,14,mint);
      return;
    }
    p.polygon([[9,32],[16,24],[33,24],[39,17],[59,17],[65,24],[77,24],[85,30],[85,56],[77,63],[15,63],[9,57]],ink);
    block(p,13,34,61,7,23,silver,walnut,shade);p.rect(14,37,59,15,teal);
    p.rect(18,26,10,4,steel);p.rect(19,25,8,2,gold);p.rect(40,20,17,7,shade);p.rect(42,22,13,4,mint);
    p.rect(18,38,9,15,deep);p.rect(68,32,4,3,ivory);p.rect(17,58,48,2,copper);
    p.disk(48,44,16,16,ink);p.disk(47,43,14,14,silver);p.disk(47,43,11,11,shade);p.disk(47,43,7,7,deep);
    p.disk(45,41,4,3,mint);p.rect(44,39,3,2,ivory);
  }
  function gallery(p,blocks){
    const n=Math.min(5,Math.max(2,(blocks||[]).filter(b=>/^h\d$|button/.test(b.role)).length));
    block(p,8,60,68,10,5,silver,steel,shade);block(p,14,34,57,9,25,ivory,'#cba784',copper);
    p.polygon([[10,35],[19,18],[72,18],[82,27],[74,37],[12,37]],ink);
    for(let i=0;i<7;i++){const x=12+i*9;p.polygon([[x,33],[x+7,20],[x+15,20],[x+9,33]],i%2?ivory:red);p.rect(x,33,9,4,i%2?'#dec19e':copper);}
    const pitch=Math.floor(46/n);
    for(let i=0;i<n;i++){const x=20+i*pitch;p.rect(x,40,pitch-2,15,ink);p.rect(x+1,41,pitch-4,11,i%2?teal:deep);p.rect(x+2,41,2,7,mint);}
    p.rect(15,56,53,3,walnut);p.rect(73,39,4,13,teal);p.rect(74,38,3,3,ivory);
  }
  function memory(p){
    p.polygon([[36,16],[40,9],[71,9],[80,15],[80,31],[74,37],[68,37],[70,45],[59,36],[42,36],[36,30]],ink);
    p.polygon([[39,17],[43,12],[70,12],[76,16],[76,29],[72,32],[64,32],[65,38],[58,32],[43,32],[39,28]],violet);
    p.rect(46,14,20,2,lilac);
    p.polygon([[10,36],[17,27],[53,27],[61,34],[61,48],[54,55],[34,55],[21,66],[22,55],[16,55],[10,49]],ink);
    p.polygon([[14,37],[20,30],[51,30],[57,35],[57,46],[50,51],[32,51],[25,57],[26,51],[19,51],[14,47]],teal);
    for(const x of [23,33,43]){p.rect(x,39,5,5,mint);p.rect(x,39,3,2,ivory);}
  }
  function parcel(p){
    block(p,12,34,47,19,29,amber,copper,walnut);p.rect(15,62,41,2,walnut);
    p.polygon([[20,33],[39,15],[46,15],[28,34]],gold);p.rect(20,34,8,26,amber);
    p.polygon([[49,34],[68,16],[73,16],[55,34]],gold);p.rect(49,34,6,28,amber);
    p.rect(32,42,12,8,ink);p.rect(34,44,8,3,silver);p.rect(16,38,2,2,ivory);p.rect(56,58,2,2,ivory);
  }
  function geometry(p){
    const a=[21,37],b=[46,16],c=[75,27],d=[57,47],e=[21,53],f=[57,64],g=[75,46];
    p.polygon([a,b,c,d],lilac);p.polygon([a,d,f,e],violet);p.polygon([d,c,g,f],plum);
    for(const pair of [[a,b],[b,c],[c,d],[d,a],[a,e],[e,f],[f,d],[c,g],[g,f],[a,f],[b,d],[d,g]])p.wire(pair,ink,2);
    for(const [x,y] of [a,b,c,d,e,f,g]){p.rect(x-2,y-2,5,5,ink);p.rect(x-1,y-1,3,3,gold);}
  }
  function paintbox(p,colors){
    block(p,9,45,57,17,13,amber,copper,walnut);
    p.polygon([[11,44],[26,27],[79,27],[65,44]],ink);
    const chips=colors.slice(0,8),n=Math.ceil(chips.length/2);
    for(let i=0;i<chips.length;i++){
      const row=Math.floor(i/n),x=22+(i%n)*Math.floor(44/n)-row*6,y=30+row*6,w=Math.floor(44/n)-2;
      p.polygon([[x,y+4],[x+4,y],[x+4+w,y],[x+w,y+4]],chips[i]);
    }
    p.wire([[36,53],[63,25],[75,13]],ink,5);p.wire([[38,52],[66,24]],gold,2);
    p.polygon([[62,26],[67,17],[79,9],[76,19],[68,28]],walnut);p.wire([[64,25],[70,19]],silver,3);
    p.rect(27,48,9,4,ink);p.rect(29,48,5,2,silver);
  }
  function draw(ctx,info){
    const p=brush(ctx),type=info.type||info.kind,semantic=String(info.label||'');
    if(info.kind==='colors')return paintbox(p,info.colors);
    if((type==='code'||info.kind==='code') && /(?:pathfind|shortest.?(?:route|path)|find.?(?:route|path)|plan.?route|route.?plan|dijkstra|a.?star\b|最短(?:路线|路径|経路)|路线规划|路径规划|寻路|経路探索|ルート(?:検索|を探す))/i.test(semantic))return route(p);
    if(info.kind==='table'&&info.series?.length)return columns(p,info.bars||info.series);
    if(type==='table'||info.kind==='table')return abacus(p,info.cells);
    if(info.kind==='wave'||type==='audio')return tape(p,info.peaks);
    if(type==='code'||info.kind==='code')return computer(p,info);
    if(type==='web'||info.kind==='web')return gallery(p,info.blocks);
    if(type==='slides')return projector(p);
    if(type==='video'||type==='image')return camera(p,type==='video');
    if(type==='memory')return memory(p);
    if(type==='file' && /\.(?:gltf|glb|obj|stl)$/i.test(info.path||''))return geometry(p);
    if(type==='file')return parcel(p);
    typewriter(p);
  }
  return Object.freeze({draw});
});
