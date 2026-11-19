(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ItemIntro = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // File names are sometimes all the mine knows. Describe a recognizable
  // convention, without guessing what an image depicts or what a test found.
  const kinds = {
    web: ['网页', 'web page', 'ウェブページ'],
    document: ['文档', 'document', '文書'],
    image: ['图片', 'image', '画像'],
    audio: ['音频', 'audio recording', '音声'],
    video: ['视频', 'video', '動画'],
    slides: ['幻灯片', 'slide deck', 'スライド'],
    table: ['表格', 'spreadsheet', '表'],
    code: ['代码', 'code file', 'コード'],
    file: ['文件', 'file', 'ファイル']
  };
  // Only recognized column labels enter a table introduction. Keep the same
  // vocabulary when reading a CSV and translating a saved observation.
  const columnNames=new Map();
  const columns=[
    ['date','日期','日付'],['month','月份','月'],['time','时间','時間'],['year','年份','年'],['city','城市','都市'],
    ['region','区域','地域'],['location','地点','場所'],['country','国家','国'],['product','商品','商品'],
    ['category','类别','分類'],['name','名称','名称'],['title','标题','題名'],['quantity','数量','数量'],
    ['units','件数','件数'],['sales','销量','販売数'],['revenue','收入','収益'],['price','价格','価格'],
    ['amount','金额','金額'],['temperature','温度','温度'],['humidity','湿度','湿度'],['count','数量','件数'],
    ['score','分数','得点'],['budget','预算','予算'],['cost','成本','費用'],['result','结果','結果'],
    ['task','任务','タスク'],['status','状态','状態'],['priority','优先级','優先度'],['deadline','截止日期','期限'],
    ['distance','距离','距離'],['duration','时长','長さ'],['artist','艺术家','アーティスト'],['album','专辑','アルバム'],
    ['genre','风格','ジャンル'],['species','物种','種'],['site','站点','観測地点'],['weight','重量','重量'],
    ['ingredient','食材','食材'],['calories','热量','カロリー'],['population','人口','人口'],['latitude','纬度','緯度'],
    ['longitude','经度','経度'],['level','等级','レベル'],['model','模型','モデル'],['tokens','Token 数','トークン数'],
    ['unit','单位','単位'],['version','版本','版'],['timestamp','时间','時刻'],['country_code','国家代码','国コード'],
    ['pier','码头','桟橋'],['departures','出发班次','出発便数'],['arrivals','到达班次','到着便数']
  ];
  for(const row of columns)for(const alias of row){
    const key=alias.toLowerCase();
    if(!columnNames.has(key))columnNames.set(key,row);
  }
  function tableColumn(name,language){
    return columnNames.get(String(name).trim().toLowerCase())?.[language==='en'?0:language==='ja'?2:1]||'';
  }
  const roles = [
    [/^readme(?:\.|$)/i, null, ['项目说明', 'Project guide', 'プロジェクトの案内'], ['想了解这个项目，可以从这份说明读起。', 'A place to start reading about the project.', 'このプロジェクトを知るとき、最初に読める案内です。']],
    [/^package\.json$/i, null, ['项目设置', 'Package settings', 'プロジェクトの設定'], ['这份清单写着项目要用哪些工具，也能列出启动项目的命令。', 'This file lists the tools the project uses and can include the commands that start it.', 'このファイルには、使うツールや起動用のコマンドをまとめておけます。']],
    [/^(?:changelog|release[-_ ]notes)(?:\.|$)/i, 'document', ['更新记录', 'Release notes', '更新履歴'], ['翻一翻这份记录，就能看看项目有哪些改动。', 'A running account of what changed in the project.', 'プロジェクトにどんな変更があったかをたどれる記録です。']],
    [/^index\.html?$/i, 'web', ['网站首页', 'Home page', 'サイトの入り口'], ['这是这个网站或栏目用来迎接访客的页面。', 'The opening page for a site or one of its sections.', 'サイトやコーナーの入り口になるページです。']],
    [/^(?:route[-_ ]?planner|路线规划)(?:\.|$)/i, 'code', ['路线规划脚本', 'Route planner', '経路を考えるプログラム'], ['这段程序用来规划路线。', 'A program for planning routes.', '経路を組み立てるためのプログラムです。']],
    [/^(?:podcast[-_ ]intro|播客片头)(?:\.|$)/i, 'audio', ['播客片头', 'Podcast intro', 'ポッドキャストのオープニング'], ['这段声音用在播客开头。', 'The opening audio for a podcast.', 'ポッドキャストの冒頭に流す音声です。']],
    [/^(?:logo|标志|标识)(?:[._ -]|$)/i, 'image', ['标志图', 'Logo', 'ロゴ画像'], ['这是一张用来辨认品牌或项目的标志图。', 'An image that identifies a brand or project.', 'ブランドやプロジェクトの目印になる画像です。']],
    [/^(?:budget|预算)(?:[._ -]|$)/i, 'table', ['预算表', 'Budget sheet', '予算表'], ['这张表用来安排预算。', 'A sheet for planning a budget.', '予算を組み立てるための表です。']],
    [/^(?:meeting[-_ ]notes|会议纪要|会议记录)(?:[._ -]|$)/i, 'document', ['会议笔记', 'Meeting notes', '会議のメモ'], ['开会时谈到的事情，记在这份笔记里。', 'A place to keep what came up in a meeting.', '会議で話したことを書き留めるメモです。']],
    [/^(?:portfolio|作品集)(?:\.|$)/i, 'web', ['作品集网页', 'Portfolio page', '作品紹介のページ'], ['这是一个用来展示作品的页面。', 'A page for showing a selection of work.', '作品をまとめて見せるためのページです。']]
  ];
  const formats = {md:'Markdown', pdf:'PDF', docx:'Word', xlsx:'Excel', csv:'CSV', pptx:'PowerPoint', html:'HTML',
    png:'PNG', jpg:'JPEG', jpeg:'JPEG', svg:'SVG', wav:'WAV', mp3:'MP3', mp4:'MP4', py:'Python', js:'JavaScript', cjs:'JavaScript', ts:'TypeScript'};
  // Match complete words in a descriptive name. For example, a fixture called
  // "catalogue" should not be described as a log or as audio.
  const topics = [
    ['code', /\b(?:audio|sound)\b|音效|声音/, ['声音播放', 'Sound playback', '音の再生'], ['这部分代码和声音播放有关。', 'This part of the program handles sound.', '音の再生に関わるコードです。']],
    ['code', /\blighting\b|光照/, ['画面光照', 'Scene lighting', '画面の照明'], ['这是程序里与光照有关的部分，关系到画面哪里亮、哪里暗。', 'This code deals with light and shade in the scene.', '画面のどこを照らし、どこに影をつけるかに関わるコードです。']],
    ['code', /\b(?:i18n|translations?|localization)\b|多语言|翻译/, ['界面翻译', 'Interface translations', '画面の翻訳'], ['这部分代码让同一处界面能用不同的语言显示。', 'This part of the program lets an interface appear in different languages.', '画面を複数の言語で表示するためのコードです。']],
    ['code', /\b(?:settings|config|setup)\b|配置|设置/, ['程序设置', 'Program settings', 'プログラムの設定'], ['这部分代码用来设置程序的运行方式。', 'This code deals with how the program is set up to run.', 'プログラムをどう動かすか、設定するためのコードです。']],
    ['code', /\b(?:radio|news)\b|电台|新闻/, ['消息播报', 'News and bulletins', 'ニュース配信'], ['这部分代码与消息播报有关。', 'This code deals with news or bulletins.', 'ニュースやお知らせに関わるコードです。']],
    ['document', /\b(?:research|study) notes\b|研究笔记/, ['研究笔记', 'Research notes', '調査ノート'], ['这是调研时留下的笔记，方便回头翻看。', 'Notes kept during research, ready to revisit later.', '調べたことを後から読み返せるように残したノートです。']],
    ['image', /\b(?:poster|海报)\b|海报/, ['海报', 'Poster', 'ポスター'], ['这是一张海报图，用一幅画面传达要展示的内容。', 'A poster that brings its message together in one image.', '伝えたいことを一枚にまとめたポスター画像です。']],
    ['image', /\b(?:cover|封面)\b|封面/, ['封面图', 'Cover image', '表紙の画像'], ['这是准备用作封面的图片。', 'An image for the cover of a work.', '表紙に使うための画像です。']],
    ['image', /\b(?:illustration|插画)\b|插画/, ['插画', 'Illustration', 'イラスト'], ['这是一幅插画。', 'An illustration from this project.', 'このプロジェクトのイラストです。']],
    ['audio', /\binterview\b|访谈|采访/, ['访谈录音', 'Interview recording', 'インタビュー音声'], ['这段录音留下了一次访谈。', 'An audio recording of an interview.', 'インタビューを音声で残したものです。']],
    ['video', /\btrailer\b|预告片/, ['预告片', 'Trailer', '予告編'], ['这段短片用来让人先睹为快。', 'A short preview of a longer work.', '作品を少し先に見られる予告編です。']],
    ['slides', /\bproposal\b|提案/, ['提案幻灯片', 'Proposal slides', '提案スライド'], ['这份幻灯片用来把一个提案讲给别人听。', 'Slides for presenting a proposal to others.', '提案の内容を人に伝えるためのスライドです。']],
    ['table', /\b(?:schedule|timetable)\b|排期|日程/, ['日程表', 'Schedule', '予定表'], ['这张表用来安排时间，查看事情先后怎么排。', 'A table for laying out what happens when.', 'いつ何をするかを見渡せる予定表です。']]
  ];
  const unit = {web:'个',document:'份',image:'张',audio:'段',video:'段',slides:'份',table:'张',code:'段',file:'份'};
  const nameHints = [
    ['code', /\b(?:collectors?|collection adapter)\b|采集器|采集模块/, ['项目数据采集','Project data collection','プロジェクトのデータ収集']],
    ['code', /\b(?:mine|mining|drill|excavation|cavern)\b|矿坑|采矿|钻机/, ['矿坑逻辑','Mining logic','採掘のしくみ']],
    ['code', /\bcore\b|核心/, ['核心逻辑','Core logic','プログラムの中核']],
    ['code', /\b(?:server|router)\b|服务端|路由/, ['服务端请求处理','Server requests','サーバーのリクエスト処理']],
    ['code', /\b(?:history store|archive|journal)\b|存档|归档/, ['历史存档','Saved history','履歴の保存']],
    ['code', /\b(?:parser|formatter|validator)\b|解析器|校验器/, ['数据格式处理','Data format handling','データ形式の処理']],
    ['video', /\b(?:mine|mining|excavation|cavern)\b.*\b(?:demo|motion|gameplay|tour|walkthrough)\b|矿坑.*(?:演示|录像)/, ['矿坑演示录像','Mine demonstration','採掘のデモ映像']],
    ['video', /\bworkshop\b.*\b(?:demo|motion|tour)\b|工坊.*演示/, ['工坊演示录像','Workshop demonstration','工房のデモ映像']],
    ['video', /\b(?:walkthrough|walk through|tutorial)\b|操作演示|操作教程/, ['分步讲解录像','Recorded walkthrough','手順の解説動画']],
    ['video', /\b(?:demo|gameplay|playthrough)\b|演示录像|实机录像/, ['演示录像','Recorded demonstration','デモ映像']],
    ['video', /\b(?:rehearsal|practice session)\b|彩排|排练/, ['排练录像','Rehearsal video','リハーサル映像']],
    ['audio', /\b(?:rehearsal|practice session)\b|彩排|排练/, ['排练录音','Rehearsal recording','リハーサル音源']],
    ['video', /\b(?:lesson|lecture)\b|课程|讲座/, ['课程录像','Recorded lesson','授業の映像']],
    ['audio', /\b(?:lesson|lecture)\b|课程|讲座/, ['课程录音','Audio lesson','授業の音声']],
    ['slides', /\b(?:lesson|lecture)\b|课程|讲座/, ['课程讲义','Lesson slides','授業のスライド']],
    ['document', /\b(?:lesson|lecture)\b|课程|讲座/, ['课程资料','Lesson material','授業の資料']],
    ['document', /\bmeeting agenda\b|会议议程|会议议题/, ['会议议程','Meeting agenda','会議の議題']],
    ['document', /\b(?:walkthrough|tutorial)\b|操作教程|分步指南/, ['分步操作指南','Step-by-step guide','手順のガイド']],
    ['document', /\binvoices?\b|发票/, ['发票文档','Invoice document','請求書']],
    ['table', /\binvoices?\b|发票/, ['发票记录表','Invoice sheet','請求の一覧表']],
    ['image', /\binvoices?\b|发票/, ['发票图片','Invoice image','請求書の画像']]
  ];
  const namedUse={
    '项目数据采集':'从文件名看，这是项目里负责收集数据的那部分程序。',
    '矿坑演示录像':'文件名提到矿坑和演示，这段录像用来回看当时展示的玩法。',
    '工坊演示录像':'从文件名看，这是一段工坊的动态演示，留作回看展示过程。',
    '演示录像':'文件名把它标作一段演示，可以回看当时怎样操作或展示。',
    '分步讲解录像':'从文件名看，这段录像要带着观众按步骤走一遍操作。',
    '分步操作指南':'从文件名看，这是一份分步说明，照着它可以逐项查找操作步骤。',
    '排练录像':'从文件名看，这是排练时留下的视频，可以回看练习的过程。',
    '排练录音':'从文件名看，这是排练时留下的声音，可以回听当时的练习。',
    '课程录像':'从文件名看，这段视频是为回看一堂课准备的。',
    '课程录音':'从文件名看，这段声音是为回听一堂课准备的。',
    '课程讲义':'从文件名看，这组幻灯片是上课讲解时使用的材料。',
    '课程资料':'从文件名看，这份资料供上课或复习时翻阅。',
    '会议议程':'从文件名看，这份文档是为开会准备的，用来安排要讨论的事项。',
    '发票文档':'从文件名看，这是一份留作付款或报销核对的发票。',
    '发票记录表':'从文件名看，这张表用来汇集发票记录，方便逐笔核对。',
    '发票图片':'文件名表明它和发票有关，具体票面内容还要看原图。'
  };
  const genericTitles = {
    image:['一张图片','An image','画像作品'], audio:['一段音频','An audio piece','音声作品'],
    video:['一段短片','A video','動画作品'], web:['一个网页','A web page','ウェブページ'],
    slides:['一份演示稿','A presentation','プレゼン資料'], code:['一段程序','A program','プログラム'],
    document:['一份文档','A document','文書'], table:['一张表格','A spreadsheet','表'], file:['一份作品文件','A project file','作品のファイル']
  };
  function clean(value) {
    return String(value || '')
      .replace(/```[\s\S]*?(?:```|$)/g, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<\/?[a-z][^>]*>/gi, '').replace(/\[\[DEEPMINE_MEMORY\]\]|\*\*|__|`/g, '')
      .replace(/^\s*(?:#{1,6}\s+|[-*>•]\s+|\d+[.)]\s+)/gm, '').trim();
  }
  function shorten(value, max) {
    const chars = Array.from(value);
    return chars.length > max ? chars.slice(0, max - 1).join('').trimEnd() + '…' : value;
  }
  function sentence(value) {
    const parts = clean(value).split(/\n+|(?<=[。！？])|(?<=[.!?])\s+/u)
      .map(s => s.trim()).filter(s => s && !/^(?:https?:\/\/|[|#])|[:：]$/.test(s));
    const content = parts.filter(s => !/^(?:好的|没问题|以下是(?:总结|更新|结果)|(?:[已现]经?|这[轮次]|我们|我)?(?:已?经)?(?:完成|改好|处理好)(?:了)?(?:以下|如下)?(?:更新|修改|调整|改动|工作)?|(?:验证结果|测试结果|主要改动|改动内容)(?:如下)?|summary|done|all set|here(?:'s| is) (?:a|the) summary)[。.!！]?$/i.test(s) &&
      !/^(?:npm (?:test|run)\b|SHA-256\b|\d+\s*(?:tests? passed|项测试通过)|tests?:?\s*\d+)/i.test(s));
    return shorten(content.find(s => s.length >= 6) || content[0] || '', 140);
  }
  function withoutStop(value) { return value.replace(/[。！？.!?]+$/, ''); }
  function sameWords(a, b) { return withoutStop(a).trim().toLowerCase() === withoutStop(b).trim().toLowerCase(); }
  function generatedNote(text) {
    return /^(?:已在配置的输出目录观察到此文件|Cursor afterFileEdit 报告此文件发生编辑|Fictional sample for the interactive preview\b|Observed(?: local)?(?: output)?(?: file)?[.!]?\s*$)/i.test(text);
  }
  function basename(path) { return path.split(/[\\/]/).pop() || ''; }
  function namedFile(path, kind, lang) {
    const name = basename(path), label = (kinds[kind] || kinds.file)[lang];
    const role = roles.find(([pattern, type]) => (!type || type === kind) && pattern.test(name));
    if (role) return {title:role[2][lang], summary:role[3][lang], recognizable:true};
    const ext = name.split('.').pop().toLowerCase(), format = Object.hasOwn(formats, ext) ? formats[ext] : '';
    const stem = clean(name.replace(/\.[^.]+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim());
    if (kind === 'code' && (/(?:[.\-_](?:test|spec)\.|^(?:test|spec)[_\-])/i.test(name) || /(?:^|\/)(?:tests?|__tests__)\//i.test(path))) {
      const subject = stem.replace(/^(?:test|spec)\s+|[.\s]+(?:test|spec)$/ig, '').trim();
      const topic = topics.find(([type,re]) => type === 'code' && re.test(subject.toLowerCase()));
      const hint=nameHints.find(([type,re])=>type==='code'&&re.test(subject.toLowerCase()));
      const feature = (topic || hint)?.[2][lang] || '';
      const title = [feature ? feature+'测试' : '程序测试', feature ? 'Tests for '+feature : 'Program tests', feature ? feature+'のテスト' : 'プログラムのテスト'][lang];
      const summary = ['文件名显示这是测试用的代码，用来检查'+(feature?'「'+feature+'」':'程序')+'是否按预期工作。', 'Its name marks it as a test of '+(feature || 'the program')+'.', 'ファイル名から、'+(feature || 'プログラム')+'の動作を確かめるテストだと分かります。'][lang];
      return {title, summary, recognizable:true};
    }
    const topic = topics.find(([type,re]) => type === kind && re.test(stem.toLowerCase()));
    if (topic) return {title:topic[2][lang], summary:topic[3][lang], recognizable:true};
    const hint=nameHints.find(([type,re])=>type===kind && re.test(stem.toLowerCase()));
    if(hint){
      const title=hint[2][lang];
      const summary=[
        namedUse[title] || (kind==='code'?'从文件名看，这段代码与'+title+'有关。':'文件名把这件作品标为'+title+'。'),
        'The file name identifies this as '+title.toLowerCase()+'.',
        'ファイル名には「'+title+'」とあります。'
      ][lang];
      return {title,summary,recognizable:true};
    }
    // A build identifier or a function-like filename supplies no reliable
    // topic, even if splitting its underscores makes it look like a phrase.
    if(!/[\u3040-\u30ff\u3400-\u9fff]/.test(stem) || /[0-9a-f]{10,}|[./\\]/i.test(stem)){
      const title=(genericTitles[kind] || genericTitles.file)[lang];
      return {title,summary:['这个版本只留下了文件记录，具体内容还看不出来。','Only the file record remains for this version. Its contents are unknown.','この版にはファイルの記録だけが残っており、詳しい内容は確認できません。'][lang],recognizable:false};
    }
    const title = shorten(stem || label, 64);
    const type = format ? [format+' '+label, format+' '+label, format+' 形式の'+label][lang] : label;
    const summary = name ? [
      '这是一'+(unit[kind] || '份')+'名为《'+title+'》的'+(format?' ':'')+type+'。', '“'+title+'” is '+(/^(?:[aeiou]|HTML|SVG|MP[34])/i.test(type)?'an ':'a ')+type+'.',
      '「'+title+'」という'+type+'です。'
    ][lang] : ['这里留着一份'+label+'。', 'A '+label+' from the project.', 'プロジェクトにある'+label+'です。'][lang];
    return {title, summary, recognizable:/[\u3040-\u30ff\u3400-\u9fff]/.test(stem) && !/[.\\/]/.test(stem)};
  }
  function addOthers(summary, files, kind, lang, leadTitle) {
    if (files.length < 2) return summary;
    const n = files.length - 1, themes = [];
    for (const path of files.slice(1)) {
      const other = namedFile(path, kind, lang);
      if (other.recognizable && other.title !== leadTitle && !themes.includes(other.title)) themes.push(other.title);
      if (themes.length === 2) break;
    }
    const labels = themes.join(['和',' and ','」や「'][lang]);
    const extra = themes.length ? [
      '这一天的文件里还能找到'+labels+'。', 'Other files from the day include '+labels+'.', 'この日のほかのファイルには「'+labels+'」もあります。'
    ][lang] : [
      '这一天还记下了另外 '+n+' 个文件。', 'Another '+n+' '+(n === 1 ? 'file appears' : 'files appear')+' alongside it.', 'この日の分には、ほかに'+n+'件のファイルがあります。'
    ][lang];
    return summary + (lang === 1 ? ' ' : /[。！？.!?…]$/.test(summary) ? '' : ' ') + extra;
  }
  function describeMemory(item, snapshot, lang) {
    const records = (snapshot.memories || []).filter(m => item.memoryIds?.includes(m.id));
    const record = records[0] || {}, note = sentence(record.summary || item.description || item.meaning);
    const originalTitle = sentence(record.title);
    const generic = ['对话里的一个想法', 'A thought from the conversation', '会話の中のひとこと'][lang];
    const title = originalTitle && !/^(?:conversation note|memory|对话节选|记忆)$/i.test(originalTitle) && !sameWords(originalTitle, note) && originalTitle.length <= 50 ? originalTitle : generic;
    if (!note) return {title, summary:['这里记下了一段当时的对话。','A note kept from this conversation.','このときの会話から残したメモです。'][lang]};
    const words = note.replace(/[。.]+$/, '');
    const quote = ['对话里提到「'+words+'」。','The conversation mentions “'+words+'”.','会話には「'+words+'」とあります。'][lang];
    const summary = records.length <= 1 ? quote : quote + ['这里还收着另外 '+(records.length-1)+' 段对话笔记。',' This group also holds '+(records.length-1)+' other conversation '+(records.length===2?'note.':'notes.'),'このほかに会話のメモが'+(records.length-1)+'件あります。'][lang];
    return {title, summary};
  }
  function describe(item, snapshot, locale, {omitUnknown=false}={}) {
    item = item || {}; snapshot = snapshot || {};
    const lang = /^zh/i.test(locale) ? 0 : /^ja/i.test(locale) ? 2 : 1;
    if (item.memoryIds?.length || item.visualType === 'memory') return describeMemory(item, snapshot, lang);
    const files = [...new Set(item.paths || [])], primary = files[0] || '', kind = item.visualType || 'file';
    const fallback = namedFile(primary, kind, lang);
    const records = (snapshot.outputs || []).filter(out => item.outputIds?.includes(out.id) && out.files?.includes(primary))
      .sort((a,b) => (b.timestamp || '').localeCompare(a.timestamp || '') || a.id.localeCompare(b.id));
    // An older description can refer to a previous version of the same file.
    const output = records[0], originalTitle = clean(output?.title);
    const usefulTitle = originalTitle && ![primary, basename(primary), fallback.title].some(name => sameWords(name, originalTitle));
    const title = usefulTitle ? shorten(originalTitle, 72) : fallback.title;
    const supplied = sentence(output?.summary);
    let summary = omitUnknown && !fallback.recognizable ? '' : fallback.summary;
    if (supplied && !generatedNote(supplied) && !sameWords(supplied, title) && !sameWords(supplied, basename(primary))) {
      summary = supplied;
    } else {
      const day = (snapshot.days || []).find(day => day.date === item.date);
      const entry = (day?.evidence || []).filter(commit => item.evidenceIds?.includes(commit.hash) && commit.files?.some(file => file.path === primary))
        .sort((a,b) => (b.timestamp || '').localeCompare(a.timestamp || ''))[0];
      const subject = sentence(clean(entry?.title).replace(/^(?:feat|fix|docs|chore|refactor|test|build|perf|ci|style)(?:\([^)]*\))?!?:\s*/i, ''));
      const redundant = /^(?:update[ds]?|fix(?:es)?|changes?|wip|file changes|更新|修改|修复)[.!。]?$/i.test(subject) ||
        /^(?:merge (?:pull request|branch)|bump .+ from [\d.]|fixup!)/i.test(subject) ||
        sameWords(subject.replace(/^(?:update[ds]?|modify|add(?:ed)?|修改|更新)\s*/i, ''), basename(primary));
      if (subject && subject.length <= 90 && !redundant) {
        summary += ['这次改动提到「'+withoutStop(subject)+'」。',' The change is described as “'+withoutStop(subject)+'”.','今回の変更には「'+withoutStop(subject)+'」とあります。'][lang];
      }
    }
    return {title, summary:addOthers(summary, files, kind, lang, title)};
  }
  return Object.freeze({describe,tableColumn});
});
