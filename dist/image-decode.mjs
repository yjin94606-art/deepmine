// Keep ordinary images and document covers on the same local decode path.
export async function decodeImage(blob,signal){
  if(signal.aborted)throw Error('Image cancelled');
  if(typeof globalThis.createImageBitmap==='function'){
    try{
      const bitmap=await globalThis.createImageBitmap(blob);
      if(!signal.aborted)return bitmap;
      bitmap.close?.();
    }catch(error){if(signal.aborted)throw error;}
  }
  if(signal.aborted)throw Error('Image cancelled');
  const image=new Image(),url=URL.createObjectURL(blob);
  try{
    await new Promise((resolve,reject)=>{
      const cleanup=()=>{image.onload=image.onerror=null;signal.removeEventListener('abort',abort);};
      const abort=()=>{cleanup();image.removeAttribute('src');reject(Error('Image cancelled'));};
      signal.addEventListener('abort',abort,{once:true});
      image.onload=()=>{cleanup();resolve();};
      image.onerror=()=>{cleanup();reject(Error('Unreadable image'));};
      image.src=url;
    });
    return image;
  }finally{URL.revokeObjectURL(url);}
}
