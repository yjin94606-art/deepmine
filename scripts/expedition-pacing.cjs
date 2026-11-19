'use strict';

const Evidence = require('../dist/evidence-core.js');
const Findings = require('../dist/work-findings.js');

function relativeKey(item) {
  return item.id.split('/').slice(-2).join('/');
}

// Offsets are relative to their day. Adding evidence on a previous day can
// move the whole layer without rearranging discoveries within that layer.
function pinDiscoveries(snapshot, previous) {
  const today = Evidence.today(snapshot.collectedAt, snapshot.timezone);
  const oldDays = new Map((previous?.days || []).map(day => [day.date, day]));
  const projection = Evidence.project(snapshot);
  const spans = new Map(projection.days.map(day => [day.date, day]));
  const findings = new Map();
  for (const item of Findings.build(snapshot)) {
    if (item.date < snapshot.history.pacingFrom) continue;
    if (!findings.has(item.date)) findings.set(item.date, []);
    findings.get(item.date).push(item);
  }
  let previousFront = 0;
  let migration = {};
  if (previous?.mining) {
    const oldSpan = Evidence.project(previous).days.find(day => day.date === today);
    if (oldSpan) {
      previousFront = Math.max(0, previous.mining.excavatedDepth - oldSpan.depthStart);
      if (!previous.history?.pacingFrom) {
        migration = Object.fromEntries(Findings.build(previous)
          .filter(item => item.date === today && item.depth <= previous.mining.excavatedDepth)
          .map(item => [relativeKey(item), item.depth - oldSpan.depthStart]));
      }
    }
  }
  for (const day of snapshot.days) {
    const items = findings.get(day.date);
    if (!items?.length) continue;
    const {depthStart, depthEnd} = spans.get(day.date);
    const span = depthEnd - depthStart;
    const existing = oldDays.get(day.date)?.placements || (day.date === today ? migration : {});
    const offsets = {};
    const remaining = [];
    for (const item of items) {
      const key = relativeKey(item);
      if (Object.hasOwn(existing, key)) offsets[key] = Math.min(span, existing[key]);
      else remaining.push(key);
    }
    const frontier = Math.min(span, Math.max(day.date === today ? previousFront : 0, ...Object.values(offsets)));
    remaining.forEach((key, index) => {
      offsets[key] = frontier + (span - frontier) * (index + 0.85) / (remaining.length + 0.35);
    });
    day.placements = offsets;
  }
}

const thresholds = [20, 80, 160];
function radioForDay(radio, date) {
  return radio?.date === date ? radio : {date, meters: 0, items: []};
}
function radioProgress(radio) {
  return {date: radio.date, meters: radio.meters, slots: thresholds.filter(m => radio.meters >= m).length, claimed: radio.items.length};
}
module.exports = {pinDiscoveries, radioForDay, radioProgress};
