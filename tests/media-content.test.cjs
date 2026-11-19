'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {describeMedia}=require('../scripts/media-content.cjs');
const str=s=>Buffer.from(s);
const join=(...chunks)=>Buffer.concat(chunks);
function uint(n,bytes=4,le=false){const b=Buffer.alloc(bytes);if(le)b.writeUIntLE(n,0,bytes);else b.writeUIntBE(n,0,bytes);return b;}
const le=(n,b=4)=>uint(n,b,true);
const read=(buffer,ext,options)=>describeMedia(buffer,ext,'001.'+ext,options);
function riff(id,data){return join(str(id),le(data.length),data,Buffer.alloc(data.length%2));}
function waveFixture(){
  const meta=riff('LIST',join(str('INFO'),riff('INAM',str('山谷的回声')),riff('IART',str('林间乐队'))));
  const fmt=riff('fmt ',join(le(1,2),le(1,2),le(8000),le(16000),le(2,2),le(16,2)));
  const content=join(str('WAVE'),fmt,riff('data',Buffer.alloc(16000*3)),meta);
  return riff('RIFF',content);
}
test('WAV names the work and gives its actual duration, including LIST after the audio payload',()=>{
  const full=waveFixture();
  const result=read(full.subarray(0,96),'wav',{size:full.length,tail:full.subarray(-128)});
  assert.equal(result.title,'山谷的回声');assert.match(result.summary,/全长3 秒/);assert.match(result.summary,/林间乐队/);
  assert.equal(read(full.subarray(0,60),'wav'),null);
});
test('short PCM recordings report separated audible bursts only where the measured envelope supports them',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const sample=fs.readFileSync(path.join(__dirname,'../docs/launch/sample-chime.wav'));
  const shipped=read(sample,'wav');
  assert.equal(shipped.title,'Three bells');assert.match(shipped.summary,/响起三次.+渐渐收住/);
  function pulses(loudFrames,comment){
    const fmt=riff('fmt ',join(le(1,2),le(1,2),le(1000),le(2000),le(2,2),le(16,2)));
    const samples=Buffer.alloc(2000);
    for(let n=0;n<1000;n++)samples.writeInt16LE(loudFrames(n)?(n%2?22000:-22000):0,n*2);
    const tags=comment?riff('LIST',join(str('INFO'),riff('ICMT',str(comment)))):Buffer.alloc(0);
    return read(riff('RIFF',join(str('WAVE'),fmt,riff('data',samples),tags)),'wav');
  }
  const two=n=>(n>=10&&n<130)||(n>=520&&n<600);
  assert.match(pulses(two).summary,/响起两次/u);
  assert.doesNotMatch(pulses(two).summary,/渐渐/);
  assert.doesNotMatch(pulses(()=>true).summary,/响起/);
  assert.doesNotMatch(pulses(()=>false).summary,/响起/);
  assert.doesNotMatch(pulses(n=>n>=100&&n<120||n>=500&&n<520).summary,/响起/);
  assert.equal(pulses(two,'录下的是木门打开和关上时的两声轻响。').summary,'录下的是木门打开和关上时的两声轻响。');
});
function idframe(id,data){return join(str(id),uint(data.length),Buffer.alloc(2),data);}
function idtext(s){return join(Buffer.from([1,255,254]),Buffer.from(s,'utf16le'));}
function id3(...frames){const b=join(...frames),n=b.length;return join(str('ID3'),Buffer.from([3,0,0,n>>21,(n>>14)&127,(n>>7)&127,n&127]),b);}
test('MP3 separates its real track, album and chapter titles; nested titles do not overwrite the song',()=>{
  const chapter=idframe('CHAP',join(Buffer.from('c1\0'),Buffer.alloc(16),idframe('TIT2',idtext('第一班船'))));
  const b=id3(idframe('TIT2',idtext('去海边')),idframe('TALB',idtext('散步日记')),chapter);
  const copy=read(b,'mp3');assert.equal(copy.title,'去海边');assert.match(copy.summary,/散步日记.*第一班船/);
});
test('untagged VBR MP3 gets its playback length from the first frame count',()=>{
  const b=join(Buffer.from([255,251,144,0]),Buffer.alloc(32),str('Xing'),uint(1),uint(2300),Buffer.alloc(500));
  assert.match(read(b,'mp3').summary,/1 分钟/);assert.equal(read(str('Xing ignore me'),'mp3'),null);
});
function comments(...items){return join(le(4),str('test'),le(items.length),...items.map(item=>join(le(str(item).length),str(item))));}
test('FLAC uses tagged programme and stream sample count',()=>{
  const stream=Buffer.alloc(34);stream.writeBigUInt64BE((44100n<<44n)|(44100n*61n),10);
  const tags=comments('TITLE=雨夜来信','ALBUM=睡前广播','CHAPTER001NAME=从一封信说起');
  const b=join(str('fLaC'),Buffer.from([0,0,0,34]),stream,Buffer.from([132]),uint(tags.length,3),tags);
  const copy=read(b,'flac');assert.equal(copy.title,'雨夜来信');assert.match(copy.summary,/睡前广播.*1 分钟 1 秒.*从一封信说起/);
});
function oggPage(packet,flags,seq,granule=0,serial=31){
  const head=Buffer.alloc(27);head.write('OggS');head[5]=flags;head.writeBigInt64LE(BigInt(granule),6);
  head.writeUInt32LE(serial,14);head.writeUInt32LE(seq,18);head[26]=1;
  return join(head,Buffer.from([packet.length]),packet);
}
test('Opus combines actual stream comments and ending sample position, ignoring a different stream',()=>{
  const h=Buffer.alloc(19);h.write('OpusHead');h[8]=1;h[9]=2;h.writeUInt16LE(312,10);
  const a=oggPage(h,2,0),b=oggPage(join(str('OpusTags'),comments('TITLE=黄昏站台')),0,1);
  assert.deepEqual(read(join(a,b,oggPage(str('x'),4,2,96000+312)),'opus'),{title:'黄昏站台',summary:'全长2 秒。'});
  assert.doesNotMatch(read(join(a,b,oggPage(str('x'),4,2,96000+312,99)),'opus').summary,/2 秒/);
});
function atom(type,data){return join(uint(8+data.length),Buffer.from(type,'latin1'),data);}
test('embedded movie descriptions carry actual scene notes and reject credential-like content',()=>{
  const movie=description=>atom('moov',atom('udta',atom('meta',join(uint(0),atom('ilst',join(
    atom('©nam',atom('data',join(uint(1),uint(0),str('潮汐图')))),
    atom('desc',atom('data',join(uint(1),uint(0),str(description))))
  ))))));
  assert.equal(read(movie('镜头从滩涂上的脚印移到栈桥边。'),'mp4').summary,'镜头从滩涂上的脚印移到栈桥边。');
  assert.doesNotMatch(read(movie('password=DO_NOT_USE_THIS_VALUE'),'mp4').summary,/DO_NOT/);
});
test('MP4 jumps over many megabytes of media to the real movie atom at EOF; no matching inside pixels',()=>{
  const title=atom('©nam',atom('data',join(uint(1),uint(0),str('渡口的清晨'))));
  const meta=atom('udta',atom('meta',join(uint(0),atom('ilst',title))));
  const moov=atom('moov',join(atom('mvhd',join(Buffer.alloc(12),uint(1000),uint(93000))),meta));
  const ftyp=atom('ftyp',str('isom0000')), mdat=join(uint(3000000),str('mdat'));
  const prefix=join(ftyp,mdat,atom('moov',atom('mvhd',Buffer.alloc(32))));
  const copy=read(prefix,'mp4',{size:ftyp.length+3000000+moov.length,tail:moov});
  assert.equal(copy.title,'渡口的清晨');assert.match(copy.summary,/1 分钟 33 秒/);
  const decoy=join(ftyp,atom('mdat',moov));assert.equal(read(decoy,'mp4'),null);
});
function ebml(id,data){return join(Buffer.from(id,'hex'),Buffer.from([128+data.length]),data);}
test('WebM introduces real segment and chapter names with the declared timestamp scale',()=>{
  const ticks=Buffer.alloc(8);ticks.writeDoubleBE(65000);
  const info=ebml('1549a966',join(ebml('7ba9',str('草原上的一天')),ebml('4489',ticks)));
  const chapter=ebml('1043a770',ebml('45b9',ebml('b6',ebml('80',ebml('85',str('夜里的星空'))))));
  const b=join(ebml('1a45dfa3',ebml('4282',str('webm'))),ebml('18538067',join(info,chapter)));
  assert.deepEqual(read(b,'webm'),{title:'草原上的一天',summary:'全长1 分钟 5 秒，其中有「夜里的星空」的章节。'});
});
test('JSON glTF and binary GLB introduce named scenes, parts and animations rather than filenames or texture URIs',()=>{
  const obj={asset:{version:'2.0'},scene:0,scenes:[{name:'水车磨坊'}],meshes:[{name:'木轮'},{name:'石磨'}],animations:[{name:'水轮转动'}],images:[{uri:'secret.png'}]};
  const json=str(JSON.stringify(obj)), padded=join(json,Buffer.alloc((4-json.length%4)%4,32));
  const bin=join(str('glTF'),le(2),le(20+padded.length),le(padded.length),str('JSON'),padded);
  for(const [b,e] of [[json,'gltf'],[bin,'glb']]){
    const copy=read(b,e);assert.equal(copy.title,'水车磨坊模型');assert.match(copy.summary,/木轮.*石磨.*水轮转动/);
    assert.doesNotMatch(copy.summary,/secret|001/);
  }
  assert.equal(read(str('{"meshes":[]}'),'gltf'),null);
});
test('OBJ reads named groups only if face and vertex declarations are present',()=>{
  const text='o 灯塔\nv 1.0 2.0 3.0\nv 2 0 0\nv 0 2 0\ng 塔身\nf 1 2 3\n';
  assert.deepEqual(read(str(text),'obj'),{title:'灯塔模型',summary:'模型里能找到「灯塔」、「塔身」。'});
  assert.equal(read(str('o 灯塔\n'),'obj'),null);
});
function zip(names){
  const entries=[],rows=[];let offset=0;
  for(const n of names){
    const s=str(n), local=Buffer.alloc(30),central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(s.length,26);
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);
    central.writeUInt16LE(s.length,28);central.writeUInt32LE(offset,42);
    entries.push(local,s);rows.push(central,s);offset+=local.length+s.length;
  }
  const cd=join(...rows),eocd=Buffer.alloc(22);eocd.writeUInt32LE(0x06054b50);
  eocd.writeUInt16LE(names.length,8);eocd.writeUInt16LE(names.length,10);eocd.writeUInt32LE(cd.length,12);eocd.writeUInt32LE(offset,16);
  return join(...entries,cd,eocd);
}
test('an archive is introduced by its contents and readable names, skipping hidden and sensitive members',()=>{
  const b=zip(['展板/温室.png','展板/小径.png','notes/游园路线.pdf','.hidden/private.svg','secret_key.md','node_modules/test.js','001.unknown']);
  const copy=read(b,'zip');
  assert.equal(copy.title,'图片和文档资料包');assert.match(copy.summary,/2 张图片、1 份文档.*温室.*小径.*游园路线/);
  assert.doesNotMatch(copy.summary,/secret|\.png|private|001|node_modules/);
  assert.equal(read(b.subarray(0,-5),'zip'),null);
});
test('malformed and secret-bearing metadata cannot fabricate descriptions or escape as raw text',()=>{
  for(const ext of ['wav','mp3','mp4','glb','obj','ogg','webm','zip','flac','other'])assert.equal(read(str('001 secret.png'),ext),null);
  assert.equal(read(id3(idframe('TIT2',idtext('private api_key=abcd'))),'mp3'),null);
  assert.equal(read(id3(idframe('TIT2',idtext('001.mp3'))),'mp3'),null);
  assert.equal(read(Buffer.alloc(10),'mp3',{size:1}),null);
});
