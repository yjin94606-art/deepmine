'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {start}=require('../scripts/server.cjs');

test('local survey reads earned metres and retires score submissions on upgraded installs',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'personal-survey-'));
  const project=path.join(directory,'sample'),save=path.join(directory,'save');
  await fs.mkdir(project);await fs.mkdir(save);
  await fs.writeFile(path.join(save,'config.json'),JSON.stringify({rankingURL:'https://retired.example'}));
  const instance=await start({projectPath:project,dataDirectory:save,quiet:true,port:0});
  t.after(async()=>{
    await new Promise(resolve=>{instance.server.close(resolve);instance.server.closeAllConnections();});
    await fs.rm(directory,{recursive:true,force:true});
  });
  const url='http://127.0.0.1:'+instance.port+'/api/daily-depth';
  const reading=await fetch(url);
  assert.equal(reading.status,200);
  const survey=await reading.json();
  assert.equal(survey.meters,0);
  assert.match(survey.day,/^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(survey.stamps,[]);
  assert.equal(survey.endpoint,undefined);
  const rejected=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Deepmine-Client':'daily-depth'},
    body:JSON.stringify({projectId:survey.projectId,endpoint:'https://retired.example'})});
  assert.equal(rejected.status,405);
  assert.equal((await fs.readdir(save)).includes('ranking.key'),false);
});
