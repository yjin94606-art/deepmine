(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory(require('./item-story.js'));
  else root.SourceReplay=factory(root.ItemStory);
})(globalThis,function(Story){
  'use strict';
  function overview(snapshot,findings,sourceId,front){
    const versions=new Set();
    let best=null;
    if(snapshot?.mode!=='live')return {count:0,work:null};
    for(const item of findings){
      for(const member of Story.works(item,snapshot)){
        const trace=member.trace;
        if(trace?.sourceId!==sourceId || !member.record)continue;
        versions.add(member.path+'\n'+member.record.fingerprint);
        if(item.pending || item.depth>front+.001)continue;
        const evidence=Number(Boolean(trace.request))*2+Number(Boolean(member.content||member.report));
        if(!best || item.date>best.item.date ||
            (item.date===best.item.date && (evidence>best.evidence || (evidence===best.evidence && trace.producedAt>best.member.trace.producedAt))))
          best={item,member,evidence};
      }
    }
    return {count:versions.size,work:best};
  }
  // Play only an already excavated interval on a separate canvas. This
  // renderer has no transport, progress saver, live scene or radio callbacks.
  function play(create,canvas,{item,layers,locale,title,onDepth,onReady}){
    let disposed=false;
    const scene=create(canvas,{onProgress:state=>{if(!disposed)onDepth(state.depth);}});
    scene.setState({scopeKey:'readback',depth:item.depth,instant:true,active:false,locale,layers,
      workFindings:[{...item,name:title}]});
    scene.replay(Math.max(0,item.depth-14),item.depth).then(()=>{if(!disposed)onReady();});
    return ()=>{disposed=true;scene.destroy();};
  }
  return Object.freeze({overview,play});
});
