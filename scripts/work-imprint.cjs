'use strict';

const path=require('node:path').posix;
const {describeBytes,planFor,publicPath}=require('./work-content.cjs');
const {openZip,DOCUMENT_EXTENSIONS,parseXml}=require('./document-content.cjs');
const {markup}=require('./text-content.cjs');
const {pcmPeaks}=require('./media-content.cjs');
const {embeddedCover,markdownArtwork,notebookArtwork,MAX_COVER}=require('./work-illustrations.cjs');
const {readWorkCompanion}=require('./media-notes.cjs');

const CODE=new Set('js mjs cjs jsx ts tsx py rb go rs java kt c cpp cc h hpp cs swift lua gd php sh bash ps1 css scss sass less vue svelte sql r'.split(' '));
const KEYS=/credential|password|secret|(?:api|access)[_-]?(?:key|token)|密钥|密码/i;
const extOf=file=>path.extname(file).slice(1).toLowerCase();
function supportsImprint(file){
  return Boolean(typeof file==='string'&&publicPath(file)&&
    (planFor(file,0)||CODE.has(extOf(file)))&&!/^(?:mp4|m4v|mov|webm)$/.test(extOf(file)));
}
function textPrefix(bytes){
  const length=Math.min(bytes.length,96*1024);
  const encoding=bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':'utf-8';
  let text=new TextDecoder(encoding,{fatal:true}).decode(bytes.subarray(0,length),{stream:length<bytes.length});
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))return '';
  if(length<bytes.length)text=text.slice(0,Math.max(0,text.lastIndexOf('\n')));
  return text;
}
function sourceMap(text){
  const lines=text.split(/\r?\n/);
  const declaration=/^\s*(?:(?:export|default|public|private|static|async|pub)\s+)*(?:function\s*\*?|class|def|fn|func|interface|struct)\s+([A-Za-z_]\w{0,40})\b/;
  const exported=new Set((/\bmodule\.exports\s*=\s*\{\s*([\w\s,]+)\}/.exec(text)?.[1]||'').split(',').map(s=>s.trim()));
  let first=lines.findIndex(line=>exported.has(declaration.exec(line)?.[1]));
  if(first<0)first=lines.findIndex(line=>declaration.test(line));
  const heading=first<0?'':declaration.exec(lines[first])[1];
  const numericList=/^\s*(?:const|let|var)\s+([A-Za-z_]\w{0,40})\s*=\s*\[\s*(-?\d{1,4}(?:\s*,\s*-?\d{1,4}){1,5})\s*\]/m.exec(text);
  const values=numericList&&!KEYS.test(numericList[1])?numericList[2].replace(/\s+/g,'').split(',').map(Number):[];
  const rows=[];
  for(const line of lines.slice(first<0?0:first, (first<0?0:first)+18)){
    const expanded=line.replace(/\t/g,'    ');
    const value=expanded.trim();
    const role=!value?'gap':/^(?:#|\/\/|\/\*|\*)/.test(value)?'comment':
      declaration.test(line)?'define':/^(?:if|for|while|switch|return|else|case|try|catch)\b/.test(value)?'flow':'line';
    rows.push({offset:Math.min(expanded.length-expanded.trimStart().length,32),length:Math.min(value.length,100),role});
  }
  return rows.some(r=>r.length>0)?{kind:'code',label:KEYS.test(heading)?'':heading,values,rows}:null;
}
// Parse only complete records, including quoted separators and newlines.
function tableImprint(text,sep){
  let field='', row=[], inQuotes=false, closed=false;
  const rows=[];
  function endRow(){
    row.push(field.trim());
    if(row.some(Boolean))rows.push(row);
    row=[];field='';closed=false;
  }
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(inQuotes){
      if(c==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(c==='"'){inQuotes=false;closed=true;}
      else field+=c;
    }else if(c===sep){row.push(field.trim());field='';closed=false;}
    else if(c==='\n'||c==='\r'){
      if(c==='\r'&&text[i+1]==='\n')i++;
      endRow();
      if(rows.length>=17)break;
    }else if(c==='"'&&!field&&!closed){inQuotes=true;}
    else if(c==='"'||closed)return null;
    else field+=c;
    if(field.length>4096||row.length>128)return null;
  }
  if(inQuotes)return null;
  if(row.length||field||closed)endRow();
  if(rows.length<2||rows[0].length<2||rows.some(r=>r.length!==rows[0].length))return null;
  const width=Math.min(8,rows[0].length);
  const body=rows.slice(1);
  const numeric=s=>/^[+-]?(?:\d{1,12}(?:\.\d{1,8})?|\.\d{1,8})$/.test(s);
  const header=rows[0].every(s=>/^[\p{L}][\p{L}\p{M}\p{N} _()./%-]{0,26}$/u.test(s)&&!KEYS.test(s));
  const data=header?body:rows;
  const numericColumns=Array.from({length:width},(_,i)=>i).filter(i=>data.length>=2&&data.every(r=>numeric(r[i])));
  const axis=/^(?:id|index|no\.?|year|month|week|day|time|年份?|序号|编号|月份|日期|週|年)$/i;
  const col=(header?numericColumns.find(i=>!axis.test(rows[0][i])):undefined)??numericColumns[0];
  const values=col===undefined?[]:data.map(r=>Number(r[col]));
  const min=Math.min(...values),max=Math.max(...values);
  const series=values.map(n=>min===max?32:Math.round(63*(n-min)/(max-min)));
  // The silhouette is a bar chart: preserve signs and measure from zero even
  // when every value is above (or below) it. Keep the original trend series.
  const span=Math.max(0,...values)-Math.min(0,...values);
  const bars=values.map(value=>span?Math.round(63*value/span):0);
  return {kind:'table',label:header?rows[0].slice(0,2).join(' · '):'',series,bars,
    cells:rows.slice(0,7).map(r=>r.slice(0,width).map(s=>Math.min(24,s.length)))};
}
function wavePeaks(bytes){
  if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')return null;
  const end=bytes.readUInt32LE(4)+8;
  if(end>bytes.length)return null;
  let fmt,data;
  for(let i=12,n=0;i+8<=end&&n<512;n++){
    const size=bytes.readUInt32LE(i+4),start=i+8,id=bytes.toString('ascii',i,i+4);
    if(start+size>end)return null;
    if(id==='fmt '&&size>=16)fmt={format:bytes.readUInt16LE(start),channels:bytes.readUInt16LE(start+2),stride:bytes.readUInt16LE(start+12),bits:bytes.readUInt16LE(start+14)};
    if(id==='data'&&!data)data=bytes.subarray(start,start+size);
    i=start+size+(size%2);
  }
  const peaks=pcmPeaks(fmt,data,96);
  return peaks?{kind:'wave',peaks}:null;
}
function documentCover(bytes){
  const zip=openZip(bytes);
  for(const part of ['docProps/thumbnail.jpeg','docProps/thumbnail.jpg','docProps/thumbnail.png','Thumbnails/thumbnail.png']){
    const cover=embeddedCover(zip.read(part));
    if(cover)return cover;
  }
  return null;
}
// Read a front cover attached to an ID3v2 tag. Never follow linked artwork
// and skip compressed, encrypted or unsynchronised frames.
function audioCover(bytes){
  if(bytes.length<20||bytes.toString('ascii',0,3)!=='ID3'||![3,4].includes(bytes[3])||bytes[5]!==0)return null;
  const syncSize=offset=>{
    const b=bytes.subarray(offset,offset+4);
    return b.some(v=>v>127)?-1:b.reduce((n,v)=>128*n+v,0);
  };
  const end=10+syncSize(6);
  if(end<10||end>bytes.length)return null;
  for(let at=10,n=0;at+10<=end&&n++<256;){
    const id=bytes.toString('ascii',at,at+4),size=bytes[3]===3?bytes.readUInt32BE(at+4):syncSize(at+4);
    if(!/^[A-Z0-9]{4}$/.test(id)||size<1||at+10+size>end)break;
    const flags=bytes[at+9],frame=bytes.subarray(at+10,at+10+size);at+=10+size;
    if(id!=='APIC'||flags||frame[0]>3)continue;
    const mimeEnd=frame.indexOf(0,1);
    if(mimeEnd<1||mimeEnd>20||frame[mimeEnd+1]!==3)continue;
    const mime=frame.toString('ascii',1,mimeEnd);
    if(!['image/jpeg','image/png'].includes(mime))continue;
    const start=mimeEnd+2,unit=frame[0]===1||frame[0]===2?2:1;
    for(let off=start;off<Math.min(frame.length,start+4096);off+=unit){
      if(frame[off]===0&&(unit===1||frame[off+1]===0)){
        const image=embeddedCover(frame.subarray(off+unit));
        if(image?.type===mime)return image;
        break;
      }
    }
  }
  return null;
}
function pageImprint(text){
  const blocks=[];
  const found=markup(text,false,blocks);
  if(!blocks.length&&!found)return null;
  return {kind:'web',label:found?.title||'',blocks};
}
function styleImprint(text){
  const css=text.replace(/\/\*[\s\S]*?\*\//g,'');
  const colors=new Set();
  for(const m of css.matchAll(/(?:^|[;{])\s*(?:(?:background|border)(?:-color)?|color|fill|stroke|--[\w-]+)\s*:\s*#([0-9a-f]{6}|[0-9a-f]{3})(?=\s*[;}!])/gi)){
    const hex=m[1].toLowerCase();
    colors.add('#'+(hex.length===3?[...hex].map(c=>c+c).join(''):hex));
    if(colors.size===8)break;
  }
  return colors.size>=2?{kind:'colors',colors:[...colors]}:sourceMap(text);
}
// A static drawing is reduced to canvas path geometry and solid paint. Keep
// markup, references, stylesheets and external resources outside the payload.
function vectorImprint(bytes){
  if(bytes.length>256*1024)return null;
  const tree=parseXml(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  const root=tree.children.filter(n=>typeof n==='object');
  if(root.length!==1||root[0].name!=='svg')return null;
  const svg=root[0],numbers=s=>String(s??'').trim().split(/[\s,]+/).map(Number);
  const dim=s=>/^\d+(?:\.\d+)?(?:px)?$/.test(s||'')?parseFloat(s):0;
  const w=dim(svg.attrs.width),h=dim(svg.attrs.height);
  const view=svg.attrs.viewBox?numbers(svg.attrs.viewBox):[0,0,w,h];
  if(view.length!==4||view.some(n=>!Number.isFinite(n)||Math.abs(n)>1e6)||view[2]<=0||view[3]<=0)return null;
  if(svg.attrs.preserveAspectRatio&&!/^xMidYMid(?:\s+meet)?$/.test(svg.attrs.preserveAspectRatio))return null;
  const shapes=[];
  const named=/^(?:none|black|silver|gray|grey|white|maroon|red|purple|fuchsia|green|lime|olive|yellow|navy|blue|teal|aqua|orange|pink|transparent)$/i;
  const paint=v=>named.test(v)||/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(v)||
    /^rgba?\(\s*[+\-\d.%\s,/]+\)$/i.test(v);
  function visit(node,inherited){
    if(typeof node!=='object'||['title','desc','metadata'].includes(node.name))return true;
    const a=node.attrs;
    if(a.display==='none')return true;
    if(Object.keys(a).some(k=>/^on|href$|^(?:style|class|transform|filter|mask|clip-path|marker(?:-start|-mid|-end)?|opacity|fill-opacity|stroke-opacity|stroke-dasharray|stroke-dashoffset|stroke-miterlimit|paint-order|vector-effect|visibility)$/i.test(k)))return false;
    const color=a.color||inherited.color;
    const resolve=v=>String(v).toLowerCase()==='currentcolor'?color:v;
    const fill=resolve(a.fill??inherited.fill),stroke=resolve(a.stroke??inherited.stroke),line=Number(a['stroke-width']??inherited.line);
    const rule=a['fill-rule']||inherited.rule,cap=a['stroke-linecap']||inherited.cap,join=a['stroke-linejoin']||inherited.join;
    if(!paint(fill)||!paint(stroke)||!Number.isFinite(line)||line<0||line>1e5||
       !['evenodd','nonzero'].includes(rule)||!['butt','round','square'].includes(cap)||!['miter','round','bevel'].includes(join))return false;
    const style={color,fill,stroke,line,rule,cap,join};
    if(node.name==='g'||node===svg)return node.children.every(n=>visit(n,style));
    if(shapes.length>=768)return false;
    const num=(k,otherwise=0)=>a[k]===undefined?otherwise:Number(a[k]);
    let d;
    if(node.name==='path')d=a.d;
    else if(node.name==='line')d='M '+num('x1')+' '+num('y1')+' L '+num('x2')+' '+num('y2');
    else if(node.name==='circle'||node.name==='ellipse'){
      const x=num('cx'),y=num('cy'),rx=num(node.name==='circle'?'r':'rx'),ry=num(node.name==='circle'?'r':'ry');
      if(rx<=0||ry<=0)return true;
      d='M '+(x-rx)+' '+y+' a '+rx+' '+ry+' 0 1 0 '+(2*rx)+' 0 a '+rx+' '+ry+' 0 1 0 '+(-2*rx)+' 0 Z';
    }else if(node.name==='rect'){
      const x=num('x'),y=num('y'),w=num('width'),h=num('height');
      if(w<=0||h<=0)return true;
      const rx=Math.min(w/2,num('rx',num('ry'))),ry=Math.min(h/2,num('ry',num('rx')));
      if(rx<0||ry<0)return false;
      if(rx&&ry){
        const turn=' a '+rx+' '+ry+' 0 0 1 ';
        d='M '+(x+rx)+' '+y+' h '+(w-2*rx)+turn+rx+' '+ry+' v '+(h-2*ry)+turn+(-rx)+' '+ry+' h '+(2*rx-w)+turn+(-rx)+' '+(-ry)+' v '+(2*ry-h)+turn+rx+' '+(-ry)+' Z';
      }else d='M '+x+' '+y+' h '+w+' v '+h+' h '+(-w)+' Z';
    }else if(node.name==='polygon'||node.name==='polyline'){
      const pts=numbers(a.points);
      if(pts.length<4||pts.length%2)return false;
      d='M '+pts.join(' ')+(node.name==='polygon'?' Z':'');
    }else return false;
    if(!d||d.length>65536||!/^\s*[Mm]/.test(d)||!/^[-+.\d\s,aAcChHlLmMqQsStTvVzZeE]+$/.test(d)||
       [...d.matchAll(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)].some(m=>Math.abs(Number(m[0]))>1e6))return false;
    if(fill!=='none'||stroke!=='none')shapes.push({d,fill,stroke,line,rule,cap,join});
    return true;
  }
  if(!visit(svg,{color:'black',fill:'black',stroke:'none',line:1,rule:'nonzero',cap:'butt',join:'miter'})||!shapes.length)return null;
  return {kind:'vector',view,size:[w||view[2],h||view[3]],shapes};
}
function describeImprint(file,bytes,linkedImages){
  if(!supportsImprint(file)||!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>16*1024*1024)return null;
  const ext=extOf(file);
  try{
    if(['md','mdx','markdown'].includes(ext)){
      const artwork=markdownArtwork(file,bytes,tableImprint,linkedImages);
      if(artwork)return artwork;
    }
    if(ext==='ipynb'){
      const artwork=notebookArtwork(bytes);
      if(artwork)return artwork;
    }
    if(ext==='svg'){
      const vector=vectorImprint(bytes);
      if(vector)return vector;
    }
    if(DOCUMENT_EXTENSIONS.has(ext)&&ext!=='pdf'){
      const cover=documentCover(bytes);
      if(cover)return cover;
    }
    if(ext==='wav'){
      const wave=wavePeaks(bytes);
      if(wave)return wave;
    }
    if(ext==='mp3'){
      const cover=audioCover(bytes);
      if(cover)return cover;
    }
    if(['css','scss','less','sass'].includes(ext))return styleImprint(textPrefix(bytes));
    if(CODE.has(ext))return sourceMap(textPrefix(bytes));
    if(ext==='csv'||ext==='tsv')return tableImprint(textPrefix(bytes),ext==='csv'?',':'\t');
    if(ext==='htm'||ext==='html')return pageImprint(textPrefix(bytes));
    const description=describeBytes(file,bytes);
    if(description)return {kind:'excerpt',label:description.title,text:description.summary};
  }catch{/* Truncated or unsupported representations have no faithful miniature. */}
  return null;
}
async function projectImprint(file,bytes,context){
  const linked=[];
  const direct=describeImprint(file,bytes,linked);
  if(!linked.length||direct?.kind==='cover')return direct;
  const {commit,outputs,fingerprint}=context;
  const owner=!commit&&outputs.find(o=>o.sourceId==='local-files'&&o.fingerprint===fingerprint&&o.files.includes(file));
  if(!commit&&!Number.isFinite(Date.parse(owner?.timestamp)))return direct;
  for(const name of linked){
    const image=await readWorkCompanion(name,MAX_COVER,context,owner?.timestamp);
    if(!image)continue;
    try{
      const artwork=extOf(name)==='svg'?vectorImprint(image):embeddedCover(image);
      if(artwork)return artwork;
    }catch{/* Later recorded drawings or the document's own excerpt may be available. */}
  }
  return direct;
}
module.exports={supportsImprint,describeImprint,projectImprint};
