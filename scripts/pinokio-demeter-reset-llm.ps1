# Remet Demeter / Pinokio en mode "serve.cjs only" :
# - tue les llama-server.exe lances a la main (port 10086)
# - supprime les lancements directs llama-server --model ... dans Pinokio
# - supprime l'auto-load injecte dans serve.cjs
#
# Usage (PowerShell admin recommande, sur Demeter) :
#   .\scripts\pinokio-demeter-reset-llm.ps1
#   .\scripts\pinokio-demeter-reset-llm.ps1 -PinokioRoot "D:\pinokio\api\uncensored-local-studio"

param(
    [string]$PinokioRoot = "D:\pinokio\api\uncensored-local-studio",
    [int]$LlmPort = 10086,
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host ">> $Message" -ForegroundColor Cyan
}

function Resolve-ServePath([string]$Root) {
    $candidates = @(
        (Join-Path $Root "app\scripts\server\serve.cjs"),
        (Join-Path $Root "scripts\server\serve.cjs"),
        (Join-Path $Root "app\app\scripts\server\serve.cjs")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }
    return $null
}

function Remove-AutoLoadBlock([string]$Content) {
    $patterns = @(
        '(?s)\r?\n// Auto-load LLM model on server startup.*?\}, \d+\);\r?\n',
        '(?s)\r?\n// Auto-load LLM model on server startup.*?\}, 2000\);\r?\n',
        '(?s)\r?\nsetTimeout\(async \(\) => \{\s*try \{\s*const models = typeof getLlmModels.*?startLlm\(.*?\}\s*\}, \d+\);\r?\n'
    )
    $result = $Content
    foreach ($pattern in $patterns) {
        $result = [regex]::Replace($result, $pattern, "`r`n")
    }
    return $result
}

function Strip-DirectLlamaLaunch([string]$Content) {
    # Ligne ou bloc lancant llama-server.exe avec --model (config manuelle DevForge)
    $patterns = @(
        '(?m)^.*llama-server\.exe.*--model.*$\r?\n',
        '(?m)^.*llama-server\.exe.*--port\s+\d+.*$\r?\n',
        '(?s)"message"\s*:\s*"[^"]*llama-server\.exe[^"]*--model[^"]*"',
        '(?s)llama-server\.exe\\s+--model\\s+[^"\r\n]+'
    )
    $result = $Content
    foreach ($pattern in $patterns) {
        $result = [regex]::Replace($result, $pattern, '')
    }
    return $result
}

if (-not (Test-Path -LiteralPath $PinokioRoot)) {
    Write-Error "Dossier Pinokio introuvable : $PinokioRoot"
}

Write-Step "Arret des processus llama-server sur le port $LlmPort"
Get-NetTCPConnection -LocalPort $LlmPort -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object {
        $proc = Get-Process -Id $_ -ErrorAction SilentlyContinue
        if ($proc -and ($proc.ProcessName -like '*llama*' -or $proc.Path -like '*llama-server*')) {
            if ($WhatIf) {
                Write-Host "  [WhatIf] Stop PID $($proc.Id) $($proc.ProcessName)" -ForegroundColor Yellow
            } else {
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                Write-Host "  Stop PID $($proc.Id) $($proc.ProcessName)" -ForegroundColor Green
            }
        }
    }

Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue | ForEach-Object {
    if ($WhatIf) {
        Write-Host "  [WhatIf] Stop llama-server PID $($_.Id)" -ForegroundColor Yellow
    } else {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        Write-Host "  Stop llama-server PID $($_.Id)" -ForegroundColor Green
    }
}

$servePath = Resolve-ServePath $PinokioRoot
if ($servePath) {
    Write-Step "Nettoyage serve.cjs : $servePath"
    $serveContent = Get-Content -LiteralPath $servePath -Raw
    $cleanServe = Remove-AutoLoadBlock $serveContent
    if ($cleanServe -ne $serveContent) {
        if ($WhatIf) {
            Write-Host "  [WhatIf] Auto-load supprime dans serve.cjs" -ForegroundColor Yellow
        } else {
            Set-Content -LiteralPath $servePath -Value $cleanServe.TrimEnd() -Encoding UTF8
            Write-Host "  Auto-load supprime dans serve.cjs" -ForegroundColor Green
        }
    } else {
        Write-Host "  Aucun auto-load dans serve.cjs" -ForegroundColor DarkGray
    }
} else {
    Write-Host "  serve.cjs introuvable sous $PinokioRoot" -ForegroundColor Yellow
}

Write-Step "Recherche de lancements directs llama-server --model"
$scanExtensions = @('*.js', '*.cjs', '*.bat', '*.cmd', '*.ps1', '*.json', '*.txt', '*.md')
$hits = @()
foreach ($ext in $scanExtensions) {
    Get-ChildItem -LiteralPath $PinokioRoot -Recurse -File -Filter $ext -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\node_modules\\|\\tools\\node-win\\|\\dist\\' } |
        ForEach-Object {
            $text = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
            if ($null -eq $text) { return }
            if ($text -match 'llama-server\.exe' -and $text -match '--model') {
                $hits += $_.FullName
            }
        }
}

if ($hits.Count -eq 0) {
    Write-Host "  Aucun fichier avec llama-server.exe --model" -ForegroundColor DarkGray
} else {
    foreach ($file in $hits | Select-Object -Unique) {
        Write-Host "  Trouve : $file" -ForegroundColor Yellow
        if ($file -like '*serve.cjs') { continue }
        $content = Get-Content -LiteralPath $file -Raw
        $clean = Strip-DirectLlamaLaunch $content
        if ($clean -ne $content) {
            if ($WhatIf) {
                Write-Host "    [WhatIf] Lignes llama-server --model supprimees" -ForegroundColor Yellow
            } else {
                Set-Content -LiteralPath $file -Value $clean.TrimEnd() -Encoding UTF8
                Write-Host "    Lignes llama-server --model supprimees" -ForegroundColor Green
            }
        } else {
            Write-Host "    A nettoyer manuellement (format non standard)" -ForegroundColor Red
        }
    }
}

$configDirs = @(
    (Join-Path $PinokioRoot "app\config"),
    (Join-Path $PinokioRoot "app\app\config")
)
foreach ($configDir in $configDirs) {
    $settingsPath = Join-Path $configDir "llm-model-settings.json"
    if (Test-Path -LiteralPath $settingsPath) {
        Write-Step "Config LLM persistee : $settingsPath"
        Write-Host "  Si l'ancien qwen3-coder revient, renommez ce fichier en .bak puis redemarrez Pinokio." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Termine." -ForegroundColor Green
Write-Host "1. Redemarrez Pinokio Uncensored Local Studio (Start dans Pinokio, PAS llama-server.exe seul)." -ForegroundColor Cyan
Write-Host "2. DevForge -> Parametres AI -> Demeter / Pinokio -> Tester -> Charger sur GPU (nouveau GGUF)." -ForegroundColor Cyan
Write-Host ""
Write-Host "NE PAS lancer manuellement :" -ForegroundColor Yellow
Write-Host "  llama-server.exe --model ... --port 10086" -ForegroundColor Yellow
Write-Host "Pinokio doit lancer serve.cjs ; le modele est choisi via l'API / DevForge." -ForegroundColor Yellow
