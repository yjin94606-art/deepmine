'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {describeText}=require('../scripts/text-content.cjs');
const read=(ext,body,truncated=false)=>describeText(Buffer.from(body),ext,'001.'+ext,truncated);

test('web pages describe what a visitor can read, excluding hidden controls, scripts and navigation',()=>{
  const page='<head><title>看潮日历</title><meta content="<title>bad</title>"></head><body><script>function test(){}</script>'+
    '<dialog><p>这里藏着不相关的信息。</p></dialog><p hidden>私人说明不应该出现。</p><main><p>按月份查看海湾每日的涨潮时间。</p></main></body>';
  assert.deepEqual(read('html',page),{title:'看潮日历',summary:'按月份查看海湾每日的涨潮时间。'});
  assert.match(read('htm','<main><h1>山路地图</h1><button>查看报道</button></main>').summary,/查看报道/);
  assert.equal(read('html','<body><title>Wrong place</title></body>'),null);
});

test('SVG uses the work’s own description, with no promotion of layer, comment or external element captions',()=>{
  const svg='<svg><g><title>引导线</title><desc>某一层的说明。</desc></g><title>海湾潮线</title><desc>三条曲线勾出了岸边的潮线。</desc></svg>';
  assert.deepEqual(read('svg',svg),{title:'海湾潮线',summary:'三条曲线勾出了岸边的潮线。'});
  assert.equal(read('svg','<svg><foreignObject><h1>Secret</h1></foreignObject></svg>'),null);
});

test('documents use the body, or meaningful chapter titles when it has no prose',()=>{
  const md='---\ntitle: Draft\n---\n~~~py\n# False title\n~~~\n# 社区里的树\n沿着河岸记录了十二种常见树木。秋天再去拍一次。\n';
  assert.deepEqual(read('md',md),{title:'社区里的树',summary:'沿着河岸记录了十二种常见树木。'});
  const bilingual='# 海岸 · Coast\n\n小船已经抵达了码头。 The boat reached the pier.';
  assert.equal(read('md',bilingual).summary,'小船已经抵达了码头。 The boat reached the pier.');
  assert.equal(read('md',bilingual.replace('The boat reached the pier.','\npassword: example')).summary,'小船已经抵达了码头。');
  const outline=read('markdown','# 菜园日记\n## 育苗记录\n## 雨后的菜畦');
  assert.match(outline.summary,/育苗记录/);assert.match(outline.summary,/雨后的菜畦/);
  assert.deepEqual(read('txt','候鸟观察\n清晨在芦苇旁听见雁群的叫声。'),{title:'候鸟观察',summary:'清晨在芦苇旁听见雁群的叫声。'});
  assert.equal(read('md','# README\n## Company plans'),null);
});

test('simple RTF decodes document text and excludes font tables, application info and embedded objects',()=>{
  const body='{\\rtf1\\ansi{\\fonttbl{\\f0 PRIVATE FONT;}}{\\info{\\author PRIVATE AUTHOR}}\\uc1 Yellow Tulips\\par '+
    'A dozen tulips grow in the garden.\\par {\\pict 123454545}}';
  const result=read('rtf',body);
  assert.equal(result.title,'Yellow Tulips');assert.match(result.summary,/tulips grow/);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|123454545/);
});

test('tables name the columns and record count without promoting any data cells, including quoted fields',()=>{
  const csv=read('csv','城市,销量,月份\n"秘密,别名",51,11\n山城,52,11\n');
  assert.equal(csv.title,'城市与销量表');assert.match(csv.summary,/2 条记录/);assert.match(csv.summary,/月份/);
  assert.doesNotMatch(csv.summary,/秘密|山城|51|52/);
  assert.equal(read('csv','城市,花束销量\n厦门,23\n青岛,18').title,'城市与花束销量表');
  assert.equal(read('csv','城市,某人姓名销量\n厦门,10').title,'城市与销量表');
  const tsv=read('tsv','species\tsite\tcount\n匿名兰花\t私人站点\t12\n');
  assert.match(tsv.summary,/物种、站点、数量/); assert.doesNotMatch(tsv.summary,/兰花|私人站点/);
  assert.equal(read('csv','city,price\none column'),null);
  assert.equal(read('csv','Mary,Sue\nAmes,Lake'),null);
  assert.equal(read('csv','city,password\nhere,abc123'),null);
  assert.doesNotMatch(read('csv','city,price\nhere,5\nthere',true).summary,/共 1/);
});

test('code summaries describe actual operations in arbitrary projects',()=>{
  assert.match(read('py','from PIL import Image\nimg=Image.open(file)\nimg.thumbnail((250,250))').summary,/调整宽高/);
  assert.match(read('cjs',"const http=require('node:http');const s=http.createServer((req,res)=>res.writeHead(200));").summary,/接收浏览器的请求/);
  assert.match(read('rs','fn plan_route() { }').summary,/规划路线/);
  assert.match(read('js','export function shortestRoute(stations, start, end) { return []; }').title,/最短路线/);
  assert.match(read('js','function estimateFare() {} function sortTrains() {}').summary,/估算车费.+排序车次/);
  assert.match(read('cs','public static int CalculateTotal(int a) { return a; }').summary,/金额|总数|函数/);
  assert.match(read('tsx','export const Screen = () => <button>开始记账</button>').summary,/开始记账/);
  assert.match(read('js',"const q = AudioContext; function f(){q.createOscillator();q.createGain();}").title,/音效/);
  assert.equal(read('js',"// const a=q.createOscillator();q.createGain();\nconst message='AudioContext createGain()';"),null);
});

test('a declared purpose can introduce code in different languages without its filename',()=>{
  assert.deepEqual(read('py','"""清理相册中重复的缩略图。"""\nimport glob'),{title:'清理相册中重复的缩略图',summary:'清理相册中重复的缩略图。'});
  assert.match(read('go','// 读取观测站当月的降雨记录。\npackage main').summary,/降雨/);
  const css=read('css','.box {display:grid} @media(max-width:640px){.box{display:block}}');
  assert.match(css.title,/屏幕/);assert.match(css.summary,/网格/);
});

test('test reports describe the subject of the checks and never declare success',()=>{
  const s=read('js',"const assert=require('node:assert');\ntest('drill pauses at discovery hold',()=>assert.ok(true));\n");
  assert.match(s.title,/钻机/);assert.match(s.summary,/1 个测试/);assert.doesNotMatch(s.summary,/通过|成功/);
  const p=read('py','def test_image_preview():\n    assert preview()');
  assert.match(p.title,/图片/);
});

test('unsupported bytes, sensitive content and incomplete excerpts produce no fabricated description',()=>{
  assert.equal(read('txt','API_KEY = sk-example-missing'),null);
  assert.equal(read('txt','user@example.com\nPassword is very easy.'),null);
  assert.equal(describeText(Buffer.from([0x41,0x00,0xff]),'txt','n.txt'),null);
  assert.equal(read('txt','This paragraph has been cut in the middle',true),null);
  assert.equal(read('pdf','A sentence masquerading as a document.'),null);
  const bytes=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('春日书单\n清明前重读的三本游记。','utf16le')]);
  assert.match(describeText(bytes,'txt','x.txt').summary,/游记/);
});
