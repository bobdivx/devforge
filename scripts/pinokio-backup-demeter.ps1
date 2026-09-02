# Sauvegarde Pinokio sur Demeter (configs, apps, LiteLLM — modeles GGUF en option).
#
# Usage :
#   powershell -ExecutionPolicy Bypass -File .\pinokio-backup-demeter.ps1
#   ou: .\pinokio-backup-demeter.bat
#
# Options :
#   -PinokioHome "D:\pinokio"
#   -BackupRoot "D:\Backups\pinokio"
#   -IncludeModels          # inclut les GGUF (tres volumineux, ~17 GB+)
#   -IncludeVenv            # inclut env/venv Python (LiteLLM, etc.)
#   -IncludeNodeModules     # inclut node_modules (lourd, rarement utile)
#   -WhatIf

param(
    [string]$PinokioHome = "D:\pinokio",
    [string]$BackupRoot = "D:\Backups\pinokio",
    [string]$ConfigPath = "D:\pinokio\litellm-config.yaml",
    [switch]$IncludeModels,
    [switch]$IncludeVenv,
    [switch]$IncludeNodeModules,
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $PinokioHome)) {
    Write-Error "Pinokio introuvable : $PinokioHome"
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dest = Join-Path $BackupRoot $stamp

Write-Host ">> Sauvegarde Pinokio Demeter" -ForegroundColor Cyan
Write-Host "   Source : $PinokioHome"
Write-Host "   Cible  : $dest"
Write-Host "   Modeles GGUF : $IncludeModels"
Write-Host ""

function Ensure-Dir([string]$Path) {
    if (-not $WhatIf) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

function Copy-ItemSafe([string]$From, [string]$To) {
    if (-not (Test-Path -LiteralPath $From)) {
        return $false
    }
    if ($WhatIf) {
        Write-Host "   [WhatIf] copie $From" -ForegroundColor Yellow
        return $true
    }
    $parent = Split-Path -Parent $To
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    Copy-Item -LiteralPath $From -Destination $To -Force -Recurse
    return $true
}

Ensure-Dir $dest
Ensure-Dir (Join-Path $dest "meta")

# Meta-infos pour restauration
$meta = @(
    "backup_date=$stamp",
    "pinokio_home=$PinokioHome",
    "hostname=$(hostname)",
    "include_models=$IncludeModels",
    "include_venv=$IncludeVenv",
    "include_node_modules=$IncludeNodeModules",
    "notes=Restaurer api/ sous le nouveau Pinokio home. Reinstaller Pinokio apps si venv/node_modules exclus."
)
if (-not $WhatIf) {
    Set-Content -LiteralPath (Join-Path $dest "meta\backup-info.txt") -Value ($meta -join "`r`n") -Encoding ASCII
}

# 1) Config LiteLLM racine
if (Test-Path -LiteralPath $ConfigPath) {
    Write-Host "   litellm-config.yaml" -ForegroundColor Green
    Copy-ItemSafe $ConfigPath (Join-Path $dest "litellm-config.yaml")
}

# 2) Apps Pinokio (api/) avec exclusions
$apiSource = Join-Path $PinokioHome "api"
if (Test-Path -LiteralPath $apiSource) {
    $apiDest = Join-Path $dest "api"
    Ensure-Dir $apiDest

    $excludeDirs = @(
        "node_modules",
        "dist",
        ".git",
        "__pycache__",
        "tools\node-win"
    )
    if (-not $IncludeVenv) {
        $excludeDirs += @("env", "venv", ".venv")
    }
    if (-not $IncludeModels) {
        $excludeDirs += @("llm-models", "models")
    }

    Write-Host "   api\ (robocopy avec exclusions)" -ForegroundColor Green

    if ($WhatIf) {
        Write-Host "   [WhatIf] robocopy $apiSource -> $apiDest" -ForegroundColor Yellow
    } else {
        $xdArgs = $excludeDirs | ForEach-Object { "/XD"; $_ }
        $robocopyArgs = @(
            $apiSource,
            $apiDest,
            "/E",
            "/R:2",
            "/W:3",
            "/NFL",
            "/NDL",
            "/NP"
        ) + $xdArgs

        if (-not $IncludeNodeModules) {
            $robocopyArgs += "/XD"
            $robocopyArgs += "node_modules"
        }

        & robocopy @robocopyArgs | Out-Null
        # robocopy exit codes 0-7 = success
        if ($LASTEXITCODE -gt 7) {
            Write-Warning "robocopy code $LASTEXITCODE (verifier le dossier cible)"
        }
    }
}

# 3) Fichiers critiques Uncensored Local Studio (serve.cjs, settings)
$studioRoots = @(
    (Join-Path $PinokioHome "api\uncensored-local-studio"),
    (Join-Path $PinokioHome "api\uncensored-local-studio\app"),
    (Join-Path $PinokioHome "app\uncensored-local-studio")
)
$criticalPatterns = @(
    "**\serve.cjs",
    "**\llm-model-settings.json",
    "**\ENVIRONMENT",
    "**\pinokio.js",
    "**\pinokio.json",
    "**\start.js",
    "**\install.js"
)

Write-Host "   fichiers critiques (serve.cjs, ENVIRONMENT, ...)" -ForegroundColor Green
foreach ($root in $studioRoots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    foreach ($pattern in @("serve.cjs", "llm-model-settings.json", "ENVIRONMENT", "pinokio.js", "pinokio.json", "start.js", "install.js")) {
        Get-ChildItem -LiteralPath $root -Recurse -Filter $pattern -File -ErrorAction SilentlyContinue |
            ForEach-Object {
                $rel = $_.FullName.Substring($PinokioHome.Length).TrimStart('\')
                $target = Join-Path (Join-Path $dest "pinokio-home-mirror") $rel
                Copy-ItemSafe $_.FullName $target
            }
    }
}

# 4) Modeles GGUF (optionnel, copie separee)
if ($IncludeModels) {
    Write-Host "   llm-models (GGUF - peut prendre longtemps)" -ForegroundColor Yellow
    $modelDirs = @()
    Get-ChildItem -LiteralPath $apiSource -Recurse -Directory -Filter "llm-models" -ErrorAction SilentlyContinue |
        ForEach-Object { $modelDirs += $_.FullName }
    foreach ($modelDir in $modelDirs) {
        $rel = $modelDir.Substring($PinokioHome.Length).TrimStart('\')
        $target = Join-Path (Join-Path $dest "pinokio-home-mirror") $rel
        Copy-ItemSafe $modelDir $target
    }
}

# Resume taille
if (-not $WhatIf -and (Test-Path -LiteralPath $dest)) {
    $sizeBytes = (Get-ChildItem -LiteralPath $dest -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
    $sizeGb = [math]::Round($sizeBytes / 1GB, 2)
    Write-Host ""
    Write-Host "Termine." -ForegroundColor Green
    Write-Host "   Dossier : $dest" -ForegroundColor White
    Write-Host "   Taille  : $sizeGb GB" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "WhatIf termine." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Restauration rapide :" -ForegroundColor Cyan
Write-Host "  1. Installer Pinokio sur la nouvelle machine / OS" -ForegroundColor White
Write-Host "  2. Copier api\ vers <pinokio-home>\api\" -ForegroundColor White
Write-Host "  3. Copier litellm-config.yaml vers la racine pinokio" -ForegroundColor White
Write-Host "  4. Pinokio -> Install puis Start sur chaque app" -ForegroundColor White
Write-Host "  5. Si modeles exclus : recopier llm-models\ ou re-telecharger GGUF" -ForegroundColor White
