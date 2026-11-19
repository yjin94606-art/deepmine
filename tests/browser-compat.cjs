'use strict';
// Optional release check. The game and its ordinary test suite do not load Playwright.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {openMine}=require('../scripts/open-mine.cjs');
const findings=require('../dist/work-findings.js');

async function verifyArchiveDateSwitch(page,directory){
  const older='2020-06-01',newer='2020-06-02';
  await fs.mkdir(directory,{recursive:true});
  for(const [date,name] of [[older,'coast/tide'],[newer,'coast/beacon']]){
    await fs.writeFile(path.join(directory,date+'.json'),JSON.stringify({date,name,
      observedAt:date+'T10:00:00Z',description:'Sea observations.',language:'Rust'}));
  }
  await page.locator('#treasureChest').click();
  await page.getByRole('button',{name:newer,exact:true}).click();
  await page.getByRole('heading',{name:'coast/beacon'}).waitFor();
  const target='**/api/treasure?date='+older;
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route(target,async route=>{await gate;await route.continue();});
  try{
    await page.getByRole('button',{name:older,exact:true}).click();
    assert.equal(await page.getByRole('heading',{name:'coast/beacon'}).count(),0);
    assert.equal(await page.getByRole('button',{name:'File map'}).count(),0);
  }finally{release();}
  await page.getByRole('heading',{name:'coast/tide'}).waitFor();
  await page.unroute(target);
  await page.getByRole('button',{name:'File map'}).click();
  await page.getByText('Filed',{exact:true}).waitFor();
  assert.deepEqual((await fs.readdir(directory)).filter(name=>name.endsWith('.filed')),[older+'.filed']);
  await page.locator('#treasureClose').click();
}

async function verifyRecordings(browser,scratch){
  const project=path.join(scratch,'recordings'),folder=path.join(project,'private-folder-name');
  await fs.mkdir(folder,{recursive:true});
  const wav=await fs.readFile(path.join(__dirname,'../docs/launch/sample-chime.wav'));
  // Preserve the WAV container, removing its display title so names come from each file.
  wav.write('JUNK',wav.indexOf('LIST'));
  await fs.writeFile(path.join(folder,'Harbor bell.wav'),wav);
  wav[wav.length-2]^=0x60;
  await fs.writeFile(path.join(folder,'Buoy alarm.wav'),wav);
  const app=await require('../scripts/server.cjs').start({projectPath:project,scopePath:project,outputDirs:['.'],
    dataDirectory:path.join(scratch,'recording-save'),sources:{codex:false,claude:false,git:false,imports:false},quiet:true,port:0});
  const ctx=await browser.newContext({locale:'en-US',reducedMotion:'reduce'});
  try{
    const page=await ctx.newPage();
    await page.goto('http://127.0.0.1:'+app.port);
    await page.locator('#paceSelect').selectOption('brisk');
    await page.locator('#digButton').click();
    const stage=page.locator('#discoveryStage[open]'),title=stage.locator('[data-stage-record]');
    await stage.waitFor();
    const first=await title.innerText();
    await stage.getByRole('button',{name:'Next',exact:true}).click();
    await page.waitForFunction(prior=>document.querySelector('[data-stage-record]').textContent!==prior,first);
    const second=await title.innerText();
    assert.deepEqual([first,second].sort(),['Buoy alarm','Harbor bell']);
    await stage.locator('#stageContinue').click();
    await page.locator('#treasureChest').click();await page.locator('#treasureRanking').click();
    const list=page.locator('#workdayTitles');
    assert.equal(await list.getByRole('button').count(),2);
    assert.doesNotMatch(await list.innerText(),/private-folder|\.wav/i);
    for(const name of [first,second]){
      await list.getByRole('button',{name:new RegExp(name)}).click();
      const detail=page.locator('#detailDialog[open]');
      assert.equal(await detail.locator('#detailTitle').innerText(),name);
      await detail.locator('#detailPlayer button').click();
      const playback=await detail.locator('audio').getAttribute('src');
      assert.equal(new URL(playback,page.url()).searchParams.get('path'),'private-folder-name/'+name+'.wav');
      await detail.locator('[data-close="detailDialog"]').click();
    }
    await list.getByRole('button',{name:new RegExp(second)}).click();
    await page.locator('#detailDialog [data-locate]').click();
    await page.waitForFunction(()=>new URL(location.href).searchParams.has('workVersion'));
    assert.doesNotMatch(decodeURIComponent(page.url()),/private-folder|\.wav/i);
    await page.reload();
    await page.getByRole('button',{name:new RegExp(second)}).first().waitFor({state:'attached'});
    const original=await app.snapshot(),source=original.outputs.find(row=>row.files.includes('private-folder-name/'+second+'.wav'));
    const legacy=new URL(page.url());
    legacy.searchParams.delete('view');
    legacy.searchParams.set('workVersion',source.id+'|'+source.files[0]);
    await page.goto(legacy.href);
    await page.locator('#detailDialog[open]').waitFor();
    assert.equal(await page.locator('#detailTitle').innerText(),second);
  }finally{await ctx.close();await new Promise(resolve=>app.server.close(resolve));}
}

