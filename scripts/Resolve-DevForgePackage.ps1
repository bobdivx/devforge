# Résolution et validation du manifeste DevForge (source unique pour rollout PS1).
# Usage dot-source: . .\scripts\Resolve-DevForgePackage.ps1
# Usage CLI:       pwsh -File scripts/Resolve-DevForgePackage.ps1 [-Root C:\path\coolify]

param(
    [string]$Root = ''
)

if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

$script:DevForgePackageRoot = $Root

function Expand-DevForgeGlobPath {
    param(
        [string]$Root,
        [string]$Pattern
    )

    $normalized = $Pattern -replace '/', [IO.Path]::DirectorySeparatorChar
    $fullPattern = Join-Path $Root $normalized
    $parent = Split-Path $fullPattern -Parent
    $leaf = Split-Path $fullPattern -Leaf

    if (-not (Test-Path $parent)) {
        return @()
    }

    return @(Get-ChildItem -Path $parent -Filter $leaf -Recurse -File -ErrorAction SilentlyContinue |
        ForEach-Object {
            $_.FullName.Substring($Root.Length + 1) -replace '\\', '/'
        })
}

function Read-DevForgePathListFile {
    param([string]$FilePath)

    if (-not (Test-Path $FilePath)) {
        throw "Fichier introuvable: $FilePath"
    }

    return @(Get-Content $FilePath -Encoding UTF8 |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and -not $_.StartsWith('#') })
}

function Get-DevForgePackagePaths {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    $pathsFile = Join-Path $Root 'scripts/devforge-package.paths'
    $requiredFile = Join-Path $Root 'scripts/devforge-package.required'
    $checksFile = Join-Path $Root 'scripts/devforge-package.content-checks.json'
    $apiFile = Join-Path $Root 'routes/devforge-api.php'

    $collected = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)

    foreach ($entry in (Read-DevForgePathListFile -FilePath $pathsFile)) {
        if ($entry -like 'glob:*') {
            $pattern = $entry.Substring(5)
            foreach ($match in (Expand-DevForgeGlobPath -Root $Root -Pattern $pattern)) {
                [void]$collected.Add($match)
            }
            continue
        }

        [void]$collected.Add(($entry -replace '\\', '/'))
    }

    if (Test-Path $requiredFile) {
        foreach ($entry in (Read-DevForgePathListFile -FilePath $requiredFile)) {
            [void]$collected.Add(($entry -replace '\\', '/'))
        }
    }

    foreach ($migration in @(
        (Join-Path $Root 'database/migrations/2026_07_13_*'),
        (Join-Path $Root 'database/migrations/*ai_agent*'),
        (Join-Path $Root 'database/migrations/*ai_provider*')
    )) {
        Get-ChildItem -Path $migration -ErrorAction SilentlyContinue | ForEach-Object {
            $relative = $_.FullName.Substring($Root.Length + 1) -replace '\\', '/'
            [void]$collected.Add($relative)
        }
    }

    if (Test-Path $apiFile) {
        $requiredRoutes = Select-String -Path $apiFile -Pattern "require __DIR__\.'/([^']+)'" -AllMatches |
            ForEach-Object { $_.Matches } |
            ForEach-Object { "routes/$($_.Groups[1].Value)" }

        $missingRoutes = @($requiredRoutes | Where-Object { -not $collected.Contains($_) })
        if ($missingRoutes.Count -gt 0) {
            throw "devforge-package.paths manque des routes requises par devforge-api.php: $($missingRoutes -join ', ')"
        }
    }

    $discoverScript = Join-Path $Root 'scripts/devforge-package-discover.php'
    if (Test-Path $discoverScript) {
        $phpExe = $null
        foreach ($candidate in @('php', 'php.exe')) {
            if (Get-Command $candidate -ErrorAction SilentlyContinue) {
                $phpExe = (Get-Command $candidate).Source
                break
            }
        }

        if ($phpExe) {
            & $phpExe $discoverScript $Root | ForEach-Object {
                $line = $_.Trim()
                if ($line) {
                    [void]$collected.Add($line)
                }
            }
        }
    }

    $existing = @($collected | Where-Object { Test-Path (Join-Path $Root $_) } | Sort-Object)

    if ($existing.Count -eq 0) {
        throw 'Aucun fichier DevForge a empaqueter.'
    }

    Test-DevForgePackageIntegrity -Root $Root -Paths $existing -ChecksFile $checksFile

    return $existing
}

function Test-DevForgePathCoveredByPackage {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Paths,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    $normalized = ($RelativePath -replace '\\', '/').TrimStart('/')

    if ($Paths -contains $normalized) {
        return $true
    }

    foreach ($entry in $Paths) {
        $prefix = ($entry -replace '\\', '/').TrimEnd('/')
        if ($normalized.StartsWith("$prefix/", [StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }

    return $false
}

function Test-DevForgePackageIntegrity {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,
        [Parameter(Mandatory = $true)]
        [string[]]$Paths,
        [Parameter(Mandatory = $true)]
        [string]$ChecksFile
    )

    $requiredFile = Join-Path $Root 'scripts/devforge-package.required'
    $missingRequired = @()

    if (Test-Path $requiredFile) {
        foreach ($entry in (Read-DevForgePathListFile -FilePath $requiredFile)) {
            $normalized = $entry -replace '\\', '/'
            if (-not (Test-DevForgePathCoveredByPackage -Paths $Paths -RelativePath $normalized)) {
                $missingRequired += $normalized
            }
        }
    }

    if ($missingRequired.Count -gt 0) {
        throw "Rollout DevForge incomplet - fichiers obligatoires absents du package:`n  $($missingRequired -join "`n  ")`nAjoutez-les dans scripts/devforge-package.required ou scripts/devforge-package.paths"
    }

    if (-not (Test-Path $ChecksFile)) {
        return
    }

    $checksJson = Get-Content $ChecksFile -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($check in $checksJson.checks) {
        $relativePath = ([string]$check.path) -replace '\\', '/'
        $fullPath = Join-Path $Root $relativePath

        if (-not (Test-Path $fullPath)) {
            throw "Validation contenu impossible - fichier absent du depot: $relativePath ($($check.description))"
        }

        if (-not (Test-DevForgePathCoveredByPackage -Paths $Paths -RelativePath $relativePath)) {
            throw "Validation contenu impossible - fichier non inclus dans le package: $relativePath ($($check.description))"
        }

        $content = Get-Content $fullPath -Raw -Encoding UTF8
        foreach ($needle in @($check.must_contain)) {
            if ($content -notlike "*$needle*") {
                throw "Validation contenu echouee: $relativePath`n  Attendu: '$needle'`n  Contexte: $($check.description)"
            }
        }
    }
}

if ($MyInvocation.InvocationName -ne '.' -and $MyInvocation.Line -notmatch '^\s*\.\s') {
    Get-DevForgePackagePaths -Root $script:DevForgePackageRoot
}
