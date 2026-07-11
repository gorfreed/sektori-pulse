# One-time setup: drops a "Restart Sektori Pulse" shortcut on the Desktop.
# Right-click it afterward and choose "Pin to taskbar".
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Restart Sektori Pulse.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = 'powershell.exe'
$shortcut.Arguments = "-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$projectRoot\scripts\restart-pulse.ps1`""
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = Join-Path $projectRoot 'assets\icon.ico'
$shortcut.Description = 'Restart Sektori Pulse if it stops responding'
$shortcut.Save()

Write-Output "Created: $shortcutPath"