async function verifyBrowser(engine){
  const playwright=require('playwright');
  const browserType=engine==='edge'?playwright.chromium:playwright[engine];
  assert.ok(browserType && ['chromium','edge','firefox','webkit'].includes(engine),'Unknown browser');
  const tempRoot=await fs.realpath(os.tmpdir());
  const scratch=await fs.mkdtemp(path.join(tempRoot,'deepmine-browser-'));
  let instance,browser;
  try{
    const project=path.join(scratch,'海岸 Studio');
    await fs.mkdir(project);
    await fs.writeFile(path.join(project,'Tide notes.md'),'# Tide notes\nThe tide rose at noon.');
    const env={...process.env,DEEPMINE_DATA_DIR:path.join(scratch,'save'),CODEX_HOME:path.join(scratch,'codex'),
      CLAUDE_CONFIG_DIR:path.join(scratch,'claude')};
    instance=await openMine({env,port:0});
    browser=await browserType.launch(engine==='edge'?{channel:'msedge'}:{});
    const context=await browser.newContext({locale:'en-US',viewport:{width:1024,height:768},reducedMotion:'reduce'});
    const errors=[];
    const newsRequests=[];
    const boardRequests=[];
    async function blockSharedBoard(route){
      boardRequests.push(route.request().method());
      await route.abort();
    }
    await context.route('**/v1/today*',blockSharedBoard);
    context.on('request',request=>{
      if(new URL(request.url()).pathname==='/api/field-news')newsRequests.push(request.method());
    });
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.setViewportSize({width:320,height:568});
    await page.goto(instance.url,{waitUntil:'commit'});
    await page.locator('#folder').waitFor();
    const sample=page.getByRole('link',{name:'Try a sample mine'});
    const sampleBounds=await sample.boundingBox();
    assert.ok(sampleBounds.y>=0 && sampleBounds.y+sampleBounds.height<=568 && sampleBounds.height>=44,'a new visitor can tap the sample before scrolling');
    assert.equal(await page.evaluate(()=>scrollY),0);
    const privateRequests=[];
    function watchDemo(request){
      if(new URL(request.url()).pathname.startsWith('/api/'))privateRequests.push(request.url());
    }
    page.on('request',watchDemo);
    await sample.click();
    await page.locator('#discoveryStage[open]').waitFor();
    assert.match(await page.locator('#discoveryStage [data-stage-record]').innerText(),/botanist|anime/i);
    assert.match(await page.locator('#stageContent p').innerText(),/hair clip/i);
    assert.deepEqual(privateRequests,[]);
    await assert.rejects(fs.access(path.join(env.DEEPMINE_DATA_DIR,'config.json')),{code:'ENOENT'});
    await fs.writeFile(path.join(env.DEEPMINE_DATA_DIR,'config.json'),JSON.stringify({fieldNews:{publicEnabled:false}}));
    page.off('request',watchDemo);
    await page.setViewportSize({width:1024,height:768});
    await page.locator('#chooseAfterFind').click();
    await page.locator('#folder').waitFor();
    await page.locator('#folder').fill(scratch);
    await page.locator('#browse').click();
    await page.locator('#pickerChildren').getByRole('button',{name:'海岸 Studio'}).click();
    await page.waitForFunction(selected=>document.getElementById('pickerLocation').textContent===selected,project);
    await page.locator('#useFolder').click();
    assert.equal(await page.locator('#folder').inputValue(),project);
    await page.locator('#enter').click();
    await page.locator('#expeditionCanvas').waitFor();
    await page.waitForFunction(()=>document.getElementById('projectName')?.textContent.includes('海岸 Studio'));
    const game=new URL(page.url()).origin;
    const localSurvey=await (await fetch(game+'/api/daily-depth')).json();
    assert.equal(localSurvey.projectId,(await (await fetch(game+'/api/instance')).json()).projectId);
    assert.equal(localSurvey.endpoint,undefined);
    await page.evaluate(projectId=>{
      localStorage.setItem('deepmine.board.opt-in.v1.'+projectId,'https://retired.example');
      localStorage.setItem('deepmine.board.opt-in.v1.receipt.'+projectId,'{}');
    },localSurvey.projectId);
    await page.reload({waitUntil:'commit'});
    await page.waitForFunction(()=>window.DeepmineApp?.getState().ready);
    const snapshot=await (await fetch(game+'/api/snapshot')).json();
    assert.ok(snapshot.outputs.some(item=>item.files?.includes('Tide notes.md')));
    assert.deepEqual(await page.locator('.topbar button:visible').evaluateAll(buttons=>buttons.map(button=>button.id)),['sourceButton','settingsButton']);
    await page.locator('#settingsButton').focus();
    await page.keyboard.press('Enter');
    const settings=page.locator('#settingsDialog[open]');
    await settings.waitFor();
    assert.ok(await settings.getByRole('combobox',{name:'Language'}).isVisible());
    assert.ok(await settings.locator('#soundToggle').isVisible());
    const news=settings.getByRole('checkbox',{name:'News while digging'});
    assert.ok(await news.isVisible());
    assert.equal(await news.isChecked(),false);
    assert.equal(await settings.locator('#newsBody').isVisible(),false);
    await page.keyboard.press('Escape');
    await page.locator('#settingsDialog').waitFor({state:'hidden'});

    await page.locator('#treasureChest').click();
    await page.locator('#treasureRanking').click();
    await page.waitForFunction(()=>document.getElementById('surveyMeters').textContent==='0 m');
    assert.equal(await page.locator('#boardHeading').innerText(),'Today’s depth');
    assert.equal(await page.locator('#boardUrl,#boardDefaultJoin,#boardPlaces').count(),0);
    assert.ok(await page.locator('#surveyMilestone').isVisible());
    assert.ok(await page.locator('#depthBoard #surveyWorkday').isVisible());
    const workday=await page.evaluate(()=>window.DeepmineApp.getWorkday());
    assert.equal(workday.projectId,snapshot.project.id);
    assert.ok(workday.workFiles>=1,'the daily ledger includes the fixture document');
    const shown=n=>Number.isSafeInteger(n)?n.toLocaleString('en-US'):'Unknown';
    assert.equal(await page.locator('#workdayTokens').innerText(),shown(workday.tokens));
    assert.equal(await page.locator('#workdayFiles').innerText(),shown(workday.workFiles));
    const dates=await page.locator('#workdayDate').innerText();
    assert.ok(dates.includes(workday.date)&&dates.includes(workday.timezone));
    const titles=await page.locator('#workdayTitles').textContent();
    for(const name of workday.titles)assert.ok(titles.includes(name));
    await page.locator('#boardClose').click();
    await page.locator('#depthBoard').waitFor({state:'hidden'});
    await page.locator('#treasureChest').click();
    await page.locator('#treasureRanking').click();
    assert.equal(await page.locator('#boardUrl').isVisible(),false);
    await page.locator('#boardClose').click();

    const speed=page.getByRole('combobox',{name:'Change digging speed'});
    assert.equal(await speed.inputValue(),'normal');
    await speed.selectOption('brisk');
    await page.reload({waitUntil:'commit'});
    await page.waitForFunction(()=>window.DeepmineApp?.getState().ready);
    assert.equal(await speed.inputValue(),'brisk');
    assert.equal(await page.evaluate(()=>window.DeepmineApp.getState().pace),'brisk');

    // A real first discovery survives closing the tab; acknowledging it in
    // another tab must release the same hold in both windows.
    await page.locator('#digButton').click();
    const stage='#discoveryStage[open]',title='#stageContent [data-stage-record]';
    await page.locator(stage).waitFor();
    const firstFind=await page.locator(title).innerText();
    await page.close();
    const returning=await context.newPage();
    returning.on('pageerror',e=>errors.push(e.message));
    await returning.goto(game,{waitUntil:'commit'});
    await returning.locator(stage).waitFor();
    assert.equal(await returning.locator(title).innerText(),firstFind);
    assert.equal(await returning.locator('#paceSelect').inputValue(),'brisk');
    const secondTab=await context.newPage();
    secondTab.on('pageerror',e=>errors.push(e.message));
    await secondTab.goto(game,{waitUntil:'commit'});
    await secondTab.locator(stage).waitFor();
    const independent=await browser.newContext({locale:'en-US',reducedMotion:'reduce'});
    const otherPlayer=await independent.newPage();
    await otherPlayer.goto(game,{waitUntil:'commit'});
    await otherPlayer.locator(stage).waitFor();
    assert.equal(await otherPlayer.locator(title).innerText(),firstFind);
    const held=(await (await fetch(game+'/api/snapshot')).json()).mining;
    assert.ok(held.waitingFind.ids.length);
    assert.equal(held.excavatedDepth,held.waitingFind.depth);
    await otherPlayer.locator('#stageContinue').press('Enter');
    await returning.locator('#discoveryStage').waitFor({state:'hidden'});
    await secondTab.locator('#discoveryStage').waitFor({state:'hidden'});
    await independent.close();
    await returning.reload({waitUntil:'commit'});
    await returning.waitForFunction(()=>window.DeepmineApp?.getState().ready);
    assert.equal(await returning.locator(stage).count(),0);

    const exposed=findings.build(snapshot).find(item=>item.paths.includes('Tide notes.md'));
    assert.ok(exposed,'the test project exposes its tide notes in the gallery');
    const workUrl=game+'/?find='+encodeURIComponent(exposed.id);
    await returning.goto(workUrl);
    await returning.locator('[data-gallery=move]').click();
    await returning.locator('#galleryArrange').waitFor();
    await secondTab.goto(workUrl);
    await secondTab.locator('[data-gallery=sell]').click();
    await secondTab.locator('[data-gallery=confirm]').click();
    await returning.locator('#galleryArrange').waitFor({state:'hidden'});
    await secondTab.waitForFunction(()=>!new URL(location.href).searchParams.has('find'));
    await secondTab.reload();
    await secondTab.waitForFunction(()=>window.DeepmineApp?.getState().ready);
    assert.equal(await secondTab.locator('#detailDialog[open]').count(),0);
    await verifyArchiveDateSwitch(returning,path.join(env.DEEPMINE_DATA_DIR,'treasure',snapshot.project.id));

    const secondProject=path.join(scratch,'Sound Studio');
    await fs.mkdir(secondProject);
    await returning.locator('#settingsButton').click();
    await returning.getByRole('button',{name:'Switch project'}).click();
    await returning.locator('#projects option').first().waitFor({state:'attached'});
    await returning.locator('#manual > summary').click();
    await returning.locator('#folder').fill(secondProject);
    await returning.locator('#enter').click();
    await returning.waitForFunction(()=>document.querySelector('#projectName')?.textContent==='Sound Studio');
    await returning.locator('#projectName').click();
    await returning.locator('#projects').selectOption({label:'海岸 Studio'});
    await returning.getByRole('button',{name:'Resume this mine'}).click();
    await returning.waitForFunction(()=>document.querySelector('#projectName')?.textContent==='海岸 Studio');
    assert.equal(new URL(returning.url()).origin,game);
    assert.equal(await returning.locator('#paceSelect').inputValue(),'brisk');

    // A narrow touch viewport, OS-level reduced motion and the fallback image decoder.
    const mobile=await browser.newContext({locale:'ja-JP',viewport:{width:360,height:740},hasTouch:true,reducedMotion:'reduce'});
    await mobile.route('**/v1/today*',blockSharedBoard);
    await mobile.addInitScript(()=>{Object.defineProperty(window,'createImageBitmap',{configurable:true,value:undefined});});
    const touch=await mobile.newPage();
    touch.on('pageerror',e=>errors.push(e.message));
    await touch.goto(game+'/?demo=1&work=portrait',{waitUntil:'commit'});
    await touch.locator('#detailDialog[open]').waitFor();
    await touch.waitForFunction(()=>Array.from(document.querySelectorAll('#detailDialog img')).some(img=>img.naturalWidth>0));
    assert.ok((await touch.locator('html').getAttribute('lang')).startsWith('ja'));
    assert.equal(await touch.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const cover=await touch.evaluate(async()=>{
      const response=await fetch('/demo-assets/sample-02.png');
      const blob=await response.blob();
      const small=document.createElement('canvas'); small.width=20;small.height=16;
      const {decodeImage}=await import('/image-decode.mjs');
      const signal=new AbortController().signal;
      const original=await decodeImage(blob,signal);
      small.getContext('2d').drawImage(original,0,0,20,16);
      const data=small.toDataURL('image/png').split(',')[1];
      const cover=await window.WorkImprints.load({literal:{kind:'cover',type:'image/png',data}},signal);
      return [cover.naturalWidth,cover.naturalHeight];
    });
    assert.deepEqual(cover,[20,16]);
    await touch.locator('#detailDialog [data-locate]').tap();
    await touch.locator('#detailDialog').waitFor({state:'hidden'});
    assert.deepEqual(newsRequests,[],'unopened news must stay offline across digging, reload and tabs');
    assert.deepEqual(boardRequests,[],'viewing the survey must never contact the shared leaderboard');
    assert.deepEqual(errors,[]);
    await verifyRecordings(browser,scratch);
    console.log(engine+' '+browser.version()+' passed welcome, live work, reopen, multi-tab continue, keyboard, touch, language and image fallback');
  }finally{
    try{await browser?.close();}finally{
      await instance?.close();
      await fs.rm(scratch,{recursive:true,force:true});
    }
  }
}
async function main(){
  const engines=process.argv.slice(2);
  for(const engine of engines.length?engines:['chromium','firefox','webkit'])await verifyBrowser(engine);
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
