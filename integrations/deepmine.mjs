/** Dependency-free bridge for Node.js AI scripts and tool hooks. No request or
 * response text is included by recordUsage; use recordMemory explicitly. */
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {usageFor}=require('../scripts/api-capture.cjs');
export function createDeepmine({projectPath,key,baseURL='http://127.0.0.1:4173',source='custom-api',sessionId}){
  const url=new URL(baseURL);if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Deepmine event endpoint must be local');
  if(!key||!projectPath||!sessionId)throw new Error('projectPath, local key and stable sessionId are required');
  async function record(kind,payload,{id,timestamp=new Date().toISOString()}={}){
    if(!id)throw new Error('A stable source event id is required');
    const event={schemaVersion:1,id,source,projectPath,timestamp,sessionId,kind,[kind]:payload};
    const response=await fetch(new URL('/api/events',url),{method:'POST',headers:{'Content-Type':'application/json','X-Deepmine-Key':key},body:JSON.stringify(event),signal:AbortSignal.timeout(10000)});
    const result=await response.json();if(!response.ok)throw new Error(result.code||'Deepmine rejected event');return result;
  }
  return{
    recordUsage:(usage,options)=>record('usage',usage,options),
    recordOutput:(output,options)=>record('output',output,options),
    recordMemory:(memory,options)=>record('memory',memory,options),
    recordApiResponse(provider,response,options={}){
      const raw=provider==='gemini'?response.usageMetadata:response.usage;
      const usage=usageFor(provider,raw,options.flavor||(raw?.prompt_tokens!==undefined?'chat':'responses'));
      if(!usage)throw new Error('Response contains no supported measured usage');
      return record('usage',usage,{...options,id:options.id||response.id||response.responseId});
    }
  };
}
