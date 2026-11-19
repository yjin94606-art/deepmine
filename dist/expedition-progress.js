(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./evidence-core.js'), require('./expedition-world.js'));
  else root.ExpeditionProgress = factory(root.EvidenceCore, root.ExpeditionWorld);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C, W) {
  'use strict';
  if (!C || !W || typeof C.project !== 'function' || typeof W.build !== 'function') throw new Error('请先加载 evidence-core.js 与 expedition-world.js。');
  const KINDS = Object.freeze(['code', 'document', 'asset', 'other']);
  const USAGE_FIELDS = Object.freeze(['inputTokens', 'cachedInputTokens', 'outputTokens', 'totalTokens', 'sessions']);
  const definitions = Object.freeze([
    { id: 'relay', name: '中继站', target: 3, unit: '天', basis: 'changed-days', effect: 'sonar-range', description: '本期记录 3 个有 Git 文件变更的工作日，布置中继站。' },
    { id: 'sorter', name: '分拣站', target: 4, unit: '类', basis: 'file-kinds', effect: 'visible-transport', description: '本期文件变更覆盖代码、文档、素材、其他四类，布置分拣站。' },
    { id: 'garden', name: '生态角', target: 3, unit: '种', basis: 'artifact-types', effect: 'ambient-life', description: '本期合法每日藏品覆盖 3 种造型，布置生态角；基础配方也计入。' }
  ].map(item => Object.freeze(item)));

  function offsetDate(date, offset) {
    const value = new Date(date + 'T12:00:00Z'); value.setUTCDate(value.getUTCDate() + offset);
    return value.toISOString().slice(0, 10);
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T12:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  const sorted = values => [...new Set(values)].sort();

  function canonicalWorld(snapshot, supplied, throughDate) {
    // Never trust a caller's counts, rules, projection, or stale world. Only recover
    // semantic envelopes, then use World's existing validation against current Git.
    const envelopes = [];
    if (supplied && typeof supplied === 'object' && !Array.isArray(supplied) &&
        (supplied.projectId === undefined || supplied.projectId === snapshot.project.id) && Array.isArray(supplied.artifacts)) {
      for (const item of supplied.artifacts.slice(0, 256)) {
        if (!item || item.semantic !== true || !validDate(item.date) || item.date > throughDate ||
            item.id !== `${snapshot.project.id}/${item.date}/artifact` ||
            (item.projectId !== undefined && item.projectId !== snapshot.project.id)) continue;
        envelopes.push({
          projectId: snapshot.project.id, date: item.date, fingerprint: item.fingerprint, source: item.source, generatedAt: item.generatedAt,
          result: { objectType: item.recipeId, name: item.name, summary: item.description, meaning: item.meaning, evidenceIds: item.evidenceIds }
        });
      }
    }
    return W.build(snapshot, undefined, envelopes);
  }

  function records(day, gitKnown) {
    const paths = new Map(), changedHashes = [];
    for (const entry of day.evidence) {
      if (entry.files.length) changedHashes.push(entry.hash);
      for (const file of entry.files) paths.set(file.path, file.kind);
    }
    const fileCounts = Object.fromEntries(KINDS.map(kind => [kind, gitKnown ? 0 : null]));
    for (const kind of paths.values()) fileCounts[kind]++;
    return {
      fileCount: gitKnown ? paths.size : null, fileCounts, paths: [...paths.keys()].sort(),
      changedHashes: sorted(changedHashes), evidenceIds: sorted(day.evidence.map(entry => entry.hash)),
      fileKinds: KINDS.filter(kind => fileCounts[kind] > 0)
    };
  }
  function copyArtifact(item) {
    if (!item) return null;
    return { id: item.id, recipeId: item.recipeId, name: item.name, description: item.description,
      source: item.source, semantic: item.semantic, evidenceIds: item.evidenceIds.slice() };
  }
  function summaryFor(record, usage, commits, demo) {
    const prefix = demo ? '演示（虚构）：' : '';
    const git = commits === null ? 'Git 记录尚不可用。' : record.fileCount > 0 ?
      `${commits} 条提交记录涉及 ${record.fileCount} 个去重文件，覆盖 ${record.fileKinds.length} 类。` :
      commits > 0 ? `${commits} 条提交记录未包含文件变更。` : '当日尚无已记录的 Git 文件变更。';
    const codex = usage.totalTokens === null ? 'Codex 总用量尚未完整观测。' : `已观测 Codex 总用量 ${usage.totalTokens} Token。`;
    return prefix + git + codex;
  }

  function build(input, suppliedWorld, _projection, throughDate) {
    const snapshot = C.validateSnapshot(input), projection = C.project(snapshot);
    const endDate = C.today(snapshot.collectedAt), startDate = offsetDate(endDate, 1 - C.PERIOD_DAYS);
    const cutoff = throughDate === undefined ? endDate : throughDate;
    if (!validDate(cutoff) || cutoff < startDate || cutoff > endDate ||
        (cutoff !== endDate && !projection.days.some(day => day.date === cutoff))) {
      throw new Error('进展截止日期必须是当前 14 日范围内的已投影日期或采集当日。');
    }
    const gitKnown = snapshot.sources.git.status === 'connected', demo = snapshot.mode === 'demo';
    const world = canonicalWorld(snapshot, suppliedWorld, cutoff);
    const artifacts = new Map(world.artifacts.filter(item => item.date <= cutoff).map(item => [item.date, item]));
    const rawDays = new Map(snapshot.days.map(day => [day.date, day]));
    const days = projection.days.filter(day => day.date <= cutoff).map(projected => {
      const day = rawDays.get(projected.date);
      return { day, projected, record: records(day, gitKnown), artifact: artifacts.get(day.date) || null };
    });
    const workDays = days.filter(item => item.record.fileCount > 0);
    const fileKinds = KINDS.filter(kind => workDays.some(item => item.record.fileCounts[kind] > 0));
    const artifactDays = workDays.filter(item => item.artifact);
    const artifactTypes = sorted(artifactDays.map(item => item.artifact.recipeId));
    const values = { relay: workDays.length, sorter: fileKinds.length, garden: artifactTypes.length };
    const tracks = definitions.map(definition => {
      const supportingDays = definition.id === 'garden' ? artifactDays : workDays;
      const references = supportingDays.flatMap(item => definition.id === 'garden' ? item.artifact.evidenceIds : item.record.changedHashes);
      let unlockedAt = null, depth = null, count = 0;
      const seenKinds = new Set(), seenTypes = new Set();
      for (const item of supportingDays) {
        count++;
        item.record.fileKinds.forEach(kind => seenKinds.add(kind));
        if (item.artifact) seenTypes.add(item.artifact.recipeId);
        const progress = definition.id === 'relay' ? count : definition.id === 'sorter' ? seenKinds.size : seenTypes.size;
        if (progress >= definition.target) { unlockedAt = item.day.date; depth = item.projected.depthEnd; break; }
      }
      const value = gitKnown ? values[definition.id] : null, unlocked = value !== null && value >= definition.target;
      return {
        ...definition, projectId: snapshot.project.id, value, progress: value === null ? null : Math.min(value, definition.target),
        unlocked, status: !gitKnown ? 'unavailable' : unlocked ? 'unlocked' : 'locked', source: demo ? 'demo' : 'git',
        dates: supportingDays.map(item => item.day.date), evidenceIds: sorted(references),
        fileKinds: definition.id === 'sorter' ? fileKinds.slice() : [],
        artifactTypes: definition.id === 'garden' ? artifactTypes.slice() : [],
        artifactSources: definition.id === 'garden' ? sorted(artifactDays.map(item => item.artifact.source)) : [],
        unlockedAt: unlocked ? unlockedAt : null, depth: unlocked ? depth : null
      };
    });
    const briefs = days.filter(item => gitKnown || item.day.usage.quality !== 'unavailable' || item.day.evidence.length).map(item => {
      const { day, record, projected } = item;
      const usage = Object.fromEntries(USAGE_FIELDS.map(key => [key, day.usage[key]]));
      const commits = gitKnown ? day.evidence.length : null, codexKnown = day.usage.quality !== 'unavailable';
      return {
        id: `${snapshot.project.id}/${day.date}/brief`, projectId: snapshot.project.id, date: day.date,
        source: demo ? 'demo' : gitKnown ? (codexKnown ? 'mixed' : 'git') : 'codex',
        usage, commits, fileCount: record.fileCount, fileCounts: { ...record.fileCounts }, paths: record.paths.slice(), evidenceIds: record.evidenceIds.slice(),
        depthStart: projected.depthStart, depthEnd: projected.depthEnd, artifact: copyArtifact(item.artifact),
        unlockedTrackIds: tracks.filter(track => track.unlockedAt === day.date).map(track => track.id),
        summary: summaryFor(record, usage, commits, demo)
      };
    });
    return { projectId: snapshot.project.id, mode: snapshot.mode, period: { startDate, endDate }, throughDate: cutoff, tracks, briefs };
  }

  return Object.freeze({ build, definitions });
});
