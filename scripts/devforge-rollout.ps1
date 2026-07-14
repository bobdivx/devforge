# Déploiement DevForge automatisé (Windows → NAS Docker Coolify)
#
# 1. Copier scripts/devforge-deploy.env.example → scripts/devforge-deploy.env
# 2. Renseigner NAS_USER, NAS_SSH_PASSWORD, NAS_HOST
# 3. .\scripts\nas-fix-devforge.ps1 -EnableAgents
#
# Prérequis: ssh/scp, npm, tar (Windows 10+)

param(
    [string]$NasHost = '',
    [string]$ContainerName = '',
    [string]$EnvFile = '',
    [switch]$EnableAgents,
    [switch]$SkipBuild,
    [switch]$SkipFrontend,
    [switch]$KeepArtifact
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$DeployEnvPath = Join-Path $Root 'scripts/devforge-deploy.env'
$DeployConfig = @{}

function Import-DevForgeDeployEnv {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return }
    Get-Content $Path -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { return }
        $eq = $line.IndexOf('=')
        if ($eq -lt 1) { return }
        $DeployConfig[$line.Substring(0, $eq).Trim()] = $line.Substring($eq + 1).Trim()
    }
}

Import-DevForgeDeployEnv -Path $DeployEnvPath

if ([string]::IsNullOrWhiteSpace($NasHost)) {
    $nasUser = $DeployConfig['NAS_USER']
    $nasHostOnly = $DeployConfig['NAS_HOST']
    if ($nasUser -and $nasHostOnly) {
        $NasHost = "${nasUser}@${nasHostOnly}"
    }
}

if ([string]::IsNullOrWhiteSpace($ContainerName)) {
    $ContainerName = if ($DeployConfig['NAS_CONTAINER']) { $DeployConfig['NAS_CONTAINER'] } else { 'coolify' }
}

if ([string]::IsNullOrWhiteSpace($EnvFile)) {
    $EnvFile = $DeployConfig['NAS_ENV_FILE']
    if (-not $EnvFile) { $EnvFile = '' }
}

$Script:SshPassword = $DeployConfig['NAS_SSH_PASSWORD']
$Script:SshKeyPath = $DeployConfig['NAS_SSH_KEY_PATH']
if (-not [string]::IsNullOrWhiteSpace($env:DEVFORGE_SSH_KEY) -and (Test-Path -LiteralPath $env:DEVFORGE_SSH_KEY)) {
    $Script:SshKeyPath = $env:DEVFORGE_SSH_KEY
}
$Script:NasUseSudo = ($DeployConfig['NAS_USE_SUDO'] -eq 'true')

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Artifact = Join-Path $Root "devforge-rollout-$timestamp.tar.gz"
$PathsFile = Join-Path $Root 'scripts/devforge-package.paths'
$PackageResolver = Join-Path $Root 'scripts/Resolve-DevForgePackage.ps1'
$RemoteScript = Join-Path $Root 'scripts/devforge-rollout-remote.sh'

$Script:SshPassExe = $null
$Script:PlinkExe = $null

foreach ($candidate in @('sshpass', "$env:ProgramFiles\Git\usr\bin\sshpass.exe")) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) {
        $Script:SshPassExe = (Get-Command $candidate).Source
        break
    }
}

if (Get-Command plink -ErrorAction SilentlyContinue) {
    $Script:PlinkExe = (Get-Command plink).Source
} else {
    foreach ($plinkPath in @(
        "$env:ProgramFiles\PuTTY\plink.exe",
        "${env:ProgramFiles(x86)}\PuTTY\plink.exe"
    )) {
        if (Test-Path $plinkPath) {
            $Script:PlinkExe = $plinkPath
            break
        }
    }
}

function Test-NasSshKeyReady {
    return [bool]($Script:SshKeyPath -and (Test-Path -LiteralPath $Script:SshKeyPath))
}

function Format-ProcessArgument {
    param([string]$Value)
    if ($Value -match '[\s"]') {
        return '"' + ($Value -replace '"', '""') + '"'
    }
    return $Value
}

function Get-SshIdentityPath {
    if (-not (Test-NasSshKeyReady)) {
        return $null
    }

    return ($Script:SshKeyPath -replace '\\', '/')
}

function Get-SshBaseArgs {
    $sshArgs = @('-o', 'StrictHostKeyChecking=accept-new')
    $identityPath = Get-SshIdentityPath
    if ($identityPath) {
        $sshArgs += @(
            '-i', $identityPath,
            '-o', 'IdentitiesOnly=yes',
            '-o', 'BatchMode=yes',
            '-o', 'PasswordAuthentication=no',
            '-o', 'PreferredAuthentications=publickey'
        )
    }
    return $sshArgs
}

