# Raccourci deploiement DevForge NAS (lit scripts/devforge-deploy.env)
#
# 1. cp scripts/devforge-deploy.env.example scripts/devforge-deploy.env
# 2. Patch rapide (recommandé au quotidien):
#      DEPLOY_MODE=overlay
#      NAS_CONTAINER=devforge-api
#    Puis: .\scripts\nas-fix-devforge.ps1 -EnableAgents
# 3. Rebuild images sur le NAS (sans Docker Hub):
#      .\scripts\nas-fix-devforge.ps1 -EnableAgents -DeployMode images
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
