(function(root,factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./evidence-core.js'),require('./item-intro.js'),require('./demo-records.js'),()=>require('./work-subjects.js'));
  else root.ItemStory = factory(root.EvidenceCore,root.ItemIntro,root.DemoRecords,()=>root.WorkSubjects);
})(globalThis,function(C,Intro,Demo,subjects) {
  'use strict';
  const indexes = new WeakMap();
  const types = {
    image:['一张图片','An image','画像作品'], audio:['一段音频','An audio piece','音声作品'],
    video:['一段短片','A video','動画作品'],web:['一个网页','A web page','ウェブページ'],
    slides:['一份演示稿','A presentation','プレゼン資料'],code:['一段程序','A program','プログラム'],
    document:['一份文档','A document','文書'],table:['一张表格','A spreadsheet','表'],
    file:['一份作品文件','A project file','作品のファイル'],memory:['对话里的想法','A thought from a conversation','会話のメモ']
  };
  const demoRequests = {
    image:['画一位在温室工作的二次元植物学家，蓝色短发，戴一条黄色围巾。','Draw an anime botanist in a greenhouse with short blue hair and a yellow scarf.','青いショートヘアで黄色いマフラーをした、温室で働くアニメ風の植物学者を描いて。'],
    garden:['画一座玻璃温室，让一条小路从花圃中间穿过去。','Draw a glass greenhouse with a path through the flower beds.','花壇の間を小道が通るガラスの温室を描いて。'],
    web:['把我的作品整理成一个网页。','Put my work together on a portfolio page.','作品を一枚のウェブページにまとめて。'],
    document:['把这次调研的发现和没弄懂的问题整理成笔记。','Turn the findings and open questions into research notes.','調査の結果と疑問点をノートにまとめて。'],
    audio:['给这期播客做一段简短的开场。','Make a short opening for this podcast episode.','番組の短いオープニングを作って。'],
    video:['把路上拍的几个片段剪成一部旅行短片。','Cut these clips into a short travel film.','旅行中の映像を短い一本に編集して。'],
    slides:['用几页幻灯片讲清楚这个项目打算怎么做。','Explain the project plan in a few slides.','企画を数枚のスライドで説明して。'],
    table:['把这几次实验的结果放进一张表，方便比较。','Put these trial results into a table for comparison.','実験結果を比較できる表にして。'],
    code:['写个小工具，帮我找出起点到终点的路线。','Write a tool to find a route between two points.','出発地と目的地を結ぶ道順を探すツールを書いて。'],
    file:['把这个产品做成能换角度查看的立体模型。','Make a model of the product that I can view from different angles.','いろいろな角度から見られる製品モデルを作って。']
  };
  const languageIndex = locale => /^zh/i.test(locale) ? 0 : /^ja/i.test(locale) ? 2 : 1;
  const han=/\p{Script=Han}/u,kana=/[\u3040-\u30ff]/u;
  function fitsLanguage(value,lang,title=false){
    if(!value)return false;
    if(lang===1)return /[a-z]/i.test(value) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}]/u.test(value);
    if(lang===0)return han.test(value) && !kana.test(value);
    return kana.test(value) || (title && /^[\p{Script=Han}]{1,4}$/u.test(value));
  }
  function titleInLanguage(title,lang){
    // Prefer an actual parallel title on bilingual covers, e.g. 深矿 · Deepmine.
    const parts=title.split(/\s+[–—|/-]\s+|\s*[·｜|／]\s*|[()（）]/u).map(x=>x.trim()).filter(Boolean);
    if(parts.some(part=>han.test(part)) && parts.some(part=>fitsLanguage(part,1,true))){
      const localized=parts.find(part=>fitsLanguage(part,lang,true));
      if(localized)return localized;
    }
    if(fitsLanguage(title,lang,true))return title;
    const parallel=lang===1 && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+\s+([A-Z][a-zA-Z]+(?:\s+v\d[\w.-]*)?)$/u.exec(title);
    return parallel?parallel[1]:'';
  }
  function namedWork(filename,lang,type){
    // Use a short human-readable basename only when the work has no title.
    // Never promote directories, numbered exports, hashes or machine identifiers.
    const name=filename.replace(/\.[^.]+$/u,'').replace(/[-_]+/gu,' ').trim();
    if(!name || name.length>64 || !/^[\p{L}\p{M}\d ’'-]+$/u.test(name) ||
      /\d{4,}|[a-f\d]{8,}|\b(?:api key|password|keyring|token|bearer|secret|sk|gh[pousr]|github pat)\b/iu.test(name) ||
      /^(?:img|dsc|rec|audio|video|file|output|export|recording|untitled|track|clip|sample|image|document|test|final|draft)(?:\s*\d+)?$/iu.test(name))return '';
    if(fitsLanguage(name,lang,true)&&(lang!==1||/\p{L}{2,}\s+\p{L}{2,}/u.test(name)))return name;
    if(type==='audio'){
      if(/\b(?:alarms?|sirens?)\b|警报|警報/iu.test(name))return ['警报声','Alarm','警報音'][lang];
      if(/\b(?:bells?|chimes?)\b|钟声|铃声|鐘の音/iu.test(name))return ['钟铃声','Bell chime','鐘の音'][lang];
    }
    return '';
  }
  function descriptionInLanguage(summary,lang){
    const lines=String(summary||'').split(/(?<=[。！？])|(?<=[.!?])\s+|\s+[·|]\s+|\n/u).map(line=>line.trim()).filter(Boolean);
    const usable=lines.filter(line=>fitsLanguage(line,lang));
    return lines.length===usable.length?summary:usable.join(lang===1?' ':'');
  }
  function tableDescription(summary,lang){
    const table=/^(?:共 (\d+) 条记录，)?每行按([^，。\n]{1,100})分栏，可以逐项对照。(?:([^，。\s]{1,12})合计 (\d+)。)?$/u.exec(summary);
    if(table){
      const language=['zh-CN','en','ja'][lang];
      const labels=table[2].split('、').map(field=>Intro.tableColumn(field,language)).filter(Boolean);
      if(labels.length){
        const metric=['出发班次','到达班次'].includes(table[3])&&Intro.tableColumn(table[3],language);
        if(metric&&table[4]&&table[1]&&labels.length===2&&labels.includes(metric)){
          const dimension=labels.find(label=>label!==metric);
          if(dimension)return [
            '按'+dimension+'记录了 '+table[1]+' 行，'+metric+'合计 '+table[4]+' 班。',
            'The table lists '+table[4]+' '+metric+' by '+dimension+' across '+table[1]+' rows.',
            dimension+'別の'+metric+'を'+table[1]+'行にまとめ、合計は'+table[4]+'便です。'
          ][lang];
        }
        if(lang===0)return summary;
        const list=new Intl.ListFormat(language).format(labels);
        const count=table[1];
        const lead=lang===1 ? (count?'The table has '+count+(count==='1'?' row':' rows')+' with columns for ':'The columns include ')+list+'.' :
          list+'を記録した'+(count?count+'行の':'')+'表です。';
        if(metric&&table[4])return lead+(lang===1?' The '+metric+' column adds up to '+table[4]+'.':metric+'の合計は'+table[4]+'です。');
        return lead;
      }
    }
    return '';
  }
  function measuredDescription(summary,lang){
    const counts=[
      [/^共 (\d+) 条记录，/u, n=>['共 '+n+' 条记录。','The table contains '+n+(n==='1'?' record.':' records.'),'この表には'+n+'件の記録があります。']],
      [/能读到 (\d+) 处函数定义/u, n=>['能读到 '+n+' 处函数定义。','The code contains '+n+(n==='1'?' function definition.':' function definitions.'),'コード内には'+n+'件の関数定義があります。']],
      [/笔记里附有 (\d+) 段可以运行的代码/u,n=>['笔记里附有 '+n+' 段代码。','The notebook includes '+n+(n==='1'?' code cell.':' code cells.'),'ノートブックには'+n+'個のコードセルがあります。']],
      [/共收录 (\d+) 个地理要素/u,n=>['地图收录 '+n+' 个地理要素。','The map records '+n+(n==='1'?' geographic feature.':' geographic features.'),'地図には'+n+'件の地物が記録されています。']]
    ];
    for(const [pattern,labels] of counts){
      const match=pattern.exec(summary);
      if(match)return labels(match[1])[lang];
    }
    return '';
  }
  function index(snapshot) {
    if (indexes.has(snapshot)) return indexes.get(snapshot);
    const byPath = new Map(), commits = new Map(), memories = new Map((snapshot.memories||[]).map(m=>[m.id,m]));
    for (const output of snapshot.outputs || []) {
      const date = C.today(output.timestamp,snapshot.timezone);
      for (const path of output.files) {
        const key = date+'\n'+path;
        if (!byPath.has(key)) byPath.set(key,[]);
        byPath.get(key).push(output);
      }
    }
    for (const day of snapshot.days || []) for (const commit of day.evidence || []) commits.set(commit.hash,commit);
    const value = {byPath,commits,memories,groups:new WeakMap()};
    indexes.set(snapshot,value);
    return value;
  }
  function works(item,snapshot) {
    if (!item || !snapshot) return [];
    const db = index(snapshot);
    if (db.groups.has(item)) return db.groups.get(item);
    const members = [];
    for (const path of item.paths || []) {
      const versions = new Map();
      for (const out of db.byPath.get(item.date+'\n'+path) || []) {
        const trace = out.traces?.find(t=>t.path===path);
        const prior = versions.get(out.fingerprint);
        const delivered = out.deliveries?.find(proof=>proof.path===path);
        const delivery = prior?.delivery?.request ? prior.delivery : delivered || prior?.delivery;
        const report=out.sourceId!=='local-files' && out.summary && !/^(?:Observed(?: local)?(?: output)?(?: file)?[.!]?$|Cursor afterFileEdit|已在配置的输出目录观察到此文件)/i.test(out.summary)?out:prior?.report;
        if (!prior || (!prior.trace && trace) || (!prior.trace && prior.record.sourceId==='local-files' && out.sourceId!=='local-files')) {
          versions.set(out.fingerprint,{path,record:out,trace:trace || prior?.trace,content:out.contentVersion?out:prior?.content,report,delivery});
        } else {
          if (out.contentVersion && !prior.content) prior.content=out;
          prior.report=report;
          prior.delivery=delivery;
        }
      }
      members.push(...versions.values());
      const commits = (item.evidenceIds || []).map(hash => db.commits.get(hash)).filter(c => c?.files.some(f => f.path===path));
      for (const commit of commits) members.push({path,commit});
      if (!versions.size && !commits.length) members.push({path});
    }
    members.sort((a,b) => Number(!!b.trace)-Number(!!a.trace) ||
      (b.record?.timestamp || b.commit?.timestamp || '').localeCompare(a.record?.timestamp || a.commit?.timestamp || '') || a.path.localeCompare(b.path));
    db.groups.set(item,members);
    return members;
  }
  function memberType(item,member) {
    return member?.record?.type || (item.visualType==='file' && member?.path ? C.classify(member.path) : item.visualType) || 'file';
  }
  function source(item,snapshot,member,route) {
    if (!member || snapshot.mode==='demo')return null;
    const {record,commit,path}=member;
    const params=new URLSearchParams({path});
    if (record?.fingerprint) params.set('fingerprint',record.fingerprint);
    else if (commit?.hash) params.set('commit',commit.hash);
    else return null;
    return {path,key:[snapshot.project.id,path,record?.fingerprint||commit.hash].join('/'),url:route+'?'+params,demo:false};
  }
  function contentSource(item,snapshot,member=works(item,snapshot)[0]) {
    const media=['audio','video'].includes(memberType(item,member));
    if ((member?.content && !media) || /\.(png|jpe?g|webp|gif)$/i.test(member?.path||''))return null;
    return source(item,snapshot,member,'/api/work-intro');
  }
  function visualSource(item,snapshot,member=works(item,snapshot)[0]) {
    if (memberType(item,member)==='video' && /\.(mp4|mov|m4v|webm)$/i.test(member?.path||'')) {
      const video=source(item,snapshot,member,'/api/preview');
      return video?{...video,kind:'video'}:null;
    }
    return picture(item,snapshot,member);
  }
  function playbackSource(item,snapshot,member) {
    if (!member || member.record?.byteLength>16*1024*1024) return null;
    const kind=memberType(item,member);
    if (!(kind==='audio' && /\.(?:wav|mp3|m4a|ogg|oga|opus|flac)$/i.test(member.path) ||
          kind==='video' && /\.(?:mp4|mov|m4v|webm)$/i.test(member.path))) return null;
    const version=source(item,snapshot,member,'/api/preview');
    return version && {...version,kind};
  }
  function picture(item,snapshot,member=works(item,snapshot)[0]) {
    if (memberType(item,member)!=='image' || !member || !/\.(png|jpe?g|gif|webp)$/i.test(member.path)) return null;
    const {record,commit,path} = member;
    if (snapshot.mode==='demo') {
      if (!Demo.describeSample(item,snapshot,'en')) return null;
      const asset = path.endsWith('/sample-02.png') ? 'sample-02.png' : path.endsWith('/Garden-illustration.png') ? 'garden.png' : null;
      return asset ? {path,url:Demo.imagePath(asset),key:'demo/'+asset,demo:true} : null;
    }
    const params = new URLSearchParams({path});
    if (record) params.set('fingerprint',record.fingerprint);
    else if (commit) params.set('commit',commit.hash);
    else return null;
    return {path,url:'/api/preview?'+params,key:snapshot.project.id+'/'+(record?.fingerprint || commit.hash+'/'+path),demo:false};
  }
  // Older saves put player metadata in the same sentence as album and chapter notes.
  function mediaText(summary, locale) {
    const text=String(summary || '').trim();
    const match=/(?:^|，)(?:这[段部个](?:视频|音频|短片|录音))?(?:全长|全场(?:时长)?|全片(?:时长)?|时长(?:约|为)?|长约)\s*((?:不到\s*)?\d+(?:\.\d+)?\s*(?:秒|分钟(?:\s*\d+\s*秒)?))(?=[，。]|$)/u.exec(text);
    if(!match)return {text,duration:''};
    const remaining=(text.slice(0,match.index)+text.slice(match.index+match[0].length)).replace(/^[，。]\s*/u,'');
    const duration=match[1].replace(/\s+/g,' ').trim();
    const numeric=duration.replace(/^不到\s*/,'');
    const i=languageIndex(locale);
    const label=i===0 ? '时长 '+duration : i===1 ? 'Duration '+(duration.startsWith('不到')?'under ':'')+numeric.replace(/\s*分钟/,' min').replace(/\s*秒/,' sec') :
      '再生時間 '+numeric.replace(/\s*分钟/,'分').replace(/\s*秒/,'秒')+(duration.startsWith('不到')?'未満':'');
    const prose=remaining.trim().replace(/声音明显响起([两三四五六七八])次，每次之间都轻了下来(，最后一声渐渐收住)?。$/u,(sentence,n,ending)=>{
      if(i===0)return sentence;
      const count='零一两三四五六七八'.indexOf(n);
      if(i===1)return ['','','Two','Three','Four','Five','Six','Seven','Eight'][count]+
        ' distinct sounds rise above the quieter gaps.'+(ending?' The last one slowly fades away.':'');
      return 'はっきり響くところが'+count+'回あり、その間は音が弱まります。'+(ending?'最後の音はゆっくりと消えていきます。':'');
    });
    return {text:prose,duration:label};
  }
  function describe(item,snapshot,locale,member=works(item,snapshot)[0],reading,versionContent) {
    const i = languageIndex(locale), type=memberType(item,member), labels=types[type] || types.file;
    const sample = snapshot.mode==='demo' && Demo.describeSample(item,snapshot,locale);
    const {path,record,commit,trace,delivery} = member || {};
    const media=type==='video'||type==='audio';
    const individual = member ? {...item,visualType:type,paths:[path],outputIds:record?[record.id]:[],evidenceIds:commit?[commit.hash]:[]} : item;
    const db = index(snapshot);
    const evidence = commit ? [commit] : [];
    const base = sample || Intro.describe({...individual,evidenceIds:evidence.map(c=>c.hash)},
      {outputs:record && !(media && record.sourceId==='local-files')?[record]:[],days:[{date:item.date,evidence}],memories:(item.memoryIds||[]).map(id=>db.memories.get(id)).filter(Boolean)},locale,{omitUnknown:true});
    const filename = path?.split(/[/\\]/u).pop() || '';
    const stem = filename.replace(/\.[^.]+$/,'').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[-_]+/g,' ').trim();
    const filenameFallback = path && (base.title === stem || base.title === filename || base.title === Array.from(stem).slice(0,63).join('').trimEnd()+'…');
    const receiptTitle = trace?.title?.trim();
    const workTitle = receiptTitle && ![path,filename,stem].includes(receiptTitle) && !/[/\\]|\.[a-z\d]{1,6}$/i.test(receiptTitle) ? receiptTitle : '';
    const saved=member?.content;
    const content=versionContent || saved;
    const report=member?.report;
    const reportedTitle=report?.title || (record?.sourceId!=='local-files' && record?.title);
    const suppliedTitle=reportedTitle && ![filename,stem,path].includes(reportedTitle) && !/[\\/]|\.\w{1,6}$/.test(reportedTitle)?reportedTitle:'';
    const visualTitle=reading?.title?.[i], visualSummary=reading?.summary?.[i];
    const candidates=media?[workTitle,suppliedTitle,content?.title,visualTitle]:[visualTitle,workTitle,suppliedTitle,content?.title];
    candidates.push(filenameFallback?labels[i]:base.title);
    const timedTitle=/^(?:不到\s*)?[\d\s.分秒钟小时]+的(?:视频|音频)$/;
    let title=sample?.title || candidates.find(value=>value && !(media && timedTitle.test(value))) || labels[i];
    const reported=media ? mediaText(report?.summary,locale) : {text:report?.summary?.trim()};
    const authored=reported.text;
    const extracted=media ? mediaText(content?.summary,locale) : {text:content?.summary};
    const duration=media && (extracted.duration || mediaText(saved?.summary,locale).duration || reported.duration) || '';
    // A sampled frame helps identify an otherwise undescribed video. Once its
    // own contents are documented, keep that frame in the visual preview.
    const frameHint=type==='video' && content?.contextSource ? '' : visualSummary;
    const details=[authored,extracted.text,frameHint].filter(text=>text && text!==title && text!==trace?.request && text!==delivery?.request);
    let summary=sample?.summary || [...new Set(details)].join(' ') || (media?mediaText(base.summary,locale).text:base.summary);
    if (summary===trace?.request || summary===delivery?.request)summary='';
    const fileTemplate = /名为《|^“.+” is an? |^「.+」という.+です。/u.test(base.summary);
    if (!sample && !extracted.text && !reading && !authored && filenameFallback && fileTemplate) {
      summary='';
      const gitNote=base.summary.match(/(?:这次改动提到「.+?」。|The change is described as .+|今回の変更には.+)/);
      if (gitNote) summary=gitNote[0];
    }
    if (!sample && !reading && /\.(?:png|jpe?g|gif|webp|svg|py|js|tsx?|md|pdf|html|csv|xlsx|pptx|wav|mp4)$/i.test(title)) title=labels[i];
    if(!sample && title===labels[i] && (media||/\s/u.test(filename)))title=namedWork(filename,i,type)||title;
    const demo = !!(sample && member);
    const timestamp = trace?.producedAt || delivery?.deliveredAt || record?.timestamp || commit?.timestamp || db.memories.get(item.memoryIds?.[0])?.timestamp;
    const when = timestamp ? new Intl.DateTimeFormat(locale,{timeZone:snapshot.timezone,year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(timestamp)) : '';
    const request = demo ? demoRequests[type==='image' && !path.endsWith('sample-02.png')?'garden':type]?.[i] || '' : trace?.request || '';
    const author = demo ? ['演示中的 AI','Demo AI','デモの AI'][i] : ({'codex':'Codex','claude-code':'Claude Code'}[trace?.sourceId] || trace?.sourceId || '');
    const edited = trace?.operation === 'edit';
    const output = author ? [author+(edited?' 修改了':' 生成了')+'「'+title+'」。',author+(edited?' edited “':' created “')+title+'”.',author+' が「'+title+'」を'+(edited?'編集':'作成')+'しました。'][i] : '';
    const timeKind = demo ? 'create' : trace?.operation || (delivery ? 'delivery' : record ? 'file' : commit ? 'commit' : 'conversation');
    const deliverySource=({'codex':'Codex','claude-code':'Claude Code'})[delivery?.sourceId] || delivery?.sourceId;
    const delivered=deliverySource ? [deliverySource+' 在交付消息里附上了这件作品。',deliverySource+' linked this work in its delivery message.',deliverySource+' が完成時のメッセージでこの作品を共有しました。'][i] : '';
    return {title,summary:summary || output || delivered,when,timeKind,type,request,requestedAt:trace?.requestedAt,output,author,delivered,duration,
      contextSource:content?.contextSource,demo,demoDiscussion:demo ? sample.discussion : undefined,trace:!!trace,hasReading:!!reading || !!content};
  }
  const stopwords=new Set(('可以 已经 自己 如果 我们 一个 这些 这个 需要 还是 有没有 没有 一下 时候 因为 是的 比较 这里 不是 用来 关于 正在 还有 怎么 什么 可以的话 主要 这次 对话 以及 今天 所以 一些 目前 这个问题 按照 进行 接下来 项目 然后 帮我 现在 通过 成为 应该 可能 继续 本次 不能 '+
    'a an the and or with without that this those these should could would have done can from about only into what your you our they them there then their need also want please make today work note thought conversation when will might been just here one '+
    'について です ます ました ない する ある いる から ここ これ こと もの それ たち ため ので など 今回').split(/\s+/));
  const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('zh',{granularity:'word'}):null;
  function topicWords(sources){
    const frequency=new Map();
    for(const source of sources){
      if(!source || !segmenter)continue;
      for(const {segment,isWordLike} of segmenter.segment(source)){
        const word=segment.toLowerCase();
        if(!isWordLike||stopwords.has(word)||!/\p{L}/u.test(word)||word.length<2||word.length>22||
           /[0-9_]/u.test(word)||/^[a-z]{1,2}$/i.test(word))continue;
        frequency.set(word,(frequency.get(word)||0)+1);
      }
    }
    return [...frequency].sort((a,b)=>b[1]-a[1]||b[0].length-a[0].length||a[0].localeCompare(b[0])).slice(0,5).map(([word])=>word);
  }
  function memorySummary(item,snapshot,locale){
    const record=index(snapshot).memories.get(item.memoryIds?.[0]);
    const words=topicWords([record?.title,record?.summary].map(source=>typeof source==='string'?
      source.replace(/```[\s\S]*?(?:```|$)/gu,'').split(/\r?\n/u)
        .filter(line=>!/[\\/@:=`<>]|密钥|密码|bearer|password|api[_ -]?key|sk-|gh[pousr]_/iu.test(line)).join(' ').slice(0,340):'')).slice(0,3);
    const lang=languageIndex(locale);
    const topics=Array.from(new Set(words.flatMap(word=>fitsLanguage(word,lang)?[word]:subjects()?.topics(word,lang)||[])));
    if(locale==='en')return topics.length?'This conversation touched on '+new Intl.ListFormat('en').format(topics)+'.':'An idea saved from this conversation.';
    if(locale==='ja')return topics.length?'この会話の話題は'+topics.join('、')+'。':'このときの会話から残したメモです。';
    return topics.length?'这段对话聊到了'+topics.join('、')+'。':'当时聊到的一个想法被留在了这里。';
  }
  // Descriptions supplied by files, captions and tools are original evidence.
  // Keep it intact for the evidence panel and the opt-in writer. Wall and card
  // copy use the chosen language even before an AI note is available.
  function card(item,snapshot,locale,member,reading,content){
    const copy=describe(item,snapshot,locale,member,reading,content);
    if(copy.demo||item.memoryIds?.length)return copy;
    const lang=languageIndex(locale),originalTitle=copy.title,originalSummary=copy.summary;
    const localTitle=titleInLanguage(originalTitle,lang);
    const summary=(copy.type==='table'&&tableDescription(originalSummary,lang))||descriptionInLanguage(originalSummary,lang);
    if(localTitle===originalTitle&&summary===originalSummary)return copy;
    const src=member||works(item,snapshot)[0];
    const role=Intro.describe({visualType:copy.type,paths:src?[src.path]:[]},{},locale,{omitUnknown:true});
    const typeTitle=(types[copy.type]||types.file)[lang];
    const baseName=src?.path?.split(/[/\\]/u).pop()||'';
    const localName=/\s/u.test(baseName)&&namedWork(baseName,lang,copy.type);
    copy.title=localTitle || localName || titleInLanguage(role.title,lang) || typeTitle;
    const topics=subjects()?.topics(originalTitle,lang)||[];
    const topicList=topics.length?new Intl.ListFormat(locale).format(topics):'';
    const subjectNote=topicList && ['这件作品的题目提到了'+topicList+'。','Its original title mentions '+topicList+'.','元の題名には'+topicList+'が出てきます。'][lang];
    copy.summary=summary || measuredDescription(originalSummary,lang) || subjectNote ||
      descriptionInLanguage(role.summary,lang) ||
      (originalSummary?['作品的原文收在下方记录中。','The original description is available in the source records.','元の説明は下の記録から読めます。'][lang]:'');
    if(copy.output && copy.title!==originalTitle)copy.output=copy.output.replace(originalTitle,()=>copy.title);
    copy.originalTitle=originalTitle!==copy.title?originalTitle:'';
    copy.originalSummary=originalSummary!==copy.summary?originalSummary:'';
    return copy;
  }
  return Object.freeze({works,picture,visualSource,playbackSource,contentSource,memberType,describe,card,topicWords,memorySummary});
});
