import * as ort from '/vision/ort.wasm.min.mjs';
import { dominantColors, addPaletteSummary } from './image-palette.mjs';

ort.env.wasm.wasmPaths = '/vision/';
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
let ready;
async function asset(name) {
  const response = await fetch('/vision/' + name);
  if (!response.ok) throw new Error('Local model is unavailable');
  return response;
}
function load() {
  if (!ready) ready = Promise.all([
    ort.InferenceSession.create('/vision/clip-vision.onnx',{executionProviders:['wasm']}),
    asset('subjects.json').then(r => r.json()),
    asset('subjects.f32').then(r => r.arrayBuffer()).then(b => new Float32Array(b))
  ]).catch(error => {ready = null; throw error;});
  return ready;
}
const size = 224, plane = size * size;
const means = [.48145466,.4578275,.40821073], scales = [.26862954,.26130258,.27577711];
function pixels(bitmap, readPalette) {
  try {
    const canvas = new OffscreenCanvas(size,size), ctx = canvas.getContext('2d',{willReadFrequently:true});
    const side = Math.min(bitmap.width,bitmap.height);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,size,size);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,size,size);
    const rgba = ctx.getImageData(0,0,size,size).data, channels = new Float32Array(plane*3);
    for (let c=0;c<3;c++) for (let i=0;i<plane;i++) channels[c*plane+i] = (rgba[4*i+c]/255-means[c])/scales[c];
    let colors = [];
    if (readPalette) {
      // Sample the full frame separately from the center crop. Preserve alpha
      // and individual colors instead of blending adjacent pixels into new ones.
      const sample = new OffscreenCanvas(67, 61), sampleCtx = sample.getContext('2d', {willReadFrequently:true});
      sampleCtx.imageSmoothingEnabled = false;
      sampleCtx.drawImage(bitmap, 0, 0, sample.width, sample.height);
      colors = dominantColors(sampleCtx.getImageData(0, 0, sample.width, sample.height).data);
    }
    return { tensor:new ort.Tensor('float32',channels,[1,3,size,size]), colors };
  } finally { bitmap.close(); }
}
self.onmessage = async ({data:{key,url,kind,frame,time}}) => {
  let bitmap=frame;
  try {
    const target = new URL(url,self.location.origin);
    if (target.origin !== self.location.origin || !['/api/preview','/demo-assets/sample-02.png','/demo-assets/garden.png'].includes(target.pathname)) throw new Error('Unknown image');
    if(kind==='video'){
      if(target.pathname!=='/api/preview'|| !(bitmap instanceof ImageBitmap) ||
        bitmap.width>520 || bitmap.height>520 || !Number.isFinite(time) || time<0)throw Error('Unsupported frame');
    }else{
      if(frame)throw Error('Unexpected frame');
      const response = await fetch(target,{signal:globalThis.AbortSignal?.timeout?.(24000)});
      if (!response.ok) throw new Error('Version unavailable');
      const blob = await response.blob();
      if (blob.size > 8*1024*1024 || !blob.type.startsWith('image/')) throw new Error('Unsupported image');
      bitmap=await createImageBitmap(blob);
    }
    const {tensor,colors} = pixels(bitmap,kind!=='video' && target.pathname==='/api/preview');
    bitmap=null;
    let result;
    try {
      const [session,subjects,embeddings] = await load();
      result = await session.run({pixel_values:tensor},['image_embeds']);
      const vector = result.image_embeds.data;
      const norm = Math.sqrt(vector.reduce((sum,value) => sum+value*value,0));
      const ranked = subjects.map((subject,index) => {
        let score = 0;
        for(let i=0;i<vector.length;i++) score += vector[i]*embeddings[index*vector.length+i];
        return {subject,score:score/norm};
      }).sort((a,b)=>b.score-a.score);
      const [first,second] = ranked;
      // Similarity is a ranking score, not a probability. Abstain on close matches.
      const match = first.subject.id !== 'unrelated' && first.score >= .22 && first.score - second.score >= .008;
      let reading=null;
      if(match){
        const {id,title,summary}=first.subject;
        if(kind==='video'){
          const stamp=Math.round(time*10)/10;
          const subject=({game:'游戏里的场景',portrait:'人物的照片',website:'网页的布局',document:'一页文字',code:'屏幕上的代码',flower:'花草植物'})[id]||title[0];
          const article=['flower','sprite','abstract'].includes(id)?'':/^[aeiou]/i.test(title[1])?'an ':'a ';
          reading={id,title:[(id==='game'?'游戏':title[0])+'片段',title[1]+' clip',title[2]+'の映像'],
            summary:['停在约第 '+stamp+' 秒，可以从这一帧看到'+subject+'。','A frame sampled at about '+stamp+' seconds shows '+article+title[1].toLowerCase()+'.','約'+stamp+'秒のコマには'+title[2]+'が映っています。']};
        }else reading={id,title,summary:addPaletteSummary(summary,colors)};
      }
      self.postMessage({key,ok:true,reading});
    } finally { tensor.dispose(); result?.image_embeds?.dispose(); }
  } catch { self.postMessage({key,ok:false}); }
  finally { bitmap?.close(); }
};
