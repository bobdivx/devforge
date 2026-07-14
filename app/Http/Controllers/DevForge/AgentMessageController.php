<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\AiAgent;
use App\Models\AiAgentMessage;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Agent\AgentChatService;
use App\Services\DevForge\Core\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use RuntimeException;

class AgentMessageController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly AgentChatService $chatService,
    ) {}

    public function index(Request $request, string $uuid): JsonResponse
    {
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('view', $agent);

        if (! Schema::hasTable('ai_agent_messages')) {
            return response()->json([
                'data' => [$this->welcomeMessage($agent)],
                'meta' => ['count' => 1, 'degraded' => true],
            ]);
        }

        $messages = $this->chatService->history($agent)
            ->map(fn (AiAgentMessage $message) => $this->present($message));

        if ($messages->isEmpty()) {
            $messages = collect([$this->welcomeMessage($agent)]);
        }

        return response()->json([
            'data' => $messages->values(),
            'meta' => ['count' => $messages->count()],
        ]);
    }

    public function store(Request $request, string $uuid): JsonResponse
    {
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('chat', $agent);

        $validated = $request->validate([
            'content' => ['required', 'string', 'max:10000'],
        ]);

        if (! Schema::hasTable('ai_agent_messages')) {
            abort(503, 'Le chat nécessite la migration ai_agent_messages. Relancez le déploiement DevForge.');
        }

        try {
            $result = $this->chatService->queueMessage($agent, $validated['content']);
        } catch (\InvalidArgumentException $exception) {
            abort(422, $exception->getMessage());
        } catch (\Throwable $exception) {
            abort($this->httpStatusForException($exception), $exception->getMessage());
        }

        return response()->json([
            'data' => [
                'user' => $this->present($result['user']),
                'run_uuid' => $result['run']->uuid,
                'status' => 'pending',
            ],
        ], 202);
    }

    private function httpStatusForException(\Throwable $exception): int
    {
        $message = mb_strtolower($exception->getMessage());

        if (str_contains($message, '[429]') || str_contains($message, 'quota') || str_contains($message, 'rate limit')) {
            return 429;
        }

        if (str_contains($message, 'timed out') || str_contains($message, 'timeout')) {
            return 504;
        }

        return 502;
    }

    private function currentTeam(Request $request): Team
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return $this->currentTeamContext->resolve($user);
    }

    private function findAgent(Request $request, string $uuid): AiAgent
    {
        $team = $this->currentTeam($request);
        $agent = AiAgent::where('uuid', $uuid)->where('team_id', $team->id)->first();
        abort_unless($agent, 404, 'Agent introuvable.');

        return $agent;
    }

    /** @return array<string, mixed> */
    private function present(AiAgentMessage $message): array
    {
        return [
            'uuid' => $message->uuid,
            'role' => $message->role,
            'content' => $message->content,
            'metadata' => $message->metadata,
            'run_uuid' => $message->run?->uuid,
            'created_at' => $message->created_at->toISOString(),
        ];
    }

    /** @return array<string, mixed> */
    private function welcomeMessage(AiAgent $agent): array
    {
        $description = $agent->description
            ? "\n\n{$agent->description}"
            : '';

        return [
            'uuid' => 'welcome',
            'role' => 'assistant',
            'content' => "Bonjour, je suis **{$agent->name}**. Posez-moi une question sur votre infrastructure, vos déploiements ou demandez-moi d'analyser une ressource.{$description}",
            'metadata' => ['welcome' => true],
            'run_uuid' => null,
            'created_at' => $agent->created_at?->toISOString() ?? now()->toISOString(),
        ];
    }
}