function Invoke-NasSshWithStdin {
    param(
        [string]$RemoteCommand,
        [string]$InputFile
    )

    if (Test-NasSshKeyReady) {
        $sshArgString = (@(Get-SshBaseArgs) + @($NasHost, $RemoteCommand) |
            ForEach-Object { Format-ProcessArgument $_ }) -join ' '
        $result = Invoke-CmdPipeline -Command "type `"$InputFile`" | ssh $sshArgString"
        if ($result.Output) { Write-Host $result.Output }
        if ($result.ExitCode -ne 0 -and $result.ExitCode -ne 141) {
            throw "ssh a echoue (code $($result.ExitCode)): $($result.Output)"
        }
        return
    }

    if ($Script:PlinkExe -and $Script:SshPassword) {
        $hostOnly = ($NasHost -split '@')[-1]
        $userOnly = ($NasHost -split '@')[0]
        $remoteTarget = "${userOnly}@${hostOnly}"
        $plinkArgs = @('-ssh', '-batch', '-pw', $Script:SshPassword, $remoteTarget, $RemoteCommand) |
            ForEach-Object { Format-ProcessArgument $_ }
        $plinkCmd = "`"$Script:PlinkExe`" $($plinkArgs -join ' ')"
        $result = Invoke-CmdPipeline -Command "type `"$InputFile`" | $plinkCmd"
        if ($result.Output) { Write-Host $result.Output }
        if ($result.ExitCode -ne 0) {
            throw "plink a echoue (code $($result.ExitCode)): $($result.Output)"
        }
        return
    }

    if ($Script:SshPassExe -and $Script:SshPassword) {
        $env:SSHPASS = $Script:SshPassword
        $sshpassArgString = (@('-e', 'ssh') + @(Get-SshBaseArgs) + @($NasHost, $RemoteCommand) |
            ForEach-Object { Format-ProcessArgument $_ }) -join ' '
        $sshpassCmd = "`"$Script:SshPassExe`" $sshpassArgString"
        $result = Invoke-CmdPipeline -Command "type `"$InputFile`" | $sshpassCmd"
        if ($result.Output) { Write-Host $result.Output }
        if ($result.ExitCode -ne 0 -and $result.ExitCode -ne 141) {
            throw "sshpass a echoue (code $($result.ExitCode)): $($result.Output)"
        }
        return
    }

    $sshArgString = (@(Get-SshBaseArgs) + @($NasHost, $RemoteCommand) |
        ForEach-Object { Format-ProcessArgument $_ }) -join ' '
    $result = Invoke-CmdPipeline -Command "type `"$InputFile`" | ssh $sshArgString"
    if ($result.Output) { Write-Host $result.Output }
    if ($result.ExitCode -ne 0 -and $result.ExitCode -ne 141) {
        throw "ssh a echoue (code $($result.ExitCode)): $($result.Output)"
    }
}

function Invoke-CmdPipeline {
    param([string]$Command)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $lines = cmd /c $Command 2>&1
        $text = ($lines | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) {
                $_.ToString()
            } else {
                [string]$_
            }
        }) -join [Environment]::NewLine
        return [PSCustomObject]@{
            ExitCode = $LASTEXITCODE
            Output = $text
        }
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Write-Step([string]$Message) {
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-PackagePaths {
    if (-not (Test-Path $PackageResolver)) {
        throw "Resolveur de package introuvable: $PackageResolver"
    }

    . $PackageResolver
    return Get-DevForgePackagePaths -Root $Root
}

if (-not $SkipFrontend) {
    Write-Step 'Build Astro DevForge'
    if (Test-Path (Join-Path $Root 'package-lock.json')) {
        npm ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci a echoue a la racine du repo.' }
    } else {
        npm install
        if ($LASTEXITCODE -ne 0) { throw 'npm install a echoue a la racine du repo.' }
    }
    npm run build:devforge
    if ($LASTEXITCODE -ne 0) { throw 'npm run build:devforge a echoue.' }
}

if (-not $SkipBuild) {
    Write-Step 'Preparation artefact'
    $existing = @(Get-PackagePaths)
    Write-Host "Fichiers dans le package: $($existing.Count)" -ForegroundColor DarkGray
    if ($existing.Count -eq 0) { throw 'Aucun fichier DevForge a empaqueter.' }
    $tarArgs = @('-czf', $Artifact) + ($existing | ForEach-Object { $_ })
    & tar @tarArgs
    if ($LASTEXITCODE -ne 0) { throw 'tar a echoue.' }
    Write-Host "Artefact: $Artifact ($([math]::Round((Get-Item $Artifact).Length / 1MB, 2)) Mo)" -ForegroundColor Green
}

if ([string]::IsNullOrWhiteSpace($NasHost)) {
    Write-Host @"

Mode local uniquement.
Configurer scripts/devforge-deploy.env puis:
  .\scripts\nas-fix-devforge.ps1 -EnableAgents

Ou: .\scripts\devforge-rollout.ps1 -NasHost bobdivx@10.1.0.58
"@ -ForegroundColor Yellow
    exit 0
}

if (Test-NasSshKeyReady) {
    Write-Host "SSH: cle $($Script:SshKeyPath) (sans mot de passe)" -ForegroundColor DarkGray
} elseif ($Script:SshPassExe -and $Script:SshPassword) {
    Write-Host 'SSH: mot de passe depuis devforge-deploy.env (sshpass)' -ForegroundColor DarkGray
} elseif ($Script:PlinkExe -and $Script:SshPassword) {
    Write-Host 'SSH: mot de passe depuis devforge-deploy.env (plink)' -ForegroundColor DarkGray
} elseif ($Script:SshKeyPath) {
    Write-Host "ATTENTION: cle introuvable: $($Script:SshKeyPath)" -ForegroundColor Yellow
    Write-Host '  -> Lancez: .\scripts\devforge-setup-ssh-key.ps1' -ForegroundColor Yellow
} elseif ($Script:SshPassword) {
    Write-Host 'ATTENTION: NAS_SSH_PASSWORD est defini mais ni plink ni sshpass detectes.' -ForegroundColor Yellow
    Write-Host '  -> Installez PuTTY: winget install PuTTY.PuTTY' -ForegroundColor Yellow
    Write-Host '  -> Ou lancez: .\scripts\devforge-setup-ssh-key.ps1' -ForegroundColor Yellow
    Write-Host '  -> Sinon saisie manuelle du mot de passe (1 fois)' -ForegroundColor Yellow
} else {
    Write-Host 'SSH: saisie manuelle du mot de passe (1 fois)' -ForegroundColor DarkGray
}

if ($SkipBuild -and -not (Test-Path $Artifact)) {
    $latest = Get-ChildItem -Path $Root -Filter 'devforge-rollout-*.tar.gz' |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -eq $latest) { throw 'Aucun artefact devforge-rollout-*.tar.gz trouve.' }
    $Artifact = $latest.FullName
    Write-Host "Artefact existant: $Artifact" -ForegroundColor Yellow
}

