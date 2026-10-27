# autorun-diff

Take a snapshot of the places Windows starts things from, take another one later, and see what changed. Meant for lab VMs and machines you are allowed to look at, e.g. before and after running a sample or installing something.

There are two parts:

- `collector/Collect-Autoruns.ps1` is a PowerShell 5.1 script that reads the startup-related configuration and writes a JSON snapshot. It only reads: registry values, directory listings, the task scheduler, and signature checks on the target files. It does not write anything except the output file you ask for.
- `bin/autorun-diff.js` is a Node.js CLI (no dependencies) that compares two snapshots and prints the result, optionally as a standalone HTML report.

## What gets collected

- Run and RunOnce keys under HKLM, HKLM\WOW6432Node and HKCU
- Winlogon `Shell` and `Userinit`
- The per-user and common Startup folders (`.lnk` files are resolved to their target)
- Scheduled tasks, one entry per executable action
- Services (read from the registry, not WMI); kernel and filesystem drivers are skipped

For each entry it records the raw command, the guessed target executable, whether that file exists, and its Authenticode status.

## Usage

```
powershell -ExecutionPolicy Bypass -File collector\Collect-Autoruns.ps1 -OutFile before.json
:: ... do the thing you want to observe ...
powershell -ExecutionPolicy Bypass -File collector\Collect-Autoruns.ps1 -OutFile after.json

node bin\autorun-diff.js before.json after.json --html report.html
```

Without `-OutFile` the collector prints JSON to stdout. The CLI prints a text summary, or the diff as JSON with `--json`. Exit code is 0 on success and 2 on bad arguments or unreadable input; it does not signal "something suspicious was found".

Two made-up snapshots are in `samples/`, and the report they produce is checked in as `docs/report.html`:

```
node bin\autorun-diff.js samples\baseline.json samples\after.json --html report.html
```

## Hints

Added entries, and changed entries whose command, target or signature moved, get short hints when something looks unusual: the target is in a user-writable location (AppData, Public, Downloads, Windows\Temp, ProgramData), the file is missing, it is unsigned or has a bad signature, the command uses an encoded PowerShell string or a script host such as `wscript` or `mshta`, or it contains a URL. For changes, a different target path or a lost valid signature is also noted.

These are prompts to go and look, nothing more. Plenty of legitimate software lives in AppData or ProgramData, and plenty of malware is signed.

## Tests

```
node --test test/*.test.js
```

CI (`.github/workflows/ci.yml`) runs the tests on windows-latest, runs the collector there, and diffs its output against the sample baseline to make sure the whole pipeline works.

## Known gaps

- Not covered: Startup/approved-run state (`StartupApproved`), IFEO debuggers, AppInit_DLLs, Winlogon notify, WMI event subscriptions, COM hijacks, browser extensions, drivers, and other users' HKCU hives.
- The target is guessed from the command line with a regex. Odd quoting or `cmd /c` wrappers can give the wrong executable, and for those the "missing" and "unsigned" hints are about the wrong file.
- Only the first executable is checked. Whatever a script or DLL loads afterwards is not.
- Signature checks run `Get-AuthenticodeSignature` on every distinct target, which can be slow on a cold machine. A run on a Windows 11 box (400 entries, PowerShell 5.1, not elevated) took about 3 seconds.
- Scheduled tasks need `Get-ScheduledTask`; if it fails the collector records a warning in the snapshot and carries on. It has only been run non-elevated so far; the elevated case is untested.
- Entries are matched by type and key. A renamed registry value shows up as one removal and one addition.
- `docs/report.html` is a rendered example from the sample data; there is no screenshot.
