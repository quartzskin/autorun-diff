#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { diffSnapshots } = require('../src/diff');
const { renderHtml, renderText } = require('../src/report');

const USAGE = `usage: autorun-diff <old.json> <new.json> [--html report.html] [--json]

  --html FILE   write a self-contained HTML report
  --json        print the diff as JSON instead of text
`;

function load(file) {
  // PowerShell 5.1 can write a BOM with Out-File; JSON.parse chokes on it
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${file}: invalid JSON (${err.message})`);
  }
}

function main(argv) {
  const files = [];
  let htmlOut = null;
  let asJson = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--html') htmlOut = argv[++i];
    else if (a === '--json') asJson = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write(USAGE);
      return 0;
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else files.push(a);
  }
  if (files.length !== 2 || (argv.includes('--html') && !htmlOut)) {
    process.stderr.write(USAGE);
    return 2;
  }

  const diff = diffSnapshots(load(files[0]), load(files[1]));
  if (htmlOut) fs.writeFileSync(htmlOut, renderHtml(diff));
  process.stdout.write(asJson ? JSON.stringify(diff, null, 2) + '\n' : renderText(diff));
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`autorun-diff: ${err.message}\n`);
  process.exitCode = 2;
}
