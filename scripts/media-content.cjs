'use strict';

// All offsets refer to the bytes already read by the fingerprint scanner. Media
// payloads are skipped through their enclosing structure and never executed.
const MEDIA_EXTENSIONS = new Set(['wav','mp3','flac','ogg','oga','opus','m4a','mp4','m4v','mov','webm','mkv','glb','gltf','obj','zip']);
const WINDOW_LIMIT = 1024 * 1024;
const utf8 = new TextDecoder('utf-8', {fatal:true});
const {cleanExcerpt}=require('./text-content.cjs');
function mediaDescription(data) {
  if(!data || data.length>1200)return '';
  try{return cleanExcerpt(utf8.decode(data).replace(/\0+$/,''),340);} catch {return '';}
}
function name(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim().normalize('NFC');
  if (text.length < 2 || text.length > 90 || !/\p{L}/u.test(text) ||
      /[\p{Cc}\p{Cf}<>\\/{}@\uFFFD]|[\w+=-]{28,}|(?:password|token|secret|credential|api[_ -]?key|密码|密钥|私钥|sk-[\w-]{8,}|AKIA[A-Z0-9]{10,})/iu.test(text) ||
      /^(?:untitled|unknown|default(?: scene)?|scene|node|mesh|animation|object|track|layer|material|chapter|group|cube|render|音轨|未命名)[\s_.-]*\d*$/i.test(text) ||
      /\.(?:png|wav|mp3|mp4|json|zip|glb|obj|jpe?g|mov|mkv|webm|gltf|ogg|flac|m4a)$/i.test(text)) return '';
  return text.replace(/ +/g,' ');
}
function textName(data, encoding='utf-8') {
  if (!data || data.length > 512) return '';
  const value = (encoding==='utf-8' ? utf8 : new TextDecoder(encoding,{fatal:true})).decode(data);
  return name(value.replace(/\0+$/,''));
}
function windows(prefix, size, tail) {
  if (!Buffer.isBuffer(prefix) || !Number.isSafeInteger(size) || size < prefix.length ||
      (tail && (!Buffer.isBuffer(tail) || tail.length > size))) return null;
  const end = (tail || (size===prefix.length?prefix:null))?.subarray(-WINDOW_LIMIT);
  prefix = prefix.subarray(0,WINDOW_LIMIT);
  return {prefix,size,read(at,n) {
    if (!Number.isSafeInteger(at) || !Number.isSafeInteger(n) || at < 0 || n < 0 || at+n>size) return null;
    if (at+n<=prefix.length) return prefix.subarray(at,at+n);
    const start=size-(end?.length || 0);
    if (end && at>=start) return end.subarray(at-start,at-start+n);
    return null;
  }};
}
function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds<=0 || seconds>7*86400) return '';
  if (seconds<1) return '不到 1 秒';
  const total=Math.round(seconds), minutes=Math.floor(total/60), rest=total%60;
  if (!minutes) return total+' 秒';
  return minutes+' 分钟'+(rest?' '+rest+' 秒':'');
}
function introduction(info, video=false) {
  const kind=video?'视频':'音频', timed=duration(info.seconds);
  const chapters=[...new Set(info.chapters || [])].filter(Boolean).slice(0,3);
  if (!info.title && !info.album && !timed && !chapters.length && !info.description) return null;
  const title=info.title || (chapters[0] ? chapters[0]+'等章节' : info.album ? '《'+info.album+'》中的'+kind : timed ? timed+'的'+kind : kind);
  if(info.description)return {title,summary:info.description};
  const lines=[];
  if(info.album && info.album!==title) lines.push('收录在《'+info.album+'》里');
  if(timed) lines.push('全长'+timed);
  if(info.artist) lines.push('署名是'+info.artist);
  if(chapters.length) lines.push('其中有'+chapters.map(c=>'「'+c+'」').join('、')+'的章节');
  if(info.measured)lines.push(info.measured.replace(/。$/,''));
  if (!lines.length) lines.push('这段'+kind+'取名为《'+title+'》');
  return {title,summary:lines.join('，')+'。'};
}

