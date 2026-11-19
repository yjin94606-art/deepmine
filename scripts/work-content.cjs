'use strict';
const path = require('node:path');
const {describeText, TEXT_EXTENSIONS} = require('./text-content.cjs');
const {describeMedia, MEDIA_EXTENSIONS} = require('./media-content.cjs');
const {describeDocument, DOCUMENT_EXTENSIONS, DOCUMENT_LIMIT} = require('./document-content.cjs');
const {describeStructured, STRUCTURED_EXTENSIONS} = require('./structured-content.cjs');

const KIB = 1024;
const MEDIA_WINDOW = 1024 * KIB;
const STRUCTURED_LIMIT = 2 * 1024 * KIB;
const MEDIA_TAIL = new Set(['mp4','mov','m4a','m4v','zip','ogg','opus','mp3','wav']);
function planFor(filename,size) {
  const ext=path.extname(filename).slice(1).toLowerCase();
  if (DOCUMENT_EXTENSIONS.has(ext)) return size <= DOCUMENT_LIMIT ? {ext,read:DOCUMENT_LIMIT,kind:'document'} : null;
  if (MEDIA_EXTENSIONS.has(ext)) return {ext,read:MEDIA_WINDOW,tail:MEDIA_TAIL.has(ext)?MEDIA_WINDOW:0,kind:'media'};
  if (STRUCTURED_EXTENSIONS.has(ext)) return {ext,read:STRUCTURED_LIMIT,kind:'structured'};
  if (TEXT_EXTENSIONS.has(ext)) return {ext,read:96*KIB,kind:'text'};
  return null;
}
function publicPath(filename) {
  return filename && !filename.includes('\\') && !/^[A-Za-z]:/.test(filename) &&
    filename.split('/').every(part=>part && !part.startsWith('.') && !/^(?:node_modules|vendor|__pycache__)$/i.test(part)) &&
    !/(?:credentials?|secrets?|passwords?|api[_-]?keys?|auth[_-]?tokens?|(?:^|\/)id_(?:rsa|ed25519)|\.(?:pem|key|p12|pfx|kdbx)$)/i.test(filename);
}
function fromParts(filename,size,plan,head,tail) {
  if (!plan || !publicPath(filename)) return null;
  try {
    let result;
    if (plan.kind==='document') result=describeDocument(head,plan.ext,filename);
    else if (plan.kind==='media') result=describeMedia(head,plan.ext,filename,{size,tail:tail?.length?tail:undefined});
    else if (plan.kind==='structured') result=describeStructured(head,plan.ext,filename,size>head.length);
    else result=describeText(head,plan.ext,filename,size>head.length);
    if (!result || typeof result.title!=='string' || typeof result.summary!=='string') return null;
    const clean=(str,len)=>str.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,len);
    const title=clean(result.title,150), summary=clean(result.summary,480);
    return title && summary ? {title,summary}:null;
  } catch { return null; }
}
// Capture small excerpts from the same stream that produced the file fingerprint.
function captureContent(filename,size) {
  const plan=publicPath(filename) && planFor(filename,size);
  if (!plan) return null;
  const heads=[], tails=[];
  let kept=0,tailBytes=0;
  return {
    push(chunk) {
      const take=Math.min(chunk.length,plan.read-kept);
      if (take>0) {heads.push(chunk.subarray(0,take));kept+=take;}
      if (plan.tail && size>plan.read) {
        tails.push(chunk);tailBytes+=chunk.length;
        while (tailBytes-tails[0].length>=plan.tail) tailBytes-=tails.shift().length;
      }
    },
    result() {
      const tail=tailBytes ? Buffer.concat(tails,tailBytes).subarray(-plan.tail) : undefined;
      return fromParts(filename,size,plan,Buffer.concat(heads,kept),tail);
    }
  };
}
function describeBytes(filename,bytes) {
  const plan=publicPath(filename) && planFor(filename,bytes.length);
  if (!plan) return null;
  return fromParts(filename,bytes.length,plan,bytes.subarray(0,plan.read),plan.tail ? bytes.subarray(-plan.tail):undefined);
}
module.exports={captureContent,describeBytes,planFor,publicPath};
