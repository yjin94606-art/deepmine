(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory(require('./item-story.js'));
  else root.GalleryLedger=factory(root.ItemStory);
})(globalThis,function(story){
  'use strict';
  const costs=Object.freeze({lamp:6,tile:14});
  const fresh=()=>({revision:0,coins:0,removed:{},positions:{},upgrades:[]});
  // A file revision stays the same display even if a second collector later finds its receipt.
  const edition=(item,member)=>JSON.stringify([item.id,member?.path||'',member?.record?.fingerprint||member?.commit?.hash||item.memoryIds?.[0]||'']);
  const members=(item,snapshot,state)=>story.works(item,snapshot).filter(m=>!Object.hasOwn(state.removed,edition(item,m)));
  function available(item,snapshot,state){
    return story.works(item,snapshot).length?members(item,snapshot,state).length>0:!Object.hasOwn(state.removed,edition(item,null));
  }
  function quote(member){
    const proof=member?.trace;
    const tokens=Number.isSafeInteger(proof?.workTokens)&&proof.workTokens>=0?proof.workTokens:null;
    return {tokens,coins:6+(tokens===null?0:Math.ceil(Math.sqrt(tokens/100)))};
  }
  function command(state,cmd,snapshot,findings,depth){
    if(!cmd || cmd.revision!==state.revision)throw Error('stale');
    const next={...state,revision:state.revision+1};
    if(cmd.action==='upgrade'){
      if(!Object.hasOwn(costs,cmd.style)||state.upgrades.includes(cmd.style))throw Error('invalid');
      if(state.coins<costs[cmd.style])throw Error('funds');
      return {...next,coins:state.coins-costs[cmd.style],upgrades:[...state.upgrades,cmd.style]};
    }
    const item=findings.find(f=>f.id===cmd.id);
    if(!item || item.pending || item.depth>depth+.001 || !available(item,snapshot,state))throw Error('unavailable');
    if(cmd.action==='move'){
      if(![-1,1].includes(cmd.side)||!Number.isInteger(cmd.row)||Math.abs(cmd.row)>4)throw Error('invalid');
      const choices=members(item,snapshot,state);
      const key=cmd.edition??edition(item,choices[0]);
      if(!(choices.length?choices.some(m=>edition(item,m)===key):edition(item,null)===key))throw Error('unavailable');
      return {...next,positions:{...state.positions,[item.id]:{side:cmd.side,row:cmd.row,edition:key}}};
    }
    if(!['sell','discard'].includes(cmd.action))throw Error('invalid');
    const choices=story.works(item,snapshot);
    const member=choices.find(m=>edition(item,m)===cmd.edition);
    if(!member && (choices.length || cmd.edition!==edition(item,null)))throw Error('unavailable');
    if(Object.hasOwn(state.removed,cmd.edition))throw Error('unavailable');
    const value=cmd.action==='sell'?quote(member).coins:0;
    return {...next,coins:state.coins+value,removed:{...state.removed,[cmd.edition]:cmd.action}};
  }
  return {fresh,costs,edition,members,available,quote,command};
});