function pcmPeaks(fmt,data,limit){
  if(!fmt||!data?.length||fmt.channels<1||fmt.channels>8||fmt.stride!==fmt.channels*fmt.bits/8)return null;
  const {format,channels,bits,stride}=fmt;
  if(!(format===1&&[8,16,24,32].includes(bits))&&!(format===3&&bits===32))return null;
  const frames=data.length/stride;
  if(!Number.isInteger(frames))return null;
  const count=Math.min(limit,frames),peaks=[];
  for(let b=0;b<count;b++){
    const start=Math.floor(b*frames/count),stop=Math.floor((b+1)*frames/count);
    let peak=0;
    const step=Math.max(1,Math.floor((stop-start)/1024));
    for(let f=start;f<stop;f+=step){
      for(let c=0;c<channels;c++){
        const pos=f*stride+c*bits/8;
        const sample=format===3?data.readFloatLE(pos):bits===8?(data[pos]-128)/128:data.readIntLE(pos,bits/8)/(2**(bits-1));
        if(Number.isFinite(sample))peak=Math.max(peak,Math.abs(sample));
      }
    }
    peaks.push(Math.min(63,Math.round(63*peak)));
  }
  return peaks;
}
function wavePhrases(fmt,data,seconds){
  if(!fmt||!data||seconds<.3||seconds>12)return '';
  const peaks=pcmPeaks(fmt,data,Math.round(seconds*100));
  if(!peaks)return '';
  const max=Math.max(...peaks);
  if(max<8)return '';
  const quiet=Math.max(1,max*.15),loud=max*.45;
  let quietBins=8,loudBins=0,armed=true,attacks=0,lastAttack=-1;
  for(let i=0;i<peaks.length;i++){
    quietBins=peaks[i]<=quiet?quietBins+1:0;
    if(quietBins>=8)armed=true;
    loudBins=peaks[i]>=loud?loudBins+1:0;
    if(armed&&loudBins>=3){attacks++;lastAttack=i;armed=false;}
  }
  if(attacks<2||attacks>8)return '';
  const count='零一两三四五六七八'[attacks];
  const tail=peaks.slice(lastAttack);
  const lastPeak=tail.lastIndexOf(Math.max(...tail));
  const decay=tail.slice(lastPeak+1);
  const fading=decay.length>=25&&Math.max(...decay.slice(-8))<=quiet&&
    decay.filter(v=>v>quiet&&v<loud).length>=10;
  return '声音明显响起'+count+'次，每次之间都轻了下来'+(fading?'，最后一声渐渐收住':'')+'。';
}
function wave(file) {
  const head=file.read(0,12);
  if(head?.toString('ascii',0,4)!=='RIFF' || head.toString('ascii',8,12)!=='WAVE') return null;
  const end=head.readUInt32LE(4)+8;
  if(end>file.size)return null;
  const info={};
  let bytesPerSecond=0,audioBytes=0,format=null,dataOffset=null,dataChunks=0;
  for(let p=12, count=0;p+8<=end && count++<1024;) {
    const chunk=file.read(p,8); if(!chunk) break;
    const id=chunk.toString('ascii',0,4), len=chunk.readUInt32LE(4), start=p+8;
    if(start+len>end) return null;
    if(id==='fmt ' && len>=16){
      const fmt=file.read(start,16);
      if(fmt && [1,3].includes(fmt.readUInt16LE(0)) && fmt.readUInt32LE(4)*fmt.readUInt16LE(12)===fmt.readUInt32LE(8)){
        bytesPerSecond=fmt.readUInt32LE(8);
        format={format:fmt.readUInt16LE(0),channels:fmt.readUInt16LE(2),stride:fmt.readUInt16LE(12),bits:fmt.readUInt16LE(14)};
      }
    }
    if(id==='data'){audioBytes+=len;dataOffset=start;dataChunks++;}
    if(id==='LIST' && len>=4 && file.read(start,4)?.toString()==='INFO'){
      for(let i=start+4,j=0;i+8<=start+len && j++<128;){
        const header=file.read(i,8);if(!header)break;
        const n=header.readUInt32LE(4), key=({INAM:'title',IPRD:'album',IART:'artist'})[header.toString('ascii',0,4)];
        if(i+8+n>start+len)break;
        if(key) info[key]=textName(file.read(i+8,n));
        else if(header.toString('ascii',0,4)==='ICMT')info.description=mediaDescription(file.read(i+8,n));
        i+=8+n+(n%2);
      }
    }
    p=start+len+(len%2);
  }
  info.seconds=audioBytes/bytesPerSecond;
  if(!info.description&&dataChunks===1&&audioBytes<=WINDOW_LIMIT&&info.seconds<=12)
    info.measured=wavePhrases(format,file.read(dataOffset,audioBytes),info.seconds);
  return introduction(info);
}

