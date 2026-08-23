<?php

namespace App\Jobs;

use App\Models\Team;
use App\Services\DevForge\Agent\AgentSkillService;
use App\Services\DevForge\Agent\AgentRunner;
use App\Models\AiAgent;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Job asynchrone pour déployer Graft sur tous les repos de l'équipe.
 * Utilise l'agent Worker avec le skill deploy-graft-all-repos.
 */
class DeployGraftToAllReposJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 600; // 10 minutes max

    public function __construct(
        public readonly int $teamId,
    ) {}

    public function handle(AgentRunner $runner, AgentSkillService $skillService): void
    {
        $team = Team::find($this->teamId);

        if (! $team) {
            Log::error("[DeployGraftToAllReposJob] Team {$this->teamId} not found");
            return;
        }

        // Trouver l'agent Worker
        $worker = AiAgent::query()
            ->where('team_id', $team->id)
            ->where(function ($q) {
                $q->where('type', 'worker')
                    ->orWhere('slug', 'worker')
                    ->orWhere('name', 'like', '%Worker%');
            })
            ->where('is_active', true)
            ->first();

        if (! $worker) {
            Log::error("[DeployGraftToAllReposJob] Worker agent not found for team {$this->teamId}");
            return;
        }

        // Vérifier que le skill existe
        $skill = $skillService->findBySlug($team, 'deploy-graft-all-repos');

        if (! $skill) {
            Log::error("[DeployGraftToAllReposJob] Skill deploy-graft-all-repos not found");
            return;
        }

        Log::info("[DeployGraftToAllReposJob] Starting Graft deployment for team {$this->teamId}");

        // Préparer le prompt pour l'agent
        $prompt = <<<'PROMPT'
skill_load('deploy-graft-all-repos')

Déploie Graft context graph sur tous les repos de l'équipe.

Repos cibles :
- bobdivx/TeslaReports
- bobdivx/aline-farm
- bobdivx/eventlist
- bobdivx/macompta
- bobdivx/mf3d-filaments
- bobdivx/popcorn-client
- bobdivx/popcorn-web
- bobdivx/sonozz
- bobdivx/starbasefr
- bobdivx/tesla

Pour chaque repo :
1. Vérifie si Graft déjà présent (read_github_file package.json)
2. Si non présent :
   - Modifie package.json (ajoute @nanonets/graft aux devDependencies)
   - Crée/merge .mcp.json avec config Graft MCP server
   - Ajoute .graft/ au .gitignore
   - Crée GRAFT.md avec documentation
3. Commit direct sur main OU créer PR si main protégé
4. Log résultat : ✅ deployed / 🔀 PR created / ⏭️ skipped / ❌ error

À la fin, fournis un rapport résumé :
- Nombre de repos avec Graft déployé
- Nombre de PRs créées
- Nombre de repos skippés (déjà configurés)
- Nombre d'erreurs
- Temps total

Commence maintenant.
PROMPT;

        try {
            // Lancer l'agent avec le prompt
            $runner->run($worker, $prompt, [
                'source' => 'graft_automation_job',
                'metadata' => [
                    'job_id' => $this->job?->getJobId(),
                    'team_id' => $this->teamId,
                ],
            ]);

            Log::info("[DeployGraftToAllReposJob] Graft deployment completed for team {$this->teamId}");
        } catch (\Throwable $e) {
            Log::error("[DeployGraftToAllReposJob] Error deploying Graft for team {$this->teamId}: {$e->getMessage()}");
            throw $e;
        }
    }
}
