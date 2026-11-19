'use strict';

const path=require('node:path');
const STRUCTURED_EXTENSIONS=new Set(['json','ipynb','geojson','srt','vtt','ics']);
const geometryNames={Point:'点位',MultiPoint:'点位',LineString:'路线',MultiLineString:'路线',Polygon:'区域',MultiPolygon:'区域'};
function phrase(value,max=96) {
  if(typeof value!=='string')return '';
  const s=value.replace(/\s+/g,' ').trim();
  if(!s || s.length>max || !/\p{L}/u.test(s) ||
    /[<>{}\u0000-\u001f\\]|https?:\/\/|[\w.+-]+@[\w.-]+|(?:password|bearer |api[_ -]?key|secret|private key|密钥|口令)|[a-zA-Z0-9_+=-]{32,}/i.test(s))return '';
  return s;
}
function sentence(s) {return /[。！？.!?]$/.test(s)?s:s+'。';}
function subtitles(text) {
  const cue=/^(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3}/;
  const lines=text.split(/\r?\n/),spoken=[];
  for(let i=0;i<lines.length;i++){
    if(!cue.test(lines[i]))continue;
    const block=[];
    while(i+1<lines.length && lines[i+1].trim() && !cue.test(lines[i+1]))block.push(lines[++i].trim());
    const line=phrase(block.join(' ').replace(/<\/?[^>]+>/g,''));
    if(line && !spoken.includes(line))spoken.push(line);
    if(spoken.length===2)break;
  }
  if(!spoken.length)return null;
  return {title:'「'+spoken[0].slice(0,32)+'」的字幕',summary:'字幕开头写着「'+spoken[0]+'」'+(spoken[1]?'，接下来是「'+spoken[1]+'」。':'。')};
}
function calendar(text) {
  if(!/^BEGIN:VCALENDAR\s*$/m.test(text))return null;
  const events=[...text.replace(/\r?\n[ \t]/g,'').matchAll(/^BEGIN:VEVENT\s*\r?\n([\s\S]*?)^END:VEVENT\s*$/gm)];
  const titles=events.map(entry=>phrase(/^SUMMARY(?:;[^:\r\n]+)?:([^\r\n]+)/m.exec(entry[1])?.[1])).filter(Boolean);
  if(!titles.length)return null;
  return {title:titles.length===1?titles[0]+'的日程':'活动日历',summary:'日历里排了'+titles.slice(0,3).map(t=>'「'+t+'」').join('、')+'。'};
}
function describeStructured(bytes,extension,filename,truncated=false) {
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes,{stream:truncated});}catch{return null;}
  if(extension==='srt'||extension==='vtt')return subtitles(truncated?text.slice(0,text.lastIndexOf('\n\n')):text);
  if(truncated)return null;
  if(extension==='ics')return calendar(text);
  let data;try{data=JSON.parse(text);}catch{return null;}
  if(!data || typeof data!=='object' || Array.isArray(data))return null;
  if(extension==='ipynb' && Array.isArray(data.cells)) {
    const notes=data.cells.filter(c=>c?.cell_type==='markdown' && (typeof c.source==='string'||Array.isArray(c.source)))
      .flatMap(c=>(Array.isArray(c.source)?c.source.join(''):c.source).split(/\r?\n/));
    const headings=notes.filter(s=>/^#{1,6}\s+/.test(s)).map(s=>phrase(s.replace(/^#{1,6}\s+/,''))).filter(Boolean);
    const intro=notes.filter(s=>!/^#|^\s*[-*]/.test(s)).map(s=>phrase(s,160)).find(Boolean);
    const code=data.cells.filter(c=>c?.cell_type==='code').length;
    if(!headings.length&&!intro&&!code)return null;
    return {title:headings[0]||'计算笔记',summary:[intro?sentence(intro):'',headings[1]?'另有一节写的是「'+headings[1]+'」。':'',code?'笔记里附有 '+code+' 段可以运行的代码。':''].join('')||'这份笔记围绕「'+headings[0]+'」展开。'};
  }
  if(data.type==='FeatureCollection' && Array.isArray(data.features)) {
    const kinds=[...new Set(data.features.map(f=>geometryNames[f?.geometry?.type]).filter(Boolean))];
    if(!kinds.length)return null;
    return {title:phrase(data.name)||kinds.join('与')+'地图',summary:'这份地图把'+kinds.join('、')+'标在地理坐标上，共收录 '+data.features.length+' 个地理要素。'};
  }
  if(path.basename(filename).toLowerCase()==='package.json' && typeof data.name==='string'){
    const name=phrase(data.name),desc=phrase(data.description,160);
    const actions=Object.keys(data.scripts||{}).filter(k=>['start','dev','build','test'].includes(k)).map(k=>({start:'启动项目',dev:'边改边预览',build:'打包',test:'运行测试'})[k]);
    return {title:name?name+' 的项目设置':'项目设置',summary:[desc?sentence(desc):'',actions.length?'清单里列出了'+actions.join('、')+'的命令。':'这里列着项目名称和运行它需要的设置。'].join('')};
  }
  const title=phrase(data.title), description=phrase(data.description,180);
  if(title && description)return {title,summary:sentence(description)};
  if(title && data.type==='object' && data.properties && typeof data.properties==='object')
    return {title,summary:'这份说明规定了「'+title+'」可以填写哪些信息。'};
  return null;
}
module.exports={describeStructured,STRUCTURED_EXTENSIONS};