function syncSize(data) {
  if(data.length!==4 || data.some(b=>b>127))return NaN;
  return data.reduce((size,b)=>size*128+b,0);
}
function id3Text(b) {
  if(!b?.length || b.length>512)return '';
  const enc=['windows-1252', b[1]===0xfe?'utf-16be':'utf-16le','utf-16be','utf-8'][b[0]];
  return enc?textName(b.subarray(1),enc):'';
}
function mp3(file) {
  const tag=file.read(0,10), info={chapters:[]};
  let firstAudio=0;
  if (tag?.toString('ascii',0,3)==='ID3' && [3,4].includes(tag[3]) && !(tag[5]&0xc0)){
    const end=10+syncSize(tag.subarray(6)), version=tag[3];
    if(!Number.isSafeInteger(end) || end>file.size)return null;
    firstAudio=end+((version===4 && tag[5]&16)?10:0);
    function frames(start,limit,chapter=false){
      for(let p=start,k=0;p+10<=limit && k++<512;){
        const h=file.read(p,10); if(!h)break;
        const id=h.toString('ascii',0,4), n=version===4?syncSize(h.subarray(4,8)):h.readUInt32BE(4);
        if(!/^[A-Z0-9]{4}$/.test(id)|| !Number.isSafeInteger(n) || p+10+n>limit)break;
        const data=file.read(p+10,n);
        if(!h[9] && data){
          const key=({TIT2:'title',TALB:'album',TPE1:'artist'})[id];
          if(key && !chapter) info[key]=id3Text(data);
          else if(id==='TIT2' && chapter)info.chapters.push(id3Text(data));
          else if(id==='TLEN' && !chapter && data.length<20) {
            const milliseconds=data.subarray(1).toString('ascii').replace(/\0+$/,'');
            if(/^\d+$/.test(milliseconds))info.seconds=Number(milliseconds)/1000;
          } else if(id==='CHAP' && !chapter && info.chapters.length<3){
            const pos=data.indexOf(0); if(pos>=0 && pos+17<=n)frames(p+10+pos+17,p+10+n,true);
          }
        }
        p+=10+n;
      }
    }
    frames(10,end);
  }
  // ID3v1 uses fixed-width text at EOF. Require a valid MPEG/audio or ID3
  // prefix as well, so an arbitrary file ending in "TAG" cannot pose as music.
  const first=file.read(0,2), trailer=file.read(file.size-128,128);
  if((tag?.toString('ascii',0,3)==='ID3'||first && first[0]===255 && (first[1]&0xe0)===0xe0) && trailer?.toString('ascii',0,3)==='TAG'){
    for(const [key,pos] of [['title',3],['artist',33],['album',63]]) info[key] ||= textName(trailer.subarray(pos,pos+30),'windows-1252');
  }
  // Xing/Info supplies a real frame count even when the encoder wrote no
  // title. Byte size divided by a guessed bitrate is unreliable for VBR.
  const header=file.read(firstAudio,4);
  if(!info.seconds && header?.[0]===255 && (header[1]&0xe6)===0xe2){
    const version=(header[1]>>3)&3, sampling=(header[2]>>2)&3, mono=(header[3]>>6)===3;
    if(version!==1 && sampling!==3 && (header[2]>>4)!==15){
      const hz=[44100,48000,32000][sampling]/(version===3?1:version===2?2:4);
      const side=version===3?(mono?17:32):(mono?9:17),crc=header[1]&1?0:2;
      const xing=file.read(firstAudio+4+side+crc,12);
      if(xing && ['Xing','Info'].includes(xing.toString('ascii',0,4)) && xing.readUInt32BE(4)&1)info.seconds=xing.readUInt32BE(8)*(version===3?1152:576)/hz;
    }
  }
  return introduction(info);
}
function readComments(data,info) {
  if(!data || data.length<8)return;
  let p=4+data.readUInt32LE(0); if(p+4>data.length)return;
  const count=data.readUInt32LE(p); p+=4;
  if(count>1024)return;
  for(let i=0;i<count && p+4<=data.length;i++){
    const n=data.readUInt32LE(p);p+=4;
    if(p+n>data.length)break;
    if(n<=512){
      const entry=utf8.decode(data.subarray(p,p+n)), equal=entry.indexOf('=');
      const tag=entry.slice(0,equal).toUpperCase(), key=({TITLE:'title',ALBUM:'album',ARTIST:'artist'})[tag];
      if(equal>0 && key)info[key]=name(entry.slice(equal+1));
      if(equal>0 && tag==='DESCRIPTION')info.description=cleanExcerpt(entry.slice(equal+1),340);
      if(/^CHAPTER\d{3}NAME$/.test(tag)&&info.chapters.length<3)info.chapters.push(name(entry.slice(equal+1)));
    }
    p+=n;
  }
}
function flac(file) {
  if(file.read(0,4)?.toString()!=='fLaC')return null;
  const info={chapters:[]};
  for(let p=4,k=0;p+4<=file.size && k++<128;){
    const h=file.read(p,4);if(!h)break;
    const type=h[0]&127,len=h.readUIntBE(1,3),start=p+4;
    if(start+len>file.size || (p===4 && (type!==0||len!==34))) return null;
    if(type===0 && len===34){
      const block=file.read(start,34);
      if(block)info.seconds=((block[13]&15)*2**32+block.readUInt32BE(14))/(block.readUIntBE(10,3)>>>4);
    }
    if(type===4)readComments(file.read(start,len),info);
    if(h[0]&128)break;
    p=start+len;
  }
  return introduction(info);
}
function ogg(file) {
  const info={chapters:[]};
  let parts=[],serial,codec='',packets=0,bytes=0,rate=0,skip=0;
  for(let p=0,pages=0;packets<2 && pages++<128;){
    const h=file.read(p,27);if(!h || h.toString('ascii',0,4)!=='OggS'||h[4]!==0)break;
    if(serial===undefined){if(!(h[5]&2))return null;serial=h.readUInt32LE(14);}
    const segments=file.read(p+27,h[26]); if(!segments)break;
    p+=27+h[26];
    for(const n of segments){
      const part=file.read(p,n);if(!part)return introduction(info);p+=n;
      if(h.readUInt32LE(14)!==serial)continue;
      parts.push(part);bytes+=n; if(bytes>WINDOW_LIMIT)return null;
      if(n<255){
        const packet=Buffer.concat(parts,bytes);parts=[];bytes=0;
        if(packets===0){
          if(packet.length>=19 && packet.toString('ascii',0,8)==='OpusHead'){
            codec='opus'; rate=48000; skip=packet.readUInt16LE(10);
          }else if(packet.length>=30 && packet[0]===1 && packet.toString('ascii',1,7)==='vorbis'){
            codec='vorbis';rate=packet.readUInt32LE(12);
          }
          else return null;
        }else if(codec==='opus' && packet.toString('ascii',0,8)==='OpusTags')readComments(packet.subarray(8),info);
        else if(codec==='vorbis' && packet[0]===3 && packet.toString('ascii',1,7)==='vorbis')readComments(packet.subarray(7),info);
        if(++packets===2)break;
      }
    }
  }
  const end=file.read(file.size-Math.min(file.size,65307),Math.min(file.size,65307));
  if(end && rate){
    const magic=Buffer.from('OggS');
    for(let p=end.lastIndexOf(magic);p>=0;p=p?end.lastIndexOf(magic,p-1):-1){
      if(p+27>end.length || end[p+4]!==0 || !(end[p+5]&4) || end.readUInt32LE(p+14)!==serial)continue;
      const boundaries=end.subarray(p+27,p+27+end[p+26]);
      if(boundaries.length!==end[p+26] || p+27+boundaries.length+boundaries.reduce((a,b)=>a+b,0)!==end.length)continue;
      info.seconds=(Number(end.readBigInt64LE(p+6))-skip)/rate;break;
    }
  }
  return introduction(info);
}

