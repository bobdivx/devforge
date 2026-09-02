# Installe l'app Pinokio "LiteLLM Cursor Proxy" sur Demeter.
# LiteLLM demarre avec Pinokio (PINOKIO_SCRIPT_AUTOLAUNCH).
#
# Usage (sur Demeter) :
#   cd C:\Users\auber\Documents\scripts
#   powershell -ExecutionPolicy Bypass -File .\pinokio-litellm-install.ps1
#   ou: .\pinokio-litellm-install.bat
#
# Options :
#   -PinokioHome "D:\pinokio"
#   -ConfigPath "D:\pinokio\litellm-config.yaml"
#   -DisableAutolaunch

param(
    [string]$PinokioHome = "D:\pinokio",
    [string]$AppName = "litellm-cursor-proxy",
    [string]$ConfigPath = "D:\pinokio\litellm-config.yaml",
    [int]$Port = 4000,
    [switch]$DisableAutolaunch,
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

$sourceApp = Join-Path $PSScriptRoot "pinokio-litellm-cursor-proxy"
$targetApp = Join-Path $PinokioHome "api\$AppName"

if (-not (Test-Path -LiteralPath $sourceApp)) {
    Write-Error "Dossier source introuvable : $sourceApp"
}

if (-not (Test-Path -LiteralPath $PinokioHome)) {
    Write-Error "Pinokio home introuvable : $PinokioHome"
}

Write-Host ">> Installation app Pinokio LiteLLM" -ForegroundColor Cyan
Write-Host "   Source : $sourceApp"
Write-Host "   Cible  : $targetApp"

if ($WhatIf) {
    Write-Host "[WhatIf] Copie + ENVIRONMENT + config" -ForegroundColor Yellow
    exit 0
}

New-Item -ItemType Directory -Force -Path $targetApp | Out-Null

$copyFiles = @(
    "pinokio.json",
    "pinokio.js",
    "install.js",
    "start.js",
    "litellm-config.yaml.example"
)
foreach ($file in $copyFiles) {
    Copy-Item -LiteralPath (Join-Path $sourceApp $file) -Destination (Join-Path $targetApp $file) -Force
}

# ENVIRONMENT - autolaunch au demarrage de Pinokio
$envLines = @(
    "# LiteLLM Cursor Proxy - genere par pinokio-litellm-install.ps1",
    "LITELLM_CONFIG_PATH=$ConfigPath",
    "LITELLM_PORT=$Port",
    "LITELLM_HOST=0.0.0.0"
)
if (-not $DisableAutolaunch) {
    $envLines += @(
        "PINOKIO_SCRIPT_AUTOLAUNCH=start.js",
        "PINOKIO_SCRIPT_AUTOLAUNCH_ENABLED=true"
    )
}
Set-Content -LiteralPath (Join-Path $targetApp "ENVIRONMENT") -Value ($envLines -join "`r`n") -Encoding ASCII
Write-Host "   ENVIRONMENT ecrit (autolaunch: $(-not $DisableAutolaunch))" -ForegroundColor Green

# Config YAML globale (si absente)
if (-not (Test-Path -LiteralPath $ConfigPath)) {
    $example = Join-Path $targetApp "litellm-config.yaml.example"
    Copy-Item -LiteralPath $example -Destination $ConfigPath -Force
    Write-Host "   Config creee : $ConfigPath" -ForegroundColor Yellow
    Write-Host "   Editez master_key et model_name avant utilisation." -ForegroundColor Yellow
} else {
    Write-Host "   Config existante conservee : $ConfigPath" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Termine." -ForegroundColor Green
Write-Host ""
Write-Host "Etapes suivantes sur Demeter :" -ForegroundColor Cyan
Write-Host "1. Ouvrir Pinokio - app LiteLLM Cursor Proxy (api\$AppName)" -ForegroundColor White
Write-Host "2. Cliquer Install (une fois) puis Start" -ForegroundColor White
Write-Host "3. Verifier : curl http://127.0.0.1:$Port/health/liveliness" -ForegroundColor White
Write-Host ""
Write-Host "Auto-start apres reboot :" -ForegroundColor Cyan
Write-Host "- Pinokio: Launch at startup active" -ForegroundColor White
Write-Host "- LiteLLM: PINOKIO_SCRIPT_AUTOLAUNCH=start.js" -ForegroundColor White
Write-Host "- llama-server :10086: Uncensored Local Studio dans Pinokio" -ForegroundColor White
Write-Host "- Tunnel Cloudflare agent.briseteia.me: service Windows separe" -ForegroundColor White
Write-Host ""
Write-Host "Cursor :" -ForegroundColor Cyan
Write-Host "  Base URL : https://agent.briseteia.me/cursor" -ForegroundColor White
Write-Host "  Modele   : demeter-qwen3-coder" -ForegroundColor White
Write-Host "  API Key  : master_key dans $ConfigPath" -ForegroundColor White
