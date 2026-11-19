// The current day's winch and the last stamped day's marker share one depth scale.
(() => {
  'use strict';
  const width=288, height=106, pitTop=38, pitBottom=94, mint='#80e0b9';
  function readout(survey){
    if(!survey||!Number.isSafeInteger(survey.meters)||survey.meters<0)return null;
    const previous=(survey.stamps||[]).find(stamp=>stamp.day<survey.day && stamp.meters>=25)||null;
    const deepest=Math.max(survey.meters,previous?.meters||0);
    const limit=[25,100,250].find(level=>level>=deepest)||Math.ceil(deepest/100)*100;
    return {day:survey.day,meters:survey.meters,limit,previous};
  }
  const depthY=(meters,limit)=>pitTop+(pitBottom-pitTop)*Math.min(1,Math.max(0,meters/limit));
  if(typeof module==='object'&&module.exports){module.exports={readout,depthY};return;}
  const scene=document.getElementById('boardSurveyScene'),dialog=document.getElementById('depthBoard');
  const ctx = scene.getContext('2d');
  if (!ctx) return;
  const landscape = document.createElement('canvas');
  landscape.width = width;
  landscape.height = height;
  function painters(c) {
    const rect = (x,y,w,h,color) => { c.fillStyle = color; c.fillRect(Math.round(x), Math.round(y), w, h); };
    // Fill each scanline with integer pixels. Slopes stay crisp even at fractional device scales.
    function poly(points, color) {
      const ys = points.map(p => p[1]);
      for (let y = Math.min(...ys); y < Math.max(...ys); y++) {
        const xs = [];
        for (let i = 0; i < points.length; i++) {
          const a = points[i], b = points[(i + 1) % points.length];
          if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
        xs.sort((a,b) => a-b);
        for (let i = 0; i + 1 < xs.length; i += 2) rect(Math.ceil(xs[i]), y, Math.ceil(xs[i + 1]) - Math.ceil(xs[i]), 1, color);
      }
    }
    function strut(x1,y1,x2,y2,color,thick=1) {
      const n = Math.max(Math.abs(x2-x1), Math.abs(y2-y1), 1);
      for (let i=0; i<=n; i++) rect(x1+(x2-x1)*i/n, y1+(y2-y1)*i/n, thick, thick, color);
    }
    return {rect, poly, strut};
  }
  function background() {
    const {rect, poly, strut} = painters(landscape.getContext('2d'));
    rect(0,0,width,height,'#172830');
    rect(0,0,width,10,'#375061'); rect(0,10,width,12,'#536977'); rect(0,22,width,8,'#8b9290');
    rect(39,4,8,6,'#efdfb3'); rect(41,3,4,8,'#efdfb3'); rect(40,8,3,2,'#cdbf9d');
    for (const [x,y] of [[20,4],[72,7],[86,3],[113,6],[152,3],[189,6],[220,3],[266,5]]) rect(x,y,1,1,'#e4d8bd');
    poly([[0,18],[19,10],[30,15],[54,6],[77,20],[99,12],[113,19],[147,6],[162,17],[190,12],[217,20],[244,8],[263,17],[287,10],[288,30],[0,30]],'#506776');
    poly([[0,23],[25,17],[44,22],[61,14],[85,19],[98,15],[121,25],[147,16],[177,23],[205,12],[234,23],[249,17],[266,20],[288,12],[288,30],[0,30]],'#3d5b67');
    poly([[0,23],[13,21],[37,26],[58,19],[87,27],[119,21],[151,25],[170,20],[198,25],[235,20],[259,24],[288,17],[288,31],[0,31]],'#2a494f');
    function fir(x, y, h) {
      const w = Math.floor(h / 3);
      poly([[x,y-h],[x+w,y-4],[x+2,y-4],[x+w+2,y],[x-w-2,y],[x-2,y-4],[x-w,y-4]],'#203c40');
      rect(x,y-1,2,4,'#203c40');
    }
    for (const [x,y,h] of [[5,26,13],[15,29,11],[25,26,8],[91,28,6],[168,28,8],[180,29,6],[254,27,10],[268,27,14],[281,28,17]]) fir(x,y,h);
    // Surface engine house and ore spur.
    rect(11,19,16,8,'#3d3634'); rect(13,21,4,3,'#ddab65'); rect(21,21,3,6,'#23373a');
    poly([[8,19],[13,14],[23,14],[29,19],[29,20],[8,20]],'#25383e');
    rect(12,15,10,1,'#96a296'); rect(23,10,2,6,'#293d44'); rect(25,8,5,1,'#96a4a2');
    rect(0,28,width,2,'#98927a'); rect(0,30,width,2,'#574640');
    const strata = [
      [32,'#37494c','#56635c'],[44,'#384346','#59615a'],[57,'#424043','#696057'],
      [72,'#4d403c','#84634e'],[86,'#58443b','#977152'],[98,'#433838','#745449']
    ];
    for (let layer=0; layer<strata.length; layer++) {
      const [y,rock,edge] = strata[layer], points = [];
      for (let x=-8; x<width+20; x+=8) {
        const line = y + Math.floor(2.4*Math.sin(x/15+layer*2) + 1.6*Math.sin(x/31-layer));
        points.push([x,line]);
      }
      poly([...points,[width+12,height],[-8,height]], rock);
      for (let i=0; i<points.length-1; i++) {
        if ((i+layer)%5 < 3) strut(...points[i],...points[i+1],edge);
      }
    }
    // Bedding, broken joints and lens-shaped mineral inclusions.
    let seed=1973;
    function random(n) { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return Math.floor(seed/4294967296*n); }
    for (let i=0; i<120; i++) {
      const x=random(width), y=34+random(70), w=2+random(9), dark=i%5===0;
      rect(x,y,w,1,dark?'#2f3638':(y>74?'#725749':'#485355'));
      if (i%4===0) rect(x+2,y+1,Math.max(1,w-3),1,'#384144');
    }
    for (const [x,y] of [[12,48],[42,81],[92,65],[153,94],[207,55],[259,86],[276,66]]) {
      for (let i=0; i<5; i++) {
        const xx=x+i*2, yy=y-[0,0,1,2,2][i];
        rect(xx,yy,2,2,'#9b7854'); rect(xx,yy,1,1,'#d7ab71');
      }
    }
    // Two exposed vugs: transparent blue crystal facets and a warm calcite pocket.
    function pocket(x,y,ground,shadow,body,light) {
      poly([[x-13,y-4],[x-6,y-7],[x+1,y-6],[x+7,y-8],[x+13,y-2],[x+10,y+5],[x+4,y+8],[x-5,y+8],[x-12,y+3]],ground);
      poly([[x-11,y-3],[x-4,y-6],[x+2,y-4],[x+7,y-6],[x+11,y-1],[x+7,y+5],[x,y+6],[x-8,y+4]],shadow);
      for (const [dx,dy,h] of [[-7,3,4],[-3,4,7],[1,5,5],[5,3,4]]) {
        const foot=x+dx, base=y+dy;
        poly([[foot-1,base],[foot-1,base-h+2],[foot+1,base-h],[foot+3,base-h+2],[foot+2,base]],body);
        strut(foot,base-2,foot+1,base-h+1,light);
      }
    }
    pocket(76,64,'#34464a','#1d333a','#478c8f','#8ecfc1');
    pocket(207,89,'#614d41','#392f30','#b37d53','#dfa766');
    for (const [x,y] of [[104,45],[184,64],[261,82],[18,92]]) {
      strut(x,y,x+3,y+3,'#303638'); strut(x+3,y+3,x+1,y+5,'#303638');
      strut(x+2,y+5,x+7,y+8,'#303638');
    }
    // A surveyor's staff on the rock face keeps the scale readable across the ore.
    rect(3,pitTop,1,pitBottom-pitTop+1,'#9e9d85');
    for (let y=pitTop; y<=pitBottom; y+=7) rect(3,y,(y-pitTop)%14===0?5:3,1,'#c1b79c');
  }
  background();
  const {rect, poly, strut} = painters(ctx);
  const font = {
    '0':['111','101','101','101','111'], '1':['010','110','010','010','111'],
    '2':['111','001','111','100','111'], '3':['111','001','111','001','111'],
    '4':['101','101','111','001','001'], '5':['111','100','111','001','111'],
    '6':['111','100','111','101','111'], '7':['111','001','010','010','010'],
    '8':['111','101','111','101','111'], '9':['111','101','111','001','111'],
    m:['000','000','101','111','101']
  };
  function numberTag(n,x,y,ink) {
    const digits=String(n).split('');
    const w=digits.length*4+3;
    rect(x-Math.floor(w/2),y,w,9,'#23343a');
    let at=x-Math.floor(w/2)+2;
    for (const digit of digits) {
      font[digit]?.forEach((line,row)=>{ for (let i=0; i<3; i++) if (line[i]==='1') rect(at+i,y+2+row,1,1,ink); });
      at+=4;
    }
  }
  function shaft(x,y,motion) {
    // Excavated face, timber sets and rock lips are distinct from the movement cable.
    const end=Math.min(height-3,Math.round(y)+9);
    poly([[x-10,30],[x+11,30],[x+10,39],[x+11,end-4],[x+7,end],[x-6,end+1],[x-11,end-2],[x-10,42]],'#1c2b30');
    rect(x-9,33,2,Math.max(1,end-35),'#5c5147');
    for (let by=42; by<end-2; by+=14) {
      rect(x-9,by,4,2,'#8c7256'); rect(x+7,by,3,2,'#675b4d');
      rect(x-8,by+2,1,2,'#73634e');
    }
    // A-frame headgear, little gabled hoist, pulley and a pennant.
    strut(x-8,27,x-1,15,'#273638',2); strut(x+7,27,x+1,15,'#263638',2);
    strut(x-6,25,x-1,15,'#ac9a78'); strut(x-4,20,x+4,24,'#655e51');
    rect(x-9,27,19,2,'#3a3933'); rect(x-6,26,13,1,'#bba27e');
    rect(x-4,13,8,4,'#39484a'); rect(x-3,13,6,1,'#c9ba95'); rect(x,14,2,2,'#d9be79');
    rect(x-3,7,1,6,'#b6aa87'); rect(x-2,7,6,2,mint); rect(x-2,9,4,1,mint);
    rect(x-2,17,1,Math.max(1,Math.round(y)-18),'#9ca092'); rect(x+2,17,1,Math.max(1,Math.round(y)-18),'#687974');
    const cy=Math.round(y);
    // The light is clipped to the face of the shaft; the surrounding rock stays solid.
    rect(x-8,cy-4,16,9,'#304f4d');
    rect(x-6,cy-5,12,10,'#385d54');
    rect(x-4,cy-4,8,8,'#496f59');
    strut(x-3,cy-2,x,cy-5,'#a5a38b'); strut(x,cy-5,x+4,cy-2,'#a5a38b');
    rect(x-7,cy-2,14,3,'#28383c'); rect(x-7,cy-2,14,1,mint);
    rect(x-6,cy+1,12,4,'#626b66'); rect(x-4,cy+1,8,3,'#2d4247');
    rect(x-3,cy+1,2,2,'#ffe6a2'); rect(x,cy+1,2,2,mint); rect(x-5,cy+5,10,1,'#adab93');
    rect(x-6,cy+6,3,1,'#29343a'); rect(x+3,cy+6,3,1,'#29343a');
    if (motion>0 && motion<1) {
      const p=motion;
      for (let i=0; i<5; i++) {
        const dir=i%2===0?-1:1, v=4+i*1.3;
        const dx=dir*(4+v*p), dy=-Math.sin(p*Math.PI)*(2+i%4)+p*p*6;
        rect(x+dx,cy+5+dy,i%3===0?2:1,1,i%2?'#bfa278':'#e6c378');
      }
    }
  }
  function draw(model,start,t){
    ctx.drawImage(landscape,0,0);
    if(!model)return;
    const end=depthY(model.meters,model.limit);
    const travel=Math.min(1,t/.7),smooth=1-(1-travel)**3;
    shaft(136,start+(end-start)*smooth,t>.65&&start!==end?(t-.65)/.35:0);
    numberTag(0,11,pitTop-4,'#ccd0b6');
    const scale=String(model.limit)+'m';
    numberTag(scale,8+scale.length*2,pitBottom-4,'#e2cda0');
    if(model.previous){
      const y=Math.round(depthY(model.previous.meters,model.limit)),x=212;
      rect(x-2,y-3,3,7,'#372e2d');rect(x-1,y-3,2,6,'#d5996f');rect(x+1,y-3,6,3,'#edb585');
      const distance=String(model.previous.meters)+'m';
      numberTag(distance,x+4+distance.length*2,y+2,'#efbc95');
    }
  }
  let frame=0,signature='',last=null;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  function settle(){
    cancelAnimationFrame(frame);frame=0;
    draw(last,pitTop,1);scene.dataset.settled='true';
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)settle();});
  reduced.addEventListener?.('change',()=>{if(reduced.matches)settle();});
  window.PersonalSurveyArt={
    render(survey){
      const model=readout(survey),next=JSON.stringify(model);
      if(next===signature)return;
      const start=last&&model&&last.day===model.day?depthY(last.meters,last.limit):pitTop;
      signature=next;last=model;cancelAnimationFrame(frame);
      if(!model||start===depthY(model.meters,model.limit)||reduced.matches||document.hidden||!dialog.open){settle();return;}
      scene.dataset.settled='false';
      const begin=performance.now();
      function animate(now){
        const t=Math.min(1,(now-begin)/800);
        draw(model,start,t);
        if(t<1 && dialog.open && !document.hidden)frame=requestAnimationFrame(animate);
        else settle();
      }
      animate(begin);
    },
    close(){cancelAnimationFrame(frame);frame=0;signature='';last=null;}
  };
})();
