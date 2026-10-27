'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { diffSnapshots } = require('../src/diff');
const { hintsFor } = require('../src/hints');
const { renderHtml } = require('../src/report');

const sample = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'samples', n), 'utf8'));
const cli = path.join(__dirname, '..', 'bin', 'autorun-diff.js');

function entry(over) {
  return { type: 'run', key: 'HKCU:\\Run\\x', name: 'x', command: 'c', target: 'C:\\Program Files\\x\\x.exe', exists: true, signature: 'Valid', extra: {}, ...over };
}

test('sample diff finds the expected adds, removes and changes', () => {
  const d = diffSnapshots(sample('baseline.json'), sample('after.json'));
  assert.deepStrictEqual(d.added.map((r) => r.entry.name).sort(), ['DriverCheck', 'Fax2', 'Updater2', 'WinSvcHelper', 'report.lnk']);
  assert.deepStrictEqual(d.removed.map((r) => r.entry.name), ['OldUpdater']);
  assert.deepStrictEqual(d.changed.map((r) => r.after.name).sort(), ['ContosoAgent', 'ContosoSync']);
  assert.strictEqual(d.unchanged, 9);
});

test('identical snapshots produce an empty diff', () => {
  const s = sample('baseline.json');
  const d = diffSnapshots(s, s);
  assert.strictEqual(d.added.length + d.removed.length + d.changed.length, 0);
});

test('keys match case-insensitively', () => {
  const a = { entries: [entry({ key: 'HKCU:\\Run\\Foo' })] };
  const b = { entries: [entry({ key: 'hkcu:\\run\\foo' })] };
  const d = diffSnapshots(a, b);
  assert.strictEqual(d.unchanged, 1);
});

test('an extra-only change is reported but gets no hints', () => {
  const a = { entries: [entry({ extra: { state: 'Ready' } })] };
  const b = { entries: [entry({ extra: { state: 'Disabled' } })] };
  const d = diffSnapshots(a, b);
  assert.strictEqual(d.changed.length, 1);
  assert.strictEqual(d.changed[0].changes[0].field, 'extra.state');
  assert.deepStrictEqual(d.changed[0].hints, []);
});

test('a changed service path into ProgramData with no signature is hinted', () => {
  const d = diffSnapshots(sample('baseline.json'), sample('after.json'));
  const hints = d.changed.find((r) => r.after.name === 'ContosoAgent').hints.join('|');
  assert.match(hints, /ProgramData/);
  assert.match(hints, /not signed/);
  assert.match(hints, /earlier snapshot/);
});

test('hints', () => {
  assert.deepStrictEqual(hintsFor(entry()), []);
  assert.match(hintsFor(entry({ target: 'C:\\Users\\bob\\AppData\\Roaming\\a\\b.exe' }))[0], /AppData/);
  assert.match(hintsFor(entry({ exists: false, signature: null })).join(), /not found/);
  assert.match(hintsFor(entry({ signature: 'HashMismatch' })).join(), /HashMismatch/);
  assert.match(hintsFor(entry({ command: 'powershell.exe -nop -enc AAAA' })).join(), /encoded/);
  assert.match(hintsFor(entry({ command: '"C:\\Windows\\System32\\wscript.exe" C:\\Users\\Public\\r.vbs' })).join(), /Public/);
});

test('malformed input is rejected', () => {
  assert.throws(() => diffSnapshots({}, { entries: [] }), /old: not a snapshot/);
  assert.throws(() => diffSnapshots({ entries: [] }, { entries: [{ name: 'a' }] }), /without type\/key/);
});

test('html report escapes content and is self-contained', () => {
  const a = { entries: [] };
  const b = { entries: [entry({ name: '<script>alert(1)</script>', command: 'a & b' })] };
  const html = renderHtml(diffSnapshots(a, b));
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!/<link|src=|https?:\/\//i.test(html));
});

test('cli writes text, json and html', () => {
  const s = (n) => path.join(__dirname, '..', 'samples', n);
  const out = path.join(require('node:os').tmpdir(), `autorun-diff-${process.pid}.html`);
  const text = execFileSync(process.execPath, [cli, s('baseline.json'), s('after.json'), '--html', out], { encoding: 'utf8' });
  assert.match(text, /5 added, 1 removed, 2 changed, 9 unchanged/);
  assert.ok(fs.readFileSync(out, 'utf8').startsWith('<!doctype html>'));
  fs.unlinkSync(out);
  const json = JSON.parse(execFileSync(process.execPath, [cli, s('baseline.json'), s('after.json'), '--json'], { encoding: 'utf8' }));
  assert.strictEqual(json.added.length, 5);
});

test('cli exits 2 on bad usage and bad files', () => {
  assert.strictEqual(spawnSync(process.execPath, [cli]).status, 2);
  const r = spawnSync(process.execPath, [cli, 'nope.json', 'nope2.json'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /autorun-diff:/);
});
