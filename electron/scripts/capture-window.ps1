param(
  [Parameter(Mandatory = $true)][ValidateSet('screenshot', 'key', 'check', 'capture-sequence', 'serve')][string]$Action,
  [string]$ProcessName = 'Sektori',
  [string]$OutFile,
  [string]$OutDir,
  [int]$PageCount = 4,
  [int]$RenderDelayMs = 350,
  [int]$ReturnDelayMs = 120,
  [ValidateSet('{PGDN}', '{PGUP}')][string]$Key
)

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct KEYBDINPUT {
  public ushort wVk;
  public ushort wScan;
  public uint dwFlags;
  public uint time;
  public IntPtr dwExtraInfo;
}

[StructLayout(LayoutKind.Sequential)]
public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

[StructLayout(LayoutKind.Sequential)]
public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }

[StructLayout(LayoutKind.Explicit)]
public struct InputUnion {
  // The union must be sized for its largest member (MOUSEINPUT) even though we
  // only ever populate ki — otherwise Marshal.SizeOf(INPUT) undercounts the
  // struct size and SendInput rejects the call with ERROR_INVALID_PARAMETER.
  [FieldOffset(0)] public MOUSEINPUT mi;
  [FieldOffset(0)] public KEYBDINPUT ki;
  [FieldOffset(0)] public HARDWAREINPUT hi;
}

[StructLayout(LayoutKind.Sequential)]
public struct INPUT {
  public uint type;
  public InputUnion u;
}

public class SektoriPulseWin32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

function Write-Result($obj) {
  # Write-Output goes through PowerShell's formatting/pipeline machinery, which
  # is unnecessary overhead and occasionally unpredictable buffering for a tight
  # line-based IPC loop (serve mode) — write straight to the console stream.
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}

function Get-CheckResult($processName) {
  $proc = Get-Process -Name $processName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $proc) { return @{ ok = $true; running = $false; foreground = $false } }
  $foreground = [SektoriPulseWin32]::GetForegroundWindow()
  $rect = New-Object SektoriPulseWin32+RECT
  [SektoriPulseWin32]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null
  return @{
    ok = $true; running = $true; foreground = ($foreground -eq $proc.MainWindowHandle)
    minimized = [bool]([SektoriPulseWin32]::IsIconic($proc.MainWindowHandle))
    rect = @{ left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom }
  }
}

function Get-ScreenshotResult($processName, $outFile) {
  $proc = Get-Process -Name $processName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $proc) { return @{ ok = $false; reason = 'process-not-found' } }
  $foreground = [SektoriPulseWin32]::GetForegroundWindow()
  if ($foreground -ne $proc.MainWindowHandle) { return @{ ok = $false; reason = 'not-foreground' } }
  if (-not $outFile) { return @{ ok = $false; reason = 'missing-outfile' } }
  if (Take-Screenshot $proc $outFile) { return @{ ok = $true } }
  return @{ ok = $false; reason = 'bad-rect' }
}

function Get-KeyResult($processName, $key) {
  $proc = Get-Process -Name $processName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $proc) { return @{ ok = $false; reason = 'process-not-found' } }
  $foreground = [SektoriPulseWin32]::GetForegroundWindow()
  if ($foreground -ne $proc.MainWindowHandle) { return @{ ok = $false; reason = 'not-foreground' } }
  if (-not $key) { return @{ ok = $false; reason = 'missing-key' } }
  return @{ ok = (Send-Key $key) }
}

# Games reading raw/hardware-level input ignore virtual-key-only events (scan
# code 0), so send the physical scan code (KEYEVENTF_SCANCODE): Page Down 0x51,
# Page Up 0x49, both extended keys (KEYEVENTF_EXTENDEDKEY). The key is also held
# for a moment between down and up — engines poll input per frame, and a 0 ms
# press can fall between two frames and never be seen.
$KEYEVENTF_EXTENDEDKEY = 0x0001
$KEYEVENTF_KEYUP = 0x0002
$KEYEVENTF_SCANCODE = 0x0008
$SCAN = @{ '{PGDN}' = 0x51; '{PGUP}' = 0x49 }
$KEY_HOLD_MS = 60

