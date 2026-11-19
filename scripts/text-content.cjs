'use strict';

// Every excerpt is taken from the bytes the caller fingerprinted. A partial
// last record must not become a title, a sentence, or a claimed total.
const LIMIT = 96 * 1024;
const CODE = new Set('js mjs cjs jsx ts tsx py rb go rs java kt c cpp cc h hpp cs swift lua gd php sh bash ps1 vue svelte'.split(' '));
const TEXT_EXTENSIONS = new Set([...CODE, ...'html htm svg md markdown mdx txt rst rtf csv tsv css scss sass less'.split(' ')]);
const GENERIC = /^(?:readme(?:\.md)?|home\s?page|untitled(?: document)?|index|project name|todo|my app|vite(?: app)?|react app|next(?:\.js)? app|usage|getting started|title|项目名称|无标题|首页|安装说明|使い方|無題|タイトル)$/i;
const UNSAFE = /[\p{Cc}\p{Cf}<>{}\x60\\]|(?:https?:\/\/|[a-z]:[\\/]|(?:^|\s)\/(?:home|Users|var|etc)\/)|\w@\w|\$\(|\[\[|\]\(|(?:password|passwd|bearer\s|credential|secret|private[ _-]*key|api[ _-]*(?:key|token)|access[ _-]*token|(?:token|授权码|access key|authorization)\s*[:=：]|sk[-_][a-z0-9]|gh[pousr]_|AKIA[A-Z0-9]|密码|密钥|口令)|[\w+=-]{28,}|(?:\d[ -]?){12,}/iu;

function clean(raw, max=120) {
  const s = String(raw || '').replace(/[ \t\n\r]+/g,' ').trim();
  if (!s || s.length > max || !/\p{L}/u.test(s) || UNSAFE.test(s)) return '';
  return s;
}
function heading(str) {
  const s = clean(str,120);
  return s.length >= 2 && !GENERIC.test(s) && !/^(?:chapter|section|第)\s*[\d一二三四五六七八九十]+(?:章|节|部分)?$/i.test(s) ? s : '';
}
function sentence(str) {
  const safe = clean(str,1800);
  if (!safe || /^(?:copyright|spdx-|licensed under|all rights reserved|import |const |class |function |#include|@param|@returns?|usage:|npm |pip )/i.test(safe)) return '';
  const first = (safe.match(/^.*?(?:[。！？]|[.!?](?=\s|$)|$)/u) || [])[0];
  // Short fragments such as labels, filenames and bylines are not an abstract.
  if (!first || first.length > 180 || !(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(first)
    ? first.length >= 6 : first.split(/\s+/).length >= 4)) return '';
  return first;
}
function subjectFromSentence(s) {
  if (!s) return '';
  const clause = s.split(/[。！？.!?，,；;]/u)[0].trim();
  return clause.length <= 58 ? heading(clause) : '';
}
const quoted = s => '「'+s.replace(/[。.!]+$/u,'')+'」';
function outline(names) {
  const list = [...new Set(names.filter(Boolean))].slice(0,3);
  return list.map(quoted).join('、');
}

function decodeEntities(text) {
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d{1,7}|#x[\da-f]{1,6});/gi, entity=>{
    const n=entity.slice(1,-1).toLowerCase();
    if (!n.startsWith('#')) return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[n];
    const point=n[1]==='x'?parseInt(n.slice(2),16):Number(n.slice(1));
    return point>0 && point<=0x10ffff ? String.fromCodePoint(point) : '';
  });
}
function markup(text, svg, blocks) {
  const stack=[], found={title:[],desc:[],h1:[],h2:[],h3:[],p:[],button:[]};
  const tags=/<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<(\/?)([a-z][\w:.-]*)\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
  let last=0, metadata='', token;
  function append(str) {
    const owner=stack.findLast(entry=>entry.collect);
    if (owner && !stack.at(-1)?.hidden && owner.text.length < 4096) owner.text+=str.slice(0,4096-owner.text.length);
  }
  while ((token=tags.exec(text))) {
    append(text.slice(last,token.index)); last=tags.lastIndex;
    const tag=token[2]?.toLowerCase();
    if (!tag) {
      if (token[0].startsWith('<![CDATA[')) append(token[0].slice(9,-3));
      continue;
    }
    if (token[1]) {
      const n=stack.findLastIndex(entry=>entry.name===tag);
      if(n>=0){
        const {collect,text:value}=stack[n]; stack.length=n;
        if(collect && found[tag].length<12) {
          const literal=decodeEntities(value);
          found[tag].push(literal);
          if(blocks && tag!=='title' && blocks.length<10){
            const label=clean(literal,1800);
            if(label)blocks.push({role:tag,text:label.slice(0,96)});
          }
        }
      }
      continue;
    }
    // Skip raw-text elements entirely, including fake tags in JavaScript.
    if(/^(script|style|template|textarea|noscript|foreignobject|iframe|pre|code)$/.test(tag)){
      if(svg && /\/\s*>$/.test(token[0]))continue;
      const close=new RegExp('</'+tag+'\\s*>','ig'); close.lastIndex=last;
      if(!close.exec(text))break;
      last=tags.lastIndex=close.lastIndex; continue;
    }
    if (!svg && tag==='meta' && stack.every(e=>['html','head'].includes(e.name))) {
      const attrs={};
      for(const [,key,v] of token[0].matchAll(/\s(name|content)\s*=\s*(".*?"|'.*?')/gi))attrs[key.toLowerCase()]=v.slice(1,-1);
      if(attrs.name?.toLowerCase()==='description')metadata=sentence(decodeEntities(attrs.content||''));
    }
    const hidden=stack.at(-1)?.hidden || tag==='dialog' && !/\sopen(?=[\s=>/])/.test(token[0]) ||
      /(?:\shidden(?=[\s=>/])|\saria-hidden\s*=\s*["']?true\b|display\s*:\s*none)/i.test(token[0]);
    const collect=!hidden && Object.hasOwn(found,tag) && (svg
      ? ['title','desc'].includes(tag) && stack.length===1 && stack[0].name==='svg'
      : tag==='title' ? stack.every(e=>['html','head'].includes(e.name)) : !['title','desc'].includes(tag) && !stack.some(e=>['head','svg','nav','footer'].includes(e.name)));
    if (!/\/\s*>$/.test(token[0]) && !/^(meta|link|base|br|hr|input|img|source|area|embed|wbr)$/.test(tag)) {
      stack.push({name:tag,hidden,collect,text:''});
      if(stack.length>128)return null;
    }
  }
  const title=heading(found.title[0]) || (!svg && found.h1.map(heading).find(Boolean));
  const desc=svg ? found.desc.map(sentence).find(Boolean) : found.p.map(sentence).find(s=>s && s!==title) || metadata;
  const subheads=outline([...found.h1,...found.h2,...found.h3].map(heading).filter(s=>s!==title));
  const buttons=outline(found.button.map(v=>clean(v,30)));
  if(!title && !desc)return null;
  const summary=desc || (subheads?'页面分成'+subheads+'等部分。':buttons?'页面上有'+buttons+'按钮。':
    svg?'这幅矢量图的题名是'+quoted(title)+'。':'这个页面的题名是'+quoted(title)+'。');
  return {title:title||subjectFromSentence(desc)||(svg?'矢量插画':'网页'),summary};
}

function richText(text) {
  if(!/^\s*{\s*\\rtf1\b/i.test(text))return '';
  const state=[], chars=[];
  let hidden=false, uc=1, skip=0;
  const tokens=/[{}]|\\(?:'[a-f0-9]{2}|[a-z]+-?\d* ?|.)|[^{}\\]+/gi;
  for(const [s] of text.matchAll(tokens)){
    if(s==='{'){if(state.length>=96)return '';state.push({hidden,uc});continue;}
    if(s==='}'){const prev=state.pop();if(!prev)return '';({hidden,uc}=prev);continue;}
    if(/^\\(?:\*|fonttbl|colortbl|stylesheet|info|pict|object|field|header|footer|generator|annotation)/i.test(s)){hidden=true;continue;}
    if(hidden)continue;
    if(/^\\uc\d+/.test(s)){uc=Math.min(16,parseInt(s.slice(3),10));continue;}
    if(/^\\u-?\d+/.test(s)){chars.push(String.fromCharCode(Number(s.slice(2).trim()) & 65535));skip=uc;continue;}
    if(/^\\(?:par|line)\b/.test(s)){chars.push('\n');continue;}
    let v=s;
    if(/^\\'[a-f\d]{2}$/i.test(s))v=new TextDecoder('windows-1252').decode(Uint8Array.of(parseInt(s.slice(2),16)));
    else if(s.startsWith('\\')){if(/^\\[\\{}]$/.test(s))v=s[1];else continue;}
    if(skip){const n=Math.min(skip,v.length);v=v.slice(n);skip-=n;}
    chars.push(v);
  }
  return chars.join('');
}
function prose(text,ext) {
  if(ext==='rtf')text=richText(text);
  const plain=['txt','rtf'].includes(ext);
  const lines=text.replace(/<!--[\s\S]*?(?:-->|$)|<(script|style|pre|code|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,'').split(/\r?\n/);
  let start=0, fence='', title='', sawHeading=false;
  if(!plain && /^(---|\+\+\+)$/.test(lines[0].trim())){
    const end=lines.findIndex((l,i)=>i>0 && l.trim()===lines[0].trim());
    if(end<0)return null;start=end+1;
  }
  const sections=[], body=[];
  for(let i=start;i<lines.length;i++){
    const raw=lines[i], line=raw.trim();
    if (!line) continue;
    const delimiter=!plain && /^ {0,3}(\x60{3,}|~{3,})(.*)$/.exec(raw);
    if(delimiter){if(!fence)fence=delimiter[1];else if(delimiter[1][0]===fence[0]&&delimiter[1].length>=fence.length&&!delimiter[2].trim())fence='';continue;}
    if(fence || /^(?: {4}|\t|<|\||!?\[.+\]:|import |export )/.test(raw))continue;
    const rendered=line.replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\*\*|__/g,'');
    const atx=!plain && /^#{1,6}\s+(.+)$/.exec(rendered);
    const setext=!plain && /^ {0,3}(?:={3,}|-{3,})\s*$/.test(lines[i+1]||'');
    if(atx || setext){
      const name=heading((atx?atx[1]:rendered).replace(/\s+#+$/,''));
      if(!sawHeading){title=name;sawHeading=true;}
      else if(name)sections.push(name);
      if(setext)i++;continue;
    }
    if(body.length<20 && !/^[-*#>\d]+[.)]?\s/.test(rendered))body.push(rendered);
  }
  if(sawHeading && !title)return null;
  if(!title && !sawHeading && body.length>1 && body[0].trim().length<=60)title=heading(body.shift());
  const firstLine=body.findIndex(line=>Boolean(sentence(line)));
  const first=firstLine<0?'':sentence(body[firstLine]);
  // A bilingual introduction can have two consecutive opening sentences.
  // Validate each complete source line before taking text from it.
  let summary=first;
  if(first && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(title) && /[A-Za-z]{2}/.test(title)){
    const opening=clean(body[firstLine],1800);
    const next=sentence(opening.slice(first.length)) || sentence(body[firstLine+1]);
    const script=s=>/[\u3040-\u30ff]/u.test(s)?'ja':/\p{Script=Han}/u.test(s)?'zh':'latin';
    if(next && script(first)!==script(next))summary=first+' '+next;
  }
  if(!title && first)title=subjectFromSentence(first) || '一段文字';
  if(!title)return null;
  const parts=outline(sections.filter(s=>s!==title));
  return {title,summary:summary || (parts?'文中谈到'+parts+'。':'文章以'+quoted(title)+'为题。')};
}

const headerNames = new Map(Object.entries({
  date:'日期', month:'月份', time:'时间', year:'年份', city:'城市', region:'区域', location:'地点', country:'国家',
  product:'商品', category:'类别', name:'名称', title:'标题', quantity:'数量', units:'件数', sales:'销量', revenue:'收入',
  price:'价格', amount:'金额', temperature:'温度', humidity:'湿度', count:'数量', score:'分数', budget:'预算',
  cost:'成本', result:'结果', task:'任务', status:'状态', priority:'优先级', deadline:'截止日期', distance:'距离',
  duration:'时长', artist:'艺术家', album:'专辑', genre:'风格', species:'物种', site:'站点', weight:'重量',
  ingredient:'食材', calories:'热量', population:'人口', latitude:'纬度', longitude:'经度', level:'等级',
  model:'模型', tokens:'Token 数', unit:'单位', version:'版本', timestamp:'时间', country_code:'国家代码'
}));
const HEADER = /^(?:(?:采样|观测|统计|销售|订单|客户|项目|商品|站点|设备|平均|最高|最低|日均|每月)?(?:日期|时间|城市|省份|区域|地区|地点|名称|类别|产品|数量|销量|销售额|金额|价格|收入|温度|气温|湿度|人数|单位|分数|预算|支出|结果|月份|年份|任务|状态|优先级|版本|截止日期|年龄|科目|成绩|距离|重量|时长|经度|纬度|物种|曲目|专辑|风格|站点|国家|人口|热量|食材)|日付|都市|地域|気温|湿度|数量|売上|価格|金額|品名|商品名|単位)$/;
function table(text,ext,truncated) {
  const sep=ext==='tsv'?'\t':',';
  const rows=text.split(/\r?\n/);
  // Quoted fields may contain delimiters. Do not count rows if there are
  // multiline fields. Their values are never candidates for titles or prose.
  function fields(line){
    if(!line || line.length>7000)return null;
    const result=[], re=sep==='\t'?/(?:"((?:[^"]|"")*)"|([^"\t]*))\t/gy:/(?:"((?:[^"]|"")*)"|([^",]*)),/gy;
    const padded=line+sep; let mat;
    while((mat=re.exec(padded))){
      result.push((mat[1]??mat[2]).replace(/""/g,'"').trim());
      if(result.length>64)return null;
      if(re.lastIndex===padded.length)return result;
    }
    return null;
  }
  const cols=fields(rows[0]);
  if(!cols || cols.length<2 || cols.some(c=>!clean(c,64)))return null;
  const data=rows.slice(1).filter(row=>row.trim().length);
  if(!data.length || fields(data[0])?.length!==cols.length)return null;
  const names=cols.map(c=>{
    if(HEADER.test(c))return c;
    // Common product labels are safe to retain. For custom measures, expose
    // only the recognized unit, never an arbitrary prefix or a row value.
    const measure=/^([\p{Script=Han}]{1,8})(销量|销售额|库存量|销售量|产量|销售收入)$/u.exec(c);
    if(measure)return /^(花束|鲜花|书籍|图书|门票|食品|饮品|服装|家具|水果)$/.test(measure[1])?c:measure[2];
    return headerNames.get(c.toLowerCase())||
      headerNames.get(c.toLowerCase().replace(/^(sample|sales|average|monthly|daily|product|order)[ _-]+/,''));
  }).filter(Boolean);
  const unique=[...new Set(names)]; if(unique.length<2)return null;
  const complete=!truncated && data.every(r=>fields(r)?.length===cols.length);
  const howMany=complete?'共 '+data.length+' 条记录，':'';
  const about=unique.slice(0,4).join('、');
  return {title:unique.slice(0,2).join('与')+'表',summary:howMany+'每行按'+about+'分栏，可以逐项对照。'};
}

function styles(text) {
  const css=text.replace(/\/\*[\s\S]*?(?:\*\/|$)/g,'');
  if(!/[\w.#:-][^{}]*\{[^{}]*[\w-]+\s*:/.test(css))return null;
  const facts=[];
  if(/@media[^{}]*(?:max-width|min-width|width\s*[><=])/i.test(css)) facts.push(['随屏幕宽度调整的页面','针对不同屏幕宽度安排版面']);
  if(/@keyframes\s+[-\w]+\s*\{/.test(css)) facts.push(['界面动效','定义元素随时间变化的动画']);
  if(/display\s*:\s*(?:inline-)?grid\b/.test(css)) facts.push(['网格排版','用网格排列页面内容']);
  if(/display\s*:\s*(?:inline-)?flex\b/.test(css)) facts.push(['界面排版','把界面元素沿一行或一列排开']);
  if(/--[\w-]+\s*:\s*(?:#[\da-f]{3,8}\b|rgb\(|hsl\()/i.test(css)) facts.push(['界面配色','把颜色集中定义，方便多处使用']);
  if(/:focus-visible\s*[{,]/.test(css))facts.push(['键盘焦点样式','标出键盘当前选中的控件']);
  if(!facts.length && /(?:color|font-size|padding|margin)\s*:/.test(css))facts.push(['页面样式','设置页面中文字或元素的外观']);
  if(!facts.length)return null;
  return {title:facts[0][0],summary:'这份样式'+facts.slice(0,2).map(f=>f[1]).join('，也')+'。'};
}

// Match operations, not just a subject mentioned in a comment, string or
// filename. The resulting sentence describes what the code contains, never
// whether a program ran successfully.
const behaviors = [
  [/\b(?:http|https)\.createServer\s*\(/, /\b(?:writeHead|listen)\s*\(/,'网页服务','接收浏览器的请求，按访问的地址返回内容'],
  [/\b(?:setZoom|jumpToDate)\s*\(/, /\b(?:drawRig|rigAt)\s*\(/,'钻机与井道画面','把钻机画在与当前深度相应的位置，也能切换视角查看不同地层'],
  [/\b(?:excavatedDepth|earnedDepth)\b/, /\b(?:drawStage|renderStage|finishStage)\s*\(/,'作品出土的展示界面','根据开挖进度展示出土的作品'],
  [/\bInferenceSession\.create\s*\(/, /\b(?:image_embeds|pixel_values)\b/,'图片内容识别','从画面提取特征，用来辨认图片里的主题'],
  [/\b(?:rgba|imageData)\b/i, /\b(?:dominantColors|colorFamily)\s*\(/,'画面配色识别','逐个查看像素，找出画面中占比较大的颜色'],
  [/\b(?:collectTraces|bindReceipts)\s*\(/, /\b(?:producedAt|sourceRef)\b/,'作品生成记录','把作品的一个具体版本和生成它的记录联系起来'],
  [/\b(?:collectConversations)\s*\(/, /\b(?:messageText|excerpt)\s*\(/,'对话摘录','从对话中挑出可保留的原话，留下日后能回看的片段'],
  [/\b(?:createCapture)\s*\(/, /\b(?:createUsageParser|usageFor)\s*\(/,'AI 调用用量记录','从 AI 服务返回的数据中读出这次调用的用量'],
  [/\b(?:parseTokenEvent|combineUsage)\s*\(/, /\b(?:total_tokens|cachedTokens|inputTokens)\b/,'AI 用量统计','整理不同记录里的 Token 数量'],
  [/\b(?:readPdf|describeDocument|describeText|describeMedia)\s*\(/, /\b(?:content|summary|title|metadata)\b/,'作品内容介绍','读取作品中留下的文字或文件信息，整理成介绍'],
  [/\b(?:validateSnapshot|demoSnapshot)\s*\(/, /\btokenMetres\s*\(/,'用量换算与工作记录','整理用量记录，并把 Token 数换算成开挖深度'],
  [/\b(?:pinDiscoveries|earnedDepth)\b/, /\b(?:radioProgress|claimNews)\s*\(/,'开挖进度与电台','按开挖的距离处理物品或电台的进度记录'],
  [/\b(?:collectFiles)\s*\(/, /\b(?:createHash|fingerprintCache)\b/,'本地成果采集','读取项目中的作品，为不同文件版本留下指纹'],
  [/\b(?:normalizeEvent|createEventStore)\s*\(/, /\b(?:append|ingest|enqueue)\s*\(/,'工作事件记录','整理接入工具送来的事件，供后续保存或查询'],
  [/\b(?:buildLightmap|directionalGain)\s*\(/, /\b(?:attenuation|lightmap)\b/i,'井下光照','按光源的方向或距离计算画面的亮暗'],
  [/\b(?:paintChunk|drawTerrain)\s*\(/, /\b(?:deposits|fractureFields)\s*\(/,'岩壁与地层','分块绘制岩壁，把矿脉和裂纹留在各自的位置'],
  [/\b(?:paintRig|drawRigHeavy)\s*\(/, /\b(?:drawLamp|paintLamp)\s*\(/,'钻机与矿灯的像素画','用图块绘制钻机、矿灯和井下设施'],
  [/\b(?:drawDrone)\s*\(/, /\b(?:drawStation)\s*\(/,'井下设施与无人机','把工作站和无人机画进井道'],
  [/\b(?:drawWorkshop|drawChamber)\s*\(/, /\b(?:drawEnvironment|drawVein)\s*\(/,'矿坑里的作业区','绘制作业间和洞室，也画出周围的岩层'],
  [/\b(?:describeMemory|namedFile)\s*\(/, /\b(?:summary|evidenceIds)\b/,'工作成果与对话介绍','把作品和对话里的线索整理成可阅读的名称与介绍'],
  [/\b(?:works|picture)\s*\(/, /\b(?:producedAt|requestedAt)\b/,'作品的创作经过','把一件作品和当时的请求、生成时间放在一起'],
  [/\b(?:usageFor|normalizeUsage)\s*\(/, /\b(?:cacheRead|inputTokens|outputTokens)\b/,'AI 用量整理','把不同记录中的输入与输出 Token 分开整理'],
  [/\b(?:new\s+Worker|worker\.postMessage)\b/, /\b(?:cache|pending)\b/,'后台处理队列','把待处理的工作发到后台，并记录已返回的结果'],
  [/\b(?:normalizeFeed|readLocal)\s*\(/, /\b(?:publishedAt|safeURL)\b/,'带来源的资讯整理','读出资讯条目的标题、发布时间或原文链接'],
  [/\b(?:buildRooms|canonicalWorld)\s*\(/, /\b(?:biomeAt|copyArtifact)\s*\(/,'地层与作品的位置','把房间或作品安排到对应的地层里'],
  [/\b(?:describeSample)\s*\(/, /\b(?:sampleAt)\s*\(/,'演示作品与文字','为演示中的示例作品配上名称和介绍'],
  [/\b(?:freezeFinding)\s*\(/, /\b(?:capGroups)\s*\(/,'当天可以挖到的作品','把观测到的作品按组整理，供当天的矿层展示'],
  [/\b(?:normalize|resolve)\s*\(/, /\bmessages\s*\[\s*(?:normalize|locale|language)/,'界面语言选择','选择界面使用的语言，并取出相应的文案'],
  [/\bcreateServer\s*\(/, /\b(?:writeHead|listen)\s*\(/,'网页服务','接收浏览器的请求，按访问的地址返回内容'],
  [/\b(?:canvas|getContext)\b/, /\b(?:drawRig|rigAt|drillDepth|drawDrill)\s*\(/,'钻机与井道画面','把钻机画在与当前深度相应的井道位置'],
  [/\b(?:AudioContext|createOscillator)\b/, /\b(?:createGain|createBufferSource)\s*\(/,'合成音效','把音调和音量的变化组合成可以播放的声音'],
  [/\b(?:beginPath|fillRect|drawImage|fillText)\s*\(/, /\b(?:requestAnimationFrame|drawFrame|renderFrame)\s*\(/,'画布动画','逐帧更新画布，让画面中的元素动起来'],
  [/\b(?:fillRect|drawImage)\s*\(/, /\b(?:palette|sprite|pixel|pixels)\b/i,'像素绘图','把图块或色块按位置画到画布上'],
  [/\b(?:getContext|beginPath)\s*\(/, /\b(?:fillRect|drawImage|fillText|stroke|fill)\s*\(/,'画布绘图','在画布上绘制图形或文字'],
  [/\b(?:createHash)\s*\(/, /\b(?:digest|fingerprint)\s*\(/,'文件指纹工具','给内容计算指纹，用来辨认两份数据是否一样'],
  [/\b(?:add_argument|addArgument|parseArgs)\s*\(/, /\b(?:parse_args|parseArgs|ArgumentParser)\s*\(/,'命令行小工具','读取命令行选项，按传入的参数工作'],
  [/\bcsv\s*\.\s*(?:DictReader|reader)\s*\(/, /\b(?:open|StringIO)\s*\(/,'表格读取工具','读取表格里的行和列，交给程序处理'],
  [/\b(?:Image\.open|sharp|imread)\s*\(/, /\b(?:resize|thumbnail)\s*\(/,'图片尺寸调整工具','读入图片并调整宽高，生成另一种尺寸的图像'],
  [/\b(?:createWorkbook|Workbook|openpyxl\.load_workbook)\s*\(/, /\b(?:save|writeFile|xlsx\.writeFile)\s*\(/,'电子表格制作工具','组织工作表，再把它们写入文件'],
  [/\b(?:fetch|requests\.get|http\.get|axios\.get)\s*\(/, /\b(?:\.json|JSON\.parse)\s*\(/,'在线数据读取工具','从网络取得数据，并读出其中的内容'],
  [/\b(?:querySelector(?:All)?|getElementById)\s*\(/, /\.addEventListener\s*\(/,'可操作的网页界面','找到页面上的控件，并响应用户的操作'],
  [/\b(?:localStorage|sessionStorage)\b/, /\.(?:setItem|removeItem)\s*\(/,'浏览器记录','在浏览器里保存或清除记录'],
  [/\b(?:readFileSync|readFile|createReadStream)\s*\(/, /\b(?:JSON\.parse|json\.loads)\s*\(/,'本地记录读取工具','从文件中读出结构化记录'],
  [/\b(?:writeFileSync|writeFile|createWriteStream)\s*\(/, /\b(?:JSON\.stringify|json\.dumps)\s*\(/,'记录保存工具','把整理好的数据写成文件，方便下次读取']
];
const testSubjects = [
  [/\b(?:drill|excavat\w*|descent|digging|strata|discovery hold)\b|井道|钻机|挖掘/i,'钻机的挖掘与停靠'],
  [/\b(?:token|usage|billing|counted)\b|用量|计量/i,'AI 用量的记录与计算'],
  [/\b(?:receipt|fingerprint|provenance|attribution)\b|原话|指纹|回执/i,'作品和原始记录的对应关系'],
  [/\b(?:snapshot|history|persist\w*|archive|checkpoint)\b|存档|归档|快照/i,'历史记录的保存与恢复'],
  [/\b(?:reveal|discover\w*|work title|findings?)\b|出土|发现/i,'发现物品时的展示'],
  [/\b(?:preview|image|pixel|thumbnail|palette)\b|图片|预览/i,'图片的读取与显示'],
  [/\b(?:sheet|workbook|csv|columns?|spreadsheet)\b|表头|表格/i,'表格内容的读取'],
  [/\b(?:request|response|endpoint|HTTP|server)\b|请求|接口/i,'服务收到请求后的响应'],
  [/\b(?:locale|translated|language)\b|语言|翻译/i,'界面语言切换'],
  [/\b(?:audio|sound|volume)\b|音效|声音/i,'声音播放']
];
function describeTests(text,truncated) {
  const names=Array.from(text.matchAll(/(?:^|[;\n}])\s*(?:test|it)(?:\.(?:skip|only|todo))?\s*\(\s*(['"])([^\n'"]{3,200})\1/g), m=>m[2]);
  for(const match of text.matchAll(/^[ \t]*(?:(?:async[ \t]+)?def[ \t]+(test_\w+)|func[ \t]+(Test[A-Z]\w*))\s*\(/gm)){
    names.push((match[1]||match[2]).replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2'));
  }
  if(!names.length || !/\b(?:assert|expect|should|Errorf|Fatalf)\b/.test(text))return null;
  // Group only topics actually named by cases. Technical identifiers and long
  // English test declarations do not become the player-facing item name.
  const hits=testSubjects.map(([re,title])=>[names.filter(n=>re.test(n)).length,title]).filter(([n])=>n).sort((a,b)=>b[0]-a[0]);
  const subject=hits[0]?.[1] || '';
  const sample=names.map(heading).find(n=>n && /[\u4e00-\u9fff]/.test(n) && n.length<=55);
  const count=truncated?'其中可读到 '+names.length+' 个测试用例':'文件中可读到 '+names.length+' 个测试用例';
  return {title:subject?subject+'测试':sample||'程序行为测试',
    summary:subject?'这组用例检查'+hits.slice(0,2).map(([,s])=>s).join('，也检查')+'。'+count+'。':
      (sample?'其中一项检查'+quoted(sample)+'。':'这些用例把程序的实际行为和期望结果逐项对照。')+count+'。'};
}

// If a project uses its own APIs, the names of declared operations are still
// usable evidence. Describe them explicitly as named steps, without inferring
// an implementation from a function name alone.
const actions={
  calculate:'计算',compute:'计算',estimate:'估算',sum:'汇总',total:'汇总',count:'统计',measure:'测量',
  group:'分组',sort:'排序',filter:'筛选',search:'查找',find:'查找',list:'列出',select:'选择',
  normalize:'整理',format:'排版',parse:'解析',validate:'校验',import:'导入',export:'导出',
  read:'读取',load:'读取',fetch:'获取',collect:'收集',write:'写入',save:'保存',store:'保存',
  build:'生成',generate:'生成',create:'创建',render:'显示',draw:'绘制',plot:'绘制',
  play:'播放',mix:'混合',record:'记录',track:'记录',update:'更新',resize:'调整尺寸',plan:'规划'
};
const subjects={
  transactions:'交易',transaction:'交易',invoice:'账单',invoices:'账单',expense:'开支',expenses:'开支',
  budget:'预算',fare:'车费',rates:'费率',price:'价格',revenue:'收入',sales:'销量',
  route:'路线',routes:'路线',trip:'行程',trips:'行程',train:'车次',trains:'车次',flight:'航班',flights:'航班',
  timetable:'时刻表',schedule:'日程',calendar:'日历',events:'事件',duration:'时长',weather:'天气',
  distance:'距离',temperature:'温度',weight:'重量',locations:'地点',coordinates:'坐标',
  median:'中位数',average:'平均值',scores:'分数',score:'分数',scoreboard:'记分板',rankings:'排名',
  songs:'歌曲',tracks:'音轨',audio:'音频',beats:'节拍',video:'视频',frames:'画帧',captions:'字幕',
  image:'图片',images:'图片',photo:'照片',photos:'照片',colors:'颜色',pixels:'像素',map:'地图',
  recipe:'食谱',recipes:'食谱',menu:'菜单',inventory:'库存',orders:'订单',products:'商品',
  chart:'图表',charts:'图表',timeline:'时间线',report:'报告',reports:'报告',table:'表格',
  archive:'归档',history:'历史记录',progress:'进度',language:'语言',rooms:'房间',layers:'地层',
  news:'资讯',memories:'对话记忆',usage:'用量',artifacts:'作品',findings:'发现记录'
};
function namedSteps(names){
  const steps=[];
  for(const name of names) {
    const words=name.replace(/([a-z\d])([A-Z])/g,'$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g,'$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const verb=Object.hasOwn(actions,words[0]) && actions[words[0]];
    const noun=words.slice(1).find(w=>Object.hasOwn(subjects,w));
    if(verb && noun){
      const step=verb+subjects[noun];
      if(!steps.includes(step))steps.push(step);
    }
  }
  if(!steps.length)return null;
  return {title:steps[0],summary:'代码中能找到'+outline(steps.slice(0,3))+'的处理步骤。'};
}
function code(text,ext,truncated) {
  const python=ext==='py';
  const top=text.slice(0,9000).replace(/^#![^\n]*\n/,'').trimStart();
  let doc='';
  if(python)doc=/^(?:#[^\n]*\n\s*)*(?:r|u)?("""|''')([\s\S]{1,2200}?)\1\s*(?:\n|$)/.exec(top)?.[2] || '';
  if(!doc)doc=/^(?:\/\*\*[\s\r\n*]*)([\s\S]{1,1800}?)\*\//.exec(top.replace(/^(?:['"]use strict['"];?\s*)/,''))?.[1] || '';
  if(!doc){
    const leader=/^(?:['"]use strict['"];?\s*)?(?:\/\/|#!? |-- )\s*([^\n]{4,350})/.exec(top)?.[1]||'';
    if(/^(?:用来|用于|把|将|从|读取|保存|计算|展示|生成|这个工具|这个程序|(?:this (?:tool|script|module) |(?:load|save|read|convert|generate|compute|render|collect|parse|display|build)s? ))/i.test(leader)) doc=leader;
  }
  const purpose=doc.split(/\r?\n/).map(l=>sentence(l.trim().replace(/^\*\s?/,''))).find(Boolean) || '';
  // Remove quoted literals and comments together so a literal containing two
  // slashes or a commented-out API call cannot dictate the apparent purpose.
  const tokens = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*'|\x60(?:\\[\s\S]|[^\x60\\])*\x60/g;
  const withoutComments=text.replace(tokens,chunk=>chunk.startsWith('//')||chunk.startsWith('/*')?' ':chunk);
  const tests=describeTests(withoutComments,truncated); if(tests)return tests;
  let executable=withoutComments.replace(tokens,' ');
  if(python || ['rb','gd','sh','bash','ps1'].includes(ext)) executable=executable.replace(/#[^\n]*/g,' ');
  let controls='';
  if(['vue','svelte','jsx','tsx'].includes(ext)){
    const labels=Array.from(withoutComments.matchAll(/<(?:button|label)\b[^<>]{0,300}>([^<>{}\n]{2,45})<\/(?:button|label)>/gi),m=>heading(decodeEntities(m[1])));
    controls=outline(labels.filter(Boolean));
  }
  if(controls)return {title:'页面上的操作控件',summary:'界面里有'+controls+'，可以看到这部分页面提供了哪些操作。'};
  const matches=behaviors.filter(([a,b])=>a.test(executable) && b.test(executable));
  if(matches.length){
    const primary=matches[0], secondary=matches[1];
    let summary=purpose && /\p{Script=Han}/u.test(purpose)?purpose:'这段程序'+primary[3]+'。';
    if(!purpose && secondary && !secondary[2].includes('绘图') && secondary[2]!==primary[2] && !secondary[2].includes('指纹'))summary+='它还会'+secondary[3]+'。';
    return {title:primary[2],summary};
  }
  if(purpose)return {title:subjectFromSentence(purpose)||'程序使用说明',summary:purpose};
  const functions=Array.from(executable.matchAll(/\b(?:function\s+|(?:async\s+)?def\s+|(?:async\s+)?fn\s+|func\s+(?:\([^\n()]+\)\s+)?)([a-zA-Z_][\w]*)\s*\(/g),m=>m[1]);
  if(['cs','java','cpp','c','h','hpp','cc','kt','swift','lua','gd','ps1','rb','tsx','js','ts','jsx','mjs','cjs','php'].includes(ext)){
    const decl=/(?:^|[\n;{}])\s*(?:(?:public|private|internal|protected|async|override|virtual|static|final|inline|export|default|suspend|open)\s+)*(?:(?:[A-Za-z_][\w.<>,[\]?:*]*\s+)+)([a-zA-Z_]\w*)\s*\([^(){}\n;]*\)\s*(?::\s*[\w.<>,[\]?:*]+\s*)?\{/g;
    const arrow=/\b(?:const|let|var)\s+([a-zA-Z_]\w*)\s*=\s*(?:async\s*)?(?:\([^(){}\n;]*\)|[A-Za-z_]\w*)\s*=>/g;
    for(const pattern of [decl,arrow]) for(const m of executable.matchAll(pattern)) {
      if(!functions.includes(m[1]) && !/^(if|while|for|switch|catch)$/.test(m[1]))functions.push(m[1]);
    }
  }
  if(!functions.length)return null;
  const topics=[
    [/^(?:find_?)?shortest_?(?:route|path)$/i,'最短路线','在起点和终点之间寻找最短路线'],
    [/(?:format|parse|convert)_?(?:date|time)/i,'日期与时间处理','处理日期或时间的写法'],
    [/(?:plan|find|build)_?(?:route|path)/i,'路线规划','查找或规划路线'],
    [/(?:calculate|compute|sum)_?(?:total|price)/i,'金额汇总','汇总金额或总数'],
    [/(?:save|load|restore)_?(?:game|progress)/i,'进度存取','保存或读回进度'],
    [/(?:search|filter)_?(?:items|records|tasks)/i,'记录筛选','查找或筛选记录']
  ];
  const topic=topics.find(([re])=>functions.some(n=>re.test(n)));
  return topic ? {title:topic[1],summary:'程序里有专门用来'+topic[2]+'的函数。'} : namedSteps(functions) ||
    {title:'程序函数',summary:'这份代码把处理步骤写成函数。其中能读到 '+functions.length+' 处函数定义。'};
}

function describeText(buffer,extension,_filename,truncated=false) {
  const ext=String(extension||'').toLowerCase().replace(/^\./,'');
  if(!TEXT_EXTENSIONS.has(ext) || !(buffer instanceof Uint8Array) || !buffer.length)return null;
  truncated=truncated || buffer.length>LIMIT;
  const bytes=buffer.subarray(0,LIMIT);
  let text;
  try{
    const encoding=bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':'utf-8';
    text=new TextDecoder(encoding,{fatal:true}).decode(bytes,{stream:truncated});
  }catch{return null;}
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))return null;
  if(truncated && !['svg','html','htm'].includes(ext)){
    const last=text.lastIndexOf('\n'); if(last<0)return null; text=text.slice(0,last);
  }
  if(['csv','tsv'].includes(ext))return table(text,ext,truncated);
  if(['svg','html','htm'].includes(ext))return markup(text,ext==='svg');
  if(['css','scss','sass','less'].includes(ext))return styles(text);
  if(CODE.has(ext))return code(text,ext,truncated);
  return prose(text,ext);
}
module.exports={describeText,TEXT_EXTENSIONS,markup,cleanExcerpt:clean,decodeEntities};
