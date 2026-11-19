(function(root){
  'use strict';
  const L=root.GalleryLedger;
  const strings={
    en:['Mine workshop','coins','Brass lamps','Glazed shelves','Installed','Arrange on wall','Sell','Remove','Keep','Confirm sale','Confirm removal','The source file and its history stay on this computer.','No item-level meter. Base price','Tokens linked to this work','Drag the selected work, or choose a direction.','Left','Right','Up','Down','Done','Another window changed the gallery. Check the current display.','The workshop could not save. Please try again.','Not enough coins.','Sell works to fit out the excavated passage.','Wall display','Saves after each move.'],
    'zh-CN':['矿道工坊','金币','黄铜矿灯','青釉展台','已安装','摆放到岩壁','出售','移出矿道','保留','确认出售','确认移出','原文件和创作记录会保留在这台电脑上。','缺少逐件用量记录，按基础价','这件作品关联的 Token','拖动选中的展品，或用方向键调整。','左','右','上','下','完成','另一个窗口调整了展位，请查看最新状态。','工坊暂时无法保存，请重试。','金币不足。','用出售展品所得的金币装饰挖过的矿道。','岩壁展位','每次摆放后自动保存。'],
    ja:['坑道の工房','コイン','真鍮のランプ','釉薬の展示棚','設置済み','壁に配置','売る','展示から外す','残す','売却する','展示から外す','元のファイルと制作記録はこの端末に残ります。','作品別の使用量が不明のため基本価格','この作品に紐づいたトークン','選択した作品をドラッグするか、矢印で移動できます。','左','右','上','下','完了','別の画面で展示が変更されました。最新の状態を確認してください。','保存できませんでした。もう一度お試しください。','コインが足りません。','作品を売ったコインで坑道を飾れます。','壁の展示','配置後に自動で保存します。']
  };
  function create({context,changed,begin,end}){
    const el=id=>document.getElementById(id);
    let state=L.fresh(),scope='',loaded=false,editing=null,editingEdition=null,confirm=null,selected=null,busy=false,pending=null,feedback='';
    const text=i=>(strings[context().locale]||strings.en)[i];
    const storageKey=()=> 'deepmine.gallery.v1.'+scope;
    function sync(mode,projectId){
      const next=mode+':'+projectId;
      if(next!==scope){
        scope=next;state=L.fresh();loaded=false;editing=null;confirm=null;selected=null;feedback='';busy=false;pending=null;
        if(mode==='demo'){
          try{const saved=JSON.parse(localStorage.getItem(storageKey()));if(saved?.revision>=0)state=saved;}catch{}
          loaded=true;render();return;
        }
      }
      if(mode==='live'&&!pending){
        const key=scope;
        const request=fetch('/api/gallery',{cache:'no-store'}).then(async res=>{
          if(!res.ok)throw Error();const fresh=await res.json();
          if(scope!==key||fresh.revision<state.revision)return;
          const different=!loaded||fresh.revision!==state.revision;
          state=fresh;loaded=true;
          if(different){
            if(editing && Object.hasOwn(fresh.removed,editingEdition)){
              editing=editingEdition=null;
              feedback=text(20);
              end(false);
            }
            changed();render();
          }
        }).catch(()=>{}).finally(()=>{if(pending===request)pending=null;});
        pending=request;
      }
    }
    function render(){
      const bank=el('galleryShop'),bar=el('galleryArrange'),tools=el('galleryDetail');
      bank.querySelector('summary').textContent=text(0)+' · '+state.coins+' '+text(1);
      bank.querySelector('p').textContent=text(23);
      for(const [i,choice] of ['lamp','tile'].entries()){
        const b=bank.querySelector('[data-style="'+choice+'"]'),installed=state.upgrades.includes(choice);
        b.textContent=text(2+i)+' · '+(installed?text(4):L.costs[choice]+' '+text(1));
        b.disabled=!loaded||busy||installed||state.coins<L.costs[choice];
      }
      bar.hidden=!editing;bar.querySelector('span').textContent=text(14);
      ['left','right','up','down','done'].forEach((id,i)=>{
        const b=bar.querySelector('[data-place="'+id+'"]');
        b.title=text(15+i);b.setAttribute('aria-label',text(15+i));b.disabled=busy;
        if(id==='done')b.textContent=text(19);
      });
      tools.hidden=!selected;
      if(selected){
        const {item,member}=selected,quote=L.quote(member);
        tools.querySelector('p').textContent=confirm?text(11):quote.tokens===null?text(12)+' · '+quote.coins+' '+text(1):text(13)+' · '+quote.tokens.toLocaleString(context().locale);
        const label={move:text(5),sell:text(6)+' · '+quote.coins+' '+text(1),discard:text(7),keep:text(8),confirm:confirm==='sell'?text(9):text(10)};
        for(const b of tools.querySelectorAll('button')){
          const id=b.dataset.gallery;
          b.textContent=label[id];b.hidden=!!confirm!==['keep','confirm'].includes(id);b.disabled=busy||!loaded;
        }
      }
      for(const out of document.querySelectorAll('[data-gallery-status]'))out.textContent=feedback;
    }
    async function write(cmd){
      if(busy||!loaded)return false;
      const key=scope,ctx=context();
      const action={...cmd,revision:state.revision};busy=true;feedback='';render();
      try{
        let fresh;
        if(ctx.mode==='demo'){
          fresh=L.command(state,action,ctx.snapshot,ctx.findings,ctx.depth);
          try{localStorage.setItem(storageKey(),JSON.stringify(fresh));}catch{}
        }else{
          const res=await fetch('/api/gallery',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Deepmine-Client':'gallery'},body:JSON.stringify(action)});
          fresh=await res.json();if(!res.ok)throw Error(fresh.error);
        }
        if(key!==scope)return false;
        if(fresh.revision>=state.revision)state=fresh;
        confirm=null;
        if(['sell','discard'].includes(cmd.action)){selected=null;end(true);}changed();
        if(ctx.mode==='live')try{localStorage.setItem('deepmine.gallery.change',scope+' '+fresh.revision);}catch{}
        return true;
      }catch(error){
        if(key===scope){feedback=text(error.message==='stale'?20:error.message==='funds'?22:21);
          if(ctx.mode==='live')sync(ctx.mode,ctx.snapshot.project.id);}
        return false;
      }finally{if(key===scope){busy=false;render();}}
    }
    function detail(item,member,atDiscovery){
      const key=L.edition(item,member);
      if(selected?.key!==key){confirm=null;feedback='';}
      selected=atDiscovery||!L.available(item,context().snapshot,state)||Object.hasOwn(state.removed,key)?null:{item,member,key};render();
    }
    function stop(){
      editing=null;end(false);render();
    }
    el('galleryDetail').addEventListener('click',event=>{
      const id=event.target.closest('button')?.dataset.gallery;if(!selected||!id)return;
      if(id==='move'){editing=selected.item.id;editingEdition=selected.key;begin(editing);feedback='';}
      if(['sell','discard'].includes(id))confirm=id;
      if(id==='keep')confirm=null;
      if(id==='confirm'&&confirm)void write({action:confirm,id:selected.item.id,edition:selected.key});
      render();
    });
    el('galleryShop').addEventListener('click',e=>{const style=e.target.closest('button')?.dataset.style;if(style)void write({action:'upgrade',style});});
    function move(side,row){return editing?write({action:'move',id:editing,edition:editingEdition,side,row:Math.min(4,Math.max(-4,row))}):false;}
    function nudge(direction){
      if(direction==='done'){stop();return;}
      const pos=context().where(editing);if(!pos)return;
      void move(direction==='left'?-1:direction==='right'?1:pos.side,pos.row+(direction==='up'?-1:direction==='down'?1:0));
    }
    el('galleryArrange').addEventListener('click',e=>{const dir=e.target.closest('button')?.dataset.place;if(dir)nudge(dir);});
    document.addEventListener('keydown',event=>{
      if(!editing||document.querySelector('dialog[open]'))return;
      const dir={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',Escape:'done'}[event.key];
      if(dir){event.preventDefault();event.stopImmediatePropagation();nudge(dir);}
    },true);
    window.addEventListener('storage',e=>{const ctx=context();if(ctx.mode==='live'&&ctx.snapshot&&e.key==='deepmine.gallery.change')sync(ctx.mode,ctx.snapshot.project.id);});
    return {sync,render,detail,move,position:id=>state.positions[id],upgraded:style=>state.upgrades.includes(style),
      editing:()=>editing,available:(item,snapshot)=>L.available(item,snapshot,state),members:(item,snapshot)=>L.members(item,snapshot,state),
      clearDetail:()=>{selected=null;confirm=null;}};
  }
  root.GalleryUI={create};
})(globalThis);
