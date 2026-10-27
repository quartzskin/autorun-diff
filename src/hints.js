'use strict';

const WRITABLE = [
  [/\\users\\[^\\]+\\appdata\\(local\\temp|roaming|local)\\/i, 'points into a per-user AppData folder'],
  [/\\users\\public\\/i, 'points into C:\\Users\\Public'],
  [/\\users\\[^\\]+\\(downloads|desktop|documents)\\/i, 'points into a user download/desktop/documents folder'],
  [/\\windows\\temp\\/i, 'points into the Windows temp folder'],
  [/\\programdata\\/i, 'points into ProgramData, which is writable by ordinary users in many setups'],
  [/\\\$recycle\.bin\\/i, 'points into the recycle bin'],
];

const LOLBINS = /(^|[\\"\s])(mshta|wscript|cscript|regsvr32|rundll32|certutil|bitsadmin|msiexec)(\.exe)?["\s]/i;
const ENCODED_PS = /powershell(\.exe)?["\s].*\s-(e|ec|enc|encodedcommand)\s/i;
const REMOTE_URL = /https?:\/\/|\\\\[^\\]+\\/i;

function hintsFor(entry, previous) {
  const out = [];
  const target = entry.target || '';
  const cmd = entry.command || '';

  for (const [re, text] of WRITABLE) {
    if (re.test(target) || re.test(cmd)) {
      out.push(text);
      break;
    }
  }
  if (entry.exists === false) out.push('target file was not found on disk');
  if (entry.exists && entry.signature && entry.signature !== 'Valid') {
    const label = entry.signature === 'NotSigned' ? 'target is not signed' : `signature status is ${entry.signature}`;
    out.push(label);
  }
  if (ENCODED_PS.test(cmd)) out.push('PowerShell with an encoded command');
  else if (LOLBINS.test(cmd)) out.push('launched through a script host or a common living-off-the-land binary');
  if (REMOTE_URL.test(cmd)) out.push('command contains a URL or UNC path');

  if (previous && previous.target && entry.target && previous.target.toLowerCase() !== entry.target.toLowerCase()) {
    out.push('target path differs from the earlier snapshot');
  }
  if (previous && previous.signature === 'Valid' && entry.signature && entry.signature !== 'Valid') {
    out.push('was validly signed in the earlier snapshot');
  }
  return out;
}

module.exports = { hintsFor };
