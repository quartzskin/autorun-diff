#requires -Version 5.1
# Read-only: only reads registry, files and the task scheduler. Prints JSON to stdout, or writes it to -OutFile.
param(
    [string]$OutFile
)

$ErrorActionPreference = 'Continue'
$exts = 'exe|dll|bat|cmd|ps1|vbs|vbe|js|jse|wsf|com|scr|sys|cpl|msi|hta'
$sigCache = @{}
$warnings = New-Object System.Collections.ArrayList

function Get-Target([string]$cmd) {
    if (-not $cmd) { return $null }
    $c = $cmd.Trim()
    $c = $c -replace '^\\\?\?\\', ''
    $c = $c -replace '^\\SystemRoot', '%SystemRoot%'
    if ($c -match '^(?i)system32\\') { $c = '%SystemRoot%\' + $c }
    $c = [Environment]::ExpandEnvironmentVariables($c)
    if ($c -match '^"([^"]+)"') { return $Matches[1] }
    if ($c -match "^(?i)(.+?\.($exts))(\s|$)") { return $Matches[1] }
    if ($c -match '^\S+') { return $Matches[0] }
    return $null
}

function Get-FileInfo([string]$target) {
    $r = @{ exists = $null; signature = $null }
    if (-not $target -or $target -notmatch '^[A-Za-z]:\\') { return $r }
    $r.exists = Test-Path -LiteralPath $target -PathType Leaf
    if ($r.exists) {
        if (-not $sigCache.ContainsKey($target)) {
            try { $sigCache[$target] = [string](Get-AuthenticodeSignature -LiteralPath $target -ErrorAction Stop).Status }
            catch { $sigCache[$target] = 'Unknown' }
        }
        $r.signature = $sigCache[$target]
    }
    return $r
}

function New-Entry($type, $key, $name, $command, $extra) {
    $target = Get-Target $command
    $fi = Get-FileInfo $target
    [ordered]@{
        type      = $type
        key       = $key
        name      = $name
        command   = $command
        target    = $target
        exists    = $fi.exists
        signature = $fi.signature
        extra     = $extra
    }
}

$entries = New-Object System.Collections.ArrayList

$runKeys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\RunOnce',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce'
)
foreach ($path in $runKeys) {
    $k = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
    if (-not $k) { continue }
    foreach ($n in $k.GetValueNames()) {
        $v = $k.GetValue($n, $null, 'DoNotExpandEnvironmentNames')
        [void]$entries.Add((New-Entry 'run' "$path\$n" $n ([string]$v) @{}))
    }
}

$winlogon = Get-Item -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -ErrorAction SilentlyContinue
if ($winlogon) {
    foreach ($n in 'Shell', 'Userinit') {
        $v = $winlogon.GetValue($n, $null, 'DoNotExpandEnvironmentNames')
        if ($v) { [void]$entries.Add((New-Entry 'winlogon' "Winlogon\$n" $n ([string]$v) @{})) }
    }
}

$startupDirs = @(
    @{ scope = 'user'; path = [Environment]::GetFolderPath('Startup') },
    @{ scope = 'common'; path = [Environment]::GetFolderPath('CommonStartup') }
)
$shell = $null
foreach ($d in $startupDirs) {
    if (-not $d.path -or -not (Test-Path -LiteralPath $d.path)) { continue }
    foreach ($f in Get-ChildItem -LiteralPath $d.path -File -Force -ErrorAction SilentlyContinue) {
        if ($f.Name -ieq 'desktop.ini') { continue }
        $cmd = $f.FullName
        if ($f.Extension -ieq '.lnk') {
            try {
                if (-not $shell) { $shell = New-Object -ComObject WScript.Shell }
                $lnk = $shell.CreateShortcut($f.FullName)
                $cmd = ('"{0}" {1}' -f $lnk.TargetPath, $lnk.Arguments).Trim()
            } catch { [void]$warnings.Add("shortcut unreadable: $($f.FullName)") }
        }
        [void]$entries.Add((New-Entry 'startup' $f.FullName $f.Name $cmd @{ scope = $d.scope }))
    }
}

try {
    foreach ($t in Get-ScheduledTask -ErrorAction Stop) {
        $i = 0
        foreach ($a in @($t.Actions)) {
            if (-not $a.Execute) { $i++; continue }
            $cmd = ('"{0}" {1}' -f $a.Execute, $a.Arguments).Trim()
            $extra = @{
                state   = [string]$t.State
                runAs   = [string]$t.Principal.UserId
                runLevel = [string]$t.Principal.RunLevel
            }
            $key = "$($t.TaskPath)$($t.TaskName)#$i"
            [void]$entries.Add((New-Entry 'task' $key $t.TaskName $cmd $extra))
            $i++
        }
    }
} catch { [void]$warnings.Add("scheduled tasks unavailable: $($_.Exception.Message)") }

$startNames = @{ 0 = 'boot'; 1 = 'system'; 2 = 'auto'; 3 = 'manual'; 4 = 'disabled' }
$svcRoot = Get-Item -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services' -ErrorAction SilentlyContinue
if ($svcRoot) {
    foreach ($name in $svcRoot.GetSubKeyNames()) {
        $sk = $svcRoot.OpenSubKey($name)
        if (-not $sk) { continue }
        try {
            $type = $sk.GetValue('Type')
            $img = $sk.GetValue('ImagePath', $null, 'DoNotExpandEnvironmentNames')
            if ($type -isnot [int] -or -not ($type -band 0x30) -or -not $img) { continue }
            $start = $sk.GetValue('Start')
            $extra = @{
                start   = $startNames[[int]$start]
                account = [string]$sk.GetValue('ObjectName')
            }
            [void]$entries.Add((New-Entry 'service' $name $name ([string]$img) $extra))
        } finally { $sk.Close() }
    }
}

$snapshot = [ordered]@{
    version   = 1
    host      = $env:COMPUTERNAME
    collected = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    warnings  = @($warnings)
    entries   = @($entries | Sort-Object { $_.type }, { $_.key })
}
$json = ConvertTo-Json -InputObject $snapshot -Depth 6

if ($OutFile) {
    [System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding($false)))
} else {
    $json
}
