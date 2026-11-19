'use strict';
const {inflateSync}=require('node:zlib');
const invalid=()=>{throw new Error('Unsupported PDF');};
const textLimit=1024*1024;

// Parse a deliberately small PDF subset. Follow the active cross-reference
// table and page tree, keeping attachments, old revisions and binary strings
// from arbitrary objects outside the reader.
class Reader {
  constructor(source,at=0){this.source=source;this.at=at;this.count=0;}
  match(re){
    re.lastIndex=this.at;
    const m=re.exec(this.source);
    if(m)this.at=re.lastIndex;
    return m;
  }
  space(){this.match(/(?:[\t\n\f\r \0]+|%[^\r\n]*(?:\r\n?|\n|$))*/y);}
  token(depth=0){
    this.space();
    if(depth>24 || ++this.count>40000)invalid();
    const char=this.source[this.at];
    if(this.source.startsWith('<<',this.at)){
      const dict=Object.create(null);
      this.at+=2;
      while(true){
        this.space();
        if(this.source.startsWith('>>',this.at)){this.at+=2;return dict;}
        const name=this.token(depth+1);
        if(typeof name!=='string'||!name.startsWith('/'))invalid();
        dict[name.slice(1)]=this.token(depth+1);
      }
    }
    if(char==='['){
      this.at++;
      const list=[];
      while(true){
        this.space();
        if(this.source[this.at]===']'){this.at++;return list;}
        list.push(this.token(depth+1));
      }
    }
    if(char==='('){
      this.at++;
      let raw='',levels=1;
      while(this.at<this.source.length && raw.length<=8192){
        let c=this.source[this.at++];
        if(c==='\\'){
          c=this.source[this.at++];
          if(c==='\n'||c==='\r'){if(c==='\r'&&this.source[this.at]==='\n')this.at++;continue;}
          if(/[0-7]/.test(c))raw+=String.fromCharCode(parseInt(c+(this.match(/[0-7]{0,2}/y)?.[0]||''),8)&255);
          else raw+=({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f'}[c]??c);
        }else{
          if(c==='(' && ++levels>24)invalid();
          if(c===')' && --levels===0)return Buffer.from(raw,'latin1');
          raw+=c;
        }
      }
      invalid();
    }
    if(char==='<'){
      const hex=this.match(/<([\da-fA-F\s]{0,16384})>/y);
      if(!hex)invalid();
      let value=hex[1].replace(/\s/g,'');
      if(value.length%2)value+='0';
      return Buffer.from(value,'hex');
    }
    const ref=this.match(/(\d{1,9})\s+(\d{1,5})\s+R\b/y);
    if(ref)return {ref:Number(ref[1]),gen:Number(ref[2])};
    const word=this.match(/\/?[^\s\0()[\]{}<>/%]+/y)?.[0];
    if(!word)invalid();
    return /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(word)?Number(word):word;
  }
}
function metadata(value) {
  if(!Buffer.isBuffer(value))return '';
  if(value[0]===254&&value[1]===255)return new TextDecoder('utf-16be',{fatal:true}).decode(value.subarray(2));
  if(value[0]===239&&value[1]===187&&value[2]===191)return new TextDecoder('utf-8',{fatal:true}).decode(value);
  return value.every(b=>b>=32&&(b<127||b>=161))?value.toString('latin1'):'';
}
function ascii85(bytes) {
  let text=bytes.toString('latin1').replace(/\s/g,'');
  if(!text.endsWith('~>'))invalid();
  text=text.slice(0,-2);
  const out=[],group=[];
  function flush(take){
    let value=0;
    for(const digit of group)value=value*85+digit;
    if(value>0xffffffff)invalid();
    for(let offset=0;offset<take;offset++)out.push(value>>>(24-8*offset)&255);
    group.length=0;
  }
  for(const c of text){
    if(c==='z'&&!group.length)out.push(0,0,0,0);
    else{
      const n=c.charCodeAt(0)-33;
      if(n<0||n>84)invalid();
      group.push(n);
      if(group.length===5)flush(4);
    }
    if(out.length>textLimit)invalid();
  }
  const tail=group.length;
  if(tail===1)invalid();
  if(tail){while(group.length<5)group.push(84);flush(tail-1);}
  return Buffer.from(out);
}
function pageText(bytes,fonts) {
  const r=new Reader(bytes.toString('latin1')),lines=[],args=[];
  let line='',inText=false,font='',paint=0;
  const finish=()=>{if(line.trim())lines.push(line.trim());line='';};
  const show=b=>{if(inText&&paint!==3&&paint!==7&&fonts.has(font)&&Buffer.isBuffer(b)&&line.length<2048)line+=new TextDecoder('windows-1252').decode(b);};
  while(r.at<r.source.length && lines.length<12){
    r.space();if(r.at===r.source.length)break;
    const t=r.token();
    if(typeof t!=='string'||t.startsWith('/')){if(args.length>256)invalid();args.push(t);continue;}
    if(t==='BI'||t==='BDC'||t==='BMC')return lines; // Inline images and optional content layers need a renderer.
    if(t==='BT'){finish();inText=true;}
    else if(t==='ET'){finish();inText=false;}
    else if(t==='Tf')font=args.at(-2);
    else if(t==='Tr')paint=args.at(-1);
    else if(t==='Tm'||t==='Td'||t==='TD'||t==='T*')finish();
    else if(t==="'"||t==='"'){finish();show(args.at(-1));}
    else if(t==='Tj')show(args.at(-1));
    else if(t==='TJ'&&Array.isArray(args.at(-1)))for(const piece of args.at(-1))show(piece);
    args.length=0;
  }
  finish();return lines;
}
function readPdf(bytes) {
  if(bytes.subarray(0,5).toString()!=='%PDF-')return null;
  const source=bytes.toString('latin1');
  const end=/startxref\s+(\d{1,9})\s+%%EOF\s*$/.exec(source.slice(-256));
  if(!end)return null;
  const r=new Reader(source,Number(end[1]));
  if(!r.match(/xref\b/y))return null;
  const refs=new Map();
  while(true){
    r.space();if(r.match(/trailer\b/y))break;
    const block=r.match(/(\d+)\s+(\d+)[ \t]*[\r\n]+/y);
    if(!block||Number(block[2])>8192||refs.size+Number(block[2])>8192)return null;
    for(let i=0;i<Number(block[2]);i++){
      const row=r.match(/(\d{10}) (\d{5}) ([fn])[ \t]*[\r\n]+/y);
      if(!row)return null;
      if(row[3]==='n')refs.set(Number(block[1])+i,{at:Number(row[1]),gen:Number(row[2])});
    }
  }
  const trailer=r.token();
  if(!trailer?.Root||trailer.Encrypt||trailer.Prev||trailer.XRefStm)return null;
  let reads=0;
  function object(ref){
    if(++reads>80||!ref?.ref)return null;
    const entry=refs.get(ref.ref);
    if(!entry||entry.gen!==ref.gen)return null;
    const obj=new Reader(source,entry.at),header=obj.match(/(\d+)\s+(\d+)\s+obj\b/y);
    if(!header||Number(header[1])!==ref.ref||Number(header[2])!==ref.gen)return null;
    return {value:obj.token(),reader:obj};
  }
  function deref(d){return d?.ref?object(d)?.value:d;}
  const info=deref(trailer.Info);
  const title=metadata(info?.Title),lines=[metadata(info?.Subject)].filter(Boolean);
  try{
    const root=deref(trailer.Root);
    if(root?.Type!=='/Catalog')return null;
    let page=deref(root.Pages),resources=page?.Resources;
    for(let d=0;page?.Type==='/Pages'&&d<10;d++){
      page=deref(page.Kids?.[0]);resources=page?.Resources||resources;
    }
    if(page?.Type==='/Page'){
      const fonts=new Set(), declared=deref(deref(resources)?.Font);
      for(const [name,ref] of Object.entries(declared||{}).slice(0,32)){
        const f=deref(ref);
        if(f?.Subtype==='/Type1' && !f.ToUnicode && (!f.Encoding || f.Encoding==='/WinAnsiEncoding') &&
            /^\/(?:Times-(?:Roman|Bold|Italic|BoldItalic)|(?:Helvetica|Courier)(?:-(?:Bold|Oblique|BoldOblique))?)$/.test(f.BaseFont))fonts.add('/'+name);
      }
      for(const ref of (Array.isArray(page.Contents)?page.Contents:[page.Contents]).slice(0,2)){
        const obj=object(ref);
        if(!obj||!fonts.size)continue;
        const {value:dict,reader}=obj, length=deref(dict.Length);
        reader.space();
        if(!reader.match(/stream(?:\r\n|\n|\r)/y)||!Number.isSafeInteger(length)||length<1||length>textLimit)continue;
        let buf=bytes.subarray(reader.at,reader.at+length);
        if(buf.length!==length||dict.DecodeParms)continue;
        for(const filter of [].concat(dict.Filter||[])){
          if(filter==='/FlateDecode')buf=inflateSync(buf,{maxOutputLength:textLimit});
          else if(filter==='/ASCII85Decode')buf=ascii85(buf);
          else invalid();
        }
        lines.push(...pageText(buf,fonts));
      }
    }
  }catch{/* Metadata remains usable if a page requires an unsupported encoding. */}
  return title||lines.length?{title,lines}:null;
}
module.exports={readPdf};
