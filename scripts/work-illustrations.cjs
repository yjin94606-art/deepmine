'use strict';
const path=require('node:path').posix;
const {publicPath}=require('./work-content.cjs');

const MAX_COVER=384*1024;
function embeddedCover(bytes){
  if(!bytes||bytes.length<24||bytes.length>MAX_COVER)return null;
  let width,height,type;
  if(bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&bytes.toString('ascii',12,16)==='IHDR'){
    type='image/png';width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);
  }else if(bytes.readUInt16BE(0)===0xffd8){
    type='image/jpeg';
    for(let at=2,n=0;at+9<=bytes.length&&n++<128;){
      if(bytes[at]!==255)break;
      const id=bytes[at+1],size=bytes.readUInt16BE(at+2);
      if(size<2||at+2+size>bytes.length)break;
      if([0xc0,0xc1,0xc2].includes(id)&&size>=8){height=bytes.readUInt16BE(at+5);width=bytes.readUInt16BE(at+7);break;}
      at+=2+size;
    }
  }
  return width&&height&&width*height<=2_500_000?{kind:'cover',type,data:bytes.toString('base64')}:null;
}
function fromBase64(type,encoded){
  if(typeof encoded!=='string'||encoded.length>MAX_COVER*4/3||!encoded.length||encoded.length%4||
    !/^[a-zA-Z\d+/]+={0,2}$/.test(encoded))return null;
  const cover=embeddedCover(Buffer.from(encoded,'base64'));
  return cover?.type===type?cover:null;
}

// Look only at a standalone, visible Markdown image. URLs, examples in code,
// comments and closed HTML/details sections must never become an item's art.
function markdownLines(text){
  const clean=text.replace(/<!--[\s\S]*?(?:-->|$)/g,'');
  const rawLines=clean.split(/\r?\n/,6000),front=/^(---|\+\+\+)$/.exec(rawLines[0]?.trim());
  let start=0;
  if(front){
    const last=rawLines.findIndex((line,i)=>i>0 && (line.trim()===front[1] || front[1]==='---'&&line.trim()==='...'));
    if(last<0)return [];
    start=last+1;
  }
  const lines=[];
  let fence='',markup=null,depth=0;
  for(const raw of rawLines.slice(start)){
    if(fence){
      if(raw.trimEnd().trimStart().startsWith(fence)&&/^ {0,3}(?:`+|~+)\s*$/.test(raw))fence='';
      lines.push('');continue;
    }
    const delimiter=!markup&&/^ {0,3}(`{3,}|~{3,})/.exec(raw);
    if(delimiter){fence=delimiter[1];lines.push('');continue;}
    if(!markup&&/^(?: {4}|\t)/.test(raw)){lines.push('');continue;}
    const html=!markup&&/^\s*<([A-Za-z][\w-]*)\b/.exec(raw);
    if(html&&!['hr','br','img','input','meta','link','source','wbr'].includes(html[1].toLowerCase()))
      markup=new RegExp('<(/?)'+html[1]+'\\b[^>]*>','gi');
    if(markup){
      for(const element of raw.matchAll(markup)){
        if(element[0].endsWith('/>'))continue;
        depth=Math.max(0,depth+(element[1]?-1:1));
      }
      if(depth===0)markup=null;
      lines.push('');continue;
    }
    lines.push(raw.trim());
  }
  return lines;
}
function localImagePath(file,destination){
  try{
    const target=decodeURIComponent(destination);
    if(target.length>2048||/^\/|[:\\?#\u0000-\u001f]/.test(target)||!/[.](?:png|jpe?g|svg)$/i.test(target))return null;
    const relative=path.join(path.dirname(file),target);
    return publicPath(relative)?relative:null;
  }catch{return null;}
}
function markdownArtwork(file,bytes,tableImprint,candidates){
  if(bytes.length>2*1024*1024)return null;
  const encoding=bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':'utf-8';
  const lines=markdownLines(new TextDecoder(encoding,{fatal:true}).decode(bytes));
  for(const line of lines){
    if(!line.startsWith('!['))continue;
    const image=/^!\[[^\]\n]{0,500}\]\(\s*(?:<([^<>]+)>|([^\s()]+))(?:\s+["'][^"'\n]{0,300}["'])?\s*\)$/.exec(line);
    if(!image)continue;
    const dst=image[1]||image[2],data=/^data:(image\/png|image\/jpeg);base64,/i.exec(dst);
    if(data){
      const cover=fromBase64(data[1].toLowerCase(),dst.slice(data[0].length));
      if(cover)return cover;
    }else if(candidates && candidates.length<3){
      const linked=localImagePath(file,dst);
      if(linked&&!candidates.includes(linked))candidates.push(linked);
    }
  }
  const fields=line=>line.replace(/^\||\|$/g,'').split('|').map(s=>s.trim());
  for(let i=1;i+2<lines.length;i++){
    if(!lines[i].includes('|')||!/^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[i]))continue;
    const header=fields(lines[i-1]);
    if(header.length<2||header.length!==fields(lines[i]).length)continue;
    const rows=[header];
    for(let j=i+1;j<lines.length&&rows.length<17&&lines[j].includes('|');j++){
      if(/[\\`]/.test(lines[j]))break;
      const row=fields(lines[j]);
      if(row.length!==header.length)break;
      rows.push(row);
    }
    const chart=tableImprint(rows.map(r=>r.join('\t')).join('\n'),'\t');
    if(chart?.bars.length)return chart;
  }
  return null;
}
function notebookArtwork(bytes){
  if(bytes.length>8*1024*1024)return null;
  const notebook=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(notebook?.nbformat!==4||!Array.isArray(notebook.cells))return null;
  const hiddenTags=new Set(['hide-output','remove-output','remove-cell','hide-cell']);
  for(const cell of notebook.cells.slice(0,256)){
    if(cell?.cell_type!=='code'||!Array.isArray(cell.outputs)||cell.metadata?.jupyter?.outputs_hidden||
      cell.metadata?.collapsed||Array.isArray(cell.metadata?.tags)&&cell.metadata.tags.some(t=>hiddenTags.has(t)))continue;
    for(const out of cell.outputs.slice(0,32)){
      if(!['display_data','execute_result'].includes(out?.output_type))continue;
      for(const type of ['image/png','image/jpeg']){
        const value=out.data?.[type];
        const encoded=Array.isArray(value)&&value.every(v=>typeof v==='string')?value.join(''):value;
        if(typeof encoded!=='string'||encoded.length>MAX_COVER*1.5)continue;
        const cover=fromBase64(type,encoded.replace(/[\r\n]/g,''));
        if(cover)return cover;
      }
    }
  }
  return null;
}
module.exports={embeddedCover,markdownArtwork,notebookArtwork,MAX_COVER};
