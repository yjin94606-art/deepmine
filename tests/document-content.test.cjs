'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {deflateRawSync,deflateSync}=require('node:zlib');
const {describeDocument,DOCUMENT_LIMIT}=require('../scripts/document-content.cjs');

function crc32(bytes){
  let crc=0xffffffff;
  for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}
  return (crc^0xffffffff)>>>0;
}
function zip(parts){
  const local=[],central=[];let offset=0;
  for(const [name,body] of Object.entries(parts)){
    const n=Buffer.from(name),raw=Buffer.from(body),packed=deflateRawSync(raw),crc=crc32(raw);
    const l=Buffer.alloc(30),c=Buffer.alloc(46);
    l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(8,8);
    l.writeUInt32LE(crc,14);l.writeUInt32LE(packed.length,18);l.writeUInt32LE(raw.length,22);l.writeUInt16LE(n.length,26);
    c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);
    c.writeUInt32LE(crc,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
    local.push(l,n,packed);central.push(c,n);offset+=l.length+n.length+packed.length;
  }
  const end=Buffer.alloc(22),dir=Buffer.concat(central);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(parts).length,8);end.writeUInt16LE(Object.keys(parts).length,10);
  end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,dir,end]);
}
const rel=(id,type,target,external=false)=>'<Relationship Id="'+id+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'+type+'" Target="'+target+'" '+(external?'TargetMode="External"':'')+'/>';
const p=s=>'<w:p><w:r><w:t>'+s+'</w:t></w:r></w:p>';
test('document artwork uses the packaged thumbnail pixels, and falls back to the document text when absent',()=>{
  const {describeImprint}=require('../scripts/work-imprint.cjs');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+5RfcAAAAASUVORK5CYII=','base64');
  const page={'word/document.xml':'<w:document><w:body>'+p('河流踏查笔记')+p('松树桥下的水面很平静。')+'</w:body></w:document>'};
  assert.deepEqual(describeImprint('field.docx',zip({...page,'docProps/thumbnail.png':png})),{kind:'cover',type:'image/png',data:png.toString('base64')});
  const fallback=describeImprint('field.docx',zip(page));
  assert.equal(fallback.kind,'excerpt');
  assert.equal(fallback.label,'河流踏查笔记');
});
test('a numbered DOCX gets the story heading and prose from its own current bytes',()=>{
  const make=(subject,body)=>zip({'word/document.xml':'<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>'+subject+'</w:t></w:r></w:p>'+p(body)+'<w:del>'+p('淘汰段落')+'</w:del><w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>隐藏文字</w:t></w:r></w:p>'+p('api_key=private-value')+'</w:body></w:document>','word/comments.xml':p('PRIVATE NOTE')});
  const a=describeDocument(make('海岸鸟类观察','傍晚在芦苇丛里看见了三只白鹭。'),'docx','001.docx');
  assert.deepEqual(a,{title:'海岸鸟类观察',summary:'傍晚在芦苇丛里看见了三只白鹭。'});
  assert.equal(describeDocument(make('山间鸟类观察','雨后听到了画眉的叫声。'),'docx','001.docx').title,'山间鸟类观察');
});
test('PPTX follows authored slide order and ignores hidden slides, notes and external targets',()=>{
  const slide=(title,hidden=false)=>'<p:sld '+(hidden?'show="0"':'')+'><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>'+title+'</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
  const file=zip({'ppt/presentation.xml':'<p:presentation><p:sldIdLst>'+['a','b','x','c'].map((v,i)=>'<p:sldId id="'+(256+i)+'" r:id="'+v+'"/>').join('')+'</p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels':'<Relationships>'+rel('a','slide','slides/slide2.xml')+rel('b','slide','slides/slide3.xml')+rel('c','slide','slides/slide1.xml')+rel('x','slide','https://example.invalid',true)+'</Relationships>',
    'ppt/slides/slide1.xml':slide('志愿者怎样报名'), 'ppt/slides/slide2.xml':slide('海岸清洁日'), 'ppt/slides/slide3.xml':slide('内部预算细节',true),'ppt/notesSlides/notesSlide2.xml':slide('内部讲者笔记')});
  const out=describeDocument(file,'pptx','001.pptx');assert.equal(out.title,'海岸清洁日');assert.match(out.summary,/报名/);assert.doesNotMatch(out.summary,/内部/);
});
test('XLSX reads visible worksheet names, headers and declared relationships without copying data values',()=>{
  const book='<workbook><sheets><sheet name="内部" state="veryHidden" r:id="q"/><sheet name="门票月报" r:id="s"/><sheet name="季度对照" r:id="t"/></sheets></workbook>';
  const parts={'xl/workbook.xml':book,'xl/_rels/workbook.xml.rels':'<Relationships>'+rel('s','worksheet','/xl/worksheets/sheet4.xml')+rel('ss','sharedStrings','sharedStrings.xml')+'</Relationships>',
    'xl/sharedStrings.xml':'<sst><si><t>月份</t></si><si><t>收入</t></si><si><t>内部数值</t></si></sst>',
    'xl/worksheets/sheet4.xml':'<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c t="s"><v>2</v></c></row></sheetData></worksheet>'};
  const out=describeDocument(zip(parts),'xlsx','001.xlsx');
  assert.equal(out.title,'门票月报');assert.match(out.summary,/月份/);assert.match(out.summary,/收入/);assert.match(out.summary,/季度对照/);assert.doesNotMatch(out.summary,/内部/);
  parts['xl/worksheets/sheet4.xml']='<worksheet><tableParts><tablePart r:id="v"/></tableParts></worksheet>';
  parts['xl/worksheets/_rels/sheet4.xml.rels']='<Relationships>'+rel('v','table','../tables/table1.xml')+'</Relationships>';
  parts['xl/tables/table1.xml']='<table><tableColumns><tableColumn name="观展主题"/><tableColumn name="受访者意见"/></tableColumns></table>';
  assert.match(describeDocument(zip(parts),'xlsx').summary,/受访者意见/);
});
test('ODT, ODP and ODS draw from each format and keep the selected document type',()=>{
  function od(kind,body){return zip({mimetype:'application/vnd.oasis.opendocument.'+kind,'content.xml':'<office:document-content><office:body>'+body+'</office:body></office:document-content>'});}
  const doc=od('text','<office:text><text:h>河流踏查笔记</text:h><text:p>松树桥下的水面很平静。</text:p></office:text>');
  assert.deepEqual(describeDocument(doc,'odt'),{title:'河流踏查笔记',summary:'松树桥下的水面很平静。'});
  assert.equal(describeDocument(doc,'ods'),null);
  const slides=od('presentation','<office:presentation><draw:page><draw:frame presentation:class="title"><text:p>River Walk</text:p></draw:frame><draw:frame><text:p>Meet at the stone bridge.</text:p></draw:frame></draw:page></office:presentation>');
  assert.equal(describeDocument(slides,'odp').summary,'Meet at the stone bridge.');
  const sheet=od('spreadsheet','<office:spreadsheet><table:table table:name="展会摊位"><table:table-header-rows><table:table-row><table:table-cell><text:p>摊位主题</text:p></table:table-cell><table:table-cell><text:p>申请类别</text:p></table:table-cell></table:table-row></table:table-header-rows></table:table></office:spreadsheet>');
  assert.match(describeDocument(sheet,'ods').summary,/摊位主题/);
});
function pdf(objects,extra=''){
  const chunks=[Buffer.from('%PDF-1.4\n')],offsets=[0]; let size=chunks[0].length;
  for(const [i,s] of objects.entries()){
    offsets.push(size);
    for(const chunk of [Buffer.from((i+1)+' 0 obj\n'),Buffer.isBuffer(s)?s:Buffer.from(s,'latin1'),Buffer.from('\nendobj\n')]){chunks.push(chunk);size+=chunk.length;}
  }
  chunks.push(Buffer.from('xref\n0 '+offsets.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+
    'trailer\n<< /Size '+offsets.length+' /Root 1 0 R '+extra+' >>\nstartxref\n'+size+'\n%%EOF\n'));
  return Buffer.concat(chunks);
}
test('a classic PDF can introduce itself from its actual first-page text, including Flate streams',()=>{
  const packed=deflateSync(Buffer.from('BT /F1 14 Tf (Harbor garden) Tj T* (The path opens beside the greenhouse.) Tj ET'));
  const stream=Buffer.concat([Buffer.from('<< /Filter /FlateDecode /Length '+packed.length+' >>\nstream\n'),packed,Buffer.from('\nendstream')]);
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>','<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',stream,'<< /Title (Wrong title from unrelated object) >>'];
  assert.deepEqual(describeDocument(pdf(objects),'pdf','001.pdf'),{title:'Harbor garden',summary:'The path opens beside the greenhouse.'});
  assert.equal(describeDocument(pdf(objects,'/Encrypt 6 0 R'),'pdf'),null);
  objects[3]='<< /Type /Font /Subtype /Type0 /BaseFont /Custom >>';
  assert.equal(describeDocument(pdf(objects),'pdf'),null);
});
test('PDF document info supports Unicode titles and escaped parentheses',()=>{
  const title=Buffer.from('湖边观察','utf16le').swap16().toString('hex');
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [] /Count 0 >>','<< /Title <feff'+title+'> /Subject (Seasonal birds \\(spring\\)) >>'];
  assert.deepEqual(describeDocument(pdf(objects,'/Info 3 0 R'),'pdf'),{title:'湖边观察',summary:'Seasonal birds (spring)'});
});
test('malformed, partial, oversize and expansion-heavy packages fail without exposing arbitrary bytes',()=>{
  assert.equal(describeDocument(Buffer.alloc(DOCUMENT_LIMIT+1),'docx'),null);
  const f=zip({'word/document.xml':'<w:document><w:body>'+p('Original title')+'</w:body></w:document>'});
  assert.equal(describeDocument(f.subarray(0,-9),'docx'),null);
  const altered=Buffer.from(f);altered[30+'word/document.xml'.length]^=1;assert.equal(describeDocument(altered,'docx'),null);
  assert.equal(describeDocument(zip({'word/document.xml':'A'.repeat(2*1024*1024+1)}),'docx'),null);
  assert.equal(describeDocument(zip({'word/document.xml':'<!DOCTYPE foo><x/>'}),'docx'),null);
  assert.equal(describeDocument(Buffer.from('%PDF-1.5\n/Title (Unsafe unreferenced title)\n%%EOF\n'),'pdf'),null);
});
