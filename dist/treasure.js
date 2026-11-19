(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const chest=$('treasureChest'),dialog=$('treasureDialog'),body=$('treasureBody');
  if(!chest||!dialog)return;
  const strings={
    en:{chest:'Map archive',found:'A treasure map!',close:'Close',survey:'Personal survey log',waiting:'Treasure map',map:'Treasure map',locked:'Actively dig 12 metres today to uncover a map.',sealed:'A folded map holds the first repository on GitHub Trending today. Unfold it to look up the live chart.',decode:'Unfold map',busy:'Reading the map…',offline:'GitHub could not be reached. Your map is still available to open today.',retry:'Try again',source:'GitHub Trending · Daily · #1',sourceLink:'Open the daily chart',visit:'Visit project',file:'File map',filed:'Filed',shelf:'Filed maps',loose:'Unfiled maps',empty:'No filed maps yet.',original:'Project description in its original language',error:'Could not read the local archive.',today:'Today',recorded:'Chart read',demo:'Sample map · outside the daily chart',sample:'A collection of .gitignore templates for Git projects.',more:'More dates',ready:'A map is ready to open',none:'The repository has no public description.'},
    'zh-CN':{chest:'藏宝图档案箱',found:'挖到藏宝图了！',close:'关闭',survey:'个人测绘簿',waiting:'藏宝图',map:'藏宝图',locked:'今天主动挖满 12 米，岩缝里就会露出一张地图。',sealed:'卷起的地图藏着 GitHub 今日热门榜的首个项目。展开时读取实时榜单。',decode:'展开藏宝图',busy:'正在解读地图…',offline:'暂时连不上 GitHub。这张地图今天仍可解读。',retry:'再试一次',source:'GitHub 热门榜 · 今日首位',sourceLink:'核对今日榜单',visit:'去看项目',file:'放进档案箱',filed:'已归档',shelf:'已归档',loose:'待归档',empty:'箱里还没有归档的地图。',original:'查看项目原文简介',error:'本地档案箱暂时无法读取。',today:'今天',recorded:'读取榜单于',demo:'试玩地图 · 示例项目',sample:'为不同类型的 Git 项目收录 .gitignore 模板。',more:'更多日期',ready:'有藏宝图待解读',none:'这个项目没有填写公开简介。'},
    ja:{chest:'宝の地図の保管箱',found:'宝の地図を発見！',close:'閉じる',survey:'個人測量帳',waiting:'宝の地図',map:'宝の地図',locked:'今日、自分で12メートル掘ると地図が見つかります。',sealed:'巻物には今日の GitHub トレンドの先頭にあるプロジェクトが記されます。開くと最新の一覧を読み取ります。',decode:'地図を広げる',busy:'地図を読んでいます…',offline:'GitHub に接続できません。今日中にもう一度地図を開けます。',retry:'もう一度',source:'GitHub トレンド · 本日の先頭',sourceLink:'今日の一覧を見る',visit:'プロジェクトへ',file:'地図を保管する',filed:'保管済み',shelf:'保管済みの地図',loose:'未整理の地図',empty:'まだ地図は保管されていません。',original:'元の言語でプロジェクトの説明を読む',error:'保管箱を読み込めませんでした。',today:'今日',recorded:'取得日時',demo:'体験用の地図 · サンプル',sample:'Git プロジェクト用の .gitignore テンプレート集です。',more:'他の日付',ready:'宝の地図が見つかりました',none:'公開されている説明文がありません。'}
  };
  let language='en',mode='',scope='',day='',metres=-1,state=null,selected='',status='',pending=false,revision=0,limit=10;
  let seenEligible=false,lastNotice='',demoRead=false,demoFiled=false,archiveRequest=0,reading=false;
  const text=key=>strings[language][key];
  function el(tag,content,cls){const node=document.createElement(tag);if(content)node.textContent=content;if(cls)node.className=cls;return node;}
  function action(label,click,cls){const b=el('button',label,cls);b.type='button';b.onclick=click;return b;}
  function link(container,label,url){const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';container.append(a);}

  function drawChest(){
    const c=$('chestArt'),g=c.getContext('2d');g.clearRect(0,0,28,24);
    const r=(x,y,w,h,color)=>{g.fillStyle=color;g.fillRect(x,y,w,h);};
    r(2,11,24,10,'#252d39');r(4,7,20,16,'#262b35');r(6,5,16,2,'#313744');
    r(4,9,20,4,'#a86c48');r(6,7,16,3,'#d09058');r(7,7,14,1,'#e4b37b');
    r(4,15,20,5,'#77483c');r(6,16,16,2,'#966046');r(6,20,16,1,'#a97654');
    for(const x of [6,20]){r(x,7,2,14,'#433b37');r(x,8,1,4,'#d5a25e');r(x,16,1,4,'#c4965a');}
    r(12,12,4,6,'#453936');r(12,13,3,4,'#dfbc70');r(13,14,1,2,'#5c4b3e');
  }
  function drawMap(canvas,seed){
    canvas.width=92;canvas.height=44;
    const g=canvas.getContext('2d'),r=(x,y,w,h,col)=>{g.fillStyle=col;g.fillRect(x,y,w,h);};
    let s=2166136261;for(const ch of seed)s=Math.imul(s^ch.charCodeAt(0),16777619);
    function rand(n){s=(Math.imul(s,1664525)+1013904223)>>>0;return s%n;}
    for(let x=4;x<87;x++){
      const fold=Math.floor((x-4)/16)%2,top=4+(fold?0:2)+(x<7||x>84?1:0);
      r(x,top+1,1,34,'#71564a');r(x,top,1,32,fold?'#ead398':'#d5b983');
      if((x-4)%16===0)r(x,top+1,1,31,'#b49b75');
    }
    for(let i=0;i<39;i++)r(8+rand(75),10+rand(22),1+rand(2),1,'#c2a477');
    let y=16+rand(10);
    for(let x=9;x<68;x+=2){y=Math.max(11,Math.min(32,y+rand(5)-2));r(x,y,2,1,'#9a8a60');if((x%6)===3)r(x,y+2,2,1,'#8eaa99');}
    for(let i=0;i<7;i++){const x=13+rand(58),v=10+rand(19);r(x,v,1,1,'#88885c');r(x-1,v+1,3,1,'#879368');r(x-2,v+2,5,1,'#a4a275');}
    const end=15+rand(12);
    for(let i=0;i<14;i++){const x=12+i*4,y=Math.round(28+(end-28)*i/13+Math.sin(i*.6)*3);r(x,y,2,1,'#976551');}
    for(let j=0;j<7;j++){r(65+j,end-3+j,2,1,'#a04f40');r(71-j,end-3+j,2,1,'#a04f40');}
    r(77,8,1,8,'#84674b');r(74,11,7,1,'#84674b');r(76,9,3,3,'#a9714e');r(77,8,1,2,'#6c654c');
  }
  function announce(){
    if(!seenEligible||lastNotice===scope+day||document.hidden||document.querySelector('dialog[open]'))return;
    lastNotice=scope+day;
    if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      const canvas=el('canvas',null,'treasure-drop');canvas.setAttribute('aria-hidden','true');drawMap(canvas,day);
      document.body.append(canvas);setTimeout(()=>canvas.remove(),1800);
    }
    $('treasureAnnounce').textContent=text('found');
  }
  function filed(date){return state?.entries?.some(e=>e.date===date&&e.filed);}
  function badge(){
    const ready=metres>=12&&!filed(day);
    chest.classList.toggle('ready',ready);chest.title=text('chest')+(ready?' · '+text('ready'):'');chest.setAttribute('aria-label',chest.title);
  }
  function sourceDescription(container,map){
    if(mode==='demo'){container.append(el('p',text('sample')));return;}
    if(!map.description){container.append(el('p',text('none')));return;}
    const cjk=/[\u3400-\u9fff\u3040-\u30ff]/.test(map.description),japanese=/[\u3040-\u30ff]/.test(map.description);
    if(language==='en'&&!cjk||language==='zh-CN'&&cjk&&!japanese||language==='ja'&&japanese){container.append(el('p',map.description));return;}
    // Keep a foreign-language repository description behind an explicit source disclosure.
    const specific=[
      [/\bplugins?\b|插件|プラグイン/i,['A project for developing or using plugins.','这是一个与插件开发或使用有关的项目。','プラグインの開発や利用に関するプロジェクトです。']],
      [/\b(?:inference|serving).*\b(?:model|llm)|\b(?:model|llm).*\binference/i,['Tools for running model inference.','项目用于运行模型推理。','モデル推論を実行するためのプロジェクトです。']],
      [/\b(?:speech recognition|speech-to-text)\b|语音识别|語音辨識|音声認識/i,['Software for turning speech into text.','项目提供语音转文字功能。','音声を文字に変換するソフトウェアです。']],
      [/\b(?:code editor|text editor)\b/i,['An editor for working with text or code.','这是一个文本或代码编辑器项目。','テキストやコードを編集するプロジェクトです。']],
      [/\b(?:database|data visualization)\b/i,['The project works with data storage or visualization.','项目涉及数据存储或可视化。','データの保存や可視化に関するプロジェクトです。']]
    ].find(([pattern])=>pattern.test(map.description));
    if(specific)container.append(el('p',specific[1][language==='en'?0:language==='zh-CN'?1:2]));
    else if(map.language){
      const line=language==='en'?'Its main programming language is '+map.language+'.':language==='zh-CN'?'项目的主要编程语言是 '+map.language+'。':'主なプログラミング言語は '+map.language+' です。';
      container.append(el('p',line));
    }
    const details=el('details');
    details.append(el('summary',text('original')),el('p',map.description));container.append(details);
  }
  function render(){
    badge();if(!dialog.open)return;
    $('treasureTitle').textContent=text('chest');$('treasureClose').setAttribute('aria-label',text('close'));$('treasureRanking').textContent=text('survey');
    const page=el('section',null,'treasure-page'),canvas=el('canvas',null,'treasure-map');
    canvas.setAttribute('aria-hidden','true');drawMap(canvas,state?.map?.name||day);page.append(canvas);
    const date=selected||day,map=state?.map?.date===date?state.map:null;
    if(map){
      page.append(el('small',text(mode==='demo'?'demo':'source'),'treasure-caption'),el('h3',map.name));
      sourceDescription(page,map);
      const links=el('div',null,'treasure-actions');
      link(links,text('visit'),'https://github.com/'+map.name);
      if(filed(map.date)){links.append(el('small',text('filed')));}
      else{const b=action(text('file'),()=>change('file',map.date));b.disabled=pending||reading;links.append(b);}
      page.append(links);
      if(mode==='live'){page.append(el('small',text('recorded')+' '+new Date(map.observedAt).toLocaleString(language),'treasure-caption'));}
    }else{
      page.append(el('small',date,'treasure-caption'),el('h3',text('waiting')));
      page.append(el('p',text(reading||pending?'busy':status==='error'||date!==day?'error':metres<12?'locked':status==='offline'?'offline':'sealed')));
      if(date===day&&metres>=12&&!pending&&!reading){page.append(action(text(status==='offline'?'retry':'decode'),()=>change('decode',date)));}
      if(status==='offline'){const a=el('div',null,'treasure-actions');link(a,text('sourceLink'),'https://github.com/trending?since=daily');page.append(a);}
    }
    if(status==='error'&&map)page.append(el('p',text('error')));
    const library=el('section',null,'treasure-contents');
    const entries=state?.entries||[];
    if(selected&&selected!==day)library.append(action(text('today'),()=>select(day)));
    for(const mark of [false,true]){
      const dates=entries.filter(row=>row.filed===mark);
      if(!mark&&!dates.length)continue;
      library.append(el('h3',text(mark?'shelf':'loose')));
      if(!dates.length){library.append(el('small',text('empty')));continue;}
      const list=el('div',null,'treasure-entries');
      for(const row of dates.slice(0,limit)){const button=action(row.date,()=>select(row.date),'treasure-entry');button.setAttribute('aria-pressed',String(row.date===(selected||day)));list.append(button);}
      if(dates.length>limit)list.append(action(text('more'),()=>{limit+=20;render();}));
      library.append(list);
    }
    body.replaceChildren(page,library);
  }
  async function api(action,date){
    const init={cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(action==='decode'?25000:10000)};
    if(action)Object.assign(init,{method:'POST',headers:{'Content-Type':'application/json','X-Deepmine-Client':'treasure'},body:JSON.stringify({action,date})});
    const response=await fetch('/api/treasure'+(!action&&date?'?date='+encodeURIComponent(date):''),init);
    if(!response.ok)throw Error();return response.json();
  }
  async function select(date){
    selected=date;const turn=++archiveRequest,epoch=revision;
    if(mode==='demo'){
      state={entries:demoRead?[{date:day,filed:demoFiled}]:[],map:demoRead?{date:day,name:'github/gitignore'}:null};
      render();return;
    }
    reading=true;render();
    try{const next=await api(null,date);if(epoch!==revision||turn!==archiveRequest)return;state=next;status='';}
    catch{if(epoch!==revision||turn!==archiveRequest)return;status='error';}
    reading=false;render();
  }
  async function change(kind,date){
    if(pending||reading||date!==(selected||day)||kind==='file'&&state?.map?.date!==date)return;
    const epoch=revision;
    pending=true;render();
    try{
      if(mode==='demo'){if(kind==='file')demoFiled=true;else demoRead=true;await select(day);return;}
      const result=await api(kind,date);if(epoch!==revision)return;
      if(['ready','filed'].includes(result.status))await select(selected||day);
      else if(date===selected)status=result.status==='offline'?'offline':'error';
    }catch{if(epoch===revision&&date===selected)status='error';}
    finally{if(epoch===revision){pending=false;render();}}
  }
  chest.onclick=()=>{if(!scope)return;dialog.showModal();document.dispatchEvent(new Event('deepmine:panel-state'));render();void select(day);};
  $('treasureClose').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{document.dispatchEvent(new Event('deepmine:panel-state'));});
  $('treasureRanking').onclick=()=>{dialog.close();window.DeepmineSurvey?.open();};
  drawChest();
  window.DeepmineTreasure={update(nextMode,project,radio,locale){
    if(!project){chest.hidden=true;return;}
    const newScope=nextMode+'|'+project,newDay=radio?.date||'',newMeters=Math.floor(radio?.meters||0),newLanguage=strings[locale]?locale:'en';
    if(newScope===scope&&day===newDay&&metres===newMeters&&language===newLanguage){announce();return;}
    const reset=scope!==newScope||day!==newDay;
    if(reset){revision++;state=null;status='';selected='';limit=10;pending=false;reading=false;demoRead=false;demoFiled=false;seenEligible=false;lastNotice='';$('treasureAnnounce').textContent='';}
    else if(metres<12&&newMeters>=12)seenEligible=true;
    mode=nextMode;language=newLanguage;scope=newScope;day=newDay;metres=newMeters;chest.hidden=false;
    if(reset&&mode==='live'&&day)void select(day);
    render();announce();
  }};
})();
