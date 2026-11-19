(()=>{
  'use strict';
  const $=id=>document.getElementById(id),dialog=$('depthBoard');
  const copy={
    'zh-CN':{workday:'今日工作',tokens:'Token 用量',files:'作品文件',active:'主动开挖',unknown:'未知',title:'个人测绘簿',today:'今日进尺',day:'本矿主动开挖',grades:['铜尺','银尺','金尺'],past:'历日测绘章',next:(n,g)=>'再挖 '+n+'，就能盖上「'+g+'」测绘章。',full:'今天的金尺测绘章已盖好。',previous:(date,n)=>'上次获章 · '+date+' · '+n,waiting:'正在翻开测绘簿…',demo:'连接自己的矿坑后，这里会记录每天亲手挖过的距离。',unread:'暂时读不到本矿的测绘记录。',close:'关闭'},
    en:{workday:'Today’s work',tokens:'Tokens used',files:'Observed work files',active:'Actively dug',unknown:'Unknown',title:'Personal survey log',today:'Today’s depth',day:'Dug by hand in this mine',grades:['Copper rule','Silver rule','Gold rule'],past:'Survey stamps by date',next:(n,g)=>n+' to the '+g+' stamp.',full:'You earned the gold survey stamp today.',previous:(date,n)=>'Previous stamped day · '+date+' · '+n,waiting:'Opening the survey log…',demo:'Connect your mine to record the distance you dig each day.',unread:'The local survey log is unavailable.',close:'Close'},
    ja:{workday:'今日の作業',tokens:'トークン使用量',files:'記録した作品ファイル',active:'自分で掘った距離',unknown:'不明',title:'個人測量帳',today:'今日の掘削深度',day:'この坑道で自分で掘った距離',grades:['銅の物差し','銀の物差し','金の物差し'],past:'日付別の測量印',next:(n,g)=>'あと '+n+' で「'+g+'」の測量印。',full:'今日は金の測量印を獲得しました。',previous:(date,n)=>'前回の測量印 · '+date+' · '+n,waiting:'測量帳を開いています…',demo:'自分の坑道を接続すると毎日掘った距離が記録されます。',unread:'坑道の測量記録を読み込めません。',close:'閉じる'}
  };
  const levels=[25,100,250];
  const tier=meters=>levels.filter(level=>meters>=level).length;
  const language=()=>copy[document.documentElement.lang]||copy.en;
  const measure=n=>n.toLocaleString(document.documentElement.lang)+' m';
  const currentMine=()=>{
    const state=window.DeepmineApp?.getState();
    return state?.mode==='live' && state.ready?state.projectId:'';
  };
  let survey=null,problem=false,request=null,timer=0,awardTimer=0;
  function paintBadge(grade){
    const c=$('surveyBadge').getContext('2d');if(!c)return;
    const [face,edge]=[['#42555b','#7d9391'],['#a16b4c','#ebc19a'],['#759aad','#e4eef0'],['#c59344','#fff0a2']][grade];
    c.clearRect(0,0,32,36);
    const block=(x,y,w,h,color)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
    block(6,1,8,13,'#437777');block(18,1,8,13,'#437777');block(8,1,2,10,'#8bc6ad');block(20,1,2,10,'#8bc6ad');
    block(6,12,20,21,'#283d45');block(3,16,26,13,'#283d45');block(8,11,16,22,face);block(5,15,22,14,face);
    block(7,15,18,2,edge);block(9,12,14,3,edge);block(7,19,18,7,'#324850');
    for(let x=9;x<24;x+=3)block(x,19,1,x%2?4:2,edge);
    block(10,27,12,2,edge);
  }
  function render(){
    const mine=currentMine(),t=language();
    const reading=mine && survey?.projectId===mine?survey:null;
    const grade=reading?tier(reading.meters):0;
    const work=mine?window.DeepmineApp?.getWorkday?.():null;
    $('surveyWorkday').hidden=!work||work.projectId!==mine;
    if(work&&work.projectId===mine){
      const format=value=>Number.isSafeInteger(value)?value.toLocaleString(document.documentElement.lang):t.unknown;
      $('workdayHeading').textContent=t.workday;$('workdayDate').textContent=work.date+' · '+work.timezone;
      $('workdayTokenLabel').textContent=t.tokens;$('workdayTokens').textContent=format(work.tokens);
      $('workdayFileLabel').textContent=t.files;$('workdayFiles').textContent=format(work.workFiles);
      $('workdayMeterLabel').textContent=t.active;$('workdayMeters').textContent=work.activeMeters===null?t.unknown:measure(work.activeMeters);
      $('workdayTitles').hidden=!work.titles.length;
      $('workdayTitles').replaceChildren(...work.titles.map(title=>{const item=document.createElement('li');item.textContent=title;return item;}));
    }
    $('boardTitle').textContent=t.title;$('boardClose').ariaLabel=t.close;
    $('boardHeading').textContent=t.today;
    $('surveyDay').textContent=reading?t.day+' · '+reading.day+' UTC':t.day;
    $('surveyMeters').textContent=reading?measure(reading.meters):'—';
    $('surveyStamp').textContent=grade?t.grades[grade-1]:'';
    paintBadge(grade);
    $('surveyMilestone').textContent=reading?(grade<levels.length?t.next(measure(levels[grade]-reading.meters),t.grades[grade]):t.full):'';
    const previous=reading?.stamps.find(stamp=>stamp.day<reading.day);
    $('surveyPrevious').hidden=!previous;
    $('surveyPrevious').textContent=previous?t.previous(previous.day,measure(previous.meters)):'';
    const stamps=reading?.stamps||[];
    $('stampBook').hidden=!stamps.length;$('stampBookTitle').textContent=t.past+' ('+stamps.length+')';
    $('stampDays').replaceChildren(...stamps.map(stamp=>{
      const row=document.createElement('li');
      row.textContent=stamp.day+' · '+t.grades[tier(stamp.meters)-1]+' · '+measure(stamp.meters);
      return row;
    }));
    const demo=window.DeepmineApp?.getState()?.mode==='demo';
    $('boardState').textContent=demo?t.demo:problem?t.unread:reading?'':t.waiting;
    window.PersonalSurveyArt?.render(reading);
  }
  function suspend(){
    clearTimeout(timer);
    request?.abort();request=null;
  }
  async function read(){
    suspend();
    if(!dialog.open||document.hidden)return;
    const mine=currentMine();
    if(!mine){
      survey=null;problem=false;render();
      if(window.DeepmineApp?.getState()?.mode!=='demo')timer=setTimeout(read,1500);
      return;
    }
    if(survey?.projectId!==mine)survey=null;
    render();
    const controller=new AbortController();request=controller;
    const deadline=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch('/api/daily-depth',{method:'GET',signal:controller.signal,credentials:'same-origin',cache:'no-store',mode:'same-origin',redirect:'error'});
      if(!response.ok)throw Error();
      const record=await response.json();
      if(record.projectId!==mine||!Number.isSafeInteger(record.meters)||record.meters<0||!Array.isArray(record.stamps))throw Error();
      if(request===controller&&currentMine()===mine){survey=record;problem=false;}
    }catch{
      if(request===controller){survey=null;problem=true;}
    }finally{
      clearTimeout(deadline);
      if(request===controller){
        request=null;
        if(dialog.open && !document.hidden){render();timer=setTimeout(read,60000);}
      }
    }
  }
  $('boardClose').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{
    suspend();survey=null;problem=false;$('stampBook').open=false;
    window.PersonalSurveyArt?.close();document.dispatchEvent(new Event('deepmine:panel-state'));$('treasureChest')?.focus();
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();else if(dialog.open)void read();});
  window.addEventListener('pagehide',suspend);
  window.addEventListener('pageshow',event=>{if(event.persisted&&dialog.open)void read();});
  new MutationObserver(()=>{if(dialog.open)render();}).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  window.DeepmineSurvey=Object.freeze({
    open(){
      if(!dialog.open)dialog.showModal();document.dispatchEvent(new Event('deepmine:panel-state'));
      void read();
    },
    award(grade){
      if(!currentMine()||![1,2,3].includes(grade))return;
      let note=$('surveyAward');
      if(!note){note=document.createElement('div');note.id='surveyAward';note.className='survey-award';note.setAttribute('role','status');document.body.append(note);}
      note.textContent=language().grades[grade-1];clearTimeout(awardTimer);awardTimer=setTimeout(()=>note.remove(),3800);
      if(dialog.open)void read();
    }
  });
})();
