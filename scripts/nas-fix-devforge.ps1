# Raccourci deploiement DevForge NAS (lit scripts/devforge-deploy.env)
#
# 1. cp scripts/devforge-deploy.env.example scripts/devforge-deploy.env
# 2. DEPLOY_MODE=images (defaut) ou overlay
# 3. .\scripts\nas-fix-devforge.ps1 -EnableAgents
#
# Voir docs/devforge-nas-cutover.md pour remplacer Coolify par la stack DevForge.

param(
    [switch]$EnableAgents,
    [switch]$SkipBuild,
    [switch]$SkipFrontend,
    [ValidateSet('', 'images', 'overlay')]
    [string]$DeployMode = ''
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rollout = Join-Path $scriptDir 'devforge-rollout.ps1'

$params = @{}
if ($EnableAgents) { $params.EnableAgents = $true }
if ($SkipBuild) { $params.SkipBuild = $true }
if ($SkipFrontend) { $params.SkipFrontend = $true }
if ($DeployMode) { $params.DeployMode = $DeployMode }

& $rollout @params
