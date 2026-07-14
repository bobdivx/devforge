<?php

/**
 * Diagnostic : pourquoi aucun agent IA ne se déclenche sur un déploiement ?
 *
 * Usage (sur le NAS) :
 *   docker cp scripts/nas-deployment-agent-diagnose.php coolify:/tmp/diag.php
 *   docker exec -w /var/www/html coolify php /tmp/diag.php [deployment_uuid]
 */

$basePath = is_dir('/var/www/html/vendor') ? '/var/www/html' : dirname(__DIR__);

require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\ApplicationDeploymentQueue;
use App\Services\DevForge\Agent\DeploymentAgentResolver;

$deploymentUuid = $argv[1] ?? null;

echo "=== DIAGNOSTIC AGENTS DE DÉPLOIEMENT ===\n\n";

echo "--- Configuration ---\n";
echo 'devforge.enabled: '.(config('devforge.enabled') ? 'true' : 'false')."\n";
echo 'devforge.agents_enabled: '.(config('devforge.agents_enabled') ? 'true' : 'false')."\n";
echo 'devforge.agents_monitor_build_enabled: '.(config('devforge.agents_monitor_build_enabled', true) ? 'true' : 'false')."\n";
echo 'devforge.agents_auto_fix_deployments: '.(config('devforge.agents_auto_fix_deployments') ? 'true' : 'false')."\n\n";

$jobPath = $basePath.'/app/Jobs/ApplicationDeploymentJob.php';
$jobHasDispatch = is_file($jobPath)
    && str_contains((string) file_get_contents($jobPath), 'DeploymentBuildAgentDispatcher')
    && str_contains((string) file_get_contents($jobPath), 'DeploymentFailureAgentDispatcher');

echo "--- Code déploiement (cause n°1 si NON) ---\n";
echo 'ApplicationDeploymentJob.php présent: '.(is_file($jobPath) ? 'oui' : 'NON')."\n";
echo 'Appels DeploymentBuildAgentDispatcher + Failure: '.($jobHasDispatch ? 'oui' : 'NON — le job ne déclenche jamais les agents')."\n";
echo 'DeploymentAgentCatchUp.php: '.(class_exists(\App\Services\DevForge\Agent\DeploymentAgentCatchUp::class) ? 'oui' : 'non')."\n\n";

echo "--- Agents en base ---\n";
$agents = AiAgent::query()->with('providerConfig')->get();
if ($agents->isEmpty()) {
    echo "Aucun agent IA créé.\n\n";
} else {
    foreach ($agents as $agent) {
        $provider = $agent->hasLlmProvider() ? 'ok' : 'MANQUANT';
        echo "- {$agent->name} | type={$agent->type} | status={$agent->status} | actif=".($agent->is_active ? 'oui' : 'non')." | provider={$provider}\n";
    }
    echo "\n";
}

$resolver = app(DeploymentAgentResolver::class);
$team = $agents->first()?->team;
if ($team) {
    $diag = $resolver->diagnostics($team);
    echo "--- Éligibilité (équipe {$team->name}) ---\n";
    echo 'agents éligibles: '.($diag['eligible_agents_count'] ?? 0)."\n";
    echo 'agents actifs: '.($diag['active_agents_count'] ?? 0)."\n";
    echo 'avec provider: '.($diag['agents_with_provider_count'] ?? 0)."\n";
    echo 'occupés (running): '.($diag['agents_busy_count'] ?? 0)."\n";
    if (! empty($diag['blockers'])) {
        echo "bloqueurs:\n";
        foreach ($diag['blockers'] as $blocker) {
            echo "  - [{$blocker['code']}] {$blocker['message']}\n";
        }
    }
    echo "\n";
}

echo "--- Runs récents (ai_agent_runs) ---\n";
$recentRuns = AiAgentRun::query()->with('agent')->latest()->limit(5)->get();
if ($recentRuns->isEmpty()) {
    echo "Aucun run agent — le dispatcher n'a probablement jamais été appelé.\n\n";
} else {
    foreach ($recentRuns as $run) {
        $agentName = $run->agent?->name ?? '?';
        echo "- run {$run->uuid} | agent={$agentName} | status={$run->status} | trigger={$run->trigger} | {$run->created_at}\n";
    }
    echo "\n";
}

if ($deploymentUuid) {
    echo "--- Déploiement {$deploymentUuid} ---\n";
    $deployment = ApplicationDeploymentQueue::query()
        ->with('application.environment.project.team')
        ->where('deployment_uuid', $deploymentUuid)
        ->first();

    if (! $deployment) {
        echo "Déploiement introuvable.\n\n";
    } else {
        echo "status: {$deployment->status}\n";
        echo 'restart_only: '.($deployment->restart_only ? 'oui' : 'non')."\n";

        $linkedRuns = AiAgentRun::query()
            ->where('logs', 'like', '%"deployment_uuid":"'.$deploymentUuid.'"%')
            ->count();
        echo "runs liés (logs contenant deployment_uuid): {$linkedRuns}\n";

        if ($linkedRuns === 0 && ! $jobHasDispatch) {
            echo "\n>>> CONCLUSION: Ce déploiement n'a pas déclenché d'agent car ApplicationDeploymentJob\n";
            echo "    sur ce conteneur ne contient pas le code DevForge. Redéployez avec:\n";
            echo "    .\\scripts\\nas-fix-devforge.ps1 -EnableAgents\n";
        } elseif ($linkedRuns === 0 && $jobHasDispatch) {
            echo "\n>>> CONCLUSION: Le code dispatch est présent mais aucun run créé pour ce déploiement.\n";
            echo "    Vérifiez les logs Laravel (recherche 'DevForge: aucun agent éligible').\n";
        } elseif ($linkedRuns > 0) {
            $pending = AiAgentRun::query()
                ->where('logs', 'like', '%"deployment_uuid":"'.$deploymentUuid.'"%')
                ->where('status', 'pending')
                ->count();
            if ($pending > 0) {
                echo "\n>>> CONCLUSION: Run(s) créé(s) mais resté(s) en pending — Horizon ne traite pas la queue 'default'.\n";
                echo "    Vérifiez: docker exec coolify php artisan horizon:status\n";
            }
        }
        echo "\n";
    }
}

echo "--- Chaîne attendue ---\n";
echo "1. ApplicationDeploymentJob.handle() → DeploymentBuildAgentDispatcher (début)\n";
echo "2. failDeployment() → DeploymentFailureAgentDispatcher (échec)\n";
echo "3. AgentRunLauncher → crée ai_agent_runs (pending) + agent.status=running\n";
echo "4. RunAgentJob (queue default) → Horizon → AgentRunner\n";
echo "Si étape 1-2 absente sur le NAS, les agents restent idle malgré '2 éligibles'.\n";
