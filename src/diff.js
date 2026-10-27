'use strict';

const { hintsFor } = require('./hints');

const COMPARED = ['command', 'target', 'exists', 'signature'];

function validate(snap, label) {
  if (!snap || typeof snap !== 'object' || !Array.isArray(snap.entries)) {
    throw new Error(`${label}: not a snapshot (no "entries" array)`);
  }
  for (const e of snap.entries) {
    if (typeof e.type !== 'string' || typeof e.key !== 'string') {
      throw new Error(`${label}: entry without type/key`);
    }
  }
}

function indexEntries(snap) {
  const map = new Map();
  for (const e of snap.entries) map.set(`${e.type}|${e.key.toLowerCase()}`, e);
  return map;
}

function sameValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function fieldChanges(before, after) {
  const out = [];
  for (const f of COMPARED) {
    if (!sameValue(before[f], after[f])) out.push({ field: f, before: before[f] ?? null, after: after[f] ?? null });
  }
  const extras = new Set([...Object.keys(before.extra || {}), ...Object.keys(after.extra || {})]);
  for (const k of [...extras].sort()) {
    const b = (before.extra || {})[k];
    const a = (after.extra || {})[k];
    if (!sameValue(b, a)) out.push({ field: `extra.${k}`, before: b ?? null, after: a ?? null });
  }
  return out;
}

function diffSnapshots(oldSnap, newSnap) {
  validate(oldSnap, 'old');
  validate(newSnap, 'new');
  const a = indexEntries(oldSnap);
  const b = indexEntries(newSnap);
  const added = [];
  const removed = [];
  const changed = [];
  let unchanged = 0;

  for (const [id, entry] of b) {
    const prev = a.get(id);
    if (!prev) {
      added.push({ entry, hints: hintsFor(entry) });
      continue;
    }
    const changes = fieldChanges(prev, entry);
    if (changes.length === 0) {
      unchanged++;
      continue;
    }
    const commandMoved = changes.some((c) => c.field === 'command' || c.field === 'target');
    const hints = commandMoved || changes.some((c) => c.field === 'signature' || c.field === 'exists')
      ? hintsFor(entry, prev)
      : [];
    changed.push({ before: prev, after: entry, changes, hints });
  }
  for (const [id, entry] of a) if (!b.has(id)) removed.push({ entry });

  const order = (x, y) => x.localeCompare(y);
  const key = (r) => `${(r.entry || r.after).type}|${(r.entry || r.after).key}`;
  for (const list of [added, removed, changed]) list.sort((x, y) => order(key(x), key(y)));

  return {
    old: { host: oldSnap.host ?? null, collected: oldSnap.collected ?? null, count: oldSnap.entries.length },
    new: { host: newSnap.host ?? null, collected: newSnap.collected ?? null, count: newSnap.entries.length },
    added,
    removed,
    changed,
    unchanged,
  };
}

module.exports = { diffSnapshots };
