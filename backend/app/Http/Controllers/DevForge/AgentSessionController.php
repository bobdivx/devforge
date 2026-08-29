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
use App\Services\DevForge\Agent\AgentWelcomeComposer;
use App\Services\DevForge\Agent\ApplicationWorkspaceChatContext;
use App\Services\DevForge\Core\CurrentTeamContext;
use App\Services\DevForge\CurrentTeamResources;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

class AgentSessionController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly CurrentTeamResources $currentTeamResources,
        private readonly AgentSessionService $sessionService,
        private readonly AgentChatService $chatService,
        private readonly AgentWelcomeComposer $welcomeComposer,
    ) {}

    public function index(Request $request, string $uuid): JsonResponse
    {
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('view', $agent);

        if (! Schema::hasTable('ai_agent_sessions')) {
            return response()->json([
                'data' => [],
                'meta' => ['count' => 0, 'degraded' => true],
            ]);
        }

        $user = $this->currentUser($request);
        $sessions = $this->sessionService
            ->listForUser($agent, $user)
            ->map(fn (AiAgentSession $session) => $this->present($session));

        $active = $this->sessionService->activeForUser($agent, $user);

        return response()->json([
            'data' => $sessions->values(),
            'meta' => [
                'count' => $sessions->count(),
                'active_session_uuid' => $active?->uuid,
            ],
        ]);
    }

    public function store(Request $request, string $uuid): JsonResponse
    {
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('chat', $agent);

        if (! Schema::hasTable('ai_agent_sessions')) {
            abort(503, 'Les sessions nécessitent la migration ai_agent_sessions. Relancez le déploiement DevForge.');
        }

        $validated = $request->validate([
            'title' => ['nullable', 'string', 'max:120'],
        ]);

        $session = $this->sessionService->create(
            $agent,
            $this->currentUser($request),
            $validated['title'] ?? null,
        );

        return response()->json([
            'data' => $this->present($session),
        ], 201);
    }

    public function update(Request $request, string $uuid, string $sessionUuid): JsonResponse
    {
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('chat', $agent);

        $validated = $request->validate([
            'title' => ['nullable', 'string', 'max:120'],
            'chat_mode' => ['nullable', 'string', 'in:plan,build,debug'],
        ]);

        try {
            $session = $this->sessionService->findForUser(
                $agent,
                $this->currentUser($request),
                $sessionUuid,
            );
            if (isset($validated['title'])) {
                $session = $this->sessionService->updateTitle(
                    $session,
                    $this->currentUser($request),
                    $validated['title'],
                );
            }
            if (isset($validated['chat_mode'])) {
                $session->update(['chat_mode' => $validated['chat_mode']]);
                $session->refresh();
            }
        } catch (\InvalidArgumentException $exception) {
            abort(422, $exception->getMessage());
        }

        return response()->json([
            'data' => $this->present($session),
        ]);
    }

    public function activate(Request $request, string $uuid, string $sessionUuid): JsonResponse
    {
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('chat', $agent);

        try {
            $session = $this->sessionService->activate(
                $agent,
                $this->currentUser($request),
                $sessionUuid,
            );
        } catch (\InvalidArgumentException $exception) {
            abort(404, $exception->getMessage());
        }

        return response()->json([
            'data' => $this->present($session),
            'meta' => ['active_session_uuid' => $session->uuid],
        ]);
    }

    public function destroy(Request $request, string $uuid, string $sessionUuid): JsonResponse
    {
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('chat', $agent);

        if (! Schema::hasTable('ai_agent_sessions')) {
            abort(503, 'Les sessions nécessitent la migration ai_agent_sessions.');
        }

        $user = $this->currentUser($request);

        try {
            $this->sessionService->deleteForUser($agent, $user, $sessionUuid);
        } catch (\InvalidArgumentException $exception) {
            $message = $exception->getMessage();
            abort(str_contains(mb_strtolower($message), 'introuvable') ? 404 : 422, $message);
        }

        $remaining = $this->sessionService->listForUser($agent, $user);
        $next = $remaining->first();
        if ($next instanceof AiAgentSession) {
            $this->sessionService->rememberActive($agent, $user, $next);
        }

        return response()->json([
            'ok' => true,
            'meta' => [
                'deleted_session_uuid' => $sessionUuid,
                'active_session_uuid' => $next?->uuid,
                'remaining_count' => $remaining->count(),
            ],
        ]);
    }

    public function messages(Request $request, string $uuid, string $sessionUuid): JsonResponse
    {
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('view', $agent);

        $application = $this->optionalBoundApplication($request, $agent);

        if (! Schema::hasTable('ai_agent_messages')) {
            return response()->json([
                'data' => [$this->welcomeMessage($agent, $this->currentUser($request), application: $application)],
                'meta' => ['count' => 1, 'degraded' => true],
            ]);
        }

        try {
            $session = $this->sessionService->findForUser(
                $agent,
                $this->currentUser($request),
                $sessionUuid,
            );
            $this->sessionService->rememberActive($agent, $this->currentUser($request), $session);
        } catch (\InvalidArgumentException $exception) {
            abort(404, $exception->getMessage());
        }

        $messages = $this->chatService
            ->history($agent, $session)
            ->map(fn (AiAgentMessage $message) => $this->presentMessage($message));

        if ($messages->isEmpty()) {
            $messages = collect([$this->welcomeMessage($agent, $this->currentUser($request), $session, $application)]);
        }

        return response()->json([
            'data' => $messages->values(),
            'meta' => [
                'count' => $messages->count(),
                'session_uuid' => $session->uuid,
            ],
        ]);
    }

    public function sendMessage(Request $request, string $uuid, string $sessionUuid): JsonResponse
    {
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('chat', $agent);

        $validated = $request->validate([
            'content' => ['required', 'string', 'max:10000'],
            'application_uuid' => ['nullable', 'string', 'max:64'],
            'chat_mode' => ['nullable', 'string', 'in:plan,build,debug'],
            'attachments' => ['nullable', 'array', 'max:8'],
            'attachments.*.type' => ['nullable', 'string', 'max:32'],
            'attachments.*.label' => ['nullable', 'string', 'max:120'],
            'attachments.*.url' => ['nullable', 'string', 'max:2500000'],
            'attachments.*.text' => ['nullable', 'string', 'max:4000'],
            'attachments.*.selector' => ['nullable', 'string', 'max:500'],
        ]);

        if (! Schema::hasTable('ai_agent_messages') || ! Schema::hasTable('ai_agent_sessions')) {
            abort(503, 'Le chat nécessite les migrations sessions. Relancez le déploiement DevForge.');
        }

        try {
            $session = $this->sessionService->findForUser(
                $agent,
                $this->currentUser($request),
                $sessionUuid,
            );
            $context = $this->resolveApplicationChatContext(
                $request,
                $agent,
                $validated['application_uuid'] ?? null,
            );
            if (isset($validated['chat_mode'])) {
                $context['chat_mode'] = $validated['chat_mode'];
            }
            if (! empty($validated['attachments'])) {
                $context['attachments'] = $validated['attachments'];
            }
            $user = $this->currentUser($request);
            if (is_string($user->email) && $user->email !== '') {
                $context['user_email'] = $user->email;
            }
            $result = $this->chatService->queueMessage($agent, $session, $validated['content'], $context);
        } catch (\InvalidArgumentException $exception) {
            abort(422, $exception->getMessage());
        } catch (\Throwable $exception) {
            abort($this->httpStatusForException($exception), $exception->getMessage());
        }

        return response()->json([
            'data' => [
                'user' => $this->presentMessage($result['user']),
                'run_uuid' => $result['run']->uuid,
                'session_uuid' => $session->uuid,
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
     * @return array<string, mixed>
     */
    private function resolveApplicationChatContext(Request $request, AiAgent $agent, ?string $applicationUuid): array
    {
        $application = $this->boundApplication($request, $agent, $applicationUuid);
        if (! $application instanceof Application) {
            return [];
        }

        return $this->applicationChatContext($application);
    }

    private function optionalBoundApplication(Request $request, AiAgent $agent): ?Application
    {
        $uuid = $request->query('application_uuid') ?? $request->input('application_uuid');

        return $this->boundApplication($request, $agent, is_string($uuid) ? $uuid : null, abortOnMissing: false);
    }

    private function boundApplication(
        Request $request,
        AiAgent $agent,
        ?string $applicationUuid,
        bool $abortOnMissing = true,
    ): ?Application {
        if ($applicationUuid === null || trim($applicationUuid) === '') {
            return null;
        }

        try {
            $application = $this->currentTeamResources->application($this->currentUser($request), $applicationUuid);
        } catch (ModelNotFoundException) {
            if ($abortOnMissing) {
                abort(404, 'Application introuvable.');
            }

            return null;
        }

        if (
            is_string($agent->resource_uuid)
            && $agent->resource_uuid !== ''
            && $agent->resource_uuid !== $application->uuid
        ) {
            abort(422, 'Cet agent est lié à une autre application.');
        }

        return $application;
    }

    /**
     * @return array<string, mixed>
     */
    private function applicationChatContext(Application $application): array
    {
        return app(ApplicationWorkspaceChatContext::class)->build($application);
    }

    /** @return array<string, mixed> */
    private function present(AiAgentSession $session): array
    {
        return [
            'uuid' => $session->uuid,
            'title' => $session->title,
            'chat_mode' => $session->chat_mode ?? 'build',
            'is_legacy' => $session->isLegacyShared(),
            'last_message_at' => $session->last_message_at?->toISOString(),
            'created_at' => $session->created_at->toISOString(),
        ];
    }

    /** @return array<string, mixed> */
    private function presentMessage(AiAgentMessage $message): array
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
    private function welcomeMessage(
        AiAgent $agent,
        User $user,
        ?AiAgentSession $session = null,
        ?Application $application = null,
    ): array {
        return $this->welcomeComposer->compose($agent, $user, $session, $application);
    }
}
