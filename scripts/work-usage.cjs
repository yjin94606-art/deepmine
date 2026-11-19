'use strict';
const {createHash}=require('node:crypto');
const {parseTokenEvent}=require('./collector.cjs');

// A complete Codex turn can price a receipt only when the entire turn delivered
// one file and all usage increments reconcile against the session counter.
function singleWorkUsage(){
  let session='',active=null,previous=null,expectedOffset=0;
  const verified=new Map();
  function read(row,location){
    const p=row.payload||{},type=p.type,event=row.type==='event_msg';
    if(location.offset!==expectedOffset){if(active)active.valid=false;previous=null;}
    expectedOffset=location.offset+location.length+1;
    if(row.type==='session_meta'){session=p.id||'';return;}
    if(!session || p.thread_id && p.thread_id!==session)return;
    if(event && type==='task_started'){
      if(active&&active.id===p.turn_id)return;
      active=p.turn_id?{id:p.turn_id,valid:true,seen:0,total:0,call:null,tool:null}:null;
      return;
    }
    if(active && p.turn_id && p.turn_id!==active.id){active.valid=false;}
    if(event && type==='token_count'){
      if(p.info==null)return; // A quota heartbeat carries no model usage.
      const usage=parseTokenEvent(row);
      const total=usage?.total?.totalTokens,last=usage?.last?.totalTokens;
      if(active){
        if(!Number.isSafeInteger(total)||!Number.isSafeInteger(last))active.valid=false;
        else if(total!==previous){
          if(last!==total-(previous??0))active.valid=false;
          else {active.seen++;active.total+=last;}
        }
      }
      previous=Number.isSafeInteger(total)?total:null;return;
    }
    if(!active)return;
    if(row.type==='response_item' && ['custom_tool_call','function_call'].includes(type)){
      if(!/(?:^|__)(?:apply_patch|imagegen|image_gen)$/.test(p.name||'')||!p.call_id||active.tool&&active.tool!==p.call_id)active.valid=false;
      else active.tool=p.call_id;
    }
    if(event && ['thread_rolled_back','conversation_rolled_back','turn_aborted','task_aborted','exec_command_begin','exec_command_end','collab_agent_spawn_begin'].includes(type)){
      active.valid=false;return;
    }
    const item=event&&type==='item_completed'?p.item:null;
    if(event&&type==='patch_apply_end'||item?.type==='FileChange'){
      const receipt=item||p,keys=Object.keys(receipt.changes||{});
      if(keys.length!==1||receipt.changes[keys[0]]?.type==='delete'||
        (item?item.status!=='completed':p.success!==true))active.valid=false;
      note(item?.id||p.call_id);
    }else if(event&&type==='image_generation_end'||item?.type==='ImageGeneration'||row.type==='response_item'&&type==='image_generation_call'){
      const receipt=item||p;
      if(receipt.status!=='completed')active.valid=false;
      note(item?.id||p.call_id||p.id);
    }else if(item && ['McpToolCall','CommandExecution','WebSearch','CollabAgentToolCall','DynamicToolCall'].includes(item.type)){
      active.valid=false;
    }
    if(event&&['task_complete','task_completed'].includes(type)){
      if(active.valid&&active.call&&(!active.tool||active.tool===active.call)&&active.seen&&p.turn_id===active.id){
        const ref='trace:'+createHash('sha256').update(['codex',session,active.call].join('\0')).digest('hex');
        verified.set(ref,active.total);
      }
      active=null;
    }
    function note(id){if(typeof id!=='string'||!id||active.call&&active.call!==id)active.valid=false;else active.call=id;}
  }
  return {read,tokens:ref=>verified.get(ref)};
}
module.exports={singleWorkUsage};
