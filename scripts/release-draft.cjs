'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');

const manifestName = 'SHA256SUMS.txt';
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

async function stageDraft({github, repo, directory, tag, version, commit, body}) {
  if (tag !== 'v' + version || !/^v\d+\.\d+\.\d+$/.test(tag)) throw Error('Tag and package version must agree');
  if (body === undefined) body = (await fs.readFile(path.join(__dirname, '../docs/launch/release-en.md'), 'utf8')).trim();
  if(typeof body!=='string'||!body.trim())throw Error('Release notes are required');
  const stem = 'deepmine-' + tag;
  const names = [stem + '-source.zip', stem + '-windows-x64-setup.exe', stem + '-windows-x64.zip'];
  const checksums = await fs.readFile(path.join(directory, manifestName));
  let expected = '';
  const hashes = new Map();
  for (const name of names) {
    const hash = digest(await fs.readFile(path.join(directory, name)));
    hashes.set(name, hash);
    expected += hash.slice(7) + '  ' + name + '\n';
  }
  if (expected !== checksums.toString('utf8')) throw Error('Release checksums do not match the verified downloads');
  hashes.set(manifestName, digest(checksums));

  const api = github.rest.repos;
  const resolved = await api.getCommit({...repo, ref:'tags/' + tag});
  if (resolved.data.sha !== commit) throw Error('The tested tag has moved. Restart verification for its current commit.');
  const matches = (await github.paginate(api.listReleases, {...repo, per_page:100})).filter(r => r.tag_name === tag);
  if (matches.length > 1) throw Error('More than one release matches this tag. Review the drafts.');
  const release = matches[0] || (await api.createRelease({...repo, tag_name:tag, target_commitish:commit,
    name:'Deepmine ' + tag, draft:true, body})).data;
  const target = {...repo, release_id:release.id};
  const existing = await github.paginate(api.listReleaseAssets, {...target, per_page:100});
  const missing = new Set(hashes.keys());
  for (const asset of existing) {
    if (!missing.delete(asset.name) || asset.state !== 'uploaded' || asset.digest !== hashes.get(asset.name)) {
      throw Error('Existing release asset differs from the verified build: ' + asset.name);
    }
  }
  if (!release.draft && missing.size) throw Error('Published release is incomplete. Review it manually.');
  for (const name of missing) {
    const fresh = (await api.getRelease(target)).data;
    if (!fresh.draft || fresh.tag_name !== tag) throw Error('Draft state changed while staging. Review it manually.');
    const data = await fs.readFile(path.join(directory, name));
    const uploaded = await api.uploadReleaseAsset({...target, name, data,
      headers:{'content-type':name === manifestName ? 'text/plain' : name.endsWith('.exe') ? 'application/octet-stream' : 'application/zip'}});
    if (uploaded.data.digest !== hashes.get(name) || uploaded.data.state !== 'uploaded') {
      throw Error('GitHub did not confirm the expected upload digest for ' + name);
    }
  }
  return release.html_url;
}
module.exports = {stageDraft};
