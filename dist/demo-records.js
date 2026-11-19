(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(require('./evidence-core.js'));else root.DemoRecords=factory(root.EvidenceCore);})(typeof globalThis!=='undefined'?globalThis:this,function(C){
  'use strict';
  const projectId = 'fictional-chronicle';
  const samples = [
    {type:'web', file:'Portfolio.html',
      short:{"zh":"你想给插画找个能一起展出的地方，AI 把灯塔、夜市和温室排在同一页。随手点一幅，画它的人还藏了段导览。","en":"You asked for a home for your illustrations. The AI put a lighthouse, a market and a greenhouse on one page, with a little tour tucked behind each picture.","ja":"絵を一緒に並べたいと頼んだら、灯台も夜市も温室も一枚のページに。作品を開くと、作者の小さなガイドが待っています。"},
      zh:['我的作品集','把海边灯塔、夜市和温室的三张插画排成一页。点开缩略图，就能读到每幅画旁边的创作笔记。'],
      en:['My portfolio','Three illustrations share a page: a lighthouse, a night market and a greenhouse. Open a thumbnail to read the artist’s note.'],
      ja:['わたしの作品集','灯台、夜市、温室のイラストを一枚のページに並べました。サムネイルを開くと制作メモが読めます。']},
    {type:'document', file:'Research-notes.md',
      short:{"zh":"你想把河口观察写成手记，还特意给没弄明白的事留了位置。AI 记下白鹭吃早餐的浅滩。至于涨潮后去哪儿，下次还得问问白鹭。","en":"You asked the AI to keep the loose ends in your estuary notes. The egrets’ breakfast spot made the page. Their high-tide plans will need another visit.","ja":"河口で分かったことも疑問も残したいと頼み、AI がシラサギの朝食場所を手帳に記録。満潮後の予定は、次に本人たちを訪ねるまでのお楽しみ。"},
      zh:['河口观鸟手记','记下了白鹭清早在哪片浅滩觅食，也留了一个下次去河口想弄清的问题：涨潮后，它们会移到哪里？'],
      en:['Birdwatching at the estuary','Egrets feed on the shallow bank in the morning. The notes leave one question for next time. Where do they go at high tide?'],
      ja:['河口の野鳥観察ノート','朝の浅瀬で餌を探すシラサギを記録しました。満潮のときはどこへ移るのか、次の観察に向けた疑問も残っています。']},
    {type:'image', file:'Garden-illustration.png',
      short:{"zh":"你点名要一条从花圃中间穿过去的小路，AI 把它一直画到玻璃温室门口。这回逛花园，鞋底连泥都不用沾。","en":"You asked for a path right through the flower beds. The AI drew it all the way to the greenhouse door. For once, a garden walk keeps your shoes clean.","ja":"花壇の真ん中に小道を、と頼んだら、ガラスの温室まで続く道が絵の中に。今回の庭歩きは靴も汚れません。"},
      zh:['温室前的小花园','一条浅色小路穿过花圃，通向玻璃温室。'],
      en:['The greenhouse garden','A pale path winds between the flower beds and leads to a glass greenhouse.'],
      ja:['温室の前の小さな庭','花壇のあいだを明るい色の小道が抜けて、ガラスの温室へと続いています。']},
    {type:'audio', file:'Podcast-intro.wav',
      short:{"zh":"夜市播客的片头原本是主持人先开口。你想让大家先听听摊上的动静，AI 就把吆喝声剪到了最前头。面还没点，听众已经入座了。","en":"The host opened your market podcast until you asked to hear the stalls first. The AI gave the vendor the opening line. Your ears already have a seat by the noodles.","ja":"夜市の番組は司会の声で始まる予定でした。先に屋台の音を聞かせたいと頼んだら、呼び込みが一番手に。耳はもう、麺の屋台に着席。"},
      discussion:{"zh":[["给这期播客做一段简短的开场。","片头剪好了，主持人先打招呼，再带大家逛夜市。"],["想让听众先听到摊上的声音，再进主持人的话。","我把摊主吆喝声放到了最前面，再接上主持人在面摊的开场。"]],"en":[["Make a short opening for this podcast episode.","The first cut opens with the host, then moves into the market."],["Let the listeners hear a stall before anyone introduces the show.","I moved a vendor’s call ahead of the host’s introduction at the noodle stand."]],"ja":[["番組の短いオープニングを作って。","最初の版は司会が挨拶してから夜市に入ります。"],["司会より先に屋台の音を聞かせたい。","麺の屋台での紹介の前に、店主の呼び声を移しました。"]]},
      zh:['周末夜市的播客片头','先听到摊主招呼客人的声音，接着主持人带听众走进夜市，从第一家面摊聊起。'],
      en:['Night market podcast opener','A vendor calls to customers. The host then takes listeners into the night market, starting at a noodle stand.'],
      ja:['夜市を歩く番組の冒頭','店主の呼び声に続いて司会者が夜市を案内します。最初に立ち寄るのは麺の屋台です。']},
    {type:'video', file:'Travel-cut.webm',
      short:{"zh":"你把沿河骑行的片段交给 AI 剪成短片。旧桥旁的车轮一转，镜头掠过河面就到了渡口。观众的腿倒是一点也不酸。","en":"You gave the AI your cycling clips. It cut from the wheel by the old bridge to the river and the ferry landing. Three shots did all the pedalling for us.","ja":"川沿いを撮った映像を AI に渡して短編に。古橋の車輪から川面、そして渡し場へ。三つのカットで走り切れて、見る側の足は元気なまま。"},
      zh:['沿河骑行短片','镜头从旧桥旁的车轮切到河面，最后停在折返点的渡口。三个片段串起了这趟骑行。'],
      en:['Cycling by the river','The camera cuts from a bicycle beside the old bridge to the river and then the ferry landing where the riders turned back.'],
      ja:['川沿いを走る短編','古い橋のそばの車輪から川面へ切り替わり、折り返し地点の渡し場で終わるサイクリングの映像です。']},
    {type:'slides', file:'Project-proposal.pptx',
      short:{"zh":"你想用几页幻灯片讲清社区花园怎么建，AI 先放空地，再铺开花圃图，最后摆上种子和工具。翻到末页，手都想去找铲子了。","en":"You wanted the garden plan in a few slides. The AI went from bare ground to flower beds to a supply list. By the last slide your hands want a shovel.","ja":"花園の計画を数枚で伝えたいと頼み、空き地から花壇図、最後に種と道具のリストへ。読み終わるころにはシャベルを探したくなります。"},
      zh:['社区花园提案','先看空地现在的样子，再看花圃怎么排。最后一页列出第一周要准备的种子和工具。'],
      en:['A community garden proposal','The deck opens with the empty plot, shows a plan for the flower beds, and closes with the seeds and tools needed for the first week.'],
      ja:['地域の花園の提案','空き地の現状と花壇の配置を順に紹介し、最後に初週に用意する種と道具をまとめました。']},
    {type:'table', file:'Experiment-results.csv',
      short:{"zh":"你想一眼比出哪盆苗长得快，AI 把同一周的株高和浇水间隔摆在一起。这下，哪棵偷偷蹿了个儿，尺子都替它交代了。","en":"You wanted to spot the fastest grower. The AI put this week’s heights beside watering intervals. No seedling can sneak in a growth spurt under that ruler.","ja":"どの苗の伸びが早いか比べたいと頼んで、同じ週の草丈と水やりの間隔が表に。こっそり伸びたつもりでも、物差しにはお見通し。"},
      zh:['花苗浇水对照表','每一行记下一盆花苗的浇水间隔和株高。把同一周的数据放在一起，就能比较不同浇水方式下的长势。'],
      en:['Watering trial for seedlings','Each row pairs a pot’s watering interval with the height of its seedling. Read across one week to compare growth.'],
      ja:['水やりと苗の成長の比較表','鉢ごとに水やりの間隔と草丈が並び、同じ週の苗の育ち方を見比べられます。']},
    {type:'code', file:'Route-planner.py',
      short:{"zh":"你只想报两个地名，就能知道怎么从这头去那头。AI 写了个路线小工具，负责把两点连起来。路上拐去买咖啡这件事，还是你说了算。","en":"You wanted directions from just two place names. The AI wrote a route finder to join the dots. Any detour for coffee remains entirely up to you.","ja":"地名を二つ渡して道順を知りたい、という依頼からルート検索ツールが完成。二地点はつないでくれます。コーヒーに寄るかはご自由に。"},
      zh:['路线规划小工具','给它一个起点和一个终点，它会帮你找一条连接两地的路线。'],
      en:['Route planner','Give it a start and a destination and it finds a route between them.'],
      ja:['ルートを探すツール','出発地と目的地を指定すると、その二地点を結ぶ道順を探してくれます。']},
    {type:'file', file:'Product-model.glb',
      short:{"zh":"你想把折叠台灯翻过来看看，AI 给它做了能转动视角的模型。一转到侧面，灯臂折好以后躲在哪儿，全露馅了。","en":"You wanted to turn the folding lamp around. The AI built a model you can rotate. One sideways glance reveals exactly where the folded arm is hiding.","ja":"折りたたみライトをいろんな角度から見たいと頼んだら、回して眺められる模型に。横を向いた瞬間、たたんだアームの隠れ場所が丸見えです。"},
      zh:['折叠台灯模型','模型分成底座、转轴和灯罩三部分。转到侧面，可以看清灯臂收起来时靠在哪里。'],
      en:['Folding desk lamp model','The lamp is built from a base, a hinge and a shade. Turn it sideways to see where the arm rests when folded.'],
      ja:['折りたたみ式デスクライト','台座、ヒンジ、かさの三つに分かれた模型です。横から見ると、アームを畳んだときの位置が分かります。']}
  ];
  const memoryNotes = [
    {short:{"zh":"每天收工，电脑里留下的记录轮流作证：今天确实干了点什么。","en":"At the end of the day, your computer’s records line up as witnesses. Something did get done around here.","ja":"一日の終わり、パソコンに残った記録が証人席へ。今日の仕事を振り返るための申し合わせです。"},
      zh:['每天回顾自己的工作','我们商量好，每天就翻翻电脑上留下的记录，看看这一天做了些什么。'],
      en:['Looking back on the day','We decided to use the records already on the computer to look back on each day’s work.'],
      ja:['その日の仕事を振り返る','毎日の振り返りには、パソコンにすでに残っている仕事の記録を使うことにしました。']},
    {short:{"zh":"火车上的网络爱请假，报告可不能。出发前留个本地副本，它就能一路随行。","en":"Train Wi-Fi likes a day off. Save the report before departure and at least one of them will show up for the journey.","ja":"列車の通信は時々お休み。出発前に保存したレポートなら、ちゃんと終点まで付き合ってくれます。"},
      zh:['把报告带上火车','出发前留一份报告在电脑里，这样火车上没有网络也能看。'],
      en:['The report for the train','Save a copy of the report before leaving so it can be read on the train without Wi-Fi.'],
      ja:['電車で読むレポート','出発前にレポートをパソコンに保存しておけば、電車でネットにつながらなくても読めます。']}
  ];
  const portrait = {type:'image',file:'sample-02.png',
      short:{"zh":"你请 AI 画一位温室里的植物学家，又让它把发夹往外挪了两回。蓝头发、黄围巾都没抢过戏，这张肖像最难伺候的是一片小叶子。","en":"You asked for an anime botanist, then had the AI move her hair clip twice. Blue hair, yellow scarf, and the fussiest sitter in this portrait was a little leaf.","ja":"温室で働く植物学者を描いてもらい、髪留めの位置を二度お直し。青い髪に黄色いマフラー、この肖像画でいちばん手のかかったのは小さな葉っぱでした。"},
      discussion:{"zh":[["画一位在温室工作的二次元植物学家，蓝色短发，戴一条黄色围巾。","画好了。我还给她别了一枚叶形发夹。"],["把发夹往外挪一点，蓝头发挡住它了。","我把叶尖移到了头发外侧。"],["再挪一点，整个叶子的形状都要看得清。","这次叶形轮廓全部露出来了。"]],"en":[["Draw an anime botanist in a greenhouse with short blue hair and a yellow scarf.","I drew her with a leaf-shaped hair clip."],["Move the clip outward so her hair doesn’t hide it.","The leaf tip now clears her hair."],["A little farther. I want the whole leaf to show.","The entire leaf outline is visible now."]],"ja":[["青いショートヘアで黄色いマフラーをした、温室で働くアニメ風の植物学者を描いて。","葉っぱの髪留めをつけて描きました。"],["髪に隠れているから、髪留めをもう少し外側へ。","葉先が青い髪から出るようにしました。"],["あと少し。葉っぱの形が全部見えるようにして。","葉の輪郭が丸ごと見える位置に移しました。"]]},
    zh:['温室里的二次元人物','蓝色短发上别着一枚叶形发夹。她系着黄色围巾，身后是温室的枝叶。'],
    en:['An anime character in a greenhouse','A leaf clip holds back her short blue hair. She wears a yellow scarf, with greenhouse plants behind her.'],
    ja:['温室にいるアニメ風の人物','青いショートヘアには葉の髪留め。黄色いマフラーを巻いた人物の後ろに、温室の草花が見えます。']};
  function sampleAt(day,index) { return (day === 20 || day === 29) && index === 0 ? portrait : samples[(day + index * 2) % samples.length]; }
  function describeSample(item, snapshot, locale) {
    if (snapshot?.mode !== 'demo' || snapshot.project?.id !== projectId ||
        item?.mode !== 'demo' || item.projectId !== projectId) return null;
    let sample;
    if (item.memoryIds?.length === 1 && !item.paths?.length) {
      const id = item.memoryIds[0], record = snapshot.memories?.find(memory => memory.id === id);
      const match = /^fictional-memory:(\d+)$/.exec(id);
      if (!match || record?.sourceId !== 'fictional-conversation' || record.sourceRef !== 'example-message:'+match[1]) return null;
      const day = Number(match[1]);
      if (day >= 30 || (day % 3 !== 0 && day < 27)) return null;
      sample = memoryNotes[day % 2];
    } else if (item.paths?.length === 1 && item.outputIds?.length === 1 && !item.evidenceIds?.length && !item.memoryIds?.length) {
      const id = item.outputIds[0], record = snapshot.outputs?.find(output => output.id === id);
      const match = /^fictional:(\d+):([0-3])$/.exec(id);
      if (!match || record?.sourceId !== 'fictional-files') return null;
      const day = Number(match[1]), index = Number(match[2]);
      if (day >= 30 || index >= (day > 26 ? 4 : 2)) return null;
      sample = sampleAt(day,index);
      const file = 'example/day-' + (day + 1) + '/' + sample.file;
      if (item.paths[0] !== file || record.files?.length !== 1 || record.files[0] !== file ||
          record.type !== sample.type || item.visualType !== sample.type) return null;
    } else return null;
    const language = String(locale).toLowerCase().split(/[-_]/)[0];
    const lang = language === 'zh' || language === 'ja' ? language : 'en';
    const [title, summary] = sample[lang];
    return {title, summary, short:sample.short[lang], discussion:sample.discussion?.[lang]};
  }
  function create(now=new Date()){
    const instant=new Date(now),end=C.today(instant),dates=Array.from({length:30},(_,i)=>{const date=new Date(end+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+i-29);return date.toISOString().slice(0,10);});
    const outputs=[],memories=[],days=[];
    dates.forEach((date,i)=>{
      const timestamp=i===29?instant.toISOString():date+'T12:00:00+08:00';
      const input=18000+i*700,output=4000+i*90;
      days.push({date,usage:{inputTokens:input,cachedInputTokens:Math.floor(input*.3),outputTokens:output,totalTokens:input+output,reasoningOutputTokens:null,cacheWriteInputTokens:null,sessions:2,quality:'observed'},usageSourceIds:['fictional-api'],evidence:[]});
      const n=i>26?4:2;
      for (let j = 0; j < n; j++) {
        const sample = sampleAt(i,j), [title, summary] = sample.en;
        outputs.push({id:'fictional:'+i+':'+j, projectId, sourceId:'fictional-files', timestamp, type:sample.type,
          title, files:['example/day-'+(i+1)+'/'+sample.file], summary, fingerprint:(i*10+j).toString(16).padStart(64,'0')});
      }
      if(i%3===0||i>26)memories.push({id:'fictional-memory:'+i,projectId,sourceId:'fictional-conversation',timestamp,sourceRef:'example-message:'+i,title:i%2?'Keep the report accessible offline':'Use local records for the daily view',summary:i%2?'Fictional conversation note: keep an offline copy of the report for the train journey.':'Fictional conversation note: the daily view should come from the saved project records.',method:'conversation-excerpt',objectType:'memory'});
    });
    return C.validateSnapshot({schemaVersion:1,kind:'deepmine-evidence',mode:'demo',collectedAt:instant.toISOString(),timezone:C.TIMEZONE,project:{id:projectId,label:'Fictional project'},sources:{codex:{status:'connected',sessions:60,events:60,method:'fictional-demo-only',notes:['All numbers are fictional.']},git:{status:'missing',head:null,branch:null,notes:[]}},days,usageSources:[{id:'fictional-api',label:'Example API',status:'connected',method:'fictional-demo-only',notes:[]}],outputs,memories,outputSource:{status:'connected',notes:['Fictional files; no actual file bodies.']},workingTree:{status:'unavailable',modified:null,untracked:null},history:{enabled:true,revision:1,pacingFrom:dates[0]},warnings:['This preview contains fictional records and handwritten conversation notes.']});
  }
  function flavorFor(item,snapshot,locale,member){
    if(member){
      const record=member.record;
      if(!record || !item?.paths?.includes(member.path) || !item.outputIds?.includes(record.id) ||
        !snapshot?.outputs?.some(o=>o.id===record.id && o.fingerprint===record.fingerprint))return null;
      item={...item,paths:[member.path],outputIds:[record.id]};
    }
    return describeSample(item,snapshot,locale)?.short || null;
  }
  return Object.freeze({create,describeSample,flavorFor});
});