if (-not (Test-Path $Artifact)) { throw "Artefact introuvable: $Artifact" }

Write-Step "Deploiement vers $NasHost (une connexion SSH)"
$agentsFlag = if ($EnableAgents) { 'true' } else { 'false' }
$hostEnvArg = if ($EnvFile) { $EnvFile } else { '' }

$bundleStaging = Join-Path $env:TEMP "devforge-bundle-$timestamp"
$bundlePath = Join-Path $env:TEMP "devforge-bundle-$timestamp.tar.gz"
New-Item -ItemType Directory -Force -Path $bundleStaging | Out-Null
Copy-Item -Path $Artifact -Destination (Join-Path $bundleStaging 'rollout.tar.gz') -Force
Copy-Item -Path $RemoteScript -Destination (Join-Path $bundleStaging 'remote.sh') -Force
& tar -czf $bundlePath -C $bundleStaging rollout.tar.gz remote.sh
if ($LASTEXITCODE -ne 0) { throw 'Creation du bundle SSH a echoue.' }
Remove-Item -Recurse -Force $bundleStaging

$hostEnvToken = if ($hostEnvArg) { $hostEnvArg } else { '-' }

$remoteStaging = "/tmp/devforge-staging-$timestamp"
$remoteCmd = 'mkdir -p STAGING && tar --warning=no-timestamp -xzf - -C STAGING && sed -i ''s/\r$//'' STAGING/remote.sh && chmod +x STAGING/remote.sh && bash STAGING/remote.sh STAGING/rollout.tar.gz CONTAINER HOSTENV AGENTS && rm -rf STAGING'
$remoteCmd = $remoteCmd.Replace('STAGING', $remoteStaging).Replace('CONTAINER', $ContainerName).Replace('HOSTENV', $hostEnvToken).Replace('AGENTS', $agentsFlag)

Write-Step 'Transfert + application sur le NAS'
Invoke-NasSshWithStdin -RemoteCommand $remoteCmd -InputFile $bundlePath
Remove-Item -Force $bundlePath -ErrorAction SilentlyContinue

if (-not $KeepArtifact) {
    Remove-Item -Force $Artifact -ErrorAction SilentlyContinue
}

$displayHost = if ($DeployConfig['NAS_HOST']) { $DeployConfig['NAS_HOST'] } else { ($NasHost -split '@')[-1] }

Write-Host @"

Deploiement termine sur $NasHost
  DEVFORGE_ENABLED=true
  DEVFORGE_AGENTS_ENABLED=$agentsFlag

Ouvrir: http://${displayHost}:8080/devforge/
"@ -ForegroundColor Green
