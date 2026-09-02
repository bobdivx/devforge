# Configure (ou remplace) l'auto-load Pinokio pour UN modele GGUF precis.
# Preferer pinokio-serve-disable-autoload.ps1 + chargement via DevForge (#pinokio).
#
# Usage :
#   .\scripts\pinokio-serve-configure-autoload.ps1 -ModelFilename "mon-nouveau-modele-q4_k_m.gguf"
#   .\scripts\pinokio-serve-configure-autoload.ps1 -ModelFilename "qwen2.5-coder-7b-q4_k_m.gguf" -ContextSize 32768

param(
    [Parameter(Mandatory = $true)]
    [string]$ModelFilename,
    [string]$ServePath = "D:\pinokio\api\uncensored-local-studio\app\scripts\server\serve.cjs",
    [int]$ContextSize = 65536
)

if (-not (Test-Path -LiteralPath $ServePath)) {
    Write-Error "Fichier introuvable : $ServePath"
    exit 1
}

$safeModel = $ModelFilename -replace '"', '\"'
$content = Get-Content -LiteralPath $ServePath -Raw

# Retirer tout ancien bloc auto-load (y compris l'ancien qwen3-coder hardcode).
$content = [regex]::Replace($content, '(?s)\r?\n// Auto-load LLM model on server startup.*?\}, 2000\);\r?\n', "`r`n")

$autoLoadCode = @"

// Auto-load LLM model on server startup (configure via DevForge scripts/pinokio-serve-configure-autoload.ps1)
setTimeout(async () => {
  try {
    const models = typeof getLlmModels === "function" ? getLlmModels() : [];
    const target = models.find(m => !m.isProjector && m.filename === "$safeModel");
    if (!target) {
      console.warn("  [llm] Auto-load skipped: $safeModel not found in app/llm-models/");
      return;
    }
    console.log("  [llm] Auto-loading " + target.filename + " ($ContextSize context)...");
    await startLlm({
      model: target.filename,
      contextSize: $ContextSize,
      gpuLayers: -1,
      flashAttn: true,
      cacheTypeK: "q8_0",
      cacheTypeV: "q8_0",
      batchSize: 2048,
      ubatchSize: 512
    });
    console.log("  [llm] Model " + target.filename + " is READY in VRAM!");
  } catch (e) {
    console.warn("  [llm] Auto-start failed:", e.message);
  }
}, 2000);
"@

Set-Content -LiteralPath $ServePath -Value ($content.TrimEnd() + "`r`n" + $autoLoadCode) -Encoding UTF8
Write-Host "Auto-load configure pour : $ModelFilename ($ContextSize tokens)" -ForegroundColor Green
Write-Host "Redemarrez Pinokio pour appliquer." -ForegroundColor Cyan
