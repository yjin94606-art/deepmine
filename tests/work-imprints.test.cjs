'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {describeImprint,supportsImprint}=require('../scripts/work-imprint.cjs');
const {source,load}=require('../dist/work-imprints.js');
const bytes=text=>Buffer.from(text,'utf8'), hash='a'.repeat(64);
const live={mode:'live',project:{id:'mine'}};
const originalPNG='iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFElEQVR4nGOsPveQAQyYIBQDAwMAJsoCLrgKBVIAAAAASUVORK5CYII=';
const revisedPNG='iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFElEQVR4nGN8UeHJAAZMEIqBgQEAHr0BrYqe4RIAAAAASUVORK5CYII=';
test('a new project can show its own inline artwork or numeric Markdown table without any subject vocabulary',()=>{
  const line=value=>'![Measured output](data:image/png;base64,'+value+')';
  for(const data of [originalPNG,revisedPNG]){
    const im=describeImprint('work.md',bytes('# Untyped study\n'+line(data)));
    assert.deepEqual(im,{kind:'cover',type:'image/png',data});
  }
  for(const hidden of ['<!--\n'+line(originalPNG)+'\n-->','~~~markdown\n'+line(originalPNG)+'\n~~~',
    '<details>\n    <details>\n</details>\n'+line(originalPNG)+'\n</details>','    '+line(originalPNG),
    '---\n'+line(originalPNG)+'\n---','+++\n'+line(originalPNG)+'\n+++']){
    assert.notEqual(describeImprint('work.md',bytes(hidden+'\n\n# Untyped study\n\nMeasured results from the latest observation.'))?.kind,'cover');
  }
  const table=describeImprint('work.md',bytes('# Results\n\n| Region | Δ |\n|---|---:|\n|东| -3 |\n|西| 6 |'));
  assert.equal(table.kind,'table');assert.deepEqual(table.bars,[-21,42]);
  assert.equal(describeImprint('work.md',Buffer.from('\ufeff# Art\n\n'+line(originalPNG),'utf16le')).data,originalPNG);
});
test('a notebook contributes the actual displayed output image; source code, metadata and concealed cells stay private',()=>{
  const output=data=>({output_type:'display_data',data:{'image/png':data}});
  const nb=cells=>bytes(JSON.stringify({nbformat:4,cells}));
  const secret={cell_type:'code',metadata:{jupyter:{outputs_hidden:true}},outputs:[output(originalPNG)]};
  const visible={cell_type:'code',source:['private path'],outputs:[{output_type:'stream',data:{'image/png':originalPNG}},output(revisedPNG)]};
  assert.deepEqual(describeImprint('new.ipynb',nb([secret,visible])),{kind:'cover',type:'image/png',data:revisedPNG});
  assert.notEqual(describeImprint('new.ipynb',nb([secret]))?.kind,'cover');
});
function wave(samples){
  const buf=Buffer.alloc(44+2*samples.length);
  buf.write('RIFF');buf.writeUInt32LE(buf.length-8,4);buf.write('WAVEfmt ',8);
  buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);
  buf.writeUInt32LE(8000,24);buf.writeUInt32LE(16000,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);
  buf.write('data',36);buf.writeUInt32LE(2*samples.length,40);
  samples.forEach((v,i)=>buf.writeInt16LE(v,44+i*2));
  return buf;
}
test('WAV uses actual samples including silence and negative excursions',()=>{
  const peaks=describeImprint('mix.wav',wave([0,32767,0,-16384,0])).peaks;
  assert.deepEqual(peaks,[0,63,0,32,0]);
  assert.deepEqual(describeImprint('mix.wav',wave([0,0,0])).peaks,[0,0,0]);
  assert.equal(describeImprint('mix.wav',bytes('Not an audio file')),null);
});
test('CSV miniature follows row structure and actual numeric series, allowing quoted multiline fields',()=>{
  const a=describeImprint('visits.csv',bytes('Day,Visits\n"Fri,\n12",16\nSun,64\nMon,8\n'));
  assert.equal(a.label,'Day · Visits');
  assert.deepEqual(a.cells,[[3,6],[7,2],[3,2],[3,1]]);
  assert.deepEqual(a.series,[9,63,0]);
  assert.deepEqual(a.bars,[16,63,8]);
  assert.deepEqual(describeImprint('same.tsv',bytes('x\ty\nsand\t6\nlake\t6')).series,[32,32]);
  assert.equal(describeImprint('x.csv',bytes('one,two\n"x,4')),null);
});
test('program miniature uses actual exported symbol, literal stops, line lengths and indentation',()=>{
  const a=describeImprint('pacing.js',bytes('function helper() {}\nfunction advance() {\n  if(a) return b;\n}\nconst stops=[20,80,160];\nmodule.exports={advance};'));
  assert.equal(a.label,'advance');assert.deepEqual(a.values,[20,80,160]);
  assert.deepEqual(a.rows[1],{offset:2,length:15,role:'flow'});
  assert.equal(describeImprint('auth-token.js',bytes('function run(){}')),null);
  assert.equal(supportsImprint('../x.js'),false);
  assert.equal(describeImprint('x.js',Buffer.from([0xff,0,0])),null);
});
test('web glyphs come from visible source text without executing page code',()=>{
  const info=describeImprint('garden.html',bytes('<title>春日花园</title><h1>桔梗</h1><script>"<h1>fake</h1>"</script><p>花圃里种着七株桔梗。</p><button hidden>Hidden</button><button>浇水</button>'));
  assert.equal(info.label,'春日花园');assert.deepEqual(info.blocks.map(b=>b.text),['桔梗','花圃里种着七株桔梗。','浇水']);
  assert.equal(describeImprint('note.md',bytes('# 春季鸟类观察\n早晨的西湖畔落下了三只白鹭。')).label,'春季鸟类观察');
});
test('static SVG uses authored geometry, paint, layering and framing without passing through markup',async()=>{
  const file='drawing.svg',svg='<svg width="80" height="60" viewBox="-4 -2 40 30"><title>Internal draft</title>'+
    '<g fill="#944499"><rect x="0" y="0" width="12" height="10" rx="2"/><circle cx="13" cy="5" r="3"/></g>'+
    '<path d="M 2 9 L 6 2" stroke="#00ffaa" stroke-width="2" fill="none"/><rect display="none" width="2" height="2"/></svg>';
  const info=describeImprint(file,bytes(svg));
  assert.equal(info.kind,'vector');assert.deepEqual(info.view,[-4,-2,40,30]);assert.deepEqual(info.size,[80,60]);
  assert.deepEqual(info.shapes.map(s=>s.fill),['#944499','#944499','none']);
  assert.equal(info.shapes.at(-1).stroke,'#00ffaa');assert.match(info.shapes[0].d,/ a 2 2/);
  assert.doesNotMatch(JSON.stringify(info),/Internal draft|<svg|<g/);
  assert.ok(source({},live,{path:file,record:{type:'image',fingerprint:hash}}));
  for(const content of ['<image href="https://example.invalid/image"/>','<script>void(0)</script>','<foreignObject/>',
    '<style>.hidden{display:none}</style>','<use href="#rect"/>','<path d="M0 0" onclick="x()"/>',
    '<rect width="4" height="4" fill="url(https://example.invalid/paint)"/>','<g transform="rotate(30)"/>']){
    assert.notEqual(describeImprint(file,bytes('<svg viewBox="0 0 20 20"><rect width="8" height="8"/>'+content+'</svg>'))?.kind,'vector');
  }
  const originalDoc=global.document,originalPath=global.Path2D,seen=[];
  try{
    const context={setTransform(...m){seen.push(m);},fill(p){seen.push(['fill',p.d,this.fillStyle]);},stroke(p){seen.push(['stroke',p.d,this.strokeStyle]);}};
    global.document={createElement:()=>({getContext:()=>context})};
    global.Path2D=class{constructor(d){this.d=d;}};
    const picture=await load({literal:info},new AbortController().signal);
    assert.deepEqual([picture.width,picture.height],[288,216]);assert.deepEqual(seen[0],[7.2,0,0,7.2,28.8,14.4]);
    assert.deepEqual(seen.at(-1),['stroke','M 2 9 L 6 2','#00ffaa']);
  }finally{
    if(originalDoc===undefined)delete global.document;else global.document=originalDoc;
    if(originalPath===undefined)delete global.Path2D;else global.Path2D=originalPath;
  }
});
test('MP3 front cover is the actual embedded raster; external links and non-front pictures are ignored',()=>{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+5RfcAAAAASUVORK5CYII=','base64');
  function tag(mime,id){
    const payload=Buffer.concat([Buffer.from([0]),bytes(mime),Buffer.from([0,id,0]),png]);
    const header=Buffer.alloc(20);header.write('ID3');header[3]=3;
    const len=payload.length+10;header[8]=len>>7;header[9]=len&127;
    header.write('APIC',10);header.writeUInt32BE(payload.length,14);
    return Buffer.concat([header,payload]);
  }
  assert.deepEqual(describeImprint('song.mp3',tag('image/png',3)),{kind:'cover',type:'image/png',data:png.toString('base64')});
  assert.notEqual(describeImprint('song.mp3',tag('-->',3))?.kind,'cover');
  assert.notEqual(describeImprint('song.mp3',tag('image/png',4))?.kind,'cover');
});
test('imprint sources stay bound to the project, file path and observed version',()=>{
  const member={path:'music/beat.wav',record:{fingerprint:hash}};
  const a=source({},live,member),b=source({},live,{...member,record:{fingerprint:'c'.repeat(64)}});
  assert.notEqual(a.key,b.key);
  assert.equal(new URL(a.url,'http://mine').searchParams.get('fingerprint'),hash);
  assert.equal(source({},live,{...member,path:'.private/beat.wav'}),null);
  assert.equal(source({},live,{...member,record:{}}),null);
  const commitSrc=source({},live,{path:'music/beat.wav',commit:{hash:'0'.repeat(40)}});
  assert.match(commitSrc.url,/commit=/);
  assert.equal(source({},live,{...member,path:'other.dat'}),null);
});
test('memory artwork uses only a saved note in the same project',()=>{
  const memory={id:'m',projectId:'mine',timestamp:'2026-11-18',title:'播客开场',summary:'开场先听面摊的声音。'};
  const item={memoryIds:['m']};
  const src=source(item,{...live,memories:[memory]});
  assert.equal(src.url,undefined);assert.equal(src.literal.text,memory.summary);
  assert.equal(source(item,{...live,memories:[{...memory,projectId:'other'}]}),null);
});
test('imprint loader never requests arbitrary addresses',async()=>{
  const original=global.location;
  try{
    global.location={origin:'http://test.local'};
    const good=source({},live,{path:'music.wav',record:{fingerprint:hash}});
    for(const url of ['https://other.invalid/api/work-imprint','/api/work-imprint?path=other.wav&fingerprint='+hash,'/api/work-imprint?path=music.wav']){
      assert.equal(await load({...good,url},new AbortController().signal),null);
    }
  }finally{if(original===undefined)delete global.location;else global.location=original;}
});

