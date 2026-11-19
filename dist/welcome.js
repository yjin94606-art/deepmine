(() => {
  'use strict';
  const words = {
    'zh-CN': {
      tryMine:'先试玩一次挖掘',resumeMine:'继续这个矿坑',
      heading: '选择你的项目', intro: '选一个工作文件夹，把这里的 AI 用量和作品留在矿坑里。',
      project: '最近用过的项目', rescan: '重新查找', other: '用其他文件夹',
      browse:'浏览文件夹', home:'个人文件夹', parent:'上一级', useFolder:'选这个文件夹', reading:'正在读取文件夹…',
      otherDrive:'其他磁盘', driveLetter:'盘符', openDrive:'打开磁盘', driveError:'这个磁盘未就绪或无法读取。可以换一个盘符，或继续浏览原来的文件夹。',
      noChildren:'这里没有可浏览的子文件夹，可以直接选用当前文件夹。', moreFolders:'此处文件较多。若列表中找不到，可以粘贴完整路径。', folderError:'无法打开这个文件夹。可以回到个人文件夹，或粘贴其他路径。',
      pathLabel: '项目文件夹路径', pathHint: '可以粘贴 Git 项目或作品文件夹的完整路径，也支持 ~/ 开头的路径。', optional:'创作小记与对话记录',
      narrationLabel:'物品小记', narrationOff:'关闭', narrationWork:'仅根据作品写', narrationProcess:'结合作品和创作过程写',
      narrationInfo:'开启后，作品摘要会发给已登录的 Codex，使用模型额度。选择创作过程时，还会从本机对话中提取与这件作品对应的要求、修改和回应，一起交给 Codex。',memory: '把请求原话保存在可展开的来源记录里', enter: '进入矿坑',
      saved: '下次打开深矿，会直接回到这个项目。矿坑进度保存在本机。',
      scanning: '正在查找 Codex 和 Claude Code 项目…', empty: '没有找到最近用过的项目。选一个平时工作的文件夹就能开始。',
      partial: '部分会话暂时无法读取。', scanFailed: '暂时无法读取项目列表，可以重新查找或填写文件夹。',
      connecting: '正在打开矿坑…', invalid: '请选择项目，或填写文件夹的完整路径。',
      missing: '找不到这个文件夹。请检查路径，或重新选择项目。', busy: '另一个窗口正在打开矿坑。请稍候，再打开深矿。',
      failed: '矿坑暂时无法启动。请确认项目可读取、存档目录可写，然后再点一次。', network: '与本机服务的连接中断，请重新打开深矿。'
    },
    en: {
      tryMine:'Try a sample mine',resumeMine:'Resume this mine',
      heading: 'Choose your project', intro: 'Choose a work folder to see its AI usage and the things you create in your mine.',
      project: 'Recent projects', rescan: 'Scan again', other: 'Use a different folder',
      browse:'Browse folders', home:'Home folder', parent:'Up one level', useFolder:'Use this folder', reading:'Reading folders…',
      otherDrive:'Other drives', driveLetter:'Drive letter', openDrive:'Open drive', driveError:'This drive is unavailable. Try another letter or continue browsing the current folder.',
      noChildren:'No subfolders to browse. You can use the current folder.', moreFolders:'This is a large directory. Paste a full path if the folder you need is missing.', folderError:'Could not open that folder. Return home or paste another path.',
      pathLabel: 'Project folder path', pathHint: 'Paste the full path to a Git project or a folder where you save your work. Paths starting with ~/ also work.', optional:'Item notes and chat excerpts',
      narrationLabel:'Item notes', narrationOff:'Off', narrationWork:'From the work', narrationProcess:'From the work and its conversation',
      narrationInfo:'When enabled, work summaries go to your signed-in Codex and use model quota. The conversation option also sends requests, revisions and replies matched to this work from your local chats.',memory: 'Keep request excerpts in the original records', enter: 'Open my mine',
      saved: 'Next time, Deepmine opens this project directly. Your mine progress is saved on this computer.',
      scanning: 'Looking for Codex and Claude Code projects…', empty: 'No recent projects found. Choose your work folder to get started.',
      partial: 'Some sessions could not be read.', scanFailed: 'The project list could not be read. Scan again or enter a folder.',
      connecting: 'Opening your mine…', invalid: 'Choose a project or enter a full folder path.',
      missing: 'This folder could not be found. Check its path or choose another project.', busy: 'Another window is opening the mine. Open Deepmine again in a moment.',
      failed: 'The mine could not start. Check that your project is readable and the save folder is writable, then try again.', network: 'The local service disconnected. Reopen Deepmine.'
    },
    ja: {
      tryMine:'サンプルの坑道で遊ぶ',resumeMine:'この坑道を再開',
      heading: 'プロジェクトを選ぶ', intro: '作業フォルダーを選ぶと、そこでの AI 使用量や作った作品が坑道に現れます。',
      project: '最近使ったプロジェクト', rescan: '再検索', other: '別のフォルダーを使う',
      browse:'フォルダーを参照', home:'ホーム', parent:'上の階層へ', useFolder:'このフォルダーを選ぶ', reading:'フォルダーを読み込み中…',
      otherDrive:'別のドライブ', driveLetter:'ドライブ文字', openDrive:'ドライブを開く', driveError:'このドライブを読み取れません。別のドライブ文字を選ぶか、今のフォルダーから続けてください。',
      noChildren:'選べるサブフォルダーはありません。現在のフォルダーを選べます。', moreFolders:'項目が多いため、一部のみ表示しています。目的のフォルダーのフルパスも指定できます。', folderError:'フォルダーを開けません。ホームに戻るか、別のパスを入力してください。',
      pathLabel: 'プロジェクトフォルダーのパス', pathHint: 'Git プロジェクトや作品の保存先のフルパスを貼り付けてください。~/ で始まるパスも使えます。', optional:'制作メモと会話の記録',
      narrationLabel:'アイテムの制作メモ', narrationOff:'オフ', narrationWork:'作品から書く', narrationProcess:'作品と制作時の会話から書く',
      narrationInfo:'有効にすると、ログイン中の Codex に作品の概要を送り、モデルの利用枠を使います。制作過程を選ぶと、この作品に対応する依頼や修正、返答も端末内の会話から抜き出して送ります。',memory: '当時の依頼文を元の記録に保存する', enter: '坑道に入る',
      saved: '次回からはこのプロジェクトが直接開きます。坑道の進み具合はこの端末に保存されます。',
      scanning: 'Codex と Claude Code のプロジェクトを検索中…', empty: '最近使ったプロジェクトが見つかりません。作業フォルダーを選んで始められます。',
      partial: '一部のセッションを読み取れませんでした。', scanFailed: '一覧を読み取れません。再検索するか、フォルダーを入力してください。',
      connecting: '坑道を開いています…', invalid: 'プロジェクトを選ぶか、フォルダーのフルパスを入力してください。',
      missing: 'フォルダーが見つかりません。パスを確認するか、別のプロジェクトを選んでください。', busy: '別の画面で坑道を開いています。しばらくしてから Deepmine を再度開いてください。',
      failed: '坑道を開けません。プロジェクトの読み取りと保存先への書き込みができるか確認して、もう一度お試しください。', network: 'ローカルサービスへの接続が切れました。Deepmine を開き直してください。'
    }
  };
  let previous;
  try { previous = localStorage.getItem('deepmine.locale.v1'); } catch { /* Browser storage is optional. */ }
  const locales = [previous, ...(navigator.languages || [navigator.language])].filter(Boolean);
  const lang = locales.map(l => l.toLowerCase().split(/[-_]/)[0]).find(l => ['zh','ja','en'].includes(l));
  const locale = lang === 'zh' ? 'zh-CN' : lang || 'en';
  const copy = words[locale], el = id => document.getElementById(id);
  document.documentElement.lang = locale;
  document.title = copy.heading + ' · Deepmine';
  for (const node of document.querySelectorAll('[data-copy]')) node.textContent = copy[node.dataset.copy];
  const select = el('projects'), manual = el('manual'), folder = el('folder');
  const submit = el('enter'), rescan = el('rescan'), error = el('error'), scanStatus = el('scanStatus');
  let projects = [], scanning = false, busy = false;
  let directoryView = null, browseRequest = 0, reading = false;
  const picker=el('picker'), browse=el('browse');
  const drives=el('pickerDrives'), driveLetter=el('driveLetter');
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') driveLetter.add(new Option(letter+':',letter));
  let browsing=null;
  function typedPath() { return manual.open && folder.value.trim(); }
  function controls() {
    if (busy) manual.inert = true;
    else manual.inert = false;
    const usePath = Boolean(typedPath());
    select.disabled = busy || !projects.length || usePath;
    rescan.disabled = busy || scanning;
    folder.disabled = el('memories').disabled = el('narrationMode').disabled = busy;
    browse.disabled = busy;
    el('pickerHome').disabled = busy || reading;
    el('pickerParent').disabled = busy || reading || !directoryView?.parent;
    el('useFolder').disabled = busy || reading || !directoryView;
    el('openDrive').disabled = busy || reading || !driveLetter.value;
    submit.disabled = busy || !picker.hidden || !usePath && !select.value;
    const selected = !usePath && projects.find(p => p.id === select.value);
    const saved=selected?.saved || (usePath && projects.some(p=>p.saved && p.path===typedPath()));
    el('writing').hidden=Boolean(saved);
    submit.textContent = busy ? copy.connecting : saved ? copy.resumeMine : copy.enter;
    el('directory').textContent = selected ? [...(selected.sources||[]),selected.path].join(' · ') : '';
    select.hidden = !scanning && !projects.length;
  }
  function clearError() { error.hidden = true; error.textContent = ''; }
  function showError(message) { error.textContent = message; error.hidden = false; }

  function closePicker() {
    browsing?.abort();
    browseRequest++; reading=false; picker.hidden=true; browse.setAttribute('aria-expanded','false');
    directoryView=null; el('pickerChildren').replaceChildren(); el('pickerLocation').textContent='';
    controls();
  }
  async function listFolders(path,driveJump=false) {
    if (busy) return;
    const request=++browseRequest;
    browsing?.abort();
    const controller=new AbortController();
    browsing=controller;
    const deadline=setTimeout(()=>controller.abort(),6000);
    picker.hidden=false; browse.setAttribute('aria-expanded','true');
    reading=true; controls(); el('pickerStatus').textContent=copy.reading;
    try {
      const reply=await fetch('/api/folders',{method:'POST',signal:controller.signal,headers:{'X-Deepmine-Client':'welcome','Content-Type':'application/json'},body:JSON.stringify({folder:path})});
      if (!reply.ok) throw Error('folder');
      const view=await reply.json();
      if (request!==browseRequest) return;
      directoryView=view;
      drives.hidden = view.windowsDrives!==true;
      if(!drives.hidden && !view.parent) drives.open=true;
      el('pickerLocation').textContent=view.current;
      el('pickerChildren').replaceChildren(...view.children.map(child=>{
        const button=document.createElement('button');
        button.type='button'; button.textContent=child.name; button.dir='auto';
        button.addEventListener('click',()=>listFolders(child.path));
        return button;
      }));
      el('pickerStatus').textContent=view.truncated?copy.moreFolders:view.children.length?'':copy.noChildren;
      el('pickerLocation').focus();
    } catch {
      if (request===browseRequest) el('pickerStatus').textContent=driveJump?copy.driveError:copy.folderError;
    } finally {
      clearTimeout(deadline);
      if (request===browseRequest) { browsing=null; reading=false; controls(); }
    }
  }
  browse.addEventListener('click',()=>picker.hidden?listFolders(folder.value.trim()):closePicker());
  el('pickerHome').addEventListener('click',()=>listFolders(''));
  el('pickerParent').addEventListener('click',()=>{if(directoryView?.parent)void listFolders(directoryView.parent);});
  driveLetter.addEventListener('change',controls);
  el('openDrive').addEventListener('click',()=>{
    if(!drives.hidden && /^[A-Z]$/.test(driveLetter.value))void listFolders(driveLetter.value+':\\',true);
  });
  el('useFolder').addEventListener('click',()=>{
    if(!directoryView || reading || busy)return;
    folder.value=directoryView.current; clearError(); closePicker(); submit.focus();
  });
  manual.addEventListener('toggle',()=>{if(!manual.open && !picker.hidden)closePicker();});
  folder.addEventListener('input',()=>{if(!picker.hidden)closePicker();});

  async function scan() {
    if (scanning || busy) return;
    scanning = true; controls(); clearError();
    scanStatus.textContent = copy.scanning;
    try {
      const response = await fetch('/api/projects', {cache:'no-store'});
      if (!response.ok) throw Error('scan');
      const result = await response.json();
      const selected = select.value;
      projects = result.projects;
      drives.hidden = result.windowsDrives !== true;
      if (!drives.hidden && directoryView && !directoryView.parent) drives.open=true;
      const names = new Set(), duplicates = new Set();
      for (const p of projects) {
        if (names.has(p.name)) duplicates.add(p.name);
        names.add(p.name);
      }
      select.replaceChildren(...projects.map(p => new Option(duplicates.has(p.name) ? p.path : p.name, p.id)));
      if (projects.some(p => p.id === selected)) select.value = selected;
      scanStatus.textContent = !projects.length ? copy.empty : result.partial ? copy.partial : '';
      if (!projects.length) manual.open = true;
    } catch {
      scanStatus.textContent = copy.scanFailed;
      if (!projects.length) manual.open = true;
    } finally {
      scanning = false; controls();
    }
  }
  rescan.addEventListener('click', scan);
  for (const [node,event] of [[select,'change'],[manual,'toggle'],[folder,'input']])
    node.addEventListener(event, () => { clearError(); controls(); });
  el('setup').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || submit.disabled) return;
    const path = typedPath();
    const choice = path ? {folder:path} : {id:select.value};
    choice.memories = el('memories').checked;
    choice.narration = el('narrationMode').value !== 'off';
    choice.includeProcess = el('narrationMode').value === 'process';
    busy = true; clearError(); controls();
    try {
      const response = await fetch('/api/connect', {method:'POST', headers:{
        'X-Deepmine-Client':'welcome', 'Content-Type':'application/json'}, body:JSON.stringify(choice)});
      const result = await response.json();
      if (response.ok) { location.replace(result.url); return; }
      const messages = {'missing-folder':copy.missing, invalid:copy.invalid, 'in-use':copy.busy};
      showError(messages[result.error] || copy.failed);
    } catch { showError(copy.network); }
    busy = false; controls();
  });

  void scan();
  // Reuse the actual game scene for the decorative illustration. It has no collector or controls here.
  if (window.ExpeditionScene) {
    let scene;
    try {
      scene = window.ExpeditionScene.create(el('mine'));
      scene.setState({scopeKey:'welcome', depth:42, instant:true, active:false, locale});
      scene.setPaused(true);
      window.addEventListener('pagehide', () => scene.destroy(), {once:true});
    } catch { scene?.destroy(); }
  }
})();
