'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');

async function verifySample(directory,channel){
  const base='/deepmine/';
  const releases='https://github.com/yjin94606-art/deepmine/releases/latest';
  const mime={'.js':'application/javascript','.mjs':'application/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
  const files=new Set();
  for(const entry of await fs.readdir(directory,{withFileTypes:true,recursive:true})){
    if(entry.isDirectory()){assert.equal(entry.name,'demo-assets');continue;}
    assert.ok(entry.isFile());
    const file=path.relative(directory,path.join(entry.parentPath||entry.path,entry.name)).split(path.sep).join('/');
    assert.ok(mime[path.extname(file)],'Unexpected hosted file '+file);
    assert.ok(!/^(welcome|vision|config|\.deepmine)/.test(file),'Unexpected local-only asset '+file);
    files.add(file);
  }
  const missing=[],errors=[],requested=[];
  const server=http.createServer(async(req,res)=>{
    const route=new URL(req.url,'http://localhost').pathname;
    const file=route===base?'index.html':route.startsWith(base)?route.slice(base.length):'';
    if(!files.has(file)){missing.push(route);res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]});res.end(await fs.readFile(path.join(directory,file)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    const site='http://127.0.0.1:'+server.address().port+base;
    browser=await chromium.launch(channel?{channel}:{});
    const context=await browser.newContext({locale:'en-US',viewport:{width:360,height:740},hasTouch:true,reducedMotion:'reduce'});
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>requested.push(request.url()));
    await page.addInitScript(()=>{
      window.samplePolicyErrors=[];
      document.addEventListener('securitypolicyviolation',event=>window.samplePolicyErrors.push(event.effectiveDirective+' '+event.blockedURI));
    });
    await page.goto(site);
    await page.locator('#discoveryStage[open]').waitFor();
    assert.equal(await page.evaluate(()=>window.DeepmineApp.getState().mode),'demo');
    assert.match(await page.locator('#stageContent').innerText(),/hair clip/i);
    assert.equal(await page.getByRole('link',{name:'Download Deepmine'}).getAttribute('href'),releases);
    await page.locator('[data-stage-record]').click();
    await page.waitForFunction(()=>[...document.querySelectorAll('#detailDialog[open] img')].some(img=>img.naturalWidth>0));
    await page.locator('#detailDialog [data-close]').click();
    const firstDepth=await page.evaluate(()=>window.DeepmineApp.getState().visualDepth);
    await page.locator('#stageContinue').click();
    await page.waitForFunction(depth=>window.DeepmineApp.getState().visualDepth>depth,firstDepth);
    assert.deepEqual(await page.evaluate(()=>window.samplePolicyErrors),[]);
    assert.ok(requested.some(url=>url===site+'demo-assets/sample-02.png'));
    assert.ok(requested.every(url=>url.startsWith(site)||url.startsWith('blob:')),requested.join('\n'));
    assert.deepEqual(missing,[]);
    assert.deepEqual(errors,[]);
    await page.goto(site+'index.html?demo=0');
    await page.locator('#discoveryStage[open]').waitFor();
    let downloadClick=false;
    await page.route(releases,route=>{downloadClick=true;return route.fulfill({status:200,contentType:'text/html',body:'Public release'});});
    await page.getByRole('link',{name:'Download Deepmine'}).click();
    await page.waitForURL(releases);
    assert.ok(downloadClick);
    assert.ok(requested.every(url=>url===releases||url.startsWith(site)||url.startsWith('blob:')));
    assert.deepEqual(missing,[]);
    console.log(files.size+' static files. The nested sample revealed its portrait, displayed its original image, resumed digging and opened Releases with zero API requests.');
  }finally{
    await browser?.close();
    await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  }
}
if(require.main===module)verifySample(path.resolve(process.argv[2]),process.argv[3]).catch(error=>{console.error(error);process.exitCode=1;});
