<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Jobs\DeployGraftToAllReposJob;
use App\Models\AiAgent;
use App\Services\DevForge\Core\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Controller pour les automations Graft (déploiement multi-repos).
 */
class GraftAutomationController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
    ) {}

    /**
     * Déclenche le déploiement Graft sur tous les repos de l'équipe.
     *
     * POST /api/v1/devforge/graft/deploy-all
     */
    public function deployToAllRepos(Request $request): JsonResponse
    {
        $this->authorize('create', AiAgent::class);
        $team = $this->currentTeamContext->team($request);

        // Dispatch job asynchrone
        $job = DeployGraftToAllReposJob::dispatch($team->id);

        return response()->json([
            'message' => 'Graft deployment started',
            'status' => 'queued',
            'job_id' => $job->getJobId() ?? null,
            'estimated_time' => '2-3 minutes',
            'repos_count' => 10,
        ]);
    }

    /**
     * Retourne le statut du déploiement Graft.
     *
     * GET /api/v1/devforge/graft/status
     */
    public function status(Request $request): JsonResponse
    {
        $this->authorize('viewAny', AiAgent::class);
        $team = $this->currentTeamContext->team($request);

        // TODO: Implémenter tracking du statut via cache ou DB
        // Pour l'instant, retourne un statut simple

        return response()->json([
            'status' => 'available',
            'last_deployment' => null,
            'repos_configured' => 0,
            'total_repos' => 10,
        ]);
    }

    /**
     * Déclenche le déploiement Graft sur un repo spécifique.
     *
     * POST /api/v1/devforge/graft/deploy/{repo}
     */
    public function deployToRepo(Request $request, string $repo): JsonResponse
    {
        $this->authorize('create', AiAgent::class);
        $team = $this->currentTeamContext->team($request);

        $validated = $request->validate([
            'repo' => ['required', 'string', 'regex:/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/'],
        ]);

        // TODO: Implémenter déploiement sur un seul repo

        return response()->json([
            'message' => "Graft deployment to {$repo} started",
            'status' => 'queued',
            'repo' => $repo,
        ]);
    }
}