function movie(file, extension) {
  const first=file.read(0,8)?.toString('latin1',4);
  if(!['ftyp','moov','wide','free','mdat'].includes(first)) return null;
  const info={chapters:[]}, tracks=new Set();
  let atomCount=0,foundMovie=false;
  function walk(start,end,parent) {
    for(let p=start;p+8<=end && atomCount++<4096;){
      const hdr=file.read(p,8);if(!hdr)break;
      const type=hdr.toString('latin1',4), short=hdr.readUInt32BE(0);
      const wide=short===1?file.read(p+8,8):null;
      if(short===1 && !wide)break;
      const length=short===1?Number(wide.readBigUInt64BE()):short || end-p;
      const body=p+(short===1?16:8), stop=p+length;
      if(!Number.isSafeInteger(stop)||stop<body||stop>end)break;
      if(type==='moov' && parent==='root'){foundMovie=true;walk(body,stop,'moov');}
      else if([['moov','udta'],['moov','trak'],['trak','mdia'],['meta','ilst']].some(([a,b])=>parent===a&&type===b)) walk(body,stop,type);
      else if(type==='meta' && (parent==='udta'||parent==='moov') && stop-body>=4) walk(body+4,stop,type);
      else if(parent==='ilst' && ['©nam','©alb','©ART','desc','ldes','©cmt'].includes(type))walk(body,stop,type);
      else if(type==='data' && ['©nam','©alb','©ART','desc','ldes','©cmt'].includes(parent) && stop-body>=8 && stop-body<=1208){
        const data=file.read(body,stop-body);
        if(data && data.readUInt32BE(0)===1) {
          const key={'©nam':'title','©alb':'album','©ART':'artist'}[parent];
          if(key)info[key]=textName(data.subarray(8));
          else info.description ||=mediaDescription(data.subarray(8));
        }
      }else if(type==='mvhd'&&parent==='moov'){
        const version=file.read(body,1)?.[0], off=version===1?20:12, needed=off+(version===1?12:8);
        const data=stop-body>=needed?file.read(body,needed):null;
        if(data && (version===0 || version===1)){
          const value=version===1?Number(data.readBigUInt64BE(off+4)):data.readUInt32BE(off+4);
          if(value!==0xffffffff)info.seconds=value/data.readUInt32BE(off);
        }
      }else if(type==='hdlr' && parent==='mdia' && stop-body>=12)tracks.add(file.read(body+8,4)?.toString());
      else if(type==='chpl' && parent==='udta' && stop-body>=9){
        const data=file.read(body,Math.min(8192,stop-body));
        if(data){
          let i=9;
          for(let chapter=0;chapter<Math.min(3,data[8]) && i+9<=data.length;chapter++){
            const n=data[i+8];i+=9;if(i+n>data.length)break;
            info.chapters.push(textName(data.subarray(i,i+n)));i+=n;
          }
        }
      }
      p=stop;
    }
  }
  walk(0,file.size,'root');
  return foundMovie?introduction(info,tracks.has('vide') || (!tracks.has('soun') && extension!=='m4a')):null;
}

