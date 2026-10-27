'use strict';

const TYPE_LABEL = { run: 'Run key', winlogon: 'Winlogon', startup: 'Startup folder', task: 'Scheduled task', service: 'Service' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function hintList(hints) {
  if (!hints.length) return '';
  return `<ul class="hints">${hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`;
}

function entryBlock(e) {
  const meta = [];
  if (e.signature) meta.push(`signature: ${esc(e.signature)}`);
  if (e.exists === false) meta.push('target missing');
  for (const [k, v] of Object.entries(e.extra || {})) meta.push(`${esc(k)}: ${esc(v)}`);
  return `<div class="name">${esc(e.name)} <span class="type">${esc(TYPE_LABEL[e.type] || e.type)}</span></div>
<div class="key">${esc(e.key)}</div>
<code>${esc(e.command)}</code>
${meta.length ? `<div class="meta">${meta.join(' &middot; ')}</div>` : ''}`;
}

function changeTable(changes) {
  const rows = changes
    .map((c) => `<tr><td>${esc(c.field)}</td><td>${esc(c.before)}</td><td>${esc(c.after)}</td></tr>`)
    .join('');
  return `<table><tr><th>field</th><th>before</th><th>after</th></tr>${rows}</table>`;
}

function section(title, cls, items, render) {
  const body = items.length ? items.map(render).join('') : '<p class="none">none</p>';
  return `<section class="${cls}"><h2>${title} <span class="count">${items.length}</span></h2>${body}</section>`;
}

function renderHtml(diff) {
  const flagged = (r) => (r.hints.length ? ' flagged' : '');
  const added = section('Added', 'added', diff.added, (r) =>
    `<article class="card${flagged(r)}">${entryBlock(r.entry)}${hintList(r.hints)}</article>`);
  const removed = section('Removed', 'removed', diff.removed, (r) =>
    `<article class="card">${entryBlock(r.entry)}</article>`);
  const changed = section('Changed', 'changed', diff.changed, (r) =>
    `<article class="card${flagged(r)}">${entryBlock(r.after)}${changeTable(r.changes)}${hintList(r.hints)}</article>`);
  const looks = diff.added.filter((r) => r.hints.length).length + diff.changed.filter((r) => r.hints.length).length;
  const side = (s) => `${esc(s.host || 'unknown host')}, ${esc(s.collected || 'no timestamp')}, ${s.count} entries`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>autorun-diff report</title>
<style>
body{font-family:system-ui,sans-serif;margin:1em 2em;max-width:60em}
table{border-collapse:collapse;margin:.5em 0;width:100%}
th,td{border:1px solid #bbb;padding:2px 6px;text-align:left;vertical-align:top;word-break:break-all}
.card{border-top:1px solid #bbb;padding:.5em 0}
.type,.key,.meta{color:#555;font-size:small}
code{display:block;margin:.3em 0;white-space:pre-wrap;word-break:break-all}
.hints{margin:.5em 0 0}
.hints:before{content:"Worth a look (hints only, not verdicts):";display:block;margin-left:-1.5em}
.flagged .name{color:#a40000}
</style></head><body>
<h1>autorun-diff report</h1>
<p>old: ${side(diff.old)}<br>new: ${side(diff.new)}</p>
<p>${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed, ${diff.unchanged} unchanged, ${looks} with hints</p>
${added}${changed}${removed}
</body></html>
`;
}

function renderText(diff) {
  const lines = [];
  lines.push(`old: ${diff.old.host || '?'} ${diff.old.collected || ''} (${diff.old.count} entries)`);
  lines.push(`new: ${diff.new.host || '?'} ${diff.new.collected || ''} (${diff.new.count} entries)`);
  lines.push(`${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed, ${diff.unchanged} unchanged`);
  const hint = (hs) => hs.forEach((h) => lines.push(`      ? ${h}`));
  for (const r of diff.added) {
    lines.push('', `+ [${r.entry.type}] ${r.entry.key}`, `      ${r.entry.command}`);
    hint(r.hints);
  }
  for (const r of diff.changed) {
    lines.push('', `~ [${r.after.type}] ${r.after.key}`);
    for (const c of r.changes) lines.push(`      ${c.field}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`);
    hint(r.hints);
  }
  for (const r of diff.removed) lines.push('', `- [${r.entry.type}] ${r.entry.key}`, `      ${r.entry.command}`);
  return lines.join('\n') + '\n';
}

module.exports = { renderHtml, renderText };
