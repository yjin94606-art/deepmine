(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.ExpeditionArt = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  // Original, hand-placed pixel clusters. No paths, gradients or bitmap assets.
  const palette = Object.freeze({
    ink:'#182c3b', deep:'#273d4b', steelDark:'#405967', steel:'#6f8a8a', silver:'#a7bdb1', shine:'#fff0bf',
    earthShadow:'#74614f', earth:'#806b56', earthLight:'#8a745c',
    tealShadow:'#3c535a', teal:'#455d63', tealLight:'#4e676c',
    shaleShadow:'#505061', shale:'#5b596b', shaleLight:'#656375',
    bedrockShadow:'#2e4052', bedrock:'#374a59', bedrockLight:'#405462',
    copperDark:'#744844', copper:'#b46b45', copperLight:'#e59d61',
    goldShadow:'#74504a', gold:'#c9903f', goldLight:'#efc05f', goldHighlight:'#ffe09a',
    cabDark:'#285d69', cab:'#5da8a6', cabLight:'#a9dac4',
    woodShadow:'#4b3f44', wood:'#846043', woodLight:'#bc925d',
    emeraldShadow:'#247168', emerald:'#42b68b', emeraldLight:'#9ce0ac',
    amberShadow:'#a3693a', amber:'#e6aa4d', amberLight:'#ffe3a3',
    violetShadow:'#625082', violet:'#ab7ac6', violetLight:'#e3b9e1',
    blueShadow:'#325f8e', blue:'#5a9fd0', blueLight:'#a9d7e3',
    mossDark:'#344c40', moss:'#55764b', mossLight:'#8ca65a',
    waterDark:'#193e53', water:'#25697c', waterLight:'#459bb1', foam:'#9ad9ce',
    roseDark:'#803f50', rose:'#c45b65', roseLight:'#ed9e8a',
    paperShadow:'#ac976c', paper:'#ddc99a', paperLight:'#f2e5bb',
    fossilDark:'#8b7e6c', fossil:'#b8ac8d', fossilLight:'#dfd2ae'
  });
  const P = palette;
  const recipes = ['engine','archive','prism','compass','rover','drill','projector','observatory','pickaxe','gamepad','quill','telescope','key','seedling','bridge','musicbox'];
  const biomes = ['roots','aquifer','crystal','ruins'];
  const cache = new Map();
  const integer = n => Number.isFinite(Number(n)) ? Math.round(Number(n)) : 0;
  const mod = (n,m) => ((integer(n)%m)+m)%m;

  function rect(c,x,y,w,h,color) {
    if(w<=0||h<=0)return;
    c.fillStyle=color;c.fillRect(x,y,w,h);
  }
  function poly(c,points,color) {
    const lo=Math.min(...points.map(p=>p[1])),hi=Math.max(...points.map(p=>p[1]));
    for(let y=lo;y<hi;y++){
      const at=y+.5,cuts=[];
      for(let i=0,j=points.length-1;i<points.length;j=i++){
        const a=points[j],b=points[i];
        if((a[1]<=at&&b[1]>at)||(b[1]<=at&&a[1]>at))cuts.push(a[0]+(at-a[1])*(b[0]-a[0])/(b[1]-a[1]));
      }
      cuts.sort((a,b)=>a-b);
      for(let i=0;i+1<cuts.length;i+=2){const x=Math.ceil(cuts[i]-.5),end=Math.ceil(cuts[i+1]-.5);rect(c,x,y,end-x,1,color);}
    }
  }
  function disc(c,x,y,r,color) {
    for(let dy=-r;dy<=r;dy++){const half=Math.floor(Math.sqrt(r*r-dy*dy));rect(c,x-half,y+dy,half*2+1,1,color);}
  }
  function line(c,x0,y0,x1,y1,color,width) {
    const dx=Math.abs(x1-x0),dy=-Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1;
    let err=dx+dy;
    for(;;){rect(c,x0,y0,width||1,width||1,color);if(x0===x1&&y0===y1)break;const e=2*err;if(e>=dy){err+=dy;x0+=sx;}if(e<=dx){err+=dx;y0+=sy;}}
  }
  function star(c,x,y,color){rect(c,x-2,y,5,1,color);rect(c,x,y-2,1,5,color);}
  function box(c,x,y,w,h,base,light,dark){rect(c,x,y,w,h,P.ink);rect(c,x+1,y+1,w-2,h-2,base);rect(c,x+1,y+1,w-2,2,light);rect(c,x+w-3,y+3,2,h-4,dark);}
  function gear(c,x,y,r,base,light,dark) {
    disc(c,x,y,r, dark);
    for(const p of [[-3,-r-2,7,5],[-3,r-2,7,5],[-r-2,-3,5,7],[r-2,-3,5,7]])rect(c,x+p[0],y+p[1],p[2],p[3],dark);
    disc(c,x-1,y-1,r-2,base);rect(c,x-r+3,y-5,2,6,light);rect(c,x-5,y-r+3,7,2,light);
    disc(c,x,y,Math.max(2,Math.floor(r*.42)),P.ink);disc(c,x,y,Math.max(1,Math.floor(r*.22)),P.steel);
  }
  function crystal(c,x,base,w,h,ramp){
    const left=x-Math.floor(w/2),right=left+w,top=base-h;
    poly(c,[[left,base-4],[left,top+5],[x,top],[right,top+6],[right,base-3],[x,base]],P.ink);
    poly(c,[[left+2,base-5],[left+2,top+6],[x,top+2],[x+1,base-2]],ramp[1]);
    poly(c,[[x+1,top+3],[right-2,top+7],[right-2,base-4],[x+1,base-2]],ramp[0]);
    poly(c,[[left+2,top+6],[x,top+2],[x,top+9],[left+2,top+12]],ramp[2]);
  }
  function plinth(c,x,y,w){box(c,x,y,w,6,P.steelDark,P.steel,P.deep);rect(c,x+3,y+6,w-6,2,P.ink);rect(c,x+4,y+1,3,2,P.goldLight);rect(c,x+w-7,y+1,3,2,P.gold);}

  function engine(c,v,f){
    plinth(c,7,56,42);rect(c,11,51,7,6,P.steel);rect(c,38,51,7,6,P.steel);
    box(c,9,27,11,24,P.copper,P.copperLight,P.copperDark);box(c,36,27,11,24,P.copper,P.copperLight,P.copperDark);
    rect(c,12,24,5,6,P.silver);rect(c,39,24,5,6,P.steel);
    box(c,7,17,15,12,P.steelDark,P.steel,P.deep);box(c,34,17,15,12,P.steelDark,P.steel,P.deep);
    for(let y=21;y<=25;y+=3){rect(c,9,y,11,1,P.silver);rect(c,36,y,11,1,P.steel);}
    rect(c,4,34,6,3,P.copperLight);rect(c,3,34,3,16,P.copper);rect(c,5,47,8,3,P.copperDark);
    rect(c,45,33,7,3,P.copper);rect(c,49,23,3,12,P.copperDark);rect(c,48,21,5,3,P.copperLight);
    gear(c,28,41,13,P.gold,P.goldHighlight,P.copperDark);
    disc(c,28,41,8,P.ink);disc(c,28,41,6,v?P.blueShadow:P.emeraldShadow);
    disc(c,27,40,4,v?P.blue:P.emerald);rect(c,25,37,3,3,P.shine);
    const glow=f%2?P.cabLight:P.cab;rect(c,26,27,4,5,glow);rect(c,23,21,10,6,P.deep);rect(c,25,22,6,2,P.goldLight);
    rect(c,14,40,2,5,P.goldHighlight);rect(c,40,40,2,5,P.goldLight);
  }
  function archive(c,v){
    plinth(c,9,56,38);rect(c,24,49,8,8,P.wood);rect(c,26,48,3,8,P.woodLight);
    poly(c,[[3,20],[8,17],[23,20],[28,24],[34,20],[49,17],[53,20],[51,46],[34,48],[28,52],[21,48],[4,46]],P.ink);
    poly(c,[[5,22],[10,20],[23,23],[28,27],[28,49],[21,45],[6,43]],P.copperDark);
    poly(c,[[28,27],[35,23],[49,20],[51,22],[49,43],[34,45],[28,49]],P.copper);
    poly(c,[[7,19],[12,17],[22,20],[27,24],[27,44],[21,41],[8,39]],P.paperShadow);
    poly(c,[[9,18],[13,17],[21,19],[25,23],[25,41],[20,38],[9,37]],P.paperLight);
    poly(c,[[29,24],[36,20],[48,17],[48,38],[36,40],[29,44]],P.paper);
    poly(c,[[30,24],[36,21],[46,19],[46,36],[36,38],[30,41]],P.paperLight);
    for(let i=0;i<4;i++){rect(c,12,23+i*4,8+i%2*2,1,P.paperShadow);rect(c,34,25+i*4,9-i%2*2,1,P.paperShadow);}
    rect(c,26,25,3,24,P.gold);rect(c,27,25,1,21,P.goldHighlight);
    poly(c,[[35,21],[39,20],[39,35],[37,32],[35,35]],v?P.violet:P.rose);
    disc(c,28,45,5,P.copperDark);disc(c,28,44,4,P.amber);rect(c,26,42,2,3,P.amberLight);
    rect(c,5,18,3,5,P.goldLight);rect(c,48,18,3,5,P.goldLight);
    poly(c,[[18,14],[21,10],[25,8],[24,13],[22,17],[18,20]],P.fossilLight);line(c,18,20,24,10,P.copper);
  }
  function prism(c,v,f){
    plinth(c,11,56,34);box(c,17,47,22,10,P.gold,P.goldHighlight,P.goldShadow);
    poly(c,[[17,46],[13,20],[27,3],[42,20],[38,46],[29,52]],P.ink);
    poly(c,[[15,20],[27,6],[27,47],[19,44]],v?P.blue:P.cab);
    poly(c,[[27,6],[39,21],[36,43],[27,48]],v?P.violet:P.blueShadow);
    poly(c,[[16,20],[25,9],[25,20],[18,28]],P.cabLight);
    poly(c,[[29,10],[37,21],[34,35],[29,42]],P.violet);
    poly(c,[[20,33],[27,29],[34,33],[28,39]],P.violetLight);
    rect(c,14,20,27,3,P.copperDark);rect(c,16,20,23,1,P.goldHighlight);
    rect(c,17,44,21,3,P.gold);rect(c,18,44,19,1,P.goldHighlight);
    rect(c,25,2,5,3,P.goldLight);rect(c,26,0,3,2,P.shine);
    rect(c,22,51,12,4,P.deep);rect(c,24,51,8,2,P.cabLight);
    if(f%2)star(c,20,16,P.shine);
  }
  function compass(c,v,f){
    plinth(c,12,56,32);rect(c,23,51,10,7,P.copper);
    box(c,23,7,10,8,P.gold,P.goldHighlight,P.copperDark);rect(c,26,5,4,3,P.copperLight);
    disc(c,28,34,23,P.ink);disc(c,28,33,21,P.gold);disc(c,27,32,19,P.goldLight);disc(c,28,34,17,P.blueShadow);disc(c,28,34,14,P.deep);
    rect(c,10,23,2,8,P.goldHighlight);rect(c,17,14,9,2,P.shine);rect(c,42,31,4,9,P.copper);
    for(const q of [[27,20,2,5],[27,44,2,5],[14,33,5,2],[38,33,5,2]])rect(c,...q,P.paperLight);
    for(const q of [[18,25],[36,25],[18,41],[36,41]])rect(c,q[0],q[1],2,2,P.steel);
    poly(c,[[28,18],[33,34],[28,39],[23,34]],v?P.emerald:P.rose);
    poly(c,[[28,49],[23,34],[28,30],[33,34]],P.blueLight);
    poly(c,[[28,20],[28,34],[25,32]],P.shine);disc(c,28,34,3,P.gold);rect(c,27,33,2,2,P.shine);
    if(f===2)rect(c,16,19,3,1,P.shine);
  }
  function rover(c,v,f){
    for(const x of [7,37]){box(c,x,46,12,17,P.deep,P.steel,P.ink);for(let y=48;y<61;y+=4)rect(c,x+1,y,10,2,P.steelDark);disc(c,x+6,54,3,P.steel);disc(c,x+6,54,1,P.ink);}
    box(c,13,40,30,15,P.gold,P.goldHighlight,P.goldShadow);rect(c,19,53,18,4,P.copperDark);rect(c,21,54,14,2,P.copper);
    box(c,16,25,24,17,P.copper,P.copperLight,P.copperDark);box(c,19,26,18,12,P.cabDark,P.cab,P.deep);
    rect(c,21,29,5,5,P.cabLight);rect(c,30,29,4,5,P.cabLight);rect(c,25,36,5,1,P.goldLight);
    rect(c,24,18,7,8,P.steel);rect(c,25,18,2,7,P.silver);
    box(c,20,12,19,9,P.steelDark,P.silver,P.deep);disc(c,34,16,5,P.ink);disc(c,34,16,3,v?P.violet:P.blue);rect(c,32,14,2,2,P.shine);
    rect(c,13,12,2,17,P.steel);rect(c,12,9,4,4,f%2?P.amberLight:P.rose);rect(c,14,7,1,3,P.ink);
    line(c,13,41,7,34,P.steel,2);line(c,7,34,4,39,P.silver,2);rect(c,3,39,5,3,P.gold);
    line(c,42,40,48,33,P.steel,2);line(c,48,33,50,39,P.silver,2);rect(c,48,39,5,3,P.gold);
    rect(c,22,44,3,3,P.shine);rect(c,31,44,3,3,P.shine);rect(c,25,49,6,2,P.deep);
  }
  function drill(c,v,f){
    box(c,17,5,22,11,P.copper,P.copperLight,P.copperDark);rect(c,22,1,12,6,P.steel);rect(c,24,1,8,2,P.silver);
    gear(c,28,23,14,P.gold,P.goldHighlight,P.copperDark);disc(c,28,23,8,P.deep);rect(c,24,18,8,14,P.steel);
    poly(c,[[13,30],[20,26],[36,26],[43,30],[38,44],[33,54],[28,63],[23,54],[18,44]],P.ink);
    poly(c,[[16,32],[24,29],[28,30],[28,59],[24,51],[20,42]],v?P.blue:P.emerald);
    poly(c,[[28,30],[35,29],[40,32],[36,44],[31,54],[28,60]],P.violetShadow);
    poly(c,[[17,32],[24,30],[27,31],[24,36],[20,39]],P.emeraldLight);
    const shift=f%2;
    poly(c,[[19,39+shift],[36,33+shift],[35,37+shift],[21,44+shift]],P.violetLight);
    poly(c,[[23,49-shift],[33,42-shift],[32,47-shift],[25,54-shift]],P.cabLight);
    rect(c,27,58,2,5,P.shine);rect(c,19,8,7,2,P.goldHighlight);rect(c,30,8,6,2,P.copperDark);
  }
  function projector(c,v,f){
    line(c,25,48,12,61,P.steel,3);line(c,31,48,43,61,P.steel,3);rect(c,25,47,6,16,P.steelDark);
    rect(c,10,61,9,3,P.ink);rect(c,39,61,9,3,P.ink);rect(c,24,61,9,3,P.ink);
    box(c,13,35,31,15,P.copper,P.copperLight,P.copperDark);box(c,16,31,24,7,P.steelDark,P.silver,P.deep);
    disc(c,28,34,9,P.ink);disc(c,28,33,7,P.gold);disc(c,28,32,5,P.cabDark);disc(c,28,31,3,P.cabLight);
    rect(c,17,40,8,5,P.deep);rect(c,18,41,5,2,P.goldLight);rect(c,34,40,5,2,P.rose);rect(c,34,44,5,2,P.steel);
    // Interrupted constellation strokes leave the hologram airy and legible.
    line(c,16,25,22,12,P.cabDark);line(c,23,10,38,14,P.cabDark);line(c,38,15,35,25,P.cabDark);line(c,18,25,33,25,P.cabDark);
    line(c,22,12,28,18,P.cab);line(c,28,18,38,14,P.cab);line(c,28,18,33,25,P.cab);
    star(c,22,11,P.cabLight);star(c,38,14,v?P.violetLight:P.blueLight);star(c,17,25,P.cabLight);star(c,34,25,P.cabLight);
    disc(c,28,18,3,P.blueShadow);rect(c,27,16,2,2,P.shine);if(f%2)star(c,29,5,P.violetLight);
    rect(c,22,28,12,1,P.waterLight);
  }
  function observatory(c,v,f){
    plinth(c,1,56,54);box(c,7,39,42,18,P.copper,P.copperLight,P.copperDark);
    poly(c,[[7,39],[7,31],[11,31],[11,25],[17,25],[17,21],[23,21],[23,19],[33,19],[33,21],[39,21],[39,25],[45,25],[45,31],[49,31],[49,39]],P.ink);
    poly(c,[[10,36],[10,31],[14,31],[14,26],[20,26],[20,23],[26,23],[26,22],[32,22],[32,24],[38,24],[38,28],[44,28],[44,33],[47,33],[47,36]],v?P.blueShadow:P.cabDark);
    poly(c,[[13,31],[17,26],[22,24],[27,23],[27,36],[13,36]],P.cab);rect(c,20,26,3,7,P.cabLight);
    rect(c,27,22,3,15,P.gold);rect(c,11,32,35,2,P.gold);rect(c,8,37,41,3,P.goldLight);
    box(c,21,43,14,14,P.ink,P.copperLight,P.copperDark);rect(c,24,45,8,12,P.cabDark);rect(c,25,46,5,8,P.cabLight);rect(c,29,52,1,2,P.goldLight);
    for(const x of [11,39]){box(c,x,44,6,7,P.cabDark,P.gold,P.copperDark);rect(c,x+2,46,2,3,P.cabLight);}
    poly(c,[[28,18],[31,12],[42,5],[47,9],[36,20]],P.ink);poly(c,[[32,14],[42,7],[45,9],[35,18]],P.gold);line(c,32,14,42,7,P.goldHighlight,2);
    poly(c,[[41,5],[45,3],[50,8],[47,11]],P.steelDark);line(c,44,5,48,9,P.blueLight,2);
    rect(c,7,19,2,20,P.steelDark);rect(c,6,17,4,3,f%2?P.amberLight:P.amber);rect(c,8,14,1,4,P.ink);
  }
  function pickaxe(c,v,f){
    // The wood haft crosses the metal eye; the two tapered points are both metal.
    poly(c,[[28,17],[34,19],[20,60],[16,64],[11,61],[14,55]],P.ink);
    poly(c,[[29,20],[32,21],[18,59],[15,61],[14,59]],P.wood);
    line(c,29,22,16,58,P.woodLight,2);line(c,28,29,18,57,P.copper,1);
    poly(c,[[3,24],[8,16],[18,10],[28,7],[34,8],[44,14],[51,23],[54,31],[48,27],[41,22],[34,19],[27,17],[18,18],[10,20]],P.ink);
    poly(c,[[6,22],[10,17],[20,12],[28,10],[33,11],[43,16],[49,24],[43,21],[34,17],[27,15],[18,16],[11,19]],P.steel);
    poly(c,[[10,17],[20,11],[28,9],[33,10],[42,15],[45,19],[33,14],[26,13],[18,15]],P.silver);
    poly(c,[[6,22],[11,18],[19,16],[16,18],[10,20]],P.shine);
    poly(c,[[35,17],[43,21],[50,27],[47,21],[41,17]],P.steelDark);
    box(c,25,12,10,10,P.gold,P.goldHighlight,P.copperDark);
    rect(c,28,15,4,4,P.woodShadow);rect(c,29,15,2,3,P.woodLight);
    line(c,19,47,22,49,v===2?P.rose:v?P.cab:P.copperDark,2);
    line(c,17,52,20,54,v===2?P.roseLight:v?P.cabLight:P.copperLight,2);
    if(f===2)star(c,15,15,P.shine);
  }
  function gamepad(c,v,f){
    const shell=v===2?P.violetShadow:v?P.blueShadow:P.steelDark;
    // A broad controller body and two distinct curved grips, with no display.
    poly(c,[[7,31],[15,27],[22,29],[34,29],[42,27],[49,31],[53,43],[54,55],[50,62],[44,64],[39,58],[35,52],[21,52],[17,58],[12,64],[6,62],[2,55],[3,42]],P.ink);
    poly(c,[[9,32],[15,30],[22,32],[34,32],[41,30],[47,33],[50,43],[51,54],[48,59],[44,61],[38,51],[34,49],[22,49],[18,51],[11,61],[7,59],[5,54],[6,43]],shell);
    poly(c,[[8,36],[11,32],[16,31],[22,34],[34,34],[41,31],[46,34],[48,38],[39,36],[33,38],[23,38],[16,35],[10,39]],P.steel);
    rect(c,10,27,10,4,P.deep);rect(c,36,27,10,4,P.deep);rect(c,11,27,8,1,P.silver);rect(c,37,27,8,1,P.silver);
    rect(c,12,37,4,14,P.ink);rect(c,7,42,14,4,P.ink);rect(c,13,38,2,11,P.steel);rect(c,9,43,10,2,P.steel);rect(c,13,42,2,3,P.silver);
    disc(c,41,39,3,P.ink);disc(c,47,45,3,P.ink);disc(c,35,45,3,P.ink);disc(c,41,51,3,P.ink);
    rect(c,40,38,3,3,P.rose);rect(c,46,44,3,3,P.goldLight);rect(c,34,44,3,3,P.blue);rect(c,40,50,3,3,P.emerald);
    rect(c,23,41,4,2,P.deep);rect(c,29,41,4,2,P.deep);rect(c,26,36,4,2,f%2?P.cabLight:P.cab);
    line(c,28,28,28,20,P.ink,3);line(c,28,20,33,16,P.ink,3);line(c,33,16,33,11,P.ink,3);line(c,33,11,25,7,P.ink,3);
    line(c,29,27,29,21,P.steel,1);line(c,29,20,34,16,P.steel,1);line(c,34,15,34,12,P.steel,1);
  }
  function quill(c,v,f){
    // A long feather with paired barbs, dipping into a squat glass ink bottle.
    box(c,8,45,29,16,P.blueShadow,P.blue,P.deep);rect(c,11,61,23,3,P.ink);
    poly(c,[[11,46],[15,41],[30,41],[34,46]],P.ink);rect(c,15,39,15,5,P.gold);rect(c,16,39,13,1,P.goldHighlight);rect(c,18,42,9,2,P.ink);
    rect(c,11,48,4,10,P.blue);rect(c,12,48,2,5,P.blueLight);rect(c,19,50,11,7,P.paper);rect(c,23,51,3,5,P.copperDark);
    poly(c,[[21,43],[20,37],[22,29],[28,19],[37,8],[47,2],[48,11],[45,22],[38,30],[29,36],[25,43]],P.ink);
    poly(c,[[23,38],[24,29],[30,20],[38,10],[45,5],[45,12],[41,22],[34,29]],v===2?P.violetLight:P.paperLight);
    poly(c,[[24,38],[31,30],[37,27],[43,20],[42,26],[35,32],[28,36],[25,41]],v===2?P.violet:P.paperShadow);
    line(c,23,41,43,9,P.gold,1);line(c,24,37,42,11,P.fossilLight,1);
    for(const p of [[27,27,31,28],[32,19,36,20],[37,12,40,13],[30,34,30,30],[37,29,36,24]])line(c,p[0],p[1],p[2],p[3],v===2?P.violetShadow:P.paperShadow,1);
    rect(c,20,42,3,4,P.ink);rect(c,21,43,1,2,P.goldHighlight);
    if(f===2)rect(c,13,48,1,3,P.shine);
  }
  function telescope(c,v,f){
    line(c,27,40,8,60,P.ink,4);line(c,29,40,45,60,P.ink,4);line(c,28,40,28,60,P.ink,4);
    line(c,28,43,11,59,P.steel,2);line(c,30,43,46,60,P.steel,2);rect(c,29,44,2,17,P.steel);
    rect(c,7,61,8,3,P.deep);rect(c,43,61,8,3,P.deep);rect(c,26,61,8,3,P.deep);
    box(c,23,33,13,11,P.steelDark,P.silver,P.deep);disc(c,28,38,3,P.gold);rect(c,27,36,2,2,P.goldHighlight);
    poly(c,[[8,31],[34,10],[45,11],[51,18],[48,25],[21,43],[13,40]],P.ink);
    poly(c,[[12,31],[36,13],[42,14],[47,20],[44,24],[20,40],[15,37]],v===2?P.blueShadow:P.copper);
    poly(c,[[13,31],[36,13],[40,14],[17,35]],P.goldLight);poly(c,[[19,37],[44,20],[46,22],[21,40]],P.copperDark);
    line(c,23,23,31,32,P.gold,3);line(c,25,22,33,31,P.goldHighlight,1);
    poly(c,[[35,9],[40,7],[50,15],[53,21],[48,27],[43,25],[38,18]],P.ink);
    poly(c,[[39,10],[42,10],[50,17],[50,21],[47,24],[42,21],[38,16]],P.steel);
    poly(c,[[41,12],[44,13],[48,17],[48,21],[46,22],[42,19],[40,15]],v?P.violetShadow:P.cabDark);
    line(c,41,12,47,17,P.cabLight,2);rect(c,45,19,2,2,P.blue);
    poly(c,[[7,32],[12,29],[18,37],[14,41],[9,39]],P.deep);line(c,8,33,12,38,P.silver,2);
    if(f===2)rect(c,42,12,2,2,P.shine);
  }
  function key(c,v,f){
    // Pierced bow, diagonal shaft and two squared teeth make a genuine key.
    const metal=v===2?P.steel:P.gold,light=v===2?P.silver:P.goldHighlight;
    poly(c,[[18,18],[25,16],[50,44],[51,49],[48,52],[43,49],[20,25]],P.ink);
    poly(c,[[21,20],[24,19],[48,45],[48,48],[45,47]],metal);line(c,23,20,46,45,light,2);
    poly(c,[[38,39],[43,42],[40,46],[44,50],[48,47],[52,51],[48,57],[44,58],[35,48]],P.ink);
    poly(c,[[39,42],[41,44],[38,47],[43,53],[46,50],[49,52],[46,55],[44,55],[37,47]],metal);line(c,39,43,38,46,light,1);
    disc(c,18,17,14,P.ink);disc(c,18,16,12,metal);disc(c,17,15,9,light);disc(c,18,17,8,P.ink);disc(c,18,17,6,P.deep);
    rect(c,6,12,3,6,light);rect(c,15,4,7,2,light);rect(c,24,21,4,3,P.copperDark);
    rect(c,16,1,5,4,P.ink);rect(c,17,2,3,3,metal);
    poly(c,[[12,14],[18,10],[24,14],[24,20],[18,24],[12,20]],P.copperDark);
    poly(c,[[14,15],[18,12],[22,15],[22,19],[18,22],[14,19]],P.ink);
    rect(c,14,13,2,2,light);if(f===2)star(c,9,10,P.shine);
    // Small detached ring tail is deliberately omitted: the silhouette stays one tool.
  }
  function seedling(c,v,f){
    poly(c,[[9,39],[47,39],[44,58],[40,64],[16,64],[12,59]],P.ink);
    poly(c,[[12,42],[44,42],[41,58],[38,61],[18,61],[15,57]],v===2?P.blueShadow:P.copper);
    poly(c,[[14,43],[20,43],[22,60],[18,60],[16,56]],v===2?P.blue:P.copperLight);
    poly(c,[[39,43],[44,42],[41,58],[38,61],[34,61]],v===2?P.deep:P.copperDark);
    box(c,8,36,40,8,v===2?P.blueShadow:P.copper,v===2?P.blueLight:P.copperLight,P.copperDark);rect(c,12,36,32,3,P.woodShadow);rect(c,18,37,21,2,P.earthLight);
    line(c,27,36,27,23,P.mossDark,3);line(c,27,24,33,13,P.mossDark,3);line(c,28,35,28,24,P.mossLight,1);
    poly(c,[[27,28],[20,29],[12,25],[7,16],[16,16],[24,20],[28,25]],P.mossDark);
    poly(c,[[25,25],[20,26],[14,23],[10,18],[17,19],[23,22]],P.emerald);line(c,12,19,25,26,P.mossLight,1);
    poly(c,[[29,22],[29,15],[34,9],[45,6],[45,15],[39,22],[32,24]],P.mossDark);
    poly(c,[[31,20],[32,15],[36,11],[43,9],[42,15],[37,20]],P.emerald);line(c,33,18,40,12,P.emeraldLight,2);
    if(v===1){poly(c,[[29,12],[24,9],[25,4],[29,2],[33,4],[34,9]],P.rose);rect(c,27,5,4,4,P.goldLight);}
    rect(c,22,49,12,7,P.goldShadow);rect(c,24,50,8,5,P.paper);rect(c,27,51,2,3,P.moss);
    if(f===2)rect(c,36,12,2,2,P.cabLight);
  }
  function bridge(c,v){
    // Two open arches, three piers and a timber deck; gaps remain transparent.
    const stone=v===2?P.copperDark:P.steelDark,light=v===2?P.copperLight:P.steel;
    poly(c,[[2,33],[8,28],[48,28],[54,33],[54,40],[2,40]],P.ink);
    poly(c,[[4,32],[9,30],[47,30],[51,32],[48,35],[8,35]],P.woodLight);rect(c,3,36,51,4,P.woodShadow);rect(c,4,36,49,1,P.wood);
    for(const x of [10,18,26,34,42])line(c,x,31,x-1,34,P.wood,1);
    // Arch masonry is drawn as a stepped shell, never a dark painted hole.
    for(const x of [3,26]){
      poly(c,[[x,39],[x+26,39],[x+26,63],[x+19,63],[x+19,49],[x+16,45],[x+10,45],[x+7,49],[x+7,63],[x,63]],P.ink);
      poly(c,[[x+1,40],[x+25,40],[x+25,61],[x+20,61],[x+20,48],[x+17,43],[x+9,43],[x+5,48],[x+5,61],[x+1,61]],stone);
      rect(c,x+1,40,24,2,light);rect(c,x+1,43,3,16,light);rect(c,x+21,47,3,2,P.deep);
      rect(c,x+1,52,4,1,P.deep);rect(c,x+20,55,5,1,P.deep);
    }
    rect(c,2,61,9,3,P.deep);rect(c,24,61,10,3,P.deep);rect(c,46,61,9,3,P.deep);
    // Short parapet posts and continuous handrails read at thumbnail scale.
    for(const x of [4,16,28,40,51]){rect(c,x,21,2,12,P.woodShadow);rect(c,x,21,1,10,P.woodLight);}
    rect(c,4,22,49,2,P.woodShadow);rect(c,4,22,48,1,P.woodLight);rect(c,4,27,49,2,P.wood);
    rect(c,31,56,4,3,P.mossDark);rect(c,33,54,2,3,P.moss);
  }
  function musicbox(c,v,f){
    // Open hinged lid, pinned brass cylinder, comb and winding key.
    poly(c,[[7,32],[7,13],[12,8],[45,10],[49,15],[47,34]],P.ink);
    poly(c,[[10,30],[10,15],[14,11],[43,13],[46,16],[44,31]],P.copperDark);
    poly(c,[[13,28],[13,16],[16,14],[41,16],[43,18],[42,29]],v===2?P.violetShadow:P.cabDark);
    line(c,13,16,41,18,P.gold,1);line(c,13,16,13,27,P.goldLight,1);
    poly(c,[[23,19],[29,17],[35,20],[34,25],[28,27],[22,24]],P.gold);rect(c,26,20,5,4,P.goldHighlight);
    poly(c,[[5,38],[11,31],[44,32],[51,39],[49,59],[44,64],[12,64],[6,59]],P.ink);
    poly(c,[[8,39],[13,34],[42,35],[48,40],[42,45],[14,45]],P.woodShadow);
    rect(c,9,45,38,14,P.copper);rect(c,10,46,6,11,P.copperLight);rect(c,42,46,5,12,P.copperDark);rect(c,13,60,31,3,P.goldShadow);
    rect(c,10,45,36,2,P.goldLight);rect(c,13,57,29,2,P.gold);rect(c,24,48,9,8,P.woodShadow);rect(c,26,49,5,5,P.goldLight);rect(c,28,50,1,3,P.copperDark);
    box(c,17,35,20,8,P.gold,P.goldHighlight,P.amberShadow);rect(c,15,37,25,3,P.steel);
    for(let x=21;x<35;x+=4){rect(c,x,35,1,7,P.copperDark);rect(c,x+(f%2),36,1,2,P.shine);}
    for(let x=18;x<37;x+=3)rect(c,x,42,1,3,P.silver);
    rect(c,48,46,5,2,P.gold);rect(c,51,42,3,9,P.copper);rect(c,50,41,5,3,P.goldLight);
    rect(c,10,31,7,3,P.gold);rect(c,39,32,7,3,P.gold);
    // One musical note above the box, not text or a decorative sparkle cloud.
    rect(c,48,1,2,9,P.goldLight);rect(c,44,8,5,3,P.gold);rect(c,49,1,5,2,P.goldLight);rect(c,52,2,2,4,P.gold);
  }
  const painters={engine,archive,prism,compass,rover,drill,projector,observatory,pickaxe,gamepad,quill,telescope,key,seedling,bridge,musicbox};

  function paintParts(c,recipe,v,f){
    // A real construction state: separated recipe components on a low pallet.
    box(c,5,55,46,7,P.wood,P.woodLight,P.woodShadow);rect(c,8,62,6,2,P.ink);rect(c,42,62,6,2,P.ink);
    rect(c,9,45,37,10,P.paperShadow);rect(c,11,46,32,7,P.paper);line(c,13,50,41,50,P.steel,1);
    if(recipe==='engine'||recipe==='compass'){gear(c,19,42,9,P.gold,P.goldHighlight,P.copperDark);box(c,34,38,12,13,P.copper,P.copperLight,P.copperDark);}
    else if(recipe==='archive'){box(c,12,38,29,11,P.copperDark,P.goldLight,P.woodShadow);rect(c,15,40,23,6,P.paperLight);rect(c,27,39,3,9,P.rose);disc(c,43,49,4,P.amber);}
    else if(recipe==='prism'||recipe==='drill'){crystal(c,20,51,13,23,[P.violetShadow,P.violet,P.violetLight]);crystal(c,36,53,12,17,[P.emeraldShadow,P.emerald,P.emeraldLight]);}
    else if(recipe==='rover'){box(c,14,34,26,15,P.gold,P.goldHighlight,P.goldShadow);box(c,18,36,18,8,P.cabDark,P.cabLight,P.deep);disc(c,12,51,5,P.ink);disc(c,43,51,5,P.ink);}
    else if(recipe==='projector'){box(c,13,37,27,14,P.copper,P.copperLight,P.copperDark);disc(c,39,46,7,P.ink);disc(c,39,46,4,P.cab);rect(c,37,43,2,2,P.shine);}
    else if(recipe==='pickaxe'){line(c,14,52,38,35,P.woodShadow,4);line(c,15,52,38,36,P.woodLight,2);poly(c,[[11,39],[16,33],[25,31],[34,34],[39,40],[29,37],[23,35],[16,37]],P.steel);rect(c,21,32,5,5,P.goldLight);}
    else if(recipe==='gamepad'){box(c,13,36,31,13,P.steelDark,P.steel,P.deep);rect(c,19,39,3,7,P.ink);rect(c,17,41,7,3,P.ink);rect(c,35,40,3,3,P.rose);disc(c,13,51,4,P.ink);disc(c,44,51,4,P.ink);}
    else if(recipe==='quill'){box(c,11,43,14,10,P.blueShadow,P.blueLight,P.deep);poly(c,[[26,50],[28,38],[38,27],[45,26],[43,36],[34,44]],P.paperLight);line(c,25,52,42,30,P.gold,1);}
    else if(recipe==='telescope'){poly(c,[[12,45],[35,32],[44,39],[20,51]],P.copper);line(c,13,45,35,33,P.goldLight,2);disc(c,39,37,6,P.ink);disc(c,39,37,4,P.cab);rect(c,37,34,3,2,P.cabLight);}
    else if(recipe==='key'){disc(c,19,41,9,P.gold);disc(c,19,41,5,P.ink);line(c,29,47,44,47,P.gold,3);rect(c,39,49,3,4,P.goldLight);}
    else if(recipe==='seedling'){box(c,14,42,28,11,P.copper,P.copperLight,P.copperDark);rect(c,16,43,24,3,P.woodShadow);disc(c,27,39,4,P.amberShadow);rect(c,26,36,3,3,P.goldLight);rect(c,36,38,3,4,P.moss);}
    else if(recipe==='bridge'){for(let i=0;i<3;i++)box(c,12+i*10,41+i%2*4,9,10,P.steelDark,P.steel,P.deep);line(c,14,38,41,35,P.woodLight,3);}
    else if(recipe==='musicbox'){box(c,13,38,29,14,P.copper,P.copperLight,P.copperDark);box(c,18,34,17,7,P.gold,P.goldHighlight,P.amberShadow);gear(c,43,47,5,P.gold,P.goldHighlight,P.copperDark);}
    else {poly(c,[[11,49],[11,42],[15,42],[15,37],[21,37],[21,34],[32,34],[32,37],[38,37],[38,42],[42,42],[42,49]],P.cabDark);rect(c,16,43,20,3,P.gold);box(c,37,48,10,6,P.copper,P.copperLight,P.copperDark);}
  }

  function rootBranch(c,points,width){
    for(let i=0;i+1<points.length;i++){line(c,points[i][0],points[i][1],points[i+1][0],points[i+1][1],P.woodShadow,width);line(c,points[i][0]+1,points[i][1],points[i+1][0]+1,points[i+1][1],P.wood,Math.max(1,width-3));}
  }
  function mushroom(c,x,y,size,bright){
    rect(c,x-1,y-size,3,size,P.fossil);rect(c,x,y-size+1,1,size-2,P.fossilLight);
    poly(c,[[x-size,y-size],[x-size,y-size-3],[x-size+3,y-size-3],[x-size+3,y-size-6],[x-2,y-size-8],[x+3,y-size-8],[x+size-2,y-size-4],[x+size,y-size-4],[x+size,y-size]],bright?P.roseDark:P.mossDark);
    poly(c,[[x-size+2,y-size-3],[x-size+4,y-size-5],[x-2,y-size-7],[x+3,y-size-6],[x+size-2,y-size-3]],bright?P.rose:P.moss);
    rect(c,x-3,y-size-6,3,2,bright?P.roseLight:P.mossLight);rect(c,x+3,y-size-3,2,2,P.fossilLight);
  }
  function roots(c,v,f){
    poly(c,[[1,81],[7,76],[19,76],[19,72],[37,72],[45,76],[65,75],[73,79],[92,79],[95,85],[90,88],[5,88]],P.mossDark);
    poly(c,[[6,78],[20,76],[35,76],[40,79],[62,78],[70,81],[85,81],[91,84],[61,84],[48,82],[26,82],[12,83]],P.moss);
    const start=v?65:21,other=v?28:75;
    rootBranch(c,[[start,3],[start-8,19],[start-3,37],[start-13,57],[start-7,77]],9);
    rootBranch(c,[[start-5,22],[start+12,27],[start+22,40],[other,54],[other+5,77]],6);
    rootBranch(c,[[start-1,42],[start+9,51],[start+4,66],[start+16,79]],4);
    rootBranch(c,[[start-10,56],[start-19,65],[start-20,78]],4);
    poly(c,[[start-7,10],[start-11,18],[start-8,23],[start-4,18],[start-1,9]],P.moss);rect(c,start-7,11,3,7,P.mossLight);
    mushroom(c,v?15:66,80,10,true);mushroom(c,v?36:82,82,6,true);mushroom(c,v?84:11,81,5,false);
    // A single embedded rib fossil; the pale ribs stay a connected motif.
    const fx=v?54:33;
    poly(c,[[fx-9,74],[fx-7,62],[fx,56],[fx+12,59],[fx+16,68],[fx+12,79],[fx-3,81]],P.earthShadow);
    line(c,fx-3,64,fx+8,74,P.fossilDark,2);line(c,fx-2,63,fx+8,72,P.fossil,1);
    for(let i=0;i<4;i++){const rx=fx-2+i*3,ry=63+i*3;line(c,rx,ry,rx+3,ry-3,P.fossil,2);line(c,rx,ry+2,rx-3,ry+3,P.fossilDark,2);}
    rect(c,fx+8,72,4,3,P.fossilLight);
    rect(c,v?76:42,78,5,3,P.mossLight);rect(c,v?79:45,75,2,5,P.moss);
  }
  function fish(c,x,y,face,f){
    rect(c,x,y,8,3,P.waterLight);rect(c,x+2,y-1,4,5,P.cab);rect(c,x+(face?0:6),y,2,2,P.foam);
    poly(c,face?[[x+8,y+1],[x+12,y-2],[x+12,y+4]]:[[x,y+1],[x-4,y-2],[x-4,y+4]],P.blueShadow);rect(c,x+(face?1:6),y,1,1,P.ink);
  }
  function aquifer(c,v,f){
    poly(c,[[1,76],[8,68],[20,64],[70,64],[85,68],[95,76],[91,84],[78,88],[16,88],[4,84]],P.ink);
    poly(c,[[5,75],[16,68],[72,68],[88,73],[90,80],[79,85],[19,85],[7,81]],P.waterDark);
    poly(c,[[9,75],[23,70],[67,70],[80,73],[84,78],[74,82],[24,82],[13,79]],P.water);
    const wx=v?64:24;
    poly(c,[[wx-18,18],[wx-12,8],[wx+10,8],[wx+20,16],[wx+19,25],[wx+10,29],[wx-17,26]],P.tealShadow);
    poly(c,[[wx-15,16],[wx-9,10],[wx+9,10],[wx+16,16],[wx+11,21],[wx-12,21]],P.tealLight);
    poly(c,[[wx-10,23],[wx+9,23],[wx+7,62],[wx+12,72],[wx+7,77],[wx-8,77],[wx-13,72],[wx-7,62]],P.water);
    rect(c,wx-7,23,5,43,P.waterLight);rect(c,wx-5,24,2,22,P.foam);rect(c,wx+3,26,2,34,P.cab);
    rect(c,wx-3,47+f%3*3,3,11,P.foam);rect(c,wx-8,68,16,2,P.cab);rect(c,wx-12,73,24,2,P.foam);
    const rx=v?16:69;
    poly(c,[[rx-11,72],[rx-9,57],[rx-3,53],[rx+9,54],[rx+15,65],[rx+11,76]],P.tealShadow);
    poly(c,[[rx-8,59],[rx-2,55],[rx+7,56],[rx+11,64],[rx-2,65]],P.teal);rect(c,rx-5,56,9,2,P.tealLight);
    rect(c,16,80,16,1,P.waterLight);rect(c,53,82,18,1,P.waterLight);
    fish(c,v?36:49,75,f%2,f);fish(c,v?73:24,80,1,0);
    poly(c,[[wx+13,13],[wx+18,13],[wx+18,23],[wx+16,30],[wx+14,30]],P.mossDark);rect(c,wx+14,14,2,9,P.moss);
  }
  function crystalCave(c,v,f){
    poly(c,[[3,70],[9,51],[14,24],[29,11],[49,7],[72,17],[85,38],[92,68],[87,84],[70,88],[16,88]],P.shaleShadow);
    poly(c,[[12,66],[18,36],[31,22],[53,17],[71,29],[81,50],[82,73],[69,82],[22,81]],P.ink);
    poly(c,[[4,72],[13,69],[22,75],[39,78],[69,75],[84,67],[92,72],[87,84],[70,88],[17,88]],P.shale);
    poly(c,[[12,29],[28,14],[49,8],[60,12],[36,17],[22,31],[17,48],[11,51]],P.shaleLight);
    if(!v){
      crystal(c,38,78,22,61,[P.violetShadow,P.violet,P.violetLight]);
      crystal(c,63,80,23,43,[P.blueShadow,P.blue,P.blueLight]);
      crystal(c,24,82,17,29,[P.emeraldShadow,P.cab,P.cabLight]);
      crystal(c,77,81,13,24,[P.violetShadow,P.violet,P.violetLight]);
      if(f%2)star(c,34,30,P.shine);
    } else {
      crystal(c,50,81,25,52,[P.blueShadow,P.cab,P.cabLight]);
      crystal(c,27,79,19,39,[P.violetShadow,P.violet,P.violetLight]);
      crystal(c,72,80,17,47,[P.violetShadow,P.violet,P.violetLight]);
      poly(c,[[36,20],[43,19],[40,36]],P.violet);poly(c,[[56,21],[65,25],[58,39]],P.blue);rect(c,38,21,2,7,P.violetLight);
      if(f%2)star(c,48,42,P.shine);
    }
    rect(c,22,84,17,2,P.shaleLight);rect(c,63,84,12,2,P.shaleShadow);
  }
  function ruins(c,v,f){
    poly(c,[[1,81],[12,74],[27,76],[35,70],[63,73],[83,72],[95,82],[90,88],[6,88]],P.bedrockShadow);
    // Broken rails have one continuous perspective, with only three sleepers.
    for(let i=0;i<3;i++){const x=9+i*27;poly(c,[[x,79],[x+11,73],[x+21,76],[x+9,84]],P.woodShadow);line(c,x+2,79,x+12,74,P.wood,2);}
    line(c,7,80,84,69,P.steelDark,3);line(c,7,79,84,68,P.steel,1);line(c,14,85,90,76,P.steelDark,3);line(c,14,84,90,75,P.steel,1);
    const gx=v?69:28;
    gear(c,gx,50,21,P.copperDark,P.copper,P.woodShadow);disc(c,gx,50,11,P.ink);disc(c,gx,50,7,P.steelDark);rect(c,gx-2,47,5,7,P.steel);
    rect(c,gx-13,33,6,3,P.copperLight);rect(c,gx+12,48,3,8,P.copper);rect(c,gx-5,64,8,2,P.copper);
    const bx=v?14:58;
    box(c,bx,37,23,35,P.steelDark,P.steel,P.deep);rect(c,bx+2,41,18,6,P.copperDark);rect(c,bx+5,43,7,2,P.copperLight);
    box(c,bx+4,51,15,13,P.deep,P.copper,P.ink);rect(c,bx+7,54,9,5,P.cabDark);rect(c,bx+8,54,3,2,P.cab);
    rect(c,bx+7,25,7,13,P.copperDark);rect(c,bx+9,24,13,4,P.copper);rect(c,bx+12,25,10,1,P.copperLight);
    rect(c,bx+21,26,3,8,P.copperDark);rect(c,bx+6,67,5,3,P.copper);
    poly(c,[[gx-14,35],[gx-9,33],[gx-8,41],[gx-11,45],[gx-12,53],[gx-15,53]],P.mossDark);rect(c,gx-13,36,2,7,P.moss);
    poly(c,[[bx+2,72],[bx+6,68],[bx+12,68],[bx+15,72],[bx+21,73],[bx+20,76],[bx+7,76]],P.mossDark);rect(c,bx+8,70,5,2,P.moss);
  }
  const environmentPainters={roots,aquifer,crystal:crystalCave,ruins};

  // Small terrain props share one cold outline and a thin contact shadow. They
  // are authored at scene scale, without the repeated display plinth of a trophy.
  function contact(c,left=5,right=27){
    poly(c,[[left,29],[left+4,28],[right-4,28],[right,29],[right-2,31],[left+3,32]],P.deep);
  }
  function dressingRoots(c,v){
    if(v===0){
      contact(c,8,29);rootBranch(c,[[13,2],[11,10],[15,19],[10,28]],4);
      rootBranch(c,[[13,12],[23,17],[27,28]],3);rootBranch(c,[[15,19],[20,24],[19,29]],3);
      rect(c,12,4,2,5,P.moss);rect(c,23,25,3,3,P.mossDark);
    }else if(v===1){
      contact(c,2,30);poly(c,[[3,27],[6,21],[13,20],[16,17],[24,19],[28,24],[29,28],[22,30],[9,30]],P.mossDark);
      poly(c,[[6,24],[10,21],[15,23],[19,20],[24,22],[25,26],[18,27],[10,28]],P.moss);
      rect(c,10,22,5,2,P.mossLight);rect(c,20,23,3,2,P.mossLight);
    }else if(v===2){
      contact(c,3,30);mushroom(c,12,29,7,true);mushroom(c,24,29,4,false);
      poly(c,[[2,29],[7,26],[9,28],[19,28],[22,26],[27,28],[30,30],[27,32],[5,32]],P.mossDark);
      rect(c,6,28,3,2,P.moss);
    }else if(v===3){
      contact(c,3,29);poly(c,[[9,13],[14,13],[14,16],[21,14],[24,21],[22,28],[18,30],[9,28],[7,23]],P.woodShadow);
      poly(c,[[10,16],[15,17],[20,16],[22,21],[20,27],[11,26],[9,22]],P.copperDark);
      rect(c,10,18,3,6,P.copper);rect(c,11,16,3,2,P.copperLight);rect(c,10,24,10,1,P.wood);
      poly(c,[[24,28],[29,25],[31,28],[28,31]],P.copperDark);rect(c,26,27,3,1,P.copper);
    }else if(v===4){
      contact(c,3,29);poly(c,[[4,24],[7,15],[16,11],[25,16],[28,25],[23,30],[9,30]],P.earthShadow);
      poly(c,[[7,22],[10,16],[16,14],[23,18],[24,26],[18,28],[10,27]],P.earth);
      line(c,11,19,21,25,P.fossilDark,2);
      for(let i=0;i<3;i++){line(c,12+i*3,19+i*2,15+i*3,17+i*2,P.fossil,2);line(c,13+i*3,21+i*2,11+i*3,23+i*2,P.fossilDark,1);}
      rect(c,21,24,3,2,P.fossil);
    }else{
      contact(c,7,26);line(c,16,29,17,9,P.mossDark,2);
      for(let i=0;i<4;i++){const y=12+i*4,w=4+i;poly(c,[[17,y+3],[17-w,y],[15-w,y],[17-w,y+3],[17,y+5]],P.moss);poly(c,[[18,y+3],[20+w,y],[22+w,y],[19+w,y+4],[18,y+5]],P.mossDark);}
      rect(c,16,10,2,4,P.mossLight);rect(c,11,20,3,1,P.mossLight);
    }
  }
  function dressingAquifer(c,v,f){
    if(v===0){
      poly(c,[[4,28],[10,25],[24,26],[29,29],[23,32],[8,31]],P.waterDark);rect(c,10,28,12,1,P.water);
      poly(c,[[10,3],[20,3],[23,7],[19,10],[11,8]],P.tealShadow);rect(c,12,4,7,2,P.teal);
      const y=10+f*4;poly(c,[[16,y],[18,y+3],[17,y+5],[14,y+5],[13,y+3]],P.waterLight);rect(c,14,y+2,1,2,P.foam);
      if(f===3){rect(c,11,27,3,1,P.waterLight);rect(c,21,28,3,1,P.waterLight);}
    }else if(v===1){
      contact(c,1,31);poly(c,[[2,27],[6,21],[14,18],[25,20],[30,25],[29,29],[22,32],[6,31]],P.tealShadow);
      poly(c,[[6,25],[12,22],[22,23],[27,26],[24,30],[10,30]],P.waterDark);rect(c,10,25,10,2,P.water);
      poly(c,[[5,24],[9,20],[17,19],[15,22],[9,24]],P.tealLight);rect(c,18,28,5,1,P.waterLight);
    }else if(v===2){
      contact(c,5,28);poly(c,[[6,27],[9,20],[23,21],[28,28],[21,31],[10,31]],P.tealShadow);
      crystal(c,12,29,8,13,[P.tealLight,P.steel,P.silver]);crystal(c,21,29,9,18,[P.tealLight,P.steel,P.silver]);
      rect(c,5,28,6,3,P.teal);rect(c,22,29,5,2,P.teal);
    }else if(v===3){
      contact(c,4,29);poly(c,[[4,28],[9,25],[22,26],[26,24],[29,26],[27,29],[8,31]],P.cabDark);
      disc(c,16,22,8,P.tealShadow);disc(c,15,21,6,P.tealLight);disc(c,16,22,4,P.tealShadow);rect(c,15,20,3,2,P.steel);rect(c,17,22,2,3,P.tealLight);
      line(c,25,26,27,22,P.cab,1);line(c,26,27,30,24,P.cab,1);
    }else if(v===4){
      contact(c,4,28);poly(c,[[6,29],[9,24],[23,25],[27,30],[22,32],[9,32]],P.tealShadow);
      line(c,13,28,10,9,P.mossDark,2);line(c,19,29,21,7,P.moss,1);line(c,16,28,16,13,P.moss,2);
      rect(c,9,7,3,7,P.copperDark);rect(c,20,5,3,7,P.wood);rect(c,15,12,3,6,P.mossDark);
      line(c,18,26,25,17,P.cabDark,2);line(c,13,25,7,18,P.cabDark,2);
    }else{
      contact(c,5,28);poly(c,[[6,30],[9,23],[11,23],[12,14],[15,8],[18,14],[19,24],[23,21],[26,26],[28,30]],P.tealShadow);
      poly(c,[[10,28],[13,22],[13,15],[15,11],[16,24],[18,29]],P.tealLight);rect(c,14,16,1,7,P.steel);rect(c,22,26,3,3,P.teal);
    }
  }
  function dressingCrystal(c,v){
    if(v===0){
      contact(c,5,27);crystal(c,13,30,10,18,[P.violetShadow,P.violet,P.violetLight]);crystal(c,23,30,7,11,[P.blueShadow,P.cabDark,P.cab]);
      rect(c,8,29,8,3,P.shaleShadow);rect(c,19,30,8,2,P.shale);
    }else if(v===1){
      contact(c,2,30);poly(c,[[3,27],[7,15],[15,11],[24,15],[30,25],[24,31],[8,31]],P.shaleShadow);
      poly(c,[[8,23],[13,17],[18,18],[23,24],[19,28],[11,27]],P.deep);
      crystal(c,13,27,7,12,[P.violetShadow,P.violet,P.violet]);crystal(c,21,28,7,10,[P.blueShadow,P.cabDark,P.cab]);
      poly(c,[[3,27],[10,25],[15,28],[24,28],[27,31],[8,31]],P.shale);
    }else if(v===2){
      contact(c,2,30);poly(c,[[3,29],[5,23],[10,22],[14,18],[20,19],[24,23],[29,25],[30,30],[17,32],[7,31]],P.shaleShadow);
      poly(c,[[6,26],[11,24],[15,21],[19,23],[22,27],[27,27],[26,30],[12,30]],P.violetShadow);
      rect(c,11,24,4,2,P.shaleLight);rect(c,20,27,3,2,P.shaleLight);
    }else if(v===3){
      contact(c,2,31);poly(c,[[3,27],[20,17],[28,20],[29,25],[10,31]],P.deep);
      poly(c,[[5,27],[20,19],[25,20],[10,29]],P.cabDark);poly(c,[[10,29],[25,20],[27,23],[11,30]],P.blueShadow);
      line(c,8,25,20,19,P.cab,1);rect(c,3,29,7,3,P.shaleShadow);rect(c,24,27,6,3,P.shaleShadow);
    }else if(v===4){
      contact(c,3,29);poly(c,[[4,23],[8,15],[16,12],[24,15],[28,24],[25,29],[9,31]],P.shaleShadow);
      poly(c,[[8,23],[11,18],[16,16],[22,19],[24,24],[20,28],[11,27]],P.deep);
      poly(c,[[9,20],[13,17],[14,22],[11,24]],P.violetShadow);poly(c,[[18,26],[22,22],[24,26],[20,28]],P.cabDark);
      rect(c,10,19,2,2,P.violet);rect(c,20,25,2,2,P.cab);rect(c,6,24,2,4,P.shaleLight);
    }else{
      contact(c,4,29);box(c,8,20,12,10,P.violetShadow,P.shaleLight,P.shaleShadow);box(c,17,24,11,7,P.shale,P.shaleLight,P.shaleShadow);
      box(c,12,13,10,9,P.shaleShadow,P.violetShadow,P.deep);rect(c,14,15,5,2,P.shaleLight);rect(c,9,29,14,3,P.shaleShadow);
    }
  }
  function dressingRuins(c,v,f){
    if(v===0){
      contact(c,4,28);poly(c,[[7,28],[7,13],[10,9],[23,9],[26,12],[26,17],[20,17],[20,15],[13,15],[13,28]],P.woodShadow);
      rect(c,9,14,3,13,P.copperDark);rect(c,11,11,12,3,P.copper);rect(c,12,11,9,1,P.copperLight);
      box(c,5,24,11,5,P.steelDark,P.steel,P.deep);rect(c,21,14,6,3,P.deep);rect(c,20,14,2,4,P.copperDark);
    }else if(v===1){
      contact(c,7,26);line(c,18,4,18,11,P.steelDark,2);line(c,18,4,25,4,P.steelDark,2);
      box(c,10,12,15,17,P.woodShadow,P.steel,P.deep);rect(c,12,16,11,10,P.goldShadow);rect(c,14,17,7,7,f===2?P.goldLight:P.amber);rect(c,15,17,3,5,P.amberLight);
      rect(c,11,12,13,3,P.steelDark);rect(c,13,10,9,2,P.steel);rect(c,14,28,7,3,P.woodShadow);
    }else if(v===2){
      contact(c,3,30);box(c,4,20,25,11,P.steelDark,P.steel,P.deep);rect(c,6,20,21,3,P.copperDark);rect(c,7,20,11,1,P.copper);
      rect(c,12,16,9,2,P.deep);rect(c,11,17,2,4,P.steelDark);rect(c,20,17,2,4,P.steelDark);
      rect(c,15,23,4,4,P.gold);rect(c,7,26,3,3,P.copperDark);rect(c,25,23,2,6,P.deep);
    }else if(v===3){
      contact(c,3,29);poly(c,[[4,21],[8,21],[8,17],[13,15],[18,16],[18,19],[23,21],[27,20],[29,25],[26,28],[22,31],[17,30],[17,27],[12,26],[8,28],[4,25]],P.woodShadow);
      poly(c,[[8,22],[11,18],[16,18],[17,22],[23,24],[24,28],[20,29],[16,25],[11,24]],P.copperDark);rect(c,11,18,4,2,P.copper);rect(c,22,25,3,2,P.copper);
    }else if(v===4){
      contact(c,2,31);line(c,5,28,26,19,P.woodShadow,3);line(c,8,31,27,24,P.woodShadow,1);
      line(c,5,21,24,29,P.steelDark,3);line(c,5,21,24,29,P.steel,1);line(c,11,17,29,24,P.steelDark,3);line(c,11,17,29,24,P.steel,1);
      rect(c,4,27,4,2,P.copperDark);rect(c,22,27,3,2,P.copperDark);
    }else{
      contact(c,7,26);rect(c,14,22,6,8,P.steelDark);rect(c,15,24,3,6,P.copperDark);rect(c,18,27,8,3,P.copperDark);
      disc(c,16,17,9,P.deep);disc(c,16,16,7,P.steelDark);disc(c,16,16,5,P.fossilDark);disc(c,16,16,4,P.paperShadow);
      line(c,16,17,19,13,P.roseDark,1);rect(c,15,16,2,2,P.deep);rect(c,11,13,2,2,P.fossil);
    }
  }
  const dressingPainters={roots:dressingRoots,aquifer:dressingAquifer,crystal:dressingCrystal,ruins:dressingRuins};
  function seam(c,b,v){
    const ramp=b==='roots'?[P.earthShadow,P.earthLight]:b==='aquifer'?[P.tealShadow,P.tealLight]:b==='crystal'?[P.shaleShadow,P.shaleLight]:[P.bedrockShadow,P.bedrockLight];
    const shapes=[
      [[1,6],[8,5],[11,3],[18,4],[23,3],[22,5],[15,6],[10,6],[7,8],[2,8]],
      [[2,3],[8,4],[11,7],[18,7],[23,9],[21,11],[16,9],[9,9],[6,6],[1,5]],
      [[0,8],[7,7],[12,4],[20,3],[23,4],[18,5],[13,6],[8,9],[1,10]],
      [[2,7],[8,6],[9,2],[12,1],[11,6],[17,8],[22,7],[24,9],[17,10],[10,8],[4,9]]
    ];
    poly(c,shapes[v],ramp[0]);
    const lips=[[3,5,4,1],[3,3,4,1],[14,3,5,1],[3,6,4,1]][v];rect(c,...lips,ramp[1]);
    if(b==='roots'&&v===3)rect(c,10,3,1,3,P.woodShadow);
    if(b==='aquifer'&&v===1)rect(c,13,8,4,1,P.cabDark);
    if(b==='crystal'&&v===2)rect(c,14,5,3,1,P.violetShadow);
    if(b==='ruins'&&v===0)rect(c,15,5,3,1,P.steelDark);
  }

  // The compact relics are redrawn, not half-sampled inventory illustrations.
  // Their 32px silhouette leaves the 36x47 machine as the scene's largest prop.
  function relic(c,r,v,f,assembled){
    contact(c,5,28);
    if(r==='engine'){
      box(c,3,9,8,17,P.copper,P.copperLight,P.copperDark);box(c,22,9,7,17,P.copper,P.copperLight,P.copperDark);
      box(c,2,6,10,5,P.steelDark,P.steel,P.deep);box(c,21,6,10,5,P.steelDark,P.steel,P.deep);
      gear(c,16,20,9,P.gold,P.goldHighlight,P.copperDark);disc(c,16,20,5,P.deep);disc(c,15,19,3,v?P.blue:P.emerald);rect(c,14,17,2,2,P.cabLight);rect(c,8,28,18,3,P.steelDark);
    }else if(r==='archive'){
      poly(c,[[2,9],[12,10],[16,13],[21,10],[29,9],[29,25],[20,27],[16,30],[12,27],[2,25]],P.copperDark);
      poly(c,[[4,8],[11,9],[15,12],[15,26],[10,23],[4,22]],P.paperLight);poly(c,[[17,12],[22,9],[27,8],[27,22],[21,24],[17,27]],P.paper);
      rect(c,15,12,2,17,P.gold);rect(c,6,13,6,1,P.paperShadow);rect(c,6,17,6,1,P.paperShadow);rect(c,20,14,5,1,P.paperShadow);rect(c,22,10,2,9,v?P.violet:P.rose);
      poly(c,[[11,10],[13,3],[19,1],[17,6]],P.fossilLight);disc(c,16,27,3,P.amber);
    }else if(r==='prism'){
      poly(c,[[8,11],[16,1],[25,11],[22,26],[16,29],[10,25]],P.deep);poly(c,[[10,11],[16,4],[16,26],[12,24]],P.cab);poly(c,[[16,4],[23,12],[20,24],[16,26]],P.violetShadow);
      poly(c,[[11,11],[15,5],[15,12],[11,17]],P.cabLight);rect(c,9,11,15,2,P.gold);rect(c,11,25,11,3,P.gold);rect(c,10,29,14,2,P.steelDark);rect(c,17,15,3,6,P.violet);
    }else if(r==='compass'){
      disc(c,16,17,13,P.deep);disc(c,16,16,11,P.gold);disc(c,16,17,9,P.deep);rect(c,14,2,5,3,P.gold);
      rect(c,7,16,3,1,P.paper);rect(c,23,16,3,1,P.paper);rect(c,15,7,1,3,P.paper);rect(c,15,24,1,3,P.paper);
      poly(c,[[16,7],[20,17],[16,20],[12,17]],v?P.emerald:P.rose);poly(c,[[16,27],[12,17],[16,14],[20,17]],P.blueLight);rect(c,15,16,3,3,P.goldHighlight);
    }else if(r==='rover'){
      box(c,3,21,7,10,P.deep,P.steel,P.ink);box(c,23,21,7,10,P.deep,P.steel,P.ink);box(c,8,17,17,11,P.gold,P.goldLight,P.goldShadow);
      box(c,10,9,13,10,P.cabDark,P.steel,P.deep);rect(c,12,12,3,4,P.cabLight);rect(c,18,12,3,4,P.cabLight);rect(c,16,19,3,2,P.shine);
      rect(c,15,5,3,5,P.steel);box(c,13,2,12,5,P.steelDark,P.silver,P.deep);rect(c,22,3,2,3,P.blue);
      line(c,8,20,3,17,P.steel,1);line(c,25,20,29,16,P.steel,1);rect(c,5,9,1,9,P.steelDark);rect(c,4,7,3,3,f===2?P.amberLight:P.amber);
    }else if(r==='drill'){
      box(c,11,1,11,7,P.copper,P.copperLight,P.copperDark);gear(c,16,11,8,P.gold,P.goldHighlight,P.copperDark);
      poly(c,[[7,16],[25,16],[22,24],[16,32],[10,24]],P.deep);poly(c,[[9,17],[16,17],[16,29],[12,24]],P.emerald);poly(c,[[16,17],[23,17],[20,24],[16,29]],P.violetShadow);
      poly(c,[[11,21],[22,18],[21,21],[13,25]],P.violetLight);rect(c,15,29,2,3,P.cabLight);
    }else if(r==='projector'){
      line(c,14,25,7,29,P.steel,2);line(c,18,25,26,29,P.steel,2);rect(c,15,24,3,7,P.steelDark);
      box(c,6,18,21,9,P.copper,P.copperLight,P.copperDark);disc(c,16,18,5,P.gold);disc(c,16,17,3,P.cabDark);rect(c,15,15,2,3,P.cabLight);
      line(c,10,7,21,10,P.cabDark,1);line(c,21,10,16,4,P.cabDark,1);line(c,10,7,16,4,P.cabDark,1);star(c,10,7,P.cab);star(c,21,10,P.cabLight);rect(c,16,3,2,2,P.violetLight);
    }else if(r==='observatory'){
      box(c,4,20,25,11,P.copper,P.copperLight,P.copperDark);poly(c,[[5,20],[5,15],[9,11],[14,9],[20,9],[26,14],[28,20]],P.deep);
      poly(c,[[7,18],[10,13],[15,11],[21,12],[25,16],[25,19]],P.cabDark);rect(c,11,13,4,5,P.cab);rect(c,16,11,2,9,P.gold);rect(c,5,19,24,2,P.goldLight);
      rect(c,13,24,8,7,P.deep);rect(c,15,25,4,6,P.cabLight);rect(c,7,24,3,3,P.cab);rect(c,24,24,3,3,P.cab);
      line(c,18,9,25,3,P.gold,3);line(c,18,9,25,3,P.goldLight,1);line(c,25,2,28,5,P.steel,2);
    }else if(r==='pickaxe'){
      line(c,17,11,8,28,P.woodShadow,3);line(c,18,12,9,28,P.woodLight,1);
      poly(c,[[1,13],[6,7],[15,4],[21,6],[28,12],[31,17],[22,12],[16,10],[9,10]],P.deep);
      poly(c,[[4,11],[8,7],[15,6],[20,7],[25,11],[17,8],[10,8]],P.silver);poly(c,[[19,9],[25,12],[28,15],[23,12]],P.steel);
      box(c,14,6,7,7,P.gold,P.goldHighlight,P.copperDark);rect(c,16,8,3,3,P.wood);
    }else if(r==='gamepad'){
      poly(c,[[3,17],[8,13],[13,15],[20,15],[25,13],[29,18],[31,27],[27,31],[23,29],[20,25],[12,25],[9,29],[5,31],[1,27]],P.deep);
      poly(c,[[5,18],[9,16],[13,18],[20,18],[25,16],[27,19],[28,26],[26,28],[22,23],[11,23],[7,28],[4,26]],P.steelDark);
      poly(c,[[6,18],[9,16],[13,18],[20,18],[24,16],[27,19],[24,18],[20,20],[12,20],[9,18]],P.steel);
      rect(c,7,18,2,7,P.ink);rect(c,5,20,6,2,P.ink);rect(c,23,19,2,2,P.rose);rect(c,26,22,2,2,P.gold);rect(c,20,22,2,2,P.blue);rect(c,23,25,2,2,P.emerald);
      line(c,16,15,16,8,P.steelDark,2);line(c,16,8,20,5,P.steelDark,2);
    }else if(r==='quill'){
      box(c,4,23,16,8,P.blueShadow,P.blue,P.deep);rect(c,8,20,9,4,P.goldShadow);rect(c,9,20,7,1,P.gold);rect(c,7,25,2,4,P.blueLight);
      poly(c,[[13,23],[15,14],[22,5],[29,1],[28,10],[24,17],[18,21]],P.paperShadow);poly(c,[[15,19],[17,13],[23,6],[27,4],[25,11],[20,16]],P.paperLight);
      line(c,13,24,25,7,P.gold,1);rect(c,11,25,5,4,P.paper);
    }else if(r==='telescope'){
      line(c,16,18,6,29,P.steelDark,2);line(c,17,18,27,29,P.steelDark,2);rect(c,16,20,2,11,P.steel);
      poly(c,[[3,15],[22,3],[29,7],[28,13],[10,24],[5,21]],P.deep);poly(c,[[6,15],[22,6],[26,8],[25,12],[11,21]],P.copper);
      line(c,7,15,22,6,P.goldLight,2);line(c,13,11,18,17,P.gold,2);line(c,23,4,29,9,P.steel,2);line(c,24,6,28,9,P.cabLight,1);
    }else if(r==='key'){
      poly(c,[[20,22],[23,25],[18,29],[15,27]],P.gold);poly(c,[[25,26],[29,29],[25,32],[21,30]],P.gold);
      line(c,12,13,26,27,P.goldShadow,3);line(c,13,13,27,27,P.goldLight,2);
      disc(c,10,10,9,P.deep);disc(c,10,9,7,P.gold);disc(c,10,10,4,P.deep);rect(c,5,5,4,2,P.goldHighlight);rect(c,9,1,3,2,P.gold);
    }else if(r==='seedling'){
      poly(c,[[7,22],[25,22],[23,31],[10,31]],P.copperDark);poly(c,[[9,23],[23,23],[21,29],[11,29]],P.copper);rect(c,6,20,20,4,P.copperLight);rect(c,8,20,16,1,P.woodShadow);
      line(c,16,20,16,10,P.mossDark,2);poly(c,[[16,16],[8,14],[5,8],[12,9],[17,13]],P.moss);poly(c,[[17,12],[18,6],[26,3],[25,9],[21,13]],P.emerald);line(c,19,10,24,6,P.emeraldLight,1);
    }else if(r==='bridge'){
      rect(c,2,14,28,5,P.woodShadow);rect(c,3,14,26,2,P.woodLight);
      for(const x of [3,15]){poly(c,[[x,19],[x+14,19],[x+14,30],[x+10,30],[x+10,24],[x+8,22],[x+6,22],[x+4,24],[x+4,30],[x,30]],P.steelDark);rect(c,x,19,14,2,P.steel);}
      for(const x of [3,10,18,27])rect(c,x,8,1,7,P.wood);rect(c,3,8,25,1,P.woodLight);rect(c,3,11,25,1,P.wood);
    }else{
      poly(c,[[5,18],[5,8],[9,5],[26,7],[28,10],[27,20]],P.copperDark);poly(c,[[8,16],[8,9],[24,10],[25,17]],P.cabDark);rect(c,13,10,7,5,P.gold);
      box(c,4,20,25,11,P.copper,P.copperLight,P.copperDark);rect(c,7,19,19,4,P.woodShadow);box(c,9,18,14,4,P.gold,P.goldHighlight,P.goldShadow);rect(c,14,25,5,4,P.goldLight);
      for(const x of [12,16,20])rect(c,x,18,1,6,P.steel);rect(c,28,24,3,2,P.gold);rect(c,25,1,2,4,P.gold);rect(c,23,4,3,2,P.gold);
    }
    if(!assembled){
      // In-scene unfinished finds remain partly embedded instead of on a shelf.
      poly(c,[[2,27],[8,25],[12,28],[19,26],[24,28],[30,26],[31,31],[26,32],[5,32]],P.deep);
      poly(c,[[6,28],[12,29],[18,28],[22,30],[9,31]],P.steelDark);
    }
  }

  function vein(c,kind,rich,revealed,f){
    poly(c,[[0,14],[3,7],[10,3],[24,4],[30,11],[32,18],[27,24],[6,24],[1,20]],P.bedrockShadow);
    poly(c,[[2,14],[5,8],[13,5],[24,6],[28,11],[23,15],[7,19]],P.bedrockLight);
    poly(c,[[3,17],[10,13],[27,14],[29,20],[24,23],[8,23]],P.bedrock);
    const ramp=kind==='code'||kind==='emerald'?[P.emeraldShadow,P.emerald,P.emeraldLight]:kind==='document'||kind==='copper'?[P.amberShadow,P.amber,P.amberLight]:kind==='asset'||kind==='crystal'?[P.violetShadow,P.violet,P.violetLight]:[P.blueShadow,P.blue,P.blueLight];
    const colors=revealed?ramp:[ramp[0],ramp[0],ramp[1]];
    crystal(c,11,21,10,revealed?17:11,colors);crystal(c,22,21,9,12,colors);
    if(rich>1){crystal(c,18,13,8,11,colors);rect(c,4,17,3,3,colors[1]);}
    if(rich>2)crystal(c,26,20,7,9,colors);
    if(!revealed){poly(c,[[1,17],[8,15],[10,18],[15,19],[13,23],[5,22]],P.bedrock);rect(c,24,8,5,4,P.bedrockLight);}
    else if(f%4===2)rect(c,10,9,2,2,P.shine);
  }

  function paintWorkshop(c,recipe,v,f,assembled){
    // 88x76, with a physical floor at the supplied anchor; no dangling platform.
    poly(c,[[2,65],[13,60],[73,60],[86,65],[86,72],[80,76],[8,76],[2,72]],P.ink);
    poly(c,[[4,65],[14,62],[72,62],[84,65],[74,69],[14,69]],P.woodLight);
    rect(c,4,69,80,4,P.wood);rect(c,8,73,72,3,P.woodShadow);
    rect(c,9,70,3,3,P.gold);rect(c,76,70,3,3,P.gold);
    line(c,21,64,17,67,P.wood,1);line(c,64,64,69,67,P.wood,1);
    c.save();c.translate(16,0);paintArtifact(c,recipe,v,f,assembled);c.restore();
    if(!assembled){
      rect(c,7,40,3,24,P.woodShadow);rect(c,7,40,1,23,P.woodLight);rect(c,76,34,3,30,P.woodShadow);rect(c,76,34,1,29,P.woodLight);
      line(c,9,43,17,56,P.wood,2);line(c,76,40,68,54,P.wood,2);
      box(c,61,55,12,8,P.steelDark,P.steel,P.deep);rect(c,64,53,6,2,P.ink);
    }else{
      box(c,7,57,10,7,P.deep,P.steel,P.ink);rect(c,9,59,6,2,P.goldLight);
      rect(c,72,57,6,7,P.woodShadow);rect(c,73,56,4,3,P.moss);rect(c,75,54,2,4,P.mossLight);
    }
  }
  function paintArtifact(c,recipe,v,f,assembled){if(assembled)painters[recipe](c,v,f);else paintParts(c,recipe,v,f);}

  const chamberThemes=['energy','workshop','archive','studio','observatory','audio','garden','gate'];
  function chamberLamp(c,x,y,lit,f){
    rect(c,x,y-7,1,7,P.steelDark);rect(c,x-4,y,9,2,P.steel);rect(c,x-3,y+2,7,7,P.ink);
    rect(c,x-2,y+3,5,4,lit?P.amber:P.steelDark);if(lit)rect(c,x-1,y+3,3,3,f===2?P.goldHighlight:P.amberLight);
    rect(c,x-3,y+8,7,1,P.woodShadow);
  }
  function chamberCrate(c,x,y,w=13){
    box(c,x,y,w,11,P.wood,P.woodLight,P.woodShadow);line(c,x+2,y+3,x+w-4,y+8,P.woodShadow,1);rect(c,x+2,y+2,2,7,P.woodLight);rect(c,x+w-4,y+2,2,7,P.woodShadow);
  }
  function chamberDesk(c,x,y,w){
    rect(c,x,y,w,4,P.woodShadow);rect(c,x,y,w,1,P.woodLight);rect(c,x+1,y+4,3,9,P.wood);rect(c,x+w-4,y+4,3,9,P.wood);
    rect(c,x+5,y+4,w-10,4,P.wood);rect(c,x+Math.floor(w/2)-1,y+5,3,1,P.gold);
  }
  function chamberShelf(c,x,y,w,rows,level){
    rect(c,x,y,w,rows*12+4,P.woodShadow);rect(c,x+2,y+2,w-4,rows*12-1,P.ink);rect(c,x,y,2,rows*12+4,P.wood);rect(c,x+w-2,y,2,rows*12+4,P.wood);
    for(let row=0;row<rows;row++){
      const yy=y+row*12+3,n=Math.min(Math.floor((w-5)/5),2+level+row%2);
      for(let i=0;i<n;i++){const xx=x+3+i*5,col=[P.copperDark,P.cabDark,P.paperShadow,P.violetShadow][(i+row)%4];rect(c,xx,yy+(i%2)*2,4,8-(i%2)*2,col);rect(c,xx,yy+(i%2)*2,1,8-(i%2)*2,P.steel);rect(c,xx+1,yy+5,2,1,P.paper);}
      rect(c,x+1,yy+9,w-2,2,P.wood);rect(c,x+1,yy+9,w-2,1,P.woodLight);
    }
  }
  function chamberTank(c,x,y,w,h,level){
    box(c,x,y,w,h,P.steelDark,P.steel,P.deep);rect(c,x+3,y+4,w-6,h-9,P.ink);
    const water=Math.floor((h-10)*level/3),bottom=y+h-5;
    if(water){rect(c,x+4,bottom-water,w-8,water,P.cabDark);rect(c,x+4,bottom-water,w-8,2,P.cab);rect(c,x+5,bottom-water+2,2,Math.max(1,water-3),P.cab);}
    for(let at=y+9;at<bottom-2;at+=7)rect(c,x+w-5,at,2,1,P.steel);
    rect(c,x+2,y+3,1,h-6,P.silver);rect(c,x+4,y+h-3,w-8,1,P.copper);rect(c,x+Math.floor(w/2)-2,y-2,5,2,P.copper);
  }
  function chamberPlant(c,x,y,size){
    line(c,x,y,x,y-size,P.mossDark,2);poly(c,[[x,y-4],[x-size,y-6],[x-size-2,y-size],[x-3,y-size+1],[x+1,y-7]],P.moss);
    poly(c,[[x+1,y-7],[x+3,y-size-3],[x+size+2,y-size-5],[x+size,y-7]],P.emeraldShadow);line(c,x+3,y-9,x+size,y-size-2,P.mossLight,1);
  }
  function chamberShell(c,w,h,v){
    // A cutaway space with irregular shoulders, never a framed rectangular card.
    const floor=h-11;
    poly(c,[[1,19],[7,19],[7,10],[16+v*2,5],[w-19,3],[w-8,10],[w-8,17],[w-2,20],[w-1,floor+4],[w-8,h],[8,h],[0,floor+3]],P.ink);
    poly(c,[[7,20],[12,11],[25,8],[w-23,7],[w-10,16],[w-7,floor],[7,floor]],P.deep);
    rect(c,13,16,12,2,P.bedrockShadow);rect(c,w-30,27,16,2,P.bedrockShadow);rect(c,19,39,9,1,P.bedrockShadow);
    poly(c,[[5,floor],[w-8,floor-2],[w-1,floor+4],[w-6,h-1],[w-20,h],[13,h],[1,h-5]],P.bedrockShadow);
    poly(c,[[7,floor],[w-10,floor-1],[w-4,floor+3],[w-14,floor+5],[15,floor+6],[4,floor+3]],P.steelDark);
    rect(c,13,h-4,w-27,2,P.bedrockLight);rect(c,19,h-2,w-38,2,P.deep);
    rect(c,7,floor+2,9,1,P.steel);rect(c,w-23,floor+1,10,1,P.steel);
  }
  function desktopChamber(c,theme,v,level,f){
    chamberShell(c,112,72,v);
    const offset=v===1?3:v===2?-3:0;
    if(theme==='energy'){
      line(c,17,53,17,60,P.copperDark,3);line(c,17,60,77,60,P.copperDark,3);line(c,75,45,75,60,P.copperDark,3);
      chamberTank(c,12+offset,16,20,43,level);chamberTank(c,37+offset,23,18,36,level);
      box(c,66,31,30,26,P.steelDark,P.steel,P.deep);rect(c,69,35,11,9,P.ink);disc(c,74,39,3,P.paperShadow);line(c,74,39,75+level,37,P.copperDark,1);
      rect(c,84,35,8,3,level?P.cab:P.deep);for(let i=0;i<3;i++)rect(c,83+i*3,44,2,6,i<level?P.cab:P.deep);
      rect(c,69,48,10,3,P.copper);rect(c,72,56,3,5,P.steelDark);rect(c,88,56,3,5,P.steelDark);
      rect(c,66,18,27,3,P.steelDark);line(c,70,20,70,31,P.steelDark,1);line(c,89,20,89,31,P.steelDark,1);
      if(level>0)chamberCrate(c,89,51,13);if(level>1){box(c,59,51,9,10,P.copperDark,P.copper,P.deep);rect(c,61,49,5,3,P.steel);}if(level>2)rect(c,85,24,8,4,P.cabDark);
      chamberLamp(c,96,12,level>0,f);
    }else if(theme==='workshop'){
      box(c,12,12,35,24,P.woodShadow,P.wood,P.deep);line(c,17,20,25,28,P.steel,2);line(c,17,28,26,18,P.steel,2);rect(c,33,18,3,11,P.copper);rect(c,30,17,9,3,P.steel);
      chamberDesk(c,60+offset,48,37);box(c,67+offset,38,13,9,P.steelDark,P.steel,P.deep);rect(c,71+offset,35,4,4,P.copperDark);line(c,82+offset,45,89+offset,40,P.steel,2);
      for(let x=10;x<61;x+=12)line(c,x,64,x+6,67,P.woodShadow,2);line(c,7,62,57,62,P.steel,1);line(c,9,67,60,67,P.steelDark,2);
      disc(c,23,57,5,P.ink);disc(c,43,57,5,P.ink);disc(c,23,57,2,P.steel);disc(c,43,57,2,P.steel);
      poly(c,[[13,39],[52,39],[48,54],[19,54]],P.ink);poly(c,[[16,41],[49,41],[45,51],[21,51]],P.copperDark);rect(c,17,41,31,2,P.copper);
      if(level>0)poly(c,[[21,39],[25,34],[34,36],[39,31],[46,39]],P.steelDark);
      if(level>1)chamberCrate(c,91,52,13);if(level>2){gear(c,56,54,5,P.copperDark,P.copper,P.woodShadow);rect(c,39,20,3,7,P.gold);}
      chamberLamp(c,56,12,true,f);
    }else if(theme==='archive'){
      chamberShelf(c,11+offset,14,31,3,level);chamberShelf(c,47,15,20,2,Math.max(0,level-1));
      rect(c,12+offset,54,3,7,P.woodShadow);rect(c,37+offset,54,3,7,P.woodShadow);rect(c,10+offset,61,33,2,P.ink);
      chamberDesk(c,61,49,38);poly(c,[[66,45],[75,43],[80,46],[85,43],[94,44],[93,49],[84,48],[80,50],[74,48],[66,49]],P.paperShadow);
      poly(c,[[67,44],[75,42],[79,45],[79,48],[74,46],[67,47]],P.paperLight);poly(c,[[81,45],[86,42],[94,43],[93,47],[85,46],[81,48]],P.paper);rect(c,79,44,2,5,P.gold);
      box(c,72,55,12,5,P.wood,P.woodLight,P.woodShadow);rect(c,73,60,2,3,P.woodShadow);rect(c,81,60,2,3,P.woodShadow);
      if(level>0){rect(c,49,51,12,7,P.woodShadow);rect(c,49,51,12,3,P.paperShadow);rect(c,50,51,3,3,P.paperLight);}
      if(level>1){rect(c,87,36,3,8,P.gold);poly(c,[[88,38],[91,31],[96,29],[94,35]],P.paperLight);}
      if(level>2)chamberCrate(c,14,51,16);chamberLamp(c,98,18,true,f);
    }else if(theme==='studio'){
      line(c,32+offset,29,22+offset,61,P.woodShadow,3);line(c,40+offset,29,50+offset,61,P.woodShadow,3);rect(c,35+offset,40,3,23,P.wood);
      box(c,19+offset,16,36,32,P.wood,P.woodLight,P.woodShadow);rect(c,22+offset,19,30,26,P.paperShadow);rect(c,24+offset,21,26,21,P.cabDark);
      poly(c,[[24+offset,38],[32+offset,29],[38+offset,34],[44+offset,27],[50+offset,36],[50+offset,42],[24+offset,42]],P.moss);disc(c,30+offset,26,3,P.paper);
      rect(c,17+offset,47,40,3,P.woodLight);chamberDesk(c,66,49,32);
      box(c,69,40,7,9,P.roseDark,P.rose,P.woodShadow);box(c,79,42,7,7,P.blueShadow,P.blue,P.deep);if(level>0)box(c,88,40,7,9,P.goldShadow,P.gold,P.woodShadow);
      line(c,72,42,70,33,P.woodLight,1);line(c,73,42,75,34,P.woodLight,1);
      box(c,57,56,11,4,P.wood,P.woodLight,P.woodShadow);rect(c,58,60,2,3,P.woodShadow);rect(c,65,60,2,3,P.woodShadow);
      if(level>1){poly(c,[[10,50],[20,50],[23,56],[19,61],[11,59]],P.wood);rect(c,12,53,3,2,P.rose);rect(c,17,55,3,2,P.blue);}
      if(level>2){rect(c,89,23,7,10,P.paper);rect(c,90,26,4,5,P.violetShadow);}chamberLamp(c,62,12,true,f);
    }else if(theme==='observatory'){
      box(c,11,12,39,27,P.steelDark,P.steel,P.deep);rect(c,14,15,33,21,P.ink);
      line(c,18,23,29,18,P.cabDark,1);line(c,29,18,39,28,P.cabDark,1);line(c,18,23,25,31,P.cabDark,1);line(c,25,31,39,28,P.cabDark,1);
      star(c,18,23,P.cab);star(c,29,18,P.cabLight);star(c,39,28,P.blue);rect(c,24,30,2,2,P.cab);
      chamberDesk(c,13,49,35);box(c,17,40,17,9,P.steelDark,P.steel,P.deep);rect(c,20,42,10,4,P.cabDark);if(level>0)rect(c,21,43,6,2,P.cab);rect(c,36,44,8,4,P.paperShadow);
      const tx=76+offset;line(c,tx,40,tx-15,60,P.steelDark,3);line(c,tx,40,tx+15,60,P.steelDark,3);rect(c,tx,43,2,19,P.steel);
      poly(c,[[tx-17,31],[tx+5,13],[tx+15,19],[tx+16,25],[tx-7,44],[tx-13,42]],P.ink);poly(c,[[tx-14,32],[tx+5,16],[tx+13,21],[tx+12,24],[tx-7,41]],P.copper);
      line(c,tx-13,32,tx+5,17,P.goldLight,2);line(c,tx-1,23,tx+5,31,P.gold,2);line(c,tx+5,14,tx+15,22,P.steel,3);line(c,tx+7,16,tx+13,21,P.cabLight,2);
      if(level>1)chamberCrate(c,50,52,13);if(level>2){rect(c,56,28,3,20,P.steelDark);disc(c,57,27,4,P.cabDark);rect(c,56,26,2,2,P.cab);}chamberLamp(c,98,12,true,f);
    }else if(theme==='audio'){
      box(c,11+offset,25,19,36,P.woodShadow,P.wood,P.ink);disc(c,20+offset,48,7,P.deep);disc(c,20+offset,48,4,P.steelDark);disc(c,20+offset,33,4,P.deep);rect(c,15+offset,27,10,1,P.copperDark);
      chamberDesk(c,36,49,43);box(c,40,29,35,20,P.steelDark,P.steel,P.deep);disc(c,49,37,6,P.ink);disc(c,65,37,6,P.ink);disc(c,49,37,4,P.steel);disc(c,65,37,4,P.steel);rect(c,48,35,2,4,P.deep);rect(c,64,35,2,4,P.deep);
      rect(c,44,44,17,2,P.deep);for(let i=0;i<level;i++)rect(c,45+i*5,44,3,1,P.cab);rect(c,66,44,5,2,P.copper);
      line(c,27,60,41,64,P.ink,1);line(c,41,64,75,61,P.ink,1);line(c,75,61,91,60,P.ink,1);
      line(c,91,23,91,58,P.steelDark,2);line(c,91,58,84,62,P.steelDark,2);line(c,91,58,98,62,P.steelDark,2);box(c,87,18,8,13,P.deep,P.steel,P.ink);rect(c,89,21,4,6,P.steelDark);
      if(level>0){rect(c,42,52,22,4,P.paperShadow);for(let x=44;x<62;x+=4)rect(c,x,52,2,3,P.deep);}
      if(level>1)chamberCrate(c,81,50,14);if(level>2){rect(c,40,18,13,6,P.woodShadow);rect(c,42,19,9,3,P.copper);}chamberLamp(c,59,12,true,f);
    }else if(theme==='garden'){
      line(c,13,18,13,46,P.copperDark,3);line(c,13,18,80,18,P.copperDark,3);rect(c,79,18,3,11,P.copperDark);rect(c,13,19,64,1,P.copper);
      chamberTank(c,85,29,15,29,level);line(c,87,58,75,61,P.copperDark,2);
      box(c,22,48,53,13,P.wood,P.woodLight,P.woodShadow);rect(c,24,48,49,4,P.earthShadow);
      chamberPlant(c,34,48,8);chamberPlant(c,58,48,10);
      if(level>0)chamberPlant(c,46,48,6);if(level>1)chamberPlant(c,69,48,7);if(level>2){poly(c,[[56,34],[54,30],[57,27],[61,28],[62,32],[59,35]],P.rose);rect(c,57,29,3,3,P.gold);}
      box(c,9,50,10,11,P.copperDark,P.copper,P.woodShadow);rect(c,11,47,6,4,P.mossDark);line(c,77,56,78,47,P.steel,2);rect(c,75,46,7,3,P.steel);
      if(level>1){rect(c,20,60,7,3,P.woodShadow);rect(c,21,59,5,2,P.copper);}chamberLamp(c,42+offset,23,true,f);
    }else{
      poly(c,[[32,61],[32,26],[37,18],[47,12],[61,12],[72,18],[78,27],[78,61]],P.steelDark);
      poly(c,[[39,59],[39,29],[44,22],[51,19],[60,19],[67,25],[71,32],[71,59]],P.ink);
      rect(c,41,32,28,28,P.woodShadow);for(let x=43;x<68;x+=6)rect(c,x,33,3,26,P.wood);rect(c,41,37,28,3,P.steelDark);rect(c,41,50,28,3,P.steelDark);
      rect(c,53,43,7,10,P.deep);rect(c,55,45,3,5,P.gold);rect(c,35,29,4,26,P.steel);rect(c,37,23,4,6,P.steel);rect(c,44,17,7,3,P.steel);
      gear(c,20,44,8,P.copperDark,P.copper,P.woodShadow);rect(c,18,45,4,15,P.steelDark);line(c,22,43,31,38,P.steel,2);line(c,20,36,20,21,P.woodShadow,1);line(c,20,21,34,21,P.woodShadow,1);
      rect(c,38,62,36,3,P.bedrockLight);rect(c,43,65,27,3,P.steelDark);
      if(level>0)chamberCrate(c,83,50,15);if(level>1){chamberDesk(c,83,37,18);rect(c,86,33,9,4,P.paperShadow);}if(level>2){rect(c,27,53,3,9,P.copperDark);rect(c,26,50,5,4,P.gold);}
      chamberLamp(c,87,15,true,f);
    }
  }
  function compactChamber(c,theme,v,level,f){
    chamberShell(c,48,56,v);const shift=v===1?1:v===2?-1:0;
    // Native mobile layouts stack the theme's identifying equipment over a
    // shallow working floor. They never scale the desktop shelves or lettering.
    if(theme==='energy'){
      chamberTank(c,6+shift,17,14,30,level);chamberTank(c,23+shift,22,13,25,level);
      line(c,10,47,39,47,P.copperDark,2);box(c,36,33,8,15,P.steelDark,P.steel,P.deep);rect(c,38,36,4,4,P.deep);if(level)rect(c,39,37,2,2,P.cab);rect(c,38,43,3,2,P.gold);
      chamberLamp(c,35,12,level>0,f);
    }else if(theme==='workshop'){
      box(c,7,10,24,17,P.woodShadow,P.wood,P.deep);line(c,11,15,17,23,P.steel,1);line(c,12,22,19,14,P.steel,1);rect(c,24,15,2,8,P.copper);rect(c,21,14,7,2,P.steel);
      line(c,4,50,34,50,P.steel,1);line(c,6,53,36,53,P.steelDark,1);disc(c,12,45,4,P.ink);disc(c,28,45,4,P.ink);disc(c,12,45,1,P.steel);disc(c,28,45,1,P.steel);
      poly(c,[[5,32],[35,32],[31,43],[10,43]],P.ink);poly(c,[[8,34],[32,34],[29,41],[12,41]],P.copperDark);rect(c,8,34,24,1,P.copper);
      if(level)poly(c,[[12,32],[16,28],[21,30],[26,27],[30,32]],P.steelDark);if(level>1)chamberCrate(c,33,39,10);chamberLamp(c,38,14,true,f);
    }else if(theme==='archive'){
      chamberShelf(c,5+shift,12,22,2,level);rect(c,6+shift,40,2,7,P.woodShadow);rect(c,24+shift,40,2,7,P.woodShadow);chamberDesk(c,19,37,23);
      poly(c,[[22,34],[28,32],[31,34],[38,32],[40,35],[35,38],[30,37],[24,38]],P.paper);rect(c,30,34,1,4,P.gold);
      rect(c,8,41,8,5,P.paperShadow);rect(c,9,41,2,4,P.paperLight);if(level>1){rect(c,5,46,12,3,P.woodShadow);rect(c,7,46,7,1,P.copper);}
      chamberLamp(c,35,15,true,f);
    }else if(theme==='studio'){
      line(c,16,32,10,49,P.woodShadow,2);line(c,24,32,30,49,P.woodShadow,2);box(c,7+shift,13,25,24,P.wood,P.woodLight,P.woodShadow);
      rect(c,10+shift,16,19,18,P.cabDark);poly(c,[[10+shift,29],[16+shift,22],[21+shift,26],[27+shift,21],[29+shift,29],[29+shift,34],[10+shift,34]],P.moss);rect(c,13+shift,19,3,3,P.paper);
      rect(c,5+shift,37,29,2,P.woodLight);box(c,33,40,8,9,P.copperDark,P.rose,P.woodShadow);line(c,36,41,35,33,P.woodLight,1);
      if(level>1){box(c,25,44,6,5,P.blueShadow,P.blue,P.deep);}chamberLamp(c,38,13,true,f);
    }else if(theme==='observatory'){
      box(c,5,11,22,16,P.steelDark,P.steel,P.deep);rect(c,7,13,18,12,P.ink);line(c,9,19,16,15,P.cabDark,1);line(c,16,15,22,21,P.cabDark,1);rect(c,9,18,2,2,P.cab);rect(c,16,14,2,2,P.cabLight);rect(c,21,20,2,2,P.cab);
      line(c,27,34,17,49,P.steelDark,2);line(c,28,34,40,49,P.steelDark,2);rect(c,28,35,2,15,P.steel);
      poly(c,[[12,31],[32,17],[40,21],[41,26],[21,40]],P.ink);poly(c,[[15,31],[32,20],[38,23],[37,26],[21,37]],P.copper);line(c,15,31,32,20,P.goldLight,1);line(c,32,18,40,24,P.steel,2);line(c,34,20,38,23,P.cabLight,1);
      if(level>1)chamberCrate(c,5,39,11);chamberLamp(c,36,10,true,f);
    }else if(theme==='audio'){
      box(c,5,24,13,25,P.woodShadow,P.wood,P.deep);disc(c,11,39,4,P.deep);disc(c,11,39,2,P.steelDark);disc(c,11,29,2,P.deep);
      chamberDesk(c,21,36,21);box(c,22,21,19,15,P.steelDark,P.steel,P.deep);disc(c,27,27,4,P.ink);disc(c,36,27,4,P.ink);disc(c,27,27,2,P.silver);disc(c,36,27,2,P.silver);rect(c,25,32,12,2,P.deep);
      for(let i=0;i<level;i++)rect(c,26+i*3,32,2,1,P.cab);line(c,15,48,26,51,P.ink,1);line(c,26,51,40,48,P.ink,1);chamberLamp(c,19,10,true,f);
    }else if(theme==='garden'){
      line(c,7,19,7,36,P.copperDark,2);line(c,7,19,31,19,P.copperDark,2);chamberTank(c,34,27,10,22,level);
      box(c,7,38,25,11,P.wood,P.woodLight,P.woodShadow);rect(c,9,38,21,3,P.earthShadow);chamberPlant(c,15,38,6);if(level>0)chamberPlant(c,25,38,5);
      if(level>1){rect(c,12,28,3,3,P.roseDark);rect(c,13,27,2,2,P.rose);}if(level>2)box(c,3,46,6,5,P.copperDark,P.copper,P.deep);chamberLamp(c,23+shift,14,true,f);
    }else{
      poly(c,[[11,48],[11,23],[15,15],[22,11],[29,12],[35,18],[38,25],[38,48]],P.steelDark);poly(c,[[16,47],[16,25],[19,20],[24,17],[29,20],[33,26],[33,47]],P.ink);
      rect(c,17,27,15,20,P.woodShadow);rect(c,19,28,3,18,P.wood);rect(c,26,28,3,18,P.wood);rect(c,17,32,15,2,P.steelDark);rect(c,17,42,15,2,P.steelDark);rect(c,23,35,4,7,P.deep);rect(c,24,36,2,4,P.gold);
      gear(c,7,37,4,P.copperDark,P.copper,P.woodShadow);rect(c,6,41,2,7,P.steelDark);rect(c,14,49,22,2,P.steel);if(level>1)chamberCrate(c,36,42,9);chamberLamp(c,39,13,true,f);
    }
    // Supply groups add density without treating level as rarity or new rewards.
    if(level===3&&theme!=='gate'&&theme!=='garden')rect(c,35,50,7,2,P.woodShadow);
  }

  function canvasFor(w,h){
    try{let canvas;if(typeof root.OffscreenCanvas==='function')canvas=new root.OffscreenCanvas(w,h);else if(root.document){canvas=root.document.createElement('canvas');canvas.width=w;canvas.height=h;}if(!canvas)return null;const context=canvas.getContext('2d');if(!context)return null;context.imageSmoothingEnabled=false;return {canvas,context};}catch(_){return null;}
  }
  function render(c,x,y,w,h,key,paint){
    if(!cache.has(key)){const item=canvasFor(w,h);if(item)paint(item.context);cache.set(key,item&&item.canvas);}
    const cached=cache.get(key),left=integer(x)-Math.floor(w/2),top=integer(y)-h+1;
    if(cached&&typeof c.drawImage==='function'){const smoothing=c.imageSmoothingEnabled;c.imageSmoothingEnabled=false;try{c.drawImage(cached,left,top);}finally{c.imageSmoothingEnabled=smoothing;}}
    else{c.save();c.translate(left,top);try{paint(c);}finally{c.restore();}}
  }
  function recipeName(name){return recipes.includes(name)?name:'engine';}
  function drawArtifact(c,x,y,recipeId,variant=0,frame=0,assembled=true){
    const r=recipeName(recipeId),v=mod(variant,3),f=mod(frame,4),a=assembled!==false;
    render(c,x,y,56,64,'a:'+r+v+f+a,ctx=>paintArtifact(ctx,r,v,f,a));
  }
  function drawWorkshop(c,x,y,recipeId,variant=0,frame=0,assembled=true){
    const r=recipeName(recipeId),v=mod(variant,3),f=mod(frame,4),a=assembled!==false;
    render(c,x,y,88,76,'w:'+r+v+f+a,ctx=>paintWorkshop(ctx,r,v,f,a));
  }
  function drawEnvironment(c,biome,x,y,variant=0,frame=0){
    const b=biomes.includes(biome)?biome:biomes[mod(biome,4)],v=mod(variant,2),f=mod(frame,4);
    render(c,x,y,96,88,'e:'+b+v+f,ctx=>environmentPainters[b](ctx,v,f));
  }
  function drawVein(c,x,y,kind,richness=1,revealed=false,frame=0){
    const safeKind=['code','emerald','document','copper','asset','crystal','other'].includes(kind)?kind:'other';
    const r=Math.max(1,Math.min(3,integer(richness))),f=mod(frame,4),a=Boolean(revealed);
    render(c,x,y,32,24,'v:'+safeKind+r+a+f,ctx=>vein(ctx,safeKind,r,a,f));
  }
  function drawDressing(c,biome,x,y,variant=0,frame=0){
    const b=biomes.includes(biome)?biome:biomes[mod(biome,4)],v=mod(variant,6);
    const f=(b==='aquifer'&&v===0)||(b==='ruins'&&v===1)?mod(frame,4):0;
    render(c,x,y,32,32,'d:'+b+v+f,ctx=>dressingPainters[b](ctx,v,f));
  }
  function drawSeam(c,biome,x,y,variant=0,frame=0){
    const b=biomes.includes(biome)?biome:biomes[mod(biome,4)],v=mod(variant,4);
    render(c,x,y,24,12,'s:'+b+v,ctx=>seam(ctx,b,v));
  }
  function drawRelic(c,x,y,recipeId,variant=0,frame=0,assembled=true){
    const r=recipeName(recipeId),v=mod(variant,3),f=r==='rover'?mod(frame,4):0,a=assembled!==false;
    render(c,x,y,32,32,'r:'+r+v+f+a,ctx=>relic(ctx,r,v,f,a));
  }
  function drawChamber(c,x,y,theme,variant=0,level=1,frame=0,compact=false){
    const t=chamberThemes.includes(theme)?theme:'workshop',v=mod(variant,3),l=Math.max(0,Math.min(3,integer(level))),f=mod(frame,4)===2?2:0,small=Boolean(compact);
    render(c,x,y,small?48:112,small?56:72,'room:'+t+v+l+f+small,ctx=>small?compactChamber(ctx,t,v,l,f):desktopChamber(ctx,t,v,l,f));
  }
  return Object.freeze({palette,drawArtifact,drawEnvironment,drawVein,drawWorkshop,drawDressing,drawSeam,drawRelic,drawChamber});
});
