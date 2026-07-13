# Installe une cle SSH pour le deploiement DevForge sans mot de passe.
# Usage: .\scripts\devforge-setup-ssh-key.ps1

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DeployEnvPath = Join-Path $Root 'scripts/devforge-deploy.env'
$DeployConfig = @{}

if (Test-Path $DeployEnvPath) {
    Get-Content $DeployEnvPath -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { return }
        $eq = $line.IndexOf('=')
        if ($eq -lt 1) { return }
        $DeployConfig[$line.Substring(0, $eq).Trim()] = $line.Substring($eq + 1).Trim()
    }
}

$nasUser = $DeployConfig['NAS_USER']
$nasHost = $DeployConfig['NAS_HOST']
if (-not $nasUser -or -not $nasHost) {
    throw 'Renseignez NAS_USER et NAS_HOST dans scripts/devforge-deploy.env'
}

$NasHost = "${nasUser}@${nasHost}"
$keyPath = Join-Path $env:USERPROFILE '.ssh/devforge_nas_ed25519'

if (-not (Test-Path (Split-Path $keyPath -Parent))) {
    New-Item -ItemType Directory -Path (Split-Path $keyPath -Parent) -Force | Out-Null
}

if (-not (Test-Path $keyPath)) {
    Write-Host "Generation de la cle $keyPath" -ForegroundColor Cyan
    ssh-keygen -t ed25519 -f $keyPath -N '""' -C "devforge-deploy"
}

Write-Host "Copie de la cle vers $NasHost (mot de passe SSH demande une derniere fois)" -ForegroundColor Cyan
Get-Content "$keyPath.pub" | ssh $NasHost "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

$envContent = Get-Content $DeployEnvPath -Encoding UTF8 -Raw
$keyLine = "NAS_SSH_KEY_PATH=$keyPath"
if ($envContent -match '(?m)^NAS_SSH_KEY_PATH=') {
    $envContent = [regex]::Replace($envContent, '(?m)^NAS_SSH_KEY_PATH=.*', $keyLine)
} else {
    $envContent = $envContent.TrimEnd() + "`n$keyLine`n"
}
Set-Content -Path $DeployEnvPath -Value $envContent -Encoding UTF8

Write-Host @"

Cle installee. NAS_SSH_KEY_PATH ajoute dans devforge-deploy.env.
Vous pouvez retirer NAS_SSH_PASSWORD du fichier .env.

Deploiement sans mot de passe:
  .\scripts\nas-fix-devforge.ps1 -EnableAgents -SkipFrontend -SkipBuild
"@ -ForegroundColor Green