function pixelObject(info){
  const pixels=new Array(96*80).fill('');
  const ctx={fillRect(x,y,width,height){
    assert.ok([x,y,width,height].every(Number.isInteger));
    assert.ok(x>=0&&y>=0&&x+width<=96&&y+height<=80);
    for(let row=y;row<y+height;row++)pixels.fill(this.fillStyle,row*96+x,row*96+x+width);
  }};
  require('../dist/work-objects.js').draw(ctx,info);
  return pixels;
}
test('every unsupported-preview medium has a distinct transparent object without text drawing',()=>{
  const masks=new Set();
  for(const type of ['web','document','code','image','audio','video','slides','table','memory','file']){
    const pixels=pixelObject({type,kind:'excerpt'});
    const count=pixels.filter(Boolean).length;
    assert.ok(count>850&&count<4600,type+' retains an open silhouette');
    assert.equal(pixels[0],'');
    masks.add(pixels.map(p=>p?'1':'0').join(''));
  }
  assert.equal(masks.size,10);
});
test('routes, measured columns, paint colors and tape peaks change the actual sprite pixels',()=>{
  const route=describeImprint('map.ts',bytes('export function shortestRoute(a, b) { return a + b; }'));
  assert.deepEqual(pixelObject(route),pixelObject({kind:'code',label:'最短路线工具'}));
  assert.notDeepEqual(pixelObject(route),pixelObject({...route,label:'unrelated'}));
  const chart=describeImprint('cities.csv',bytes('Year,Temperature\n2020,6\n2021,15\n2022,-2'));
  assert.deepEqual(chart.series,[30,63,0]);
  assert.deepEqual(chart.bars,[22,56,-7]);
  const columns=pixelObject(chart),reversed=pixelObject({...chart,bars:[...chart.bars].reverse()});
  assert.notDeepEqual(columns,reversed);
  assert.notDeepEqual(pixelObject({kind:'wave',peaks:[0,0]}),pixelObject({kind:'wave',peaks:[0,63]}));
  const swatches=describeImprint('theme.css',bytes('/* :root{color:#858181} */ .sky{color:#37a;fill:#f4b256}'));
  assert.deepEqual(swatches,{kind:'colors',colors:['#3377aa','#f4b256']});
  for(const color of swatches.colors)assert.ok(pixelObject(swatches).includes(color));
});
test('live loader draws authenticated excerpts with their medium and never substitutes a scene for a measurement',async()=>{
  const original={document:global.document,location:global.location,fetch:global.fetch,objects:global.WorkObjects,subjects:global.WorkSubjects};
  const seen=[],themes=[];
  let info;
  try{
    global.document={createElement:()=>({getContext:()=>({})})};
    global.WorkSubjects={draw:(_,model)=>{themes.push(model);return false;}};
    global.WorkObjects={draw:(_,model)=>seen.push(model)};
    global.location={origin:'http://deepmine.test'};
    global.fetch=async()=>new Response(JSON.stringify(info),{headers:{'Content-Type':'application/json','X-Deepmine-Preview':'verified-fingerprint'}});
    const signal=new AbortController().signal;
    for(const [file,type,payload] of [
      ['route.py','code',describeImprint('route.py',bytes('def shortestRoute(path):\n  return path'))],
      ['song.wav','audio',describeImprint('song.wav',wave([0,1024]))],
      ['cities.csv','table',describeImprint('cities.csv',bytes('City,Value\nA,4\nB,8'))],
      ['index.html','web',describeImprint('index.html',bytes('<title>River</title><h1>Creek</h1><p>A bend in the river.</p>'))],
      ['report.md','document',describeImprint('report.md',bytes('# River birds\n\nThree white egrets have returned to the estuary.'))]
    ]){
      info=payload;
      const src=source({},live,{path:file,record:{fingerprint:hash,type}});
      const canvas=await load(src,signal);
      assert.deepEqual([canvas.width,canvas.height,canvas.pixelArtwork],[96,80,true]);
      assert.equal(seen.at(-1).kind,info.kind);assert.equal(seen.at(-1).type,type);
      assert.equal(canvas.needsPersonalArt===true,info.kind==='excerpt' && type==='document');
    }
    assert.deepEqual(themes.map(m=>m.kind),['web','excerpt']);
    assert.match(themes[0].text,/Creek/);
  }finally{
    for(const [key,value] of Object.entries({document:original.document,location:original.location,fetch:original.fetch,WorkObjects:original.objects,WorkSubjects:original.subjects})){
      if(value===undefined)delete global[key];else global[key]=value;
    }
  }
});
