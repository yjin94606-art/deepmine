(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.WorkSketch=factory();
})(globalThis,function(){
  'use strict';
  // The writer returns palette cells, never markup or drawing commands.
  const palette=['#302b42','#655366','#a27d73','#dba665','#ffe6a0','#fff5dd','#b95759','#f3896d',
    '#33595c','#51a080','#a1c277','#446d94','#84c6ce','#9269a9','#d6a1c8'];
  const symbols='123456789ABCDEF';
  // Identical file bytes can be delivered in different conversations or on different days.
  function illustrationKey(itemId,memberKey,sourceKey,locale,mode){return JSON.stringify([itemId,memberKey,sourceKey,locale,mode]);}
  function rows(value){
    if(!Array.isArray(value)||value.length<6||value.length>32||
      value.some(line=>typeof line!=='string'||line.length>32||!/^[.1-9A-F]*$/.test(line)))return null;
    const width=Math.max(...value.map(line=>line.length));
    let left=width,right=-1,top=value.length,bottom=-1,count=0;
    const used=new Set();
    for(let y=0;y<value.length;y++)for(let x=0;x<value[y].length;x++){
      const cell=value[y][x];if(cell==='.')continue;
      used.add(cell);count++;left=Math.min(left,x);right=Math.max(right,x);
      top=Math.min(top,y);bottom=Math.max(bottom,y);
    }
    if(right-left<5||bottom-top<5||count<20||used.size<2||count>=(right-left+1)*(bottom-top+1)*.97)return null;
    return value.slice(top,bottom+1).map(line=>line.padEnd(right+1,'.').slice(left,right+1));
  }
  function paint(value,makeCanvas){
    const lines=rows(value);if(!lines)return null;
    const canvas=makeCanvas();canvas.width=lines[0].length+2;canvas.height=lines.length+2;
    const ctx=canvas.getContext('2d');if(!ctx)return null;
    lines.forEach((line,y)=>{
      for(let x=0;x<line.length;x++){
        const color=symbols.indexOf(line[x]);if(color<0)continue;
        ctx.fillStyle=palette[color];ctx.fillRect(x+1,y+1,1,1);
      }
    });
    return canvas;
  }
  return Object.freeze({rows,paint,illustrationKey});
});
