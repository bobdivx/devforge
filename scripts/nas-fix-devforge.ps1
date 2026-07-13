# Raccourci deploiement DevForge NAS (lit scripts/devforge-deploy.env)
#
# 1. cp scripts/devforge-deploy.env.example scripts/devforge-deploy.env
# 2. Editer NAS_SSH_PASSWORD dans devforge-deploy.env
# 3. .\scripts\nas-fix-devforge.ps1 -EnableAgents

param(
    [switch]$EnableAgents,
    [switch]$SkipBuild,
    [switch]$SkipFrontend
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rollout = Join-Path $scriptDir 'devforge-rollout.ps1'

$params = @{}
if ($EnableAgents) { $params.EnableAgents = $true }
if ($SkipBuild) { $params.SkipBuild = $true }
if ($SkipFrontend) { $params.SkipFrontend = $true }

& $rollout @params
