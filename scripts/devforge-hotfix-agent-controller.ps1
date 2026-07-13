# Correctif urgent : AgentController.php (import dupliqué → 500 API DevForge)
# Usage: .\scripts\devforge-hotfix-agent-controller.ps1 -NasHost bobdivx@10.1.0.58

param(
    [string]$NasHost = 'bobdivx@10.1.0.58',
    [string]$ContainerName = 'coolify'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Source = Join-Path $Root 'app/Http/Controllers/DevForge/AgentController.php'

if (-not (Test-Path $Source)) {
    throw "Fichier introuvable: $Source"
}

Write-Host "==> Transfert AgentController.php corrigé" -ForegroundColor Cyan
scp $Source "${NasHost}:/tmp/AgentController.php"
if ($LASTEXITCODE -ne 0) { throw 'scp a échoué.' }

Write-Host "==> Application dans le conteneur $ContainerName" -ForegroundColor Cyan
ssh $NasHost @"
docker cp /tmp/AgentController.php ${ContainerName}:/var/www/html/app/Http/Controllers/DevForge/AgentController.php
docker exec ${ContainerName} php artisan route:clear
docker exec ${ContainerName} php artisan config:clear
docker exec ${ContainerName} php artisan route:list --path=devforge --except-vendor 2>&1 | head -10
rm -f /tmp/AgentController.php
"@

Write-Host "Correctif appliqué. Rechargez http://10.1.0.58:8080/devforge/" -ForegroundColor Green
