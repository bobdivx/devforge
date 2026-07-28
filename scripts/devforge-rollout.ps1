# Déploiement DevForge automatisé (Windows → NAS)
#
# Modes (scripts/devforge-deploy.env → DEPLOY_MODE):
#   images  (défaut) — build images Docker sur le NAS + docker compose
#   overlay — ancien docker cp dans le conteneur coolify (transition)
#
# 1. Copier scripts/devforge-deploy.env.example → scripts/devforge-deploy.env
# 2. .\scripts\nas-fix-devforge.ps1 -EnableAgents

param(
    [string]$NasHost = '',
    [string]$ContainerName = '',
    [string]$EnvFile = '',
    [string]$DeployMode = '',
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

if ([string]::IsNullOrWhiteSpace($DeployMode)) {
    $DeployMode = if ($DeployConfig['DEPLOY_MODE']) { $DeployConfig['DEPLOY_MODE'] } else { 'images' }
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
$PackageResolver = Join-Path $Root 'scripts/Resolve-DevForgePackage.ps1'
$RemoteScript = Join-Path $Root 'scripts/devforge-rollout-remote.sh'
$RemoteImagesScript = Join-Path $Root 'scripts/devforge-rollout-images-remote.sh'
$NasDataDirScript = Join-Path $Root 'scripts/devforge-nas-data-dir.sh'
$DiskPruneScript = Join-Path $Root 'scripts/devforge-disk-prune.sh'

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
    if (-not (Test-NasSshKeyReady)) { return $null }
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

function Invoke-CmdPipeline {
    param([string]$Command)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $lines = cmd /c $Command 2>&1
        $text = ($lines | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { [string]$_ }
        }) -join [Environment]::NewLine
        return [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Output = $text }
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Invoke-NasSshWithStdin {
    param([string]$RemoteCommand, [string]$InputFile)

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
        if ($result.ExitCode -ne 0) { throw "plink a echoue (code $($result.ExitCode)): $($result.Output)" }
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

function Invoke-OverlayDeploy {
    if (-not $SkipFrontend) {
        Write-Step 'Build Astro DevForge (overlay)'
        if (Test-Path (Join-Path $Root 'package-lock.json')) {
            npm ci
            if ($LASTEXITCODE -ne 0) { throw 'npm ci a echoue.' }
        } else {
            npm install
            if ($LASTEXITCODE -ne 0) { throw 'npm install a echoue.' }
        }
        $env:DEVFORGE_SPA_BASE = '/devforge'
        npm run build:devforge
        if ($LASTEXITCODE -ne 0) { throw 'npm run build:devforge a echoue.' }
    }

    if (-not $SkipBuild) {
        Write-Step 'Preparation artefact overlay'
        $existing = @(Get-PackagePaths)
        if ($existing.Count -eq 0) { throw 'Aucun fichier DevForge a empaqueter.' }
        . $PackageResolver
        $staging = Join-Path $env:TEMP "devforge-pkg-$timestamp"
        if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
        New-Item -ItemType Directory -Force -Path $staging | Out-Null
        foreach ($deployPath in $existing) {
            $src = Get-DevForgeSourceFullPath -Root $Root -DeployRelativePath $deployPath
            $dest = Join-Path $staging ($deployPath -replace '/', [IO.Path]::DirectorySeparatorChar)
            $destParent = Split-Path $dest -Parent
            if (-not (Test-Path $destParent)) { New-Item -ItemType Directory -Force -Path $destParent | Out-Null }
            if (Test-Path $src -PathType Container) {
                Copy-Item -Path $src -Destination $dest -Recurse -Force
            } else {
                Copy-Item -Path $src -Destination $dest -Force
            }
        }
        & tar -czf $Artifact -C $staging .
        $tarExit = $LASTEXITCODE
        Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
        if ($tarExit -ne 0) { throw 'tar a echoue.' }
    }

    if ($SkipBuild -and -not (Test-Path $Artifact)) {
        $latest = Get-ChildItem -Path $Root -Filter 'devforge-rollout-*.tar.gz' |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($null -eq $latest) { throw 'Aucun artefact trouve.' }
        $Artifact = $latest.FullName
    }

    $agentsFlag = if ($EnableAgents) { 'true' } else { 'false' }
    $hostEnvToken = if ($EnvFile) { $EnvFile } else { '-' }
    $bundleStaging = Join-Path $env:TEMP "devforge-bundle-$timestamp"
    $bundlePath = Join-Path $env:TEMP "devforge-bundle-$timestamp.tar.gz"
    New-Item -ItemType Directory -Force -Path $bundleStaging | Out-Null
    Copy-Item -Path $Artifact -Destination (Join-Path $bundleStaging 'rollout.tar.gz') -Force
    Copy-Item -Path $RemoteScript -Destination (Join-Path $bundleStaging 'remote.sh') -Force
    Copy-Item -Path $NasDataDirScript -Destination (Join-Path $bundleStaging 'devforge-nas-data-dir.sh') -Force
    & tar -czf $bundlePath -C $bundleStaging rollout.tar.gz remote.sh devforge-nas-data-dir.sh
    if ($LASTEXITCODE -ne 0) { throw 'Creation du bundle SSH a echoue.' }
    Remove-Item -Recurse -Force $bundleStaging

    $remoteStaging = "/DATA/.devforge/staging/bundle-$timestamp"
    $remoteCmd = 'mkdir -p STAGING && tar --warning=no-timestamp -xzf - -C STAGING && sed -i ''s/\r$//'' STAGING/remote.sh STAGING/devforge-nas-data-dir.sh && chmod +x STAGING/remote.sh && bash STAGING/remote.sh STAGING/rollout.tar.gz CONTAINER HOSTENV AGENTS && rm -rf STAGING'
    $remoteCmd = $remoteCmd.Replace('STAGING', $remoteStaging).Replace('CONTAINER', $ContainerName).Replace('HOSTENV', $hostEnvToken).Replace('AGENTS', $agentsFlag)

    Write-Step 'Transfert overlay NAS'
    Invoke-NasSshWithStdin -RemoteCommand $remoteCmd -InputFile $bundlePath
    Remove-Item -Force $bundlePath -ErrorAction SilentlyContinue
    if (-not $KeepArtifact) { Remove-Item -Force $Artifact -ErrorAction SilentlyContinue }
}

function Invoke-ImagesDeploy {
    Write-Step 'Preparation contexte images Docker'
    $contextStaging = Join-Path $env:TEMP "devforge-imgctx-$timestamp"
    if (Test-Path $contextStaging) { Remove-Item -Recurse -Force $contextStaging }
    New-Item -ItemType Directory -Force -Path $contextStaging | Out-Null

    $copyDirs = @(
        'backend',
        'frontend',
        'docker',
        'scripts',
        'docs/changelogs'
    )
    foreach ($rel in $copyDirs) {
        $src = Join-Path $Root ($rel -replace '/', [IO.Path]::DirectorySeparatorChar)
        if (-not (Test-Path $src)) { continue }
        $dest = Join-Path $contextStaging ($rel -replace '/', [IO.Path]::DirectorySeparatorChar)
        $destParent = Split-Path $dest -Parent
        if (-not (Test-Path $destParent)) { New-Item -ItemType Directory -Force -Path $destParent | Out-Null }
        Copy-Item -Path $src -Destination $dest -Recurse -Force
    }

    foreach ($file in @(
        'package.json',
        'package-lock.json',
        'docker-compose.yml',
        'docker-compose.prod.yml',
        '.env.devforge.example'
    )) {
        $src = Join-Path $Root $file
        if (Test-Path $src) {
            Copy-Item -Path $src -Destination (Join-Path $contextStaging $file) -Force
        }
    }

    # Exclude heavy / irrelevant trees from context
    $excludeGlobs = @(
        'backend\vendor',
        'backend\node_modules',
        'backend\storage\logs\*',
        'frontend\node_modules',
        'frontend\dist',
        'backend\public\devforge\_astro'
    )
    foreach ($g in $excludeGlobs) {
        $full = Join-Path $contextStaging $g
        Get-Item $full -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }

    if (-not $SkipFrontend) {
        Write-Step 'Build SPA local (verification + assets overlay fallback)'
        if (Test-Path (Join-Path $Root 'package-lock.json')) {
            npm ci
            if ($LASTEXITCODE -ne 0) { throw 'npm ci a echoue.' }
        }
        # Keep overlay-compatible assets in repo public/ for hybrid; image build uses DEVFORGE_SPA_BASE=/
        $env:DEVFORGE_SPA_BASE = '/devforge'
        npm run build:devforge
        if ($LASTEXITCODE -ne 0) { throw 'npm run build:devforge a echoue.' }
        $built = Join-Path $Root 'backend\public\devforge'
        if (Test-Path $built) {
            $destPublic = Join-Path $contextStaging 'backend\public\devforge'
            New-Item -ItemType Directory -Force -Path (Split-Path $destPublic -Parent) | Out-Null
            Copy-Item -Path $built -Destination $destPublic -Recurse -Force
        }
    }

    if ($SkipBuild) {
        Write-Host 'SkipBuild: transfert contexte sans rebuild local npm (images build sur NAS).' -ForegroundColor Yellow
    }

    $contextTar = Join-Path $env:TEMP "devforge-imgctx-$timestamp.tar.gz"
    Write-Step 'Compression contexte Docker'
    & tar -czf $contextTar -C $contextStaging .
    if ($LASTEXITCODE -ne 0) { throw 'tar contexte a echoue.' }
    Remove-Item -Recurse -Force $contextStaging -ErrorAction SilentlyContinue
    Write-Host "Contexte: $contextTar ($([math]::Round((Get-Item $contextTar).Length / 1MB, 2)) Mo)" -ForegroundColor Green

    $agentsFlag = if ($EnableAgents) { 'true' } else { 'false' }
    $bundleStaging = Join-Path $env:TEMP "devforge-imgbundle-$timestamp"
    $bundlePath = Join-Path $env:TEMP "devforge-imgbundle-$timestamp.tar.gz"
    New-Item -ItemType Directory -Force -Path $bundleStaging | Out-Null
    Copy-Item $contextTar (Join-Path $bundleStaging 'context.tar.gz') -Force
    Copy-Item $RemoteImagesScript (Join-Path $bundleStaging 'remote-images.sh') -Force
    Copy-Item $DiskPruneScript (Join-Path $bundleStaging 'devforge-disk-prune.sh') -Force
    & tar -czf $bundlePath -C $bundleStaging context.tar.gz remote-images.sh devforge-disk-prune.sh
    if ($LASTEXITCODE -ne 0) { throw 'bundle images SSH a echoue.' }
    Remove-Item -Recurse -Force $bundleStaging -ErrorAction SilentlyContinue
    Remove-Item -Force $contextTar -ErrorAction SilentlyContinue

    $remoteStaging = "/DATA/.devforge/staging/images-$timestamp"
    $remoteCmd = @"
mkdir -p STAGING/context && tar --warning=no-timestamp -xzf - -C STAGING && sed -i 's/\r`$//' STAGING/remote-images.sh STAGING/devforge-disk-prune.sh && chmod +x STAGING/remote-images.sh STAGING/devforge-disk-prune.sh && mkdir -p STAGING/context && tar --warning=no-timestamp -xzf STAGING/context.tar.gz -C STAGING/context && mkdir -p STAGING/context/scripts && cp STAGING/devforge-disk-prune.sh STAGING/context/scripts/ && bash STAGING/remote-images.sh STAGING/context AGENTS && rm -rf STAGING
"@
    $remoteCmd = $remoteCmd.Replace('STAGING', $remoteStaging).Replace('AGENTS', $agentsFlag)

    Write-Step 'Transfert + build images sur le NAS'
    Invoke-NasSshWithStdin -RemoteCommand $remoteCmd -InputFile $bundlePath
    Remove-Item -Force $bundlePath -ErrorAction SilentlyContinue
}

# --- main ---

if ([string]::IsNullOrWhiteSpace($NasHost)) {
    Write-Host @"

Mode local uniquement.
Configurer scripts/devforge-deploy.env puis:
  .\scripts\nas-fix-devforge.ps1 -EnableAgents

DEPLOY_MODE=$DeployMode
"@ -ForegroundColor Yellow
    exit 0
}

if (Test-NasSshKeyReady) {
    Write-Host "SSH: cle $($Script:SshKeyPath)" -ForegroundColor DarkGray
} elseif ($Script:SshPassword) {
    Write-Host 'SSH: mot de passe / plink / sshpass' -ForegroundColor DarkGray
} else {
    Write-Host 'SSH: saisie manuelle eventuelle' -ForegroundColor DarkGray
}

Write-Step "Mode deploiement: $DeployMode"
$agentsFlag = if ($EnableAgents) { 'true' } else { 'false' }

if ($DeployMode -eq 'overlay') {
    Invoke-OverlayDeploy
} else {
    Invoke-ImagesDeploy
}

$displayHost = if ($DeployConfig['NAS_HOST']) { $DeployConfig['NAS_HOST'] } else { ($NasHost -split '@')[-1] }
$openPath = if ($DeployMode -eq 'overlay') { '/devforge/' } else { '/' }

Write-Host @"

Deploiement termine sur $NasHost
  DEPLOY_MODE=$DeployMode
  DEVFORGE_ENABLED=true
  DEVFORGE_AGENTS_ENABLED=$agentsFlag

Ouvrir: http://${displayHost}:8080${openPath}
"@ -ForegroundColor Green
