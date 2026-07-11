$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stageRoot = Join-Path $projectRoot 'work\package-stage'
$stage = Join-Path $stageRoot 'win-unpacked'
$output = Join-Path $projectRoot 'release'

foreach ($target in @($stageRoot, $output)) {
    if (-not $target.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Packaging path escaped the project root: $target"
    }
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
}

Push-Location $projectRoot
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Vite build failed.' }

    if (-not (Test-Path -LiteralPath 'node_modules\electron\dist\electron.exe')) {
        & node 'node_modules\electron\install.js'
        if ($LASTEXITCODE -ne 0) { throw 'Electron runtime download failed.' }
    }

    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    Copy-Item -Path 'node_modules\electron\dist\*' -Destination $stage -Recurse -Force

    $appDir = Join-Path $stage 'resources\app'
    New-Item -ItemType Directory -Force -Path $appDir | Out-Null
    Copy-Item -LiteralPath 'dist' -Destination (Join-Path $appDir 'dist') -Recurse
    Copy-Item -LiteralPath 'electron' -Destination (Join-Path $appDir 'electron') -Recurse
    Copy-Item -LiteralPath 'assets' -Destination (Join-Path $appDir 'assets') -Recurse
    Copy-Item -LiteralPath 'package.json' -Destination (Join-Path $appDir 'package.json')
    Copy-Item -LiteralPath 'package-lock.json' -Destination (Join-Path $appDir 'package-lock.json')

    # A clean production-only install instead of copying the dev node_modules
    # wholesale — the dev tree drags in Vite/electron-builder/testing tooling
    # (Babel, Playwright, rxjs, lightningcss, ...) that never runs in the
    # packaged app and was bloating the installer by ~250MB for nothing.
    Push-Location $appDir
    try {
        & npm ci --omit=dev
        if ($LASTEXITCODE -ne 0) { throw 'Production dependency install failed.' }
    }
    finally { Pop-Location }

    # vigemclient ships a native addon built against plain Node's ABI by
    # default; Electron embeds a different V8/Node ABI, so the addon must be
    # rebuilt against Electron's headers or it fails to load at runtime.
    # -m wants the package directory (containing package.json), not node_modules
    # itself — it targets the pruned copy in $appDir, not this project's dev copy.
    & '.\node_modules\.bin\electron-rebuild.cmd' -f -w vigemclient -m $appDir
    if ($LASTEXITCODE -ne 0) { throw 'electron-rebuild failed for vigemclient.' }

    $exe = Join-Path $stage 'Sektori Pulse.exe'
    Move-Item -LiteralPath (Join-Path $stage 'electron.exe') -Destination $exe
    & node '.\scripts\brand-executable.cjs' $exe (Resolve-Path 'assets\icon.ico').Path
    if ($LASTEXITCODE -ne 0) { throw 'Executable branding failed.' }

    & '.\node_modules\.bin\electron-builder.cmd' --prepackaged $stage --win nsis
    if ($LASTEXITCODE -ne 0) { throw 'Installer build failed.' }
}
finally {
    Pop-Location
}
