<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\AiAgent;
use App\Models\AiAgentMessage;
use App\Models\AiAgentSession;
use App\Models\Application;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Agent\AgentChatService;
use App\Services\DevForge\Agent\AgentSessionService;
use App\Services\DevForge\Core\CurrentTeamContext;
use App\Services\DevForge\CurrentTeamResources;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use RuntimeException;

class AgentMessageController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly CurrentTeamResources $currentTeamResources,
        private readonly AgentChatService $chatService,
        private readonly AgentSessionService $sessionService,
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

        if (! Schema::hasTable('ai_agent_sessions')) {
            return response()->json([
                'data' => [$this->welcomeMessage($agent)],
                'meta' => ['count' => 1, 'degraded' => true],
            ]);
        }

        try {
            $sessionUuid = $request->query('session_uuid');

            if ($sessionUuid) {
                $session = $this->sessionService->findForUser(
                    $agent,
                    $this->currentUser($request),
                    (string) $sessionUuid,
                );
            } else {
                $session = $this->sessionService->activeForUser($agent, $this->currentUser($request));
            }
        } catch (\Throwable) {
            return response()->json([
                'data' => [$this->welcomeMessage($agent)],
                'meta' => ['count' => 1, 'degraded' => true],
            ]);
        }

        if (! $session instanceof AiAgentSession) {
            return response()->json([
                'data' => [$this->welcomeMessage($agent)],
                'meta' => ['count' => 1],
            ]);
        }

        $messages = $this->chatService->history($agent, $session)
            ->map(fn (AiAgentMessage $message) => $this->present($message));

        if ($messages->isEmpty()) {
            $messages = collect([$this->welcomeMessage($agent, $session)]);
        }

        return response()->json([
            'data' => $messages->values(),
            'meta' => [
                'count' => $messages->count(),
                'session_uuid' => $session->uuid,
            ],
        ]);
    }

    public function store(Request $request, string $uuid): JsonResponse
    {
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('chat', $agent);

        $validated = $request->validate([
            'content' => ['required', 'string', 'max:10000'],
            'session_uuid' => ['nullable', 'string', 'max:64'],
            'application_uuid' => ['nullable', 'string', 'max:64'],
        ]);

        if (! Schema::hasTable('ai_agent_messages')) {
            abort(503, 'Le chat nécessite la migration ai_agent_messages. Relancez le déploiement DevForge.');
        }

        try {
            $session = $this->resolveSession($request, $agent, $validated['session_uuid'] ?? null);
            $context = $this->resolveApplicationChatContext(
                $request,
                $agent,
                $validated['application_uuid'] ?? null,
            );
            $result = $this->chatService->queueMessage($agent, $session, $validated['content'], $context);
        } catch (\InvalidArgumentException $exception) {
            abort(422, $exception->getMessage());
        } catch (\Throwable $exception) {
            abort($this->httpStatusForException($exception), $exception->getMessage());
        }

        return response()->json([
            'data' => [
                'user' => $this->present($result['user']),
                'run_uuid' => $result['run']->uuid,
                'session_uuid' => $session->uuid,
                'status' => 'pending',
            ],
        ], 202);
    }

    public function resolveApproval(Request $request, string $uuid, string $messageUuid): JsonResponse
    {
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('chat', $agent);

        $validated = $request->validate([
            'decision' => ['required', 'string', 'in:approve,deny'],
        ]);

        $message = AiAgentMessage::query()
            ->where('uuid', $messageUuid)
            ->where('agent_id', $agent->id)
            ->first();

        abort_unless($message, 404, 'Message introuvable.');

        try {
            $result = $this->chatService->resolveToolApproval($agent, $message, $validated['decision']);
        } catch (\InvalidArgumentException $exception) {
            abort(422, $exception->getMessage());
        }

        return response()->json([
            'data' => [
                'user' => $this->present($result['user']),
                'run_uuid' => $result['run']->uuid,
                'session_uuid' => $result['user']->session?->uuid,
                'decision' => $result['decision'],
                'status' => 'pending',
            ],
        ], 202);
    }

    private function resolveSession(Request $request, AiAgent $agent, ?string $sessionUuid = null): AiAgentSession
    {
        $user = $this->currentUser($request);
        $sessionUuid ??= $request->query('session_uuid');

        if (! Schema::hasTable('ai_agent_sessions')) {
            throw new RuntimeException('Les sessions nécessitent la migration ai_agent_sessions.');
        }

        if ($sessionUuid) {
            return $this->sessionService->findForUser($agent, $user, (string) $sessionUuid);
        }

        return $this->sessionService->resolveDefault($agent, $user);
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

    private function currentUser(Request $request): User
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return $user;
    }

    private function currentTeam(Request $request): Team
    {
        return $this->currentTeamContext->resolve($this->currentUser($request));
    }

    private function findAgent(Request $request, string $uuid): AiAgent
    {
        $team = $this->currentTeam($request);
        $agent = AiAgent::where('uuid', $uuid)->where('team_id', $team->id)->first();
        abort_unless($agent, 404, 'Agent introuvable.');

        return $agent;
    }

    /**
     * @return array<string, string>
     */
    private function resolveApplicationChatContext(Request $request, AiAgent $agent, ?string $applicationUuid): array
    {
        if ($applicationUuid === null || trim($applicationUuid) === '') {
            return [];
        }

        try {
            $application = $this->currentTeamResources->application($this->currentUser($request), $applicationUuid);
        } catch (ModelNotFoundException) {
            abort(404, 'Application introuvable.');
        }

        if (
            is_string($agent->resource_uuid)
            && $agent->resource_uuid !== ''
            && $agent->resource_uuid !== $application->uuid
        ) {
            abort(422, 'Cet agent est lié à une autre application.');
        }

        return $this->applicationChatContext($application);
    }

    /**
     * @return array<string, string>
     */
    private function applicationChatContext(Application $application): array
    {
        return array_filter([
            'application_uuid' => $application->uuid,
            'application_name' => (string) $application->name,
            'git_repository' => is_string($application->git_repository) ? $application->git_repository : null,
            'git_branch' => is_string($application->git_branch) ? $application->git_branch : null,
            'build_pack' => is_string($application->build_pack) ? $application->build_pack : null,
            'fqdn' => is_string($application->fqdn) ? $application->fqdn : null,
        ], fn (?string $value): bool => $value !== null && $value !== '');
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
            'session_uuid' => $message->session?->uuid,
            'created_at' => $message->created_at->toISOString(),
        ];
    }

    /** @return array<string, mixed> */
    private function welcomeMessage(AiAgent $agent, ?AiAgentSession $session = null): array
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
            'session_uuid' => $session?->uuid,
            'created_at' => $agent->created_at?->toISOString() ?? now()->toISOString(),
        ];
    }
}