function vint(file,p,elementId=false) {
  const first=file.read(p,1)?.[0];if(!first)return null;
  let width=1,mask=128;
  while(!(first&mask)){width++;mask>>=1;}
  if(elementId && width>4)return null;
  const data=file.read(p,width);if(!data)return null;
  let n=elementId?first:first&(mask-1),unknown=!elementId && n===mask-1;
  for(let i=1;i<width;i++){n=n*256+data[i];unknown=unknown&&data[i]===255;}
  if(!unknown && !Number.isSafeInteger(n))return null;
  return {width,n:unknown?Infinity:n};
}
function matroska(file) {
  if(file.read(0,4)?.readUInt32BE(0)!==0x1a45dfa3)return null;
  const info={chapters:[]};
  let scale=1000000, ticks,valid=false,count=0;
  // Descend only along the standard Segment / Info and Chapters hierarchy.
  const parents=new Map([[0x18538067,0],[0x1549a966,0x18538067],[0x1043a770,0x18538067],
    [0x45b9,0x1043a770],[0xb6,0x45b9],[0x80,0xb6]]);
  function walk(p,end,parent) {
    while(p<end && count++<4096){
      const id=vint(file,p,true);if(!id)break;
      const length=vint(file,p+id.width);if(!length)break;
      const at=p+id.width+length.width, n=length.n,stop=n===Infinity?end:at+n;
      if(!Number.isSafeInteger(stop)||stop>end || (n===Infinity && id.n!==0x18538067))break;
      if(parents.get(id.n)===parent){if(id.n===0x18538067)valid=true;walk(at,stop,id.n);}
      else if(parent===0x1549a966){
        const data=file.read(at,stop-at);
        if(id.n===0x2ad7b1 && data && n>0 && n<=6)scale=data.readUIntBE(0,n);
        if(id.n===0x4489 && data && (n===4||n===8))ticks=n===4?data.readFloatBE(0):data.readDoubleBE(0);
        if(id.n===0x7ba9)info.title=textName(data);
      }else if(parent===0x80 && id.n===0x85 && info.chapters.length<3)info.chapters.push(textName(file.read(at,n)));
      p=stop;
    }
  }
  walk(0,file.size,0);
  info.seconds=ticks*scale/1e9;
  return valid?introduction(info,true):null;
}
function list(items,limit=3) {
  return [...new Set(items.filter(Boolean))].slice(0,limit).map(n=>'「'+n+'」').join('、');
}
function model(file,ext) {
  if(ext==='obj'){
    let text=utf8.decode(file.prefix,{stream:file.size>file.prefix.length});
    if(file.size>file.prefix.length)text=text.slice(0,text.lastIndexOf('\n')+1);
    if(!/^v\s+[-+.\d]+\s+[-+.\d]+\s+[-+.\d]+/m.test(text) || !/^f\s+[-\d/]+\s+[-\d/]+\s+[-\d/]+/m.test(text))return null;
    const groups=Array.from(text.matchAll(/^(?:o|g)\s+([^\r\n]{1,90})$/gm),m=>name(m[1])).filter(Boolean);
    if(!groups.length)return {title:'立体模型',summary:'这件模型用一组顶点和面拼出了立体形状。'};
    return {title:groups[0]+'模型',summary:'模型里能找到'+list(groups)+'。'};
  }
  let data;
  if(ext==='glb'){
    const h=file.read(0,20);
    if(!h || h.toString('ascii',0,4)!=='glTF' || h.readUInt32LE(4)!==2 || h.readUInt32LE(8)!==file.size || h.toString('ascii',16,20)!=='JSON')return null;
    data=file.read(20,h.readUInt32LE(12));
  }else data=file.read(0,file.size);
  if(!data || data.length>WINDOW_LIMIT)return null;
  const obj=JSON.parse(utf8.decode(data));
  if(obj?.asset?.version!=='2.0' || !Array.isArray(obj.meshes) || !obj.meshes.length)return null;
  const names=elements=>(Array.isArray(elements)?elements.slice(0,1000):[]).map(e=>name(e?.name)).filter(Boolean);
  const scenes=names(obj.scenes), meshes=names(obj.meshes), anim=names(obj.animations);
  const subject=name(obj.scenes?.[obj.scene]?.name) || scenes[0] || meshes[0];
  const parts=[];
  if(scenes.length)parts.push('可以看到'+list(scenes)+'场景');
  if(meshes.length)parts.push('模型里有'+list(meshes));
  if(anim.length)parts.push('还带有'+list(anim)+'动画');
  if(!parts.length)parts.push('模型由 '+obj.meshes.length+' 组立体形状组成');
  return {title:subject?subject+'模型':'立体模型',summary:parts.join('，')+'。'};
}

