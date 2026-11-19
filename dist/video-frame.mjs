  const maxBytes=16*1024*1024;
  async function verifiedBlob(url,signal) {
    const target=new URL(url,location.origin);
    const fingerprint=target.searchParams.get('fingerprint'),commit=target.searchParams.get('commit');
    if(target.origin!==location.origin || target.pathname!=='/api/preview' || Boolean(fingerprint)===Boolean(commit) ||
      (fingerprint?!/^[a-f\d]{64}$/.test(fingerprint):!/^[a-f\d]{40,64}$/.test(commit)))throw Error('Unverified video');
    const response=await fetch(target,{signal,credentials:'same-origin',redirect:'error'});
    const type=response.headers.get('Content-Type')?.split(';')[0], version=response.headers.get('X-Deepmine-Preview');
    if(!response.ok || version!==(fingerprint?'verified-fingerprint':'commit-blob') || !['video/webm','video/mp4','video/quicktime','video/ogg','video/x-matroska','video/x-msvideo'].includes(type) ||
      Number(response.headers.get('Content-Length'))>maxBytes) {
      await response.body?.cancel();throw Error('Video unavailable');
    }
    if(typeof response.body?.getReader!=='function'){
      const blob=await response.blob();
      if(blob.size>maxBytes || signal.aborted)throw Error('Video unavailable');
      return blob;
    }
    const reader=response.body.getReader(),chunks=[]; let size=0;
    try {
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        size+=value.byteLength;
        if(size>maxBytes){await reader.cancel();throw Error('Large video');}
        chunks.push(value);
      }
    } finally {reader.releaseLock();}
    return new Blob(chunks,{type});
  }
  function wait(video,event,action,signal) {
    return new Promise((resolve,reject)=>{
      let timer;
      const clean=()=>{clearTimeout(timer);signal.removeEventListener('abort',fail);video.removeEventListener('error',fail);video.removeEventListener(event,done);};
      const done=()=>{clean();resolve();},fail=()=>{clean();reject(Error('Cannot decode frame'));};
      if(signal.aborted){fail();return;}
      signal.addEventListener('abort',fail,{once:true});
      video.addEventListener('error',fail,{once:true});video.addEventListener(event,done,{once:true});
      timer=setTimeout(fail,4000);
      try{action();}catch{fail();}
    });
  }
  function useful(ctx,width,height){
    const {data}=ctx.getImageData(0,0,width,height);
    let total=0,bright=0,sum=0,squares=0;
    for(let i=0;i<data.length;i+=4*11){
      const y=(data[i]+2*data[i+1]+data[i+2])/4;
      total++;sum+=y;squares+=y*y;if(y>23)bright++;
    }
    return total>0 && bright/total>.08 && squares/total-(sum/total)**2>95;
  }
  export async function extractVideoFrame(url,signal,{transfer=false}={}) {
    const blob=await verifiedBlob(url,signal),video=document.createElement('video');
    const objectURL=URL.createObjectURL(blob);
    try {
      video.preload='auto';video.muted=true;video.playsInline=true;
      await wait(video,'loadeddata',()=>{video.src=objectURL;},signal);
      const w=video.videoWidth,h=video.videoHeight;
      if(!w||!h || w*h>40_000_000)throw Error('Unsupported dimensions');
      const scale=Math.min(1,520/Math.max(w,h)),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      const duration=video.duration;
      // Some recorder-produced WebMs omit their duration. Seek a short distance
      // into those and retain the decoder's actual presentation time.
      const times=Number.isFinite(duration)&&duration>0?[.36*duration,.63*duration,.15*duration]:[1,2.5,0];
      for(const t of times){
        if(Math.abs(video.currentTime-t)>.005){
          try{await wait(video,'seeked',()=>{video.currentTime=t;},signal);}
          catch(error){if(signal.aborted || video.error)throw error;continue;}
        }
        if(video.readyState<2)continue;
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
        if(useful(ctx,canvas.width,canvas.height)){
          const frame=transfer ? await createImageBitmap(canvas) : canvas;
          return {frame,time:video.currentTime};
        }
      }
      return null;
    } finally {
      video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(objectURL);
    }
  }
