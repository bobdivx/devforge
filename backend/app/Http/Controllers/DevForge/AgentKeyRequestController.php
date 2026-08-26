<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Jobs\Agent\ResumeAgentAfterUserInputJob;
use App\Models\AiAgentKeyRequest;
use App\Models\Application;
use App\Models\SharedEnvironmentVariable;
use App\Services\DevForge\Agent\AgentMissionBoard;
use App\Services\DevForge\Application\ApplicationEnvironmentVariableCatalog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

class AgentKeyRequestController extends Controller
{
    public function __construct(
        private readonly ApplicationEnvironmentVariableCatalog $envCatalog,
        private readonly AgentMissionBoard $missionBoard,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $teamId = currentTeam()->id;
        $status = is_string($request->query('status')) ? $request->query('status') : 'pending';

        $query = AiAgentKeyRequest::query()
            ->with(['agent:id,uuid,name,type', 'application:uuid,name'])
            ->where('team_id', $teamId)
            ->orderByDesc('created_at')
            ->limit(50);

        if ($status !== 'all') {
            $query->where('status', $status);
        }

        $rows = $query->get()->map(fn (AiAgentKeyRequest $row) => $this->present($row))->values();

        return response()->json([
            'data' => $rows,
            'meta' => [
                'pending_count' => AiAgentKeyRequest::query()
                    ->where('team_id', $teamId)
                    ->where('status', 'pending')
                    ->count(),
            ],
        ]);
    }

    public function fulfill(Request $request, string $uuid): JsonResponse
    {
        $validated = $request->validate([
            'value' => ['nullable', 'string'],
            'confirmed' => ['nullable', 'boolean'],
            'scope' => ['nullable', 'string', 'in:shared,application'],
        ]);

        $team = currentTeam();
        $keyRequest = AiAgentKeyRequest::query()
            ->where('uuid', $uuid)
            ->where('team_id', $team->id)
            ->firstOrFail();

        if ($keyRequest->status !== 'pending') {
            return response()->json(['error' => 'Cette demande a déjà été traitée.'], 400);
        }

        $kind = (string) ($keyRequest->kind ?? 'secret');
        $value = trim((string) ($validated['value'] ?? ''));

        if (in_array($kind, ['secret', 'token', 'text'], true) && $value === '') {
            return response()->json(['error' => 'value requis pour ce type de demande.'], 422);
        }

        if ($kind === 'confirm' && empty($validated['confirmed']) && $value === '') {
            return response()->json(['error' => 'confirmed=true requis.'], 422);
        }

        $scope = (string) ($validated['scope'] ?? 'shared');
        $injected = null;

        if (in_array($kind, ['secret', 'token', 'text'], true) && $value !== '') {
            $injected = $this->injectValue($team->id, $keyRequest, $value, $scope);
            if (isset($injected['error'])) {
                return response()->json(['error' => $injected['error']], 422);
            }
        }

        $payload = ['status' => 'fulfilled'];
        if (Schema::hasColumn('ai_agent_key_requests', 'resolved_at')) {
            $payload['resolved_at'] = now();
        }
        $keyRequest->update($payload);

        if (is_string($keyRequest->mission_uuid) && $keyRequest->mission_uuid !== '') {
            $this->missionBoard->update($team, $keyRequest->mission_uuid, [
                'status' => 'open',
                'blocked_reason' => '',
                'metadata' => [
                    'user_input_resolved_key' => $keyRequest->key_name,
                ],
            ]);
        }

        ResumeAgentAfterUserInputJob::dispatch($keyRequest->id);

        return response()->json([
            'message' => 'Demande traitée. L’agent va reprendre (la valeur n’est pas renvoyée au modèle).',
            'data' => $this->present($keyRequest->fresh(['agent'])),
            'injected' => $injected,
        ]);
    }

    /**
     * @return array{ok: bool, target: string}|array{error: string}
     */
    private function injectValue(int $teamId, AiAgentKeyRequest $keyRequest, string $value, string $scope): array
    {
        $resourceUuid = is_string($keyRequest->resource_uuid) ? trim($keyRequest->resource_uuid) : '';

        if ($scope === 'application' || $resourceUuid !== '') {
            if ($resourceUuid === '') {
                return ['error' => 'resource_uuid manquant pour injecter sur l’application.'];
            }

            $application = Application::query()
                ->where('uuid', $resourceUuid)
                ->whereHas('environment.project', fn ($q) => $q->where('team_id', $teamId))
                ->first();

            if (! $application instanceof Application) {
                return ['error' => 'Application introuvable pour injection env.'];
            }

            try {
                $this->envCatalog->upsert($application, [
                    'key' => $keyRequest->key_name,
                    'value' => $value,
                    'is_buildtime' => true,
                    'is_runtime' => true,
                    'is_literal' => true,
                ]);
            } catch (\Throwable $exception) {
                return ['error' => mb_substr($exception->getMessage(), 0, 300)];
            }

            return ['ok' => true, 'target' => 'application:'.$application->uuid];
        }

        if (! Schema::hasTable('shared_environment_variables')) {
            return ['error' => 'Variables partagées indisponibles.'];
        }

        $existing = SharedEnvironmentVariable::query()
            ->where('team_id', $teamId)
            ->where('key', $keyRequest->key_name)
            ->first();

        if ($existing instanceof SharedEnvironmentVariable) {
            $existing->update(['value' => $value]);
        } else {
            SharedEnvironmentVariable::create([
                'key' => $keyRequest->key_name,
                'value' => $value,
                'team_id' => $teamId,
                'is_shown_once' => false,
            ]);
        }

        return ['ok' => true, 'target' => 'shared'];
    }

    /** @return array<string, mixed> */
    private function present(AiAgentKeyRequest $request): array
    {
        return [
            'uuid' => $request->uuid,
            'key_name' => $request->key_name,
            'kind' => $request->kind ?? 'secret',
            'reason' => $request->reason,
            'status' => $request->status,
            'resource_uuid' => $request->resource_uuid ?? null,
            'mission_uuid' => $request->mission_uuid ?? null,
            'agent' => $request->agent ? [
                'uuid' => $request->agent->uuid,
                'name' => $request->agent->name,
                'type' => $request->agent->type,
            ] : null,
            'agent_uuid' => $request->agent?->uuid,
            'agent_name' => $request->agent?->name,
            'agent_type' => $request->agent?->type,
            'application' => $request->application ? [
                'uuid' => $request->application->uuid,
                'name' => $request->application->name,
            ] : null,
            'application_uuid' => $request->application?->uuid,
            'application_name' => $request->application?->name,
            'created_at' => $request->created_at?->toISOString(),
            'resolved_at' => $request->resolved_at?->toISOString(),
        ];
    }
}
