# Soft rename already applied: sources live in frontend/
# This script is a no-op if frontend/ exists and package.json workspace is frontend.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'devforge'
$dst = Join-Path $root 'frontend'

if (Test-Path $dst) {
    Write-Host 'frontend/ already present — soft rename done.'
    if ((Test-Path $src) -and (Test-Path (Join-Path $src 'README.md'))) {
        Write-Host 'Stub leftover at devforge/README.md — safe to delete the folder when unlocked.'
    }
    exit 0
}

if (-not (Test-Path $src)) {
    throw 'Neither frontend/ nor devforge/ found.'
}

Rename-Item -Path $src -NewName 'frontend'
Write-Host 'Renamed devforge -> frontend. Update package.json workspaces if needed.'
