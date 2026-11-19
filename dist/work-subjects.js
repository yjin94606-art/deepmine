(function(root, factory) {
  const subjects = factory();
  if (typeof module === 'object' && module.exports) module.exports = subjects;
  else root.WorkSubjects = subjects;
})(globalThis, function() {
  'use strict';
  // Tiny illustrations for subjects explicitly named in the work. Coordinates
  // are authored on a 72 × 54 pixel grid, with the light above and to the left.
  const C = {
    ink:'#262d3b', deep:'#343d49', shade:'#54546a', steel:'#7b8390', silver:'#b9c4ba',
    cream:'#fff0be', white:'#fff8db', sun:'#ffce73', ochre:'#d79348', copper:'#b76042',
    clay:'#8d4e41', brick:'#784042', coral:'#e68150', red:'#ba5043', blush:'#ffa37a',
    pine:'#264f50', green:'#3c7663', leaf:'#72a46a', lime:'#c5ce77',
    sea:'#31596d', teal:'#418997', glass:'#68b4b3', sky:'#a5d6c7',
    violet:'#856a9c', iris:'#c593b8', water:'#528296', sand:'#bd9f76'
  };
  function brushes(ctx) {
    const scale=Math.min(ctx.canvas.width/72,ctx.canvas.height/54);
    const ox=Math.round((ctx.canvas.width-72*scale)/2),oy=Math.round((ctx.canvas.height-54*scale)/2);
    function rect(x,y,w,h,color) {
      ctx.fillStyle=color;
      ctx.fillRect(ox+Math.round(x*scale),oy+Math.round(y*scale),
        Math.round((x+w)*scale)-Math.round(x*scale),Math.round((y+h)*scale)-Math.round(y*scale));
    }
    function poly(points,color) {
      const ys=points.map(point=>point[1]);
      for(let y=Math.min(...ys);y<Math.max(...ys);y++) {
        const scan=y+.5,cuts=[];
        for(let i=0,j=points.length-1;i<points.length;j=i++) {
          const [x1,y1]=points[j],[x2,y2]=points[i];
          if((y1<=scan&&y2>scan)||(y2<=scan&&y1>scan))cuts.push(x1+(scan-y1)*(x2-x1)/(y2-y1));
        }
        cuts.sort((a,b)=>a-b);
        for(let i=0;i+1<cuts.length;i+=2) {
          const left=Math.ceil(cuts[i]-.5),right=Math.ceil(cuts[i+1]-.5);
          if(right>left)rect(left,y,right-left,1,color);
        }
      }
    }
    function stroke(points,color,size=1) {
      for(let i=1;i<points.length;i++) {
        let [x,y]=points[i-1]; const [endX,endY]=points[i];
        const dx=Math.abs(endX-x),sx=x<endX?1:-1,dy=-Math.abs(endY-y),sy=y<endY?1:-1;
        let error=dx+dy;
        for(;;) {
          rect(x,y,size,size,color);
          if(x===endX&&y===endY)break;
          const e=2*error;
          if(e>=dy){error+=dy;x+=sx;} if(e<=dx){error+=dx;y+=sy;}
        }
      }
    }
    return {rect,poly,stroke};
  }
  function egret({poly,rect,stroke}) {
    // A white egret wading on two dark, differently bent legs.
    poly([[5,43],[17,40],[29,41],[40,39],[57,41],[63,44],[54,47],[40,48],[25,47],[17,49],[6,47]],C.sea);
    stroke([[7,44],[17,42],[29,43]],C.glass);stroke([[31,45],[44,45],[50,43],[57,43]],C.water);
    stroke([[25,31],[27,38],[23,44],[17,45]],C.ink,2);
    stroke([[32,30],[32,37],[38,41],[36,45],[41,45]],C.ink,2);
    rect(22,43,4,1,C.ochre);rect(37,45,4,1,C.ochre);
    poly([[10,28],[21,23],[31,20],[39,21],[44,24],[40,30],[32,34],[22,33],[14,35],[17,31],[9,32]],C.shade);
    poly([[10,28],[24,22],[32,20],[39,21],[41,25],[36,29],[28,31],[16,32],[19,29]],C.cream);
    poly([[13,28],[24,23],[34,21],[35,23],[28,26],[22,27],[18,30]],C.white);
    poly([[21,30],[29,25],[34,24],[30,28],[25,30]],C.silver);
    poly([[31,24],[38,21],[43,19],[40,17],[36,16],[35,12],[36,9],[40,6],[46,6],[49,9],[47,12],[42,12],[40,13],[42,15],[47,18],[47,21],[45,25],[39,29],[34,29]],C.silver);
    poly([[32,24],[39,21],[44,19],[42,16],[39,15],[37,12],[38,9],[41,7],[46,7],[48,9],[46,11],[41,11],[39,13],[42,16],[46,18],[46,21],[43,24],[37,27]],C.white);
    stroke([[37,10],[33,11],[30,13]],C.silver);rect(44,8,2,2,C.ink);
    poly([[47,9],[55,10],[62,12],[55,12],[47,11]],C.ochre);rect(47,9,5,1,C.sun);
    stroke([[11,42],[10,37],[7,34]],C.green,2);stroke([[10,40],[12,35],[13,32]],C.leaf);
    stroke([[57,41],[57,33],[60,28]],C.green,2);rect(60,25,2,6,C.copper);
    stroke([[56,41],[54,36],[52,34]],C.leaf);rect(43,47,6,1,C.sky);
  }
  function deskLamp({poly,rect,stroke}) {
    poly([[12,44],[22,40],[33,40],[42,44],[39,48],[18,49],[11,47]],C.ink);
    poly([[13,43],[23,40],[32,41],[39,44],[32,46],[16,46]],C.teal);
    rect(19,43,13,1,C.glass);rect(28,41,4,3,C.ochre);
    stroke([[25,40],[16,26],[37,13],[51,18]],C.ink,5);
    stroke([[27,40],[20,26],[38,16],[49,19]],C.ink,3);
    stroke([[25,40],[18,26],[38,14],[51,18]],C.ochre,2);
    stroke([[27,38],[21,27],[37,18]],C.copper);
    for(const [x,y] of [[25,40],[18,26],[38,14],[51,18]]) {
      rect(x-2,y-2,6,6,C.ink);rect(x-1,y-1,4,4,C.teal);rect(x,y,2,2,C.cream);
    }
    poly([[49,14],[54,15],[54,19],[58,20],[63,26],[60,28],[47,32],[39,31],[40,28],[44,23],[46,19]],C.ink);
    poly([[47,20],[51,18],[56,21],[60,25],[53,28],[41,30],[43,26]],C.teal);
    poly([[47,21],[51,19],[54,21],[46,25],[43,28]],C.glass);
    poly([[42,30],[52,26],[61,25],[57,28],[46,32],[40,32]],C.cream);
    rect(48,30,4,2,C.sun);rect(52,28,3,1,C.white);
    stroke([[32,45],[42,47],[48,46]],C.ink);rect(48,44,3,3,C.shade);
  }
  function lighthouse({poly,rect,stroke}) {
    poly([[6,44],[14,41],[22,40],[29,37],[47,38],[57,42],[64,44],[58,47],[40,51],[21,49],[10,48]],C.sea);
    poly([[13,42],[22,39],[35,37],[48,38],[56,41],[50,44],[34,47],[17,46]],C.shade);
    poly([[16,42],[26,38],[44,37],[54,40],[44,43],[32,44],[26,43]],C.leaf);
    poly([[27,40],[32,16],[41,16],[47,39],[43,42],[29,42]],C.ink);
    poly([[29,39],[33,17],[40,17],[45,39],[42,41],[30,40]],C.cream);
    poly([[38,17],[40,17],[45,39],[41,40]],C.silver);
    poly([[31,26],[42,25],[43,30],[30,32]],C.red);rect(32,26,5,2,C.coral);
    rect(35,36,4,5,C.clay);rect(35,21,2,3,C.sea);
    rect(28,14,17,3,C.ink);rect(30,14,13,1,C.sun);rect(31,8,11,6,C.ink);
    rect(33,9,3,5,C.sun);rect(37,9,3,4,C.ochre);rect(33,9,2,3,C.white);
    poly([[28,9],[30,7],[35,4],[37,2],[39,5],[44,8],[44,9]],C.brick);
    stroke([[30,8],[36,4],[39,6]],C.coral);rect(36,1,1,3,C.ink);
    for(const x of [28,32,40,44])rect(x,12,1,3,C.ink);
    rect(28,12,17,1,C.ochre);stroke([[9,46],[18,48],[23,48]],C.sky);rect(48,46,7,1,C.glass);
  }
  function greenhouse({poly,rect,stroke}) {
    poly([[6,37],[8,25],[28,11],[50,8],[64,19],[65,36],[45,46],[25,48],[8,42]],C.ink);
    poly([[9,25],[28,12],[48,10],[32,23]],C.glass);
    poly([[31,23],[49,10],[62,20],[46,29]],C.sky);
    poly([[9,26],[31,23],[46,29],[46,42],[27,46],[9,40]],C.teal);
    poly([[46,29],[63,20],[63,35],[46,43]],C.sea);
    poly([[11,35],[13,31],[17,34],[20,27],[22,30],[25,29],[27,34],[31,30],[35,33],[39,30],[43,35],[43,42],[26,44],[12,40]],C.green);
    for(const [x,y] of [[14,33],[21,30],[29,34],[39,33],[51,30],[57,28]]) {
      rect(x,y,3,2,C.leaf);rect(x,y+2,1,3,C.pine);
    }
    for(const points of [[[9,25],[28,11],[49,9],[63,20],[46,29],[31,23],[9,25]],[[20,24],[39,11]],[[31,23],[49,9]],[[39,25],[56,15]]])stroke(points,C.cream);
    for(const [x,top,bottom] of [[11,26,39],[21,24,42],[32,24,43],[45,29,42],[54,25,38],[62,21,34]])stroke([[x,top],[x,bottom]],C.pine,2);
    stroke([[9,40],[26,46],[45,42],[63,34]],C.copper,3);
    stroke([[9,40],[26,45],[45,41],[63,33]],C.sun);
    poly([[27,33],[35,31],[35,42],[27,44]],C.ink);poly([[29,34],[33,33],[33,41],[29,42]],C.glass);rect(32,37,1,1,C.white);
    rect(15,27,3,1,C.sky);rect(16,28,2,1,C.sky);rect(54,16,2,1,C.white);
  }
  function garden({poly,rect,stroke}) {
    poly([[7,34],[38,24],[63,31],[65,36],[31,49],[7,42]],C.ink);
    poly([[8,34],[38,25],[62,31],[31,43]],C.ochre);
    poly([[12,34],[38,27],[57,31],[31,40]],C.clay);
    poly([[9,36],[30,43],[30,47],[9,41]],C.copper);
    poly([[31,43],[63,32],[63,36],[31,47]],C.brick);
    stroke([[10,36],[30,42],[61,32]],C.sun);
    for(const [x,y,h,petal] of [[43,30,13,C.iris],[51,32,10,C.coral],[28,32,15,C.sun],[20,35,10,C.iris],[36,36,14,C.blush],[29,39,7,C.cream]]) {
      stroke([[x,y],[x,y-h+3]],C.pine,2);
      poly([[x,y-4],[x-6,y-8],[x-6,y-10],[x-2,y-9],[x+1,y-5]],C.green);
      poly([[x+1,y-6],[x+4,y-11],[x+8,y-12],[x+6,y-8]],C.leaf);
      rect(x-4,y-h,9,3,petal);rect(x-2,y-h-2,4,7,petal);
      rect(x-1,y-h,3,2,C.ochre);rect(x-3,y-h-1,2,1,C.white);
    }
  }
  function cycle({poly,rect,stroke}) {
    const rim=[[0,-10],[5,-9],[9,-5],[10,0],[9,5],[5,9],[0,10],[-5,9],[-9,5],[-10,0],[-9,-5],[-5,-9],[0,-10]];
    for(const x of [18,53]) {
      const pts=rim.map(([dx,dy])=>[x+dx,35+dy]);stroke(pts,C.ink,3);stroke(pts,C.silver);
      for(const [dx,dy] of [[6,-6],[-4,-8],[0,9],[-8,4]])stroke([[x,35],[x+dx,35+dy]],C.steel);
    }
    stroke([[18,35],[28,21],[35,35],[18,35],[46,20],[28,21]],C.ink,3);
    stroke([[19,34],[28,22],[35,34],[19,34],[45,20],[29,21]],C.coral,2);
    stroke([[46,18],[53,35]],C.ochre,2);stroke([[48,24],[53,35]],C.sun);
    stroke([[45,20],[43,15],[49,13],[51,15]],C.ink,2);rect(47,13,4,1,C.silver);
    stroke([[28,21],[26,16]],C.steel,2);poly([[22,15],[28,15],[32,17],[30,18],[21,18]],C.ink);
    rect(33,33,5,5,C.ink);rect(34,34,2,2,C.sun);stroke([[36,36],[39,40],[42,40]],C.silver);rect(39,40,5,2,C.ink);
    rect(15,46,10,1,C.shade);rect(50,46,9,1,C.shade);
  }
  function train({poly,rect,stroke}) {
    stroke([[6,40],[57,45],[67,39]],C.shade,2);
    poly([[6,17],[11,13],[48,16],[59,18],[65,25],[65,37],[57,42],[10,37],[6,33]],C.ink);
    poly([[8,17],[13,14],[48,17],[56,19],[53,21],[10,19]],C.silver);
    poly([[8,20],[54,23],[56,37],[9,33]],C.cream);
    poly([[55,22],[59,20],[63,25],[63,35],[57,39],[55,36]],C.teal);
    for(let i=0;i<5;i++){const x=11+i*8,y=21+Math.floor(i/2);rect(x,y,6,6,C.sea);rect(x+1,y,3,2,C.glass);}
    poly([[57,23],[60,22],[63,26],[63,28],[57,30]],C.ink);rect(58,24,2,3,C.glass);
    stroke([[9,29],[53,33],[56,35],[62,31]],C.red,2);rect(57,33,2,1,C.sun);rect(62,31,1,2,C.white);
    for(const [x,y] of [[16,35],[23,36],[43,38],[50,39]]){rect(x,y,4,4,C.ink);rect(x+1,y+1,2,2,C.steel);}
    stroke([[16,14],[19,10],[30,13],[23,15]],C.steel);rect(17,10,9,1,C.ink);
  }
  function shaft({poly,rect,stroke}){
    // A section of rock with a timber portal, a cart track, and an inspection lamp.
    poly([[5,36],[9,26],[16,22],[20,13],[31,10],[42,12],[47,9],[54,13],[55,18],[62,23],[66,34],[64,42],[56,45],[14,46],[5,42]],C.ink);
    poly([[7,36],[12,26],[18,24],[23,15],[32,12],[41,14],[47,12],[53,15],[54,21],[61,25],[65,35],[60,40],[52,39],[18,42],[9,40]],C.steel);
    poly([[8,36],[15,29],[21,29],[18,35],[21,40],[14,42],[8,40]],C.shade);
    poly([[44,15],[50,14],[53,17],[49,20],[43,19]],C.silver);
    poly([[49,26],[57,24],[61,28],[55,31],[47,31]],C.shade);
    poly([[18,35],[22,23],[27,18],[42,18],[49,24],[50,37],[44,41],[19,41]],C.ink);
    poly([[21,24],[26,18],[44,18],[49,23],[47,25],[42,22],[26,22]],C.copper);
    rect(21,23,4,15,C.clay);rect(44,23,4,14,C.clay);rect(22,24,1,12,C.ochre);rect(45,24,1,11,C.ochre);
    stroke([[26,45],[32,37],[35,32]],C.silver,2);stroke([[45,45],[40,37],[38,32]],C.steel,2);
    stroke([[29,41],[43,41]],C.copper,2);stroke([[31,38],[41,38]],C.ochre);stroke([[34,35],[39,35]],C.clay);
    rect(39,22,1,4,C.shade);rect(37,25,5,5,C.copper);rect(38,26,3,3,C.sun);rect(38,26,1,2,C.white);
    rect(11,34,4,2,C.silver);rect(53,34,6,2,C.silver);rect(53,40,3,1,C.ochre);
  }
  const subjects=[
    [/(?:矿坑|矿道|矿井|礦坑|礦井|坑道|廃鉱|\bmine\s?(?:shafts?|tunnels?)\b|\bmining\s+(?:games?|tunnels?)\b)/iu,shaft],
    [/(?:白鹭|白鷺|苍鹭|蒼鷺|シラサギ|コサギ|アオサギ|\b(?:egrets?|herons?)\b)/iu,egret],
    [/(?:台灯|檯燈|デスクライト|卓上(?:灯|ライト)|\b(?:desk|folding|reading)\s+lamp\b)/iu,deskLamp],
    [/(?:灯塔|燈塔|灯台|\blighthouse\b)/iu,lighthouse],
    [/(?:温室|溫室|\b(?:greenhouse|glasshouse|conservatory)\b)/iu,greenhouse],
    [/(?:花园|花園|花卉|花圃|花苗|苗床|花壇|ガーデン|\b(?:garden|flowerbed|seedlings?|flower\s+bed)\b)/iu,garden],
    [/(?:自行车|腳踏車|单车|骑行|骑车|自転車|サイクリング|\b(?:bicycles?|cycling|bike\s+ride)\b)/iu,cycle],
    [/(?:火车|火車|列车|列車|電車|鉄道|\b(?:railway|railroad|locomotive|trains?)\b)/iu,train]
  ];
  const labels=new Map([
    [shaft,['矿道','mine shaft','坑道']], [egret,['白鹭或苍鹭','heron','サギ']],
    [deskLamp,['台灯','desk lamp','デスクライト']], [lighthouse,['灯塔','lighthouse','灯台']],
    [greenhouse,['温室','greenhouse','温室']], [garden,['花园','garden','庭園']],
    [cycle,['自行车','bicycle','自転車']], [train,['列车','train','列車']]
  ]);
  function topics(text,language){
    return subjects.filter(([pattern])=>pattern.test(text||'')).map(([,draw])=>labels.get(draw)[language]);
  }
  function draw(ctx,model) {
    // More than one named subject in a description is usually a collection.
    // Let the renderer for that work type handle it rather than choosing a cover.
    for(const text of [model?.label,model?.text]) {
      if(!text)continue;
      const matches=subjects.filter(([pattern])=>pattern.test(text));
      if(matches.length>1)return false;
      if(matches.length===1){matches[0][1](brushes(ctx));return true;}
    }
    return false;
  }
  return {draw,topics};
});