function Send-Key($keyName) {
  $scan = $SCAN[$keyName]
  if (-not $scan) { return $false }
  $size = [System.Runtime.InteropServices.Marshal]::SizeOf([type][INPUT])
  $down = New-Object INPUT
  $down.type = 1
  $down.u.ki.wScan = $scan
  $down.u.ki.dwFlags = $KEYEVENTF_SCANCODE -bor $KEYEVENTF_EXTENDEDKEY
  $sentDown = [SektoriPulseWin32]::SendInput(1, [INPUT[]]@($down), $size)
  Start-Sleep -Milliseconds $KEY_HOLD_MS
  $up = New-Object INPUT
  $up.type = 1
  $up.u.ki.wScan = $scan
  $up.u.ki.dwFlags = $KEYEVENTF_SCANCODE -bor $KEYEVENTF_EXTENDEDKEY -bor $KEYEVENTF_KEYUP
  $sentUp = [SektoriPulseWin32]::SendInput(1, [INPUT[]]@($up), $size)
  return (($sentDown + $sentUp) -eq 2)
}

function Take-Screenshot($proc, $path) {
  $rect = New-Object SektoriPulseWin32+RECT
  [SektoriPulseWin32]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -le 0 -or $height -le 0) { return $false }
  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size $width, $height))
    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    return $true
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

if ($Action -eq 'check') {
  Write-Result (Get-CheckResult $ProcessName)
  exit 0
}

if ($Action -eq 'screenshot') {
  Write-Result (Get-ScreenshotResult $ProcessName $OutFile)
  exit 0
}

if ($Action -eq 'key') {
  Write-Result (Get-KeyResult $ProcessName $Key)
  exit 0
}

if ($Action -eq 'serve') {
  # Persistent session: the Add-Type C# compilation above happens ONCE here,
  # then this loop services one JSON request per stdin line until stdin
  # closes. A single-shot invocation of this script pays ~600ms just
  # recompiling that interop code on every call — a 4-page capture used to
  # spawn ~10 fresh PowerShell processes for that alone; now it reuses one
  # already-warm process for the app's entire lifetime.
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim().Length -eq 0) { continue }
    try {
      $cmd = $line | ConvertFrom-Json
    } catch {
      Write-Result @{ ok = $false; reason = 'bad-request' }
      continue
    }
    switch ($cmd.action) {
      'check' { Write-Result (Get-CheckResult $cmd.processName) }
      'screenshot' { Write-Result (Get-ScreenshotResult $cmd.processName $cmd.outFile) }
      'key' { Write-Result (Get-KeyResult $cmd.processName $cmd.key) }
      default { Write-Result @{ ok = $false; reason = 'unknown-action' } }
    }
  }
  exit 0
}

if ($Action -eq 'capture-sequence') {
  # Everything below runs in this ONE process, with no gap in which anything
  # else on the system could steal foreground focus between screenshot/key
  # steps (which was the real risk with spawning a separate PowerShell process
  # per action).
  $proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $proc) {
    Write-Result @{ ok = $false; reason = 'process-not-found' }
    exit 0
  }
  $foreground = [SektoriPulseWin32]::GetForegroundWindow()
  if ($foreground -ne $proc.MainWindowHandle) {
    Write-Result @{ ok = $false; reason = 'not-foreground' }
    exit 0
  }
  if (-not $OutDir) {
    Write-Result @{ ok = $false; reason = 'missing-outdir' }
    exit 0
  }
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  $pages = @()
  $page1 = Join-Path $OutDir 'page-1.png'
  if (-not (Take-Screenshot $proc $page1)) {
    Write-Result @{ ok = $false; reason = 'bad-rect' }
    exit 0
  }
  $pages += @{ index = 1; file = $page1 }
  $reached = 1
  for ($n = 2; $n -le $PageCount; $n++) {
    if (-not (Send-Key '{PGDN}')) { break }
    Start-Sleep -Milliseconds $RenderDelayMs
    $pagePath = Join-Path $OutDir "page-$n.png"
    if (-not (Take-Screenshot $proc $pagePath)) { break }
    $pages += @{ index = $n; file = $pagePath }
    $reached = $n
  }
  for ($n = $reached; $n -gt 1; $n--) {
    Send-Key '{PGUP}' | Out-Null
    Start-Sleep -Milliseconds $ReturnDelayMs
  }
  Write-Result @{ ok = $true; pages = $pages }
  exit 0
}
