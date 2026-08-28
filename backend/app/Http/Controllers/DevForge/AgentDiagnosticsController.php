<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\AiProviderConfig;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Agent\AgentDiagnosticsService;
use App\Services\DevForge\Core\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AgentDiagnosticsController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly AgentDiagnosticsService $diagnostics,
    ) {}

    public function run(Request $request): JsonResponse
    {
        $this->authorize('viewAny', AiProviderConfig::class);
        $team = $this->currentTeam($request);

        $validated = $request->validate([
            'check' => ['nullable', 'string', Rule::in(['rig', 'mcp', 'ollama', 'gemini'])],
        ]);

        return response()->json([
            'data' => $this->diagnostics->run($team, $validated['check'] ?? null),
        ]);
    }

    private function currentTeam(Request $request): Team
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return $this->currentTeamContext->resolve($user);
    }
}
