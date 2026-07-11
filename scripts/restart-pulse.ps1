# Kills any stuck Sektori Pulse process tree and relaunches it cleanly.
# Meant to be pinned to the taskbar for one-click recovery when the app stops
# responding (e.g. a dev-mode hot-reload crash) — see restart-pulse.lnk.
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$logPath = Join-Path $env:TEMP 'sektori-pulse-restart.log'

Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($projectRoot) -and $_.Name -match 'node|electron' } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }

Start-Sleep -Milliseconds 800

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'cmd.exe'
$psi.Arguments = "/c npm run electron:dev > `"$logPath`" 2>&1"
$psi.WorkingDirectory = $projectRoot
$psi.WindowStyle = 'Hidden'
$psi.UseShellExecute = $true
[System.Diagnostics.Process]::Start($psi) | Out-Null
# No confirmation dialog on purpose — the app's own overlay HUD reappearing in
# a few seconds is the confirmation. Diagnostics land silently in $logPath.