const archiveTypes=[
  ['图片','张','png jpg jpeg gif webp svg avif bmp'],
  ['文档','份','md txt docx doc pdf odt rtf epub'],
  ['表格','张','csv tsv xlsx ods'], ['幻灯片','份','pptx odp'],
  ['音频','段','wav mp3 flac ogg opus m4a'], ['视频','段','mp4 webm mov mkv m4v'],
  ['立体模型','件','obj glb gltf stl'], ['网页','个','html htm'], ['程序文件','份','js ts jsx tsx cjs mjs py rs c cpp go java cs gd css']
];
const typeFor=new Map(archiveTypes.flatMap(([label,unit,ext])=>ext.split(' ').map(e=>[e,{label,unit}])));
function archive(file) {
  const tailLen=Math.min(file.size,65557);
  const tail=file.read(file.size-tailLen,tailLen);if(!tail || tail.length<22)return null;
  let i=tail.lastIndexOf(Buffer.from([80,75,5,6]),tail.length-22);
  while(i>=0 && i+22+tail.readUInt16LE(i+20)!==tail.length){
    if(!i)return null;
    i=tail.lastIndexOf(Buffer.from([80,75,5,6]),i-1);
  }
  if(i<0 || tail.readUInt32LE(i+4)!==0)return null;
  const count=tail.readUInt16LE(i+10), length=tail.readUInt32LE(i+12), start=tail.readUInt32LE(i+16);
  if(!count || count>4096 || count!==tail.readUInt16LE(i+8) || start+length!==file.size-tailLen+i)return null;
  const dir=file.read(start,length);if(!dir)return null;
  const types=new Map(), names=[],seen=new Set();
  let p=0;
  for(let row=0;row<count;row++){
    if(p+46>dir.length || dir.readUInt32LE(p)!==0x02014b50)return null;
    const len=dir.readUInt16LE(p+28),end=p+46+len;
    const next=end+dir.readUInt16LE(p+30)+dir.readUInt16LE(p+32);
    if(next>dir.length)return null;
    const raw=dir.subarray(p+46,end), encrypted=dir.readUInt16LE(p+8)&1, utf=dir.readUInt16LE(p+8)&0x800;
    p=next;
    if(encrypted || len>512 || (!utf && raw.some(b=>b>127)))continue;
    const filename=utf8.decode(raw);
    if(seen.has(filename) || filename.includes('\\') || filename.split('/').some(s=>!s || s.startsWith('.') || /^(?:node_modules|vendor|__MACOSX|__pycache__)$/i.test(s)) ||
       /(?:secret|credential|password|api[_-]?key|密钥|密码)/i.test(filename))continue;
    seen.add(filename);
    const base=filename.split('/').pop(),dot=base.lastIndexOf('.'),kind=typeFor.get(base.slice(dot+1).toLowerCase());
    if(dot<=0 || !kind)continue;
    types.set(kind,(types.get(kind)||0)+1);
    const stem=name(base.slice(0,dot));
    if(stem && /[\u3400-\u9fff\u3040-\u30ff]/.test(stem) && names.length<3)names.push(stem);
  }
  if(!types.size || p!==dir.length)return null;
  const counts=[...types].sort((a,b)=>b[1]-a[1]);
  const title=counts.length===1?counts[0][0].label+'合集':counts.slice(0,2).map(([type])=>type.label).join('和')+'资料包';
  const inventory=counts.slice(0,4).map(([type,n])=>n+' '+type.unit+type.label).join('、');
  return {title,summary:'打开后能找到'+inventory+'。'+(names.length?'其中有'+list(names)+'。':'')};
}

function describeMedia(buffer,extension,filename,options={}) {
  const ext=String(extension).toLowerCase().replace(/^\./,'');
  if(!MEDIA_EXTENSIONS.has(ext) || !Buffer.isBuffer(buffer))return null;
  const file=windows(buffer,options.size ?? buffer.length,options.tail || null);
  if(!file)return null;
  try{
    if(ext==='wav')return wave(file);
    if(ext==='mp3')return mp3(file);
    if(ext==='flac')return flac(file);
    if(['ogg','oga','opus'].includes(ext))return ogg(file);
    if(['mp4','m4a','mov','m4v'].includes(ext))return movie(file,ext);
    if(['mkv','webm'].includes(ext))return matroska(file);
    if(ext==='zip')return archive(file);
    return model(file,ext);
  }catch{return null;}
}
module.exports={describeMedia,MEDIA_EXTENSIONS,pcmPeaks};
