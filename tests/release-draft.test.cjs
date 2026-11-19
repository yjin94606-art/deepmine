'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {stageDraft} = require('../scripts/release-draft.cjs');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'deepmine-draft-'));
  t.after(() => fs.rm(directory, {recursive:true, force:true}));
  let sums = '';
  for (const kind of ['source.zip', 'windows-x64-setup.exe', 'windows-x64.zip']) {
    const name = 'deepmine-v1.2.0-' + kind;
    await fs.writeFile(path.join(directory, name), kind);
    sums += createHash('sha256').update(kind).digest('hex') + '  ' + name + '\n';
  }
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), sums);
  const releases = [], assets = [];
  const notes = (await fs.readFile(path.join(__dirname, '../docs/launch/release-en.md'), 'utf8')).trim();
  const api = {
    getCommit: async ({ref}) => { assert.equal(ref,'tags/v1.2.0'); return {data:{sha:'tested'}}; },
    listReleases: async () => releases,
    createRelease: async data => {
      assert.equal(data.draft,true);assert.equal(data.body,notes);
      const release = {...data, id:12, html_url:'draft'};
      releases.push(release);
      return {data:release};
    },
    getRelease: async ({release_id}) => ({data:releases.find(r => r.id === release_id)}),
    listReleaseAssets: async () => assets,
    uploadReleaseAsset: async ({release_id, name, data}) => {
      assert.equal(release_id,12);
      assert.ok(!assets.some(a=>a.name===name));
      const asset = {name,state:'uploaded',digest:'sha256:' + createHash('sha256').update(data).digest('hex')};
      assets.push(asset);
      return {data:asset};
    }
  };
  const options = {repo:{owner:'owner', repo:'mine'}, directory, tag:'v1.2.0', version:'1.2.0', commit:'tested',
    github:{rest:{repos:api}, paginate:(fn,params)=>fn(params)}};
  return {options, releases, assets, api};
}
test('tag, commit and local checksums must all match before creating a draft', async t=>{
  const {options,releases} = await fixture(t);
  await assert.rejects(stageDraft({...options,tag:'v9.9.9'}), /Tag and package/);
  await assert.rejects(stageDraft({...options,commit:'different'}), /tag has moved/);
  await fs.appendFile(path.join(options.directory,'deepmine-v1.2.0-source.zip'),'changed');
  await assert.rejects(stageDraft(options), /checksums/);
  assert.equal(releases.length,0);
});
test('an interrupted draft can resume and repeat without changing any verified asset',async t=>{
  const {options, releases, assets, api} = await fixture(t);
  const upload = api.uploadReleaseAsset;
  api.uploadReleaseAsset = args => assets.length === 1 ? Promise.reject(Error('offline')) : upload(args);
  await assert.rejects(stageDraft(options), /offline/);
  assert.equal(assets.length,1);
  api.uploadReleaseAsset = upload;
  await stageDraft(options);
  await stageDraft(options);
  assert.equal(releases.length,1);
  assert.equal(assets.length,4);
  releases[0].draft=false;
  await stageDraft(options);
  assets.pop();
  await assert.rejects(stageDraft(options), /Published release/);
  assert.equal(assets.length,3);
});
test('conflicting assets and externally published drafts are preserved',async t=>{
  const {options, releases, assets, api} = await fixture(t);
  await stageDraft(options);
  assets[1].digest='sha256:conflict';
  await assert.rejects(stageDraft(options),/differs/);
  assert.equal(assets[1].digest,'sha256:conflict');
  assets.splice(1);
  api.getRelease = async () => ({data:{...releases[0],draft:false}});
  await assert.rejects(stageDraft(options), /Draft state changed/);
  assert.equal(assets.length,1);
});
