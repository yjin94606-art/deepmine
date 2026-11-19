'use strict';
const path = require('node:path').posix;
const {inflateRawSync} = require('node:zlib');
const {readPdf} = require('./document-pdf.cjs');

const DOCUMENT_LIMIT = 16 * 1024 * 1024;
const DOCUMENT_EXTENSIONS = new Set(['docx','pptx','xlsx','odt','odp','ods','pdf']);
const partLimit = 2 * 1024 * 1024;
const invalid = () => { throw new Error('Unsupported document'); };
const decoder = new TextDecoder('utf-8',{fatal:true});
const crcTable = Array.from({length:256},(_,i)=>{
  for(let k=0;k<8;k++) i = i&1 ? 0xedb88320^(i>>>1) : i>>>1;
  return i>>>0;
});
function crc32(bytes) {
  let n=0xffffffff;
  for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);
  return (n^0xffffffff)>>>0;
}

// Only package parts explicitly requested by a format reader are inflated.
// Never extract entries to disk or open an external relationship.
function openZip(bytes) {
  let end=bytes.length-22;
  for(;end>=Math.max(0,bytes.length-65557);end--){
    if(bytes.readUInt32LE(end)===0x06054b50 && end+22+bytes.readUInt16LE(end+20)===bytes.length)break;
  }
  if(end<0||bytes.readUInt32LE(end)!==0x06054b50||bytes.readUInt32LE(end+4)!==0)invalid();
  const entries=bytes.readUInt16LE(end+10), directory=bytes.readUInt32LE(end+16);
  if(entries>4096 || entries!==bytes.readUInt16LE(end+8) || directory+bytes.readUInt32LE(end+12)!==end)invalid();
  let at=directory,remaining=6*1024*1024;
  const parts=new Map();
  for(let i=0;i<entries;i++){
    if(at+46>end || bytes.readUInt32LE(at)!==0x02014b50)invalid();
    const length=bytes.readUInt16LE(at+28),next=at+46+length+bytes.readUInt16LE(at+30)+bytes.readUInt16LE(at+32);
    if(next>end||length>1024)invalid();
    const name=bytes.toString('utf8',at+46,at+46+length);
    if(parts.has(name))invalid();
    parts.set(name,at); at=next;
  }
  if(at!==end)invalid();
  function read(name) {
    const p=parts.get(name);
    if(p===undefined)return null;
    const size=bytes.readUInt32LE(p+24),compressed=bytes.readUInt32LE(p+20),local=bytes.readUInt32LE(p+42);
    const method=bytes.readUInt16LE(p+10);
    if(bytes.readUInt16LE(p+8)&1 || ![0,8].includes(method) || size>partLimit || size>remaining ||
        local+30>directory || bytes.readUInt32LE(local)!==0x04034b50 || bytes.readUInt16LE(local+8)!==method)invalid();
    const nameEnd=local+30+bytes.readUInt16LE(local+26),data=nameEnd+bytes.readUInt16LE(local+28);
    if(data+compressed>directory || bytes.toString('utf8',local+30,nameEnd)!==name)invalid();
    remaining-=size;
    const packed=bytes.subarray(data,data+compressed);
    const result=method===0?packed:inflateRawSync(packed,{maxOutputLength:Math.max(1,size)});
    if(result.length!==size || crc32(result)!==bytes.readUInt32LE(p+16))invalid();
    return result;
  }
  return {xml:name=>{const part=read(name);return part?xml(decoder.decode(part)):null;},read};
}

