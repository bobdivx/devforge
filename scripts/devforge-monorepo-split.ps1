# Full monorepo split: Laravel → backend/, Astro stays in frontend/
# Soft rename frontend/ must already be done.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$backend = Join-Path $root 'backend'
if (Test-Path (Join-Path $backend 'artisan')) {
    Write-Host "backend/ already contains Laravel (artisan present). Nothing to move."
    exit 0
}

New-Item -ItemType Directory -Force -Path $backend | Out-Null

$dirs = @(
    'app',
    'bootstrap',
    'config',
    'database',
    'lang',
    'public',
    'resources',
    'routes',
    'storage',
    'tests',
    'templates',
    'svgs'
)

$files = @(
    'artisan',
    'composer.json',
    'composer.lock',
    'phpunit.xml',
    'phpunit.dusk.xml',
    'pint.json',
    'rector.php',
    'openapi.json',
    'openapi.yaml',
    'versions.json',
    'boost.json',
    '.phpactor.json',
    '.env.development.example',
    '.env.dusk.ci',
    '.env.production',
    '.env.testing',
    '.env.windows-docker-desktop.example'
)

foreach ($dir in $dirs) {
    $src = Join-Path $root $dir
    if (-not (Test-Path $src)) {
        Write-Host "skip missing dir: $dir"
        continue
    }
    $dest = Join-Path $backend $dir
    if (Test-Path $dest) {
        Write-Host "skip existing: backend/$dir"
        continue
    }
    Write-Host "move $dir/ → backend/$dir/"
    Move-Item -LiteralPath $src -Destination $dest
}

foreach ($file in $files) {
    $src = Join-Path $root $file
    if (-not (Test-Path $src)) {
        Write-Host "skip missing file: $file"
        continue
    }
    $dest = Join-Path $backend $file
    if (Test-Path $dest) {
        Write-Host "skip existing: backend/$file"
        continue
    }
    Write-Host "move $file → backend/$file"
    Move-Item -LiteralPath $src -Destination $dest
}

# Optional live .env (not examples)
foreach ($envName in @('.env', '.env.backup', '.env.secrets', '.env.dusk.local')) {
    $src = Join-Path $root $envName
    if (Test-Path $src) {
        $dest = Join-Path $backend $envName
        if (-not (Test-Path $dest)) {
            Write-Host "move $envName → backend/$envName"
            Move-Item -LiteralPath $src -Destination $dest
        }
    }
}

# vendor if present locally
$vendorSrc = Join-Path $root 'vendor'
if (Test-Path $vendorSrc) {
    $vendorDest = Join-Path $backend 'vendor'
    if (-not (Test-Path $vendorDest)) {
        Write-Host "move vendor/ → backend/vendor/"
        Move-Item -LiteralPath $vendorSrc -Destination $vendorDest
    }
}

Write-Host @"

Laravel tree moved to backend/.
Vite/npm stay at repo root (vite.config.js → backend/resources + backend/public).
Astro outDir → backend/public/devforge.
Docker mount: ./backend → /var/www/html.
"@
