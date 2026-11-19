(function(root){
  'use strict';
  function draw(ctx,item,depth,gallery){
    if(!gallery)return;
    const distance=Math.max(0,depth-item.depth),stage=distance>=32?3:distance>=12?2:distance>=3?1:0;
    const w=Math.max(12,Math.min(82,item.artWidth||34)),x=Math.round(item.x),left=x-Math.ceil(w/2),right=left+w;
    const y=Math.round(item.y)+1,h=Math.max(12,Math.min(42,item.artHeight||24));
    const tile=gallery.upgraded('tile'),lamp=gallery.upgraded('lamp');
    const box=(a,b,c,d,color)=>{ctx.fillStyle=color;ctx.fillRect(a,b,c,d);};
    ctx.save();
    if(stage){
      const edge=tile?'#8ad6c1':'#dda46e',face=tile?'#40827e':'#966344',shadow=tile?'#284a51':'#573e38';
      box(left-2,y-1,w+4,5,'#382f3b'); box(left-1,y-1,w+2,2,edge);box(left,y+1,w,2,face);
      for(let i=5;i<w;i+=tile?9:17)box(left+i,y,1,3,shadow);
      if(stage>=2){
        for(const [end,dir] of [[left+2,1],[right-4,-1]]){
          box(end,y+3,3,8,shadow);box(end+1,y+3,1,6,face);
          for(let i=0;i<4;i++)box(end+dir*(i+1)*2,y+8-i*2,3,2,face);
          box(end+1,y+1,1,1,'#f2d995');
        }
      }
      if(stage>=3){
        const beam=item.x>0?right-2:left;
        box(beam,y-h,3,h,shadow);box(beam+1,y-h+1,1,h-2,face);
        box(beam-3,y-h-1,9,2,edge);
      }
      if(lamp){
        const a=item.x<0?right-4:left+3,b=y-h;
        box(a,b,1,5,'#ab926c');box(a-2,b+4,5,1,'#e4b77a');
        box(a-2,b+5,5,6,'#5f493e');box(a-1,b+5,3,4,'#ffe59b');box(a,b+6,1,2,'#fff3cd');
        if(ctx.createRadialGradient){
          const glow=ctx.createRadialGradient(a,b+6,1,a,b+6,17);
          glow.addColorStop(0,'rgba(255,202,107,.25)');glow.addColorStop(1,'rgba(255,190,93,0)');
          ctx.fillStyle=glow;ctx.fillRect(a-17,b-11,34,34);
        }
      }
    }
    if(gallery.editing()===item.id){
      const c='#ffe396';
      for(const [a,dir] of [[left-4,1],[right+4,-1]]){
        box(a-(dir<0?5:0),y+5,6,2,c);box(a,y+1,2,4,c);
        box(a-(dir<0?5:0),y-h-5,6,2,c);box(a,y-h-5,2,5,c);
      }
    }
    ctx.restore();
  }
  root.GalleryArt={draw};
})(globalThis);
