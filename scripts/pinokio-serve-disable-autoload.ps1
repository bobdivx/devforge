# Désactive le chargement automatique du modèle au démarrage de Pinokio (serve.cjs).
# Le serveur LLM démarre vide — chargez le modèle depuis DevForge → Paramètres AI → Demeter / Pinokio.
#
# Usage (PowerShell sur la machine GPU, ex. Demeter) :
#   .\scripts\pinokio-serve-disable-autoload.ps1
#   .\scripts\pinokio-serve-disable-autoload.ps1 -ServePath "D:\pinokio\api\uncensored-local-studio\app\scripts\server\serve.cjs"

param(
    [string]$ServePath = "D:\pinokio\api\uncensored-local-studio\app\scripts\server\serve.cjs"
)

if (-not (Test-Path -LiteralPath $ServePath)) {
    Write-Error "Fichier introuvable : $ServePath"
    exit 1
}

$content = Get-Content -LiteralPath $ServePath -Raw

$pattern = '(?s)\r?\n// Auto-load LLM model on server startup.*?\}, 2000\);\r?\n'
$newContent = [regex]::Replace($content, $pattern, "`r`n")

if ($newContent -eq $content) {
    Write-Host "Aucun bloc auto-load detecte — rien a modifier (deja desactive ?)." -ForegroundColor Yellow
    exit 0
}

Set-Content -LiteralPath $ServePath -Value $newContent.TrimEnd() -Encoding UTF8 -NoNewline
Add-Content -LiteralPath $ServePath -Value "`r`n" -Encoding UTF8

Write-Host "Auto-load supprime dans serve.cjs" -ForegroundColor Green
Write-Host "Redemarrez Pinokio Uncensored Local Studio, puis chargez le modele via DevForge (#pinokio)." -ForegroundColor Cyan