function decodeXml(value) {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d{1,7}|#x[\da-f]{1,6});/gi,(_,token)=>{
    if(token[0]!=='#')return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[token]??'';
    const n=Number.parseInt(token.slice(token[1]==='x'?2:1),token[1]==='x'?16:10);
    return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';
  });
}
const localName = name=>name.slice(name.lastIndexOf(':')+1);
// Keep text and tags in source order. Prefixes vary between valid producers.
function xml(text) {
  if(/<!DOCTYPE|<!ENTITY/i.test(text))invalid();
  const root={name:'',attrs:{},children:[]},stack=[root];
  const tokens=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:[^<>"']|"[^"]*"|'[^']*')*)>|([^<]+)/gy;
  let count=0,i=0,m;
  while(i<text.length){
    if(!(m=tokens.exec(text)) || ++count>85000 || stack.length>64)invalid();
    i=tokens.lastIndex;
    const parent=stack.at(-1);
    if(m[1]!==undefined)parent.children.push(m[1]);
    else if(m[2]){if(stack.length===1||parent.tag!==m[2])invalid();stack.pop();}
    else if(m[3]){
      const attrs=Object.create(null);
      for(const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))attrs[a[1]]=decodeXml(a[2]??a[3]);
      const node={name:localName(m[3]),tag:m[3],attrs,children:[]};
      parent.children.push(node);
      if(!/\/\s*$/.test(m[4]))stack.push(node);
    }else if(m[5] && (m[5].trim() || !m[5].includes('\n')))parent.children.push(decodeXml(m[5]));
  }
  if(stack.length!==1)invalid();
  return root;
}
const nodes = n=>(n?.children||[]).filter(c=>typeof c!=='string');
const omitted = new Set(['del','moveFrom','annotation','change-info','tracked-changes','notes','note','rPh']);
function find(n,name,list=[],max=128) {
  for(const child of nodes(n)){
    if(list.length===max)break;
    if(omitted.has(child.name) || (child.name==='section' && attr(child,'display')==='none'))continue;
    if(child.name===name)list.push(child);
    else find(child,name,list,max);
  }
  return list;
}
function attr(n,name) {
  if(!n)return '';
  return n.attrs[name] ?? Object.entries(n.attrs).find(([key])=>localName(key)===name)?.[1] ?? '';
}
function words(n) {
  if(!n||omitted.has(n.name))return '';
  if(n.name==='s' || n.name==='tab' || n.name==='br' || n.name==='line-break')return ' ';
  return n.children.map(c=>typeof c==='string'?c:words(c)).join('');
}
function safe(text,max=140) {
  const value=(text||'').replace(/\s+/gu,' ').trim();
  if(value.length<2||value.length>1800||!/\p{L}/u.test(value)||
    /[<>{}\p{Cf}\u0000-\u001f]|https?:\/\/|[\w.+-]+@[\w.-]+\.\w+|(?:[a-z]:\\|\/(?:Users|home)\/)|[A-Za-z0-9_=-]{32,}|(?:password|passwd|bearer\s|credential|secret|private[ _-]*key|api[ _-]*(?:key|token)|access[ _-]*token|authorization:|sk[-_][\w-]{6,}|gh[pousr]_|AKIA[A-Z0-9]|密码|密钥|口令)/iu.test(value)||
    /^(?:untitled(?: document)?|unspecified|default|title|presentation\d*|sheet\s*\d+|slide\s*\d+|document\d*|untitled presentation|microsoft (?:word|powerpoint|excel)|click to (?:add|edit).+|无标题|标题|工作表\s*\d+|幻灯片\s*\d+|单击此处.+)$/i.test(value))return '';
  const chars=Array.from(value);
  return chars.length>max?chars.slice(0,max-1).join('').trimEnd()+'…':value;
}
function unique(rows) { return [...new Set(rows.filter(Boolean))]; }
const lang = s=>/[ぁ-んァ-ヶ]/.test(s)?2:/\p{Script=Han}/u.test(s)?0:1;
function prose(title,body,kind='文档') {
  const lines=unique(body.map(s=>safe(s))), candidate=safe(title,100)||safe(lines[0],100);
  if(!candidate)return null;
  const rest=lines.filter(s=>s!==candidate && !(candidate.endsWith('…') && s.startsWith(candidate.slice(0,-1)))).slice(0,2);
  const language=lang(candidate+rest.join(''));
  if(rest.length)return {title:candidate,summary:rest.join(language===1?' · ':'　')};
  return {title:candidate,summary:['这份'+kind+'的题目是《'+candidate+'》。','This '+(kind==='演示稿'?'presentation':'document')+' is titled “'+candidate+'”.','「'+candidate+'」という題の'+(kind==='演示稿'?'スライド':'文書')+'です。'][language]};
}
function describeSlides(titles,body,meta){
  const headings=unique(titles.map(t=>safe(t,96)));
  const introduction=prose(headings[0]||meta,body,'演示稿');
  if(!introduction || headings.length<2)return introduction;
  const next=headings.slice(1,4),language=lang(headings.join(''));
  const contents=['后面讲到'+next.map(s=>'「'+s+'」').join('、')+'。',
    'Later slides cover '+next.map(s=>'“'+s+'”').join(', ')+'.', '続くスライドでは'+next.map(s=>'「'+s+'」').join('、')+'を取り上げます。'][language];
  const opening=body.map(s=>safe(s)).find(s=>s && !headings.includes(s));
  if(!opening)return {title:introduction.title,summary:contents};
  const stop=/[。！？.!?…]$/.test(opening)?'':language===1?'.':'。';
  return {title:introduction.title,summary:opening+stop+(language===1?' ':'')+contents};
}
function wordText(p) {
  return find(p,'r').filter(r=>!find(r,'vanish').some(v=>!['false','0','off'].includes(attr(v,'val')))).map(r=>find(r,'t').map(words).join('')).join('');
}
function sheet(title,columns,otherSheets) {
  const fields=unique(columns.map(v=>safe(v,48))).slice(0,6);
  const names=unique(otherSheets.map(v=>safe(v,50))).slice(0,3);
  title=safe(title,80);
  const language=lang([title,...fields,...names].join(''));
  if(!title && fields.length>=2)title=[fields.slice(0,2).join('与')+'表',fields.slice(0,2).join(' and '),fields.slice(0,2).join('と')+'の表'][language];
  if(!title)title=names.shift();
  if(!title)return null;
  const more=names.filter(s=>s!==title);
  const details=[];
  if(fields.length)details.push(['表里按'+fields.map(f=>'「'+f+'」').join('、')+'分栏。','The columns cover '+fields.join(', ')+'.',fields.join('、')+'の列があります。'][language]);
  if(more.length)details.push(['还有'+more.map(f=>'「'+f+'」').join('、')+'工作表。','Other sheets include '+more.join(', ')+'.','ほかに'+more.join('、')+'のシートがあります。'][language]);
  return {title,summary:details.join(language===1?' ':'')||['工作簿里有一张「'+title+'」表。','The workbook contains a sheet named “'+title+'”.','「'+title+'」というシートがあります。'][language]};
}
// An ordinary first row may already contain data. In that case promote only
// clearly named columns. A declared table header can supply custom captions.
const headerLabel=/^(?:(?:销售|产品|商品|项目|平均|预计|实际|采样|观测|客户|订单|实验|测试|任务)?(?:时间|月份|日期|销量|销售额|支出|收入|金额|费用|价格|名称|类型|类别|状态|结果|地区|区域|城市|数量|单位|库存|进度|温度|气温|预算|评分|渠道|科目|年龄)|(?:sales |order |project |product |total |average )?(?:name|month|date|time|category|region|city|quantity|units|budget|cost|amount|income|revenue|sales|price|result|score|status|temperature|stock|channel)|日付|名前|価格|気温|売上|都市|数量)$/i;
function relationships(zip,owner) {
  const dir=path.dirname(owner),rels=zip.xml(path.join(dir,'_rels',path.basename(owner)+'.rels'));
  const map=new Map();
  for(const rel of find(rels,'Relationship',[],4096)){
    const target=attr(rel,'Target'),type=attr(rel,'Type').split('/').pop();
    if(!target||attr(rel,'TargetMode')==='External'||/[:\\?#\x00]/.test(target))continue;
    const part=path.normalize(target.startsWith('/')?target.slice(1):path.join(dir,target));
    if(!part.startsWith('../'))map.set(attr(rel,'Id'),{part,type});
  }
  return map;
}
function relId(node) {return Object.entries(node?.attrs||{}).find(([k])=>k.includes(':')&&localName(k)==='id')?.[1];}
function presentation(zip,meta) {
  const owner='ppt/presentation.xml', rels=relationships(zip,owner), xml=zip.xml(owner);
  const titles=[],body=[];let visible=0;
  for(const ref of find(find(xml,'sldIdLst')[0],'sldId',[],12)){
    const link=rels.get(relId(ref)); if(link?.type!=='slide')continue;
    const slide=find(zip.xml(link.part),'sld')[0];
    if(!slide||['0','false'].includes(attr(slide,'show')))continue;
    visible++;
    for(const shape of find(find(slide,'spTree')[0],'sp',[],64)){
      if(['1','true'].includes(attr(find(shape,'cNvPr')[0],'hidden')))continue;
      const kind=attr(find(shape,'ph')[0],'type');
      if(['sldNum','ftr','dt'].includes(kind))continue;
      const text=find(find(shape,'txBody')[0],'p',[],8).map(p=>safe(find(p,'t').map(words).join(''))).filter(Boolean);
      if(['title','ctrTitle'].includes(kind))titles.push(...text);else body.push(...text);
    }
    if(titles.length>=4)break;
  }
  return visible?describeSlides(titles,body,meta):null;
}
function workbook(zip,meta) {
  const owner='xl/workbook.xml', book=zip.xml(owner),rels=relationships(zip,owner);
  const sheets=find(find(book,'sheets')[0],'sheet').filter(s=>!['hidden','veryHidden'].includes(attr(s,'state')));
  if(!sheets.length)return null;
  const first=sheets[0], target=rels.get(relId(first));
  const names=sheets.map(s=>attr(s,'name'));
  let fields=[];
  if(target?.type==='worksheet'){
    const ws=zip.xml(target.part),table=find(ws,'tablePart')[0];
    if(table){
      const ref=relationships(zip,target.part).get(relId(table));
      if(ref?.type==='table'){
        const tbl=find(zip.xml(ref.part),'table')[0];
        if(tbl && attr(tbl,'headerRowCount')!=='0')fields=find(tbl,'tableColumn',[],32).map(c=>attr(c,'name'));
      }
    }
    if(!fields.length){
      const row=find(find(ws,'sheetData')[0],'row',[],1)[0];
      const cells=nodes(row).filter(c=>c.name==='c').slice(0,32);
      let strings=[];
      if(cells.some(c=>attr(c,'t')==='s')){
        const shared=[...rels.values()].find(r=>r.type==='sharedStrings');
        if(shared)strings=find(zip.xml(shared.part),'si',[],16384);
      }
      if(!['1','true'].includes(attr(row,'hidden')))fields=cells.map(c=>{
        if(find(c,'f').length)return '';
        if(attr(c,'t')==='inlineStr')return find(c,'t').map(words).join('');
        const raw=words(find(c,'v')[0]);
        return attr(c,'t')==='s'&&/^\d+$/.test(raw)?find(strings[Number(raw)],'t').map(words).join(''):'';
      }).filter(s=>headerLabel.test(s.trim()));
    }
  }
  return sheet(meta||names[0],fields,names);
}
const odMime={odt:'text',odp:'presentation',ods:'spreadsheet'};
function openDocument(zip,ext) {
  if(zip.read('mimetype')?.toString()!=='application/vnd.oasis.opendocument.'+odMime[ext])return null;
  const meta=words(find(zip.xml('meta.xml'),'title')[0]);
  const content=find(zip.xml('content.xml'),'body')[0];
  if(ext==='odt'){
    const doc=find(content,'text')[0];
    return prose(words(find(doc,'h')[0])||meta,[...find(doc,'p',[],8).map(words),...find(doc,'h',[],8).map(words)]);
  }
  if(ext==='odp'){
    const titles=[],body=[];
    for(const page of find(content,'page',[],12)){
      if(attr(page,'visibility')==='hidden')continue;
      for(const frame of find(page,'frame',[],32)){
        const list=['title','subtitle'].includes(attr(frame,'class'))?titles:body;
        list.push(...find(frame,'p',[],6).map(words));
      }
    }
    return describeSlides(titles,body,meta);
  }
  const tables=find(content,'table').filter(t=>!['false','0'].includes(attr(t,'display')));
  if(!tables.length)return null;
  const head=find(tables[0],'table-header-rows')[0],row=find(head||tables[0],'table-row',[],1)[0];
  const cells=nodes(row).filter(n=>n.name==='table-cell'&&!attr(n,'formula')).slice(0,32).map(c=>find(c,'p').map(words).join(' '));
  return sheet(meta||attr(tables[0],'name'),head?cells:cells.filter(s=>headerLabel.test(s.trim())),tables.map(t=>attr(t,'name')));
}
function readDocument(buffer,extension) {
  const ext=String(extension).replace(/^\./,'').toLowerCase();
  if(!Buffer.isBuffer(buffer)||!DOCUMENT_EXTENSIONS.has(ext)||buffer.length>DOCUMENT_LIMIT||buffer.length<22)return null;
  try {
    if(ext==='pdf'){
      const info=readPdf(buffer);
      return info?prose(info.title,info.lines):null;
    }
    const zip=openZip(buffer);
    if(ext in odMime)return openDocument(zip,ext);
    const meta=safe(words(find(zip.xml('docProps/core.xml'),'title')[0]),100);
    if(ext==='pptx')return presentation(zip,meta);
    if(ext==='xlsx')return workbook(zip,meta);
    const body=find(zip.xml('word/document.xml'),'body')[0];
    if(!body)return null;
    const paragraphs=find(body,'p',[],96);
    const heading=paragraphs.find(p=>/^(?:title|heading\s*1|标题\s*1)$/i.test(attr(find(p,'pStyle')[0],'val')));
    return prose((heading&&wordText(heading))||meta,paragraphs.map(wordText));
  } catch {return null;}
}
function fit(value,max) {
  if(value.length<=max)return value;
  return value.slice(0,max-1).replace(/[\uD800-\uDBFF]$/,'').trimEnd()+'…';
}
function describeDocument(buffer,extension,filename) {
  const copy=readDocument(buffer,extension);
  return copy?{title:fit(copy.title,160),summary:fit(copy.summary,500)}:null;
}
module.exports={describeDocument,DOCUMENT_EXTENSIONS,DOCUMENT_LIMIT,openZip,parseXml:xml};
