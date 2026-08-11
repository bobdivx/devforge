<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentMission;
use App\Models\Team;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Tableau de missions (bugs / features / veille) pour les agents DevForge.
 */
class AgentMissionBoard
{
    public const KINDS = ['bug', 'feature', 'tech_watch', 'github_pr', 'ops', 'other'];

    public const STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'];

    public const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

    /** @var array<string, string> kind → type d'agent assignee par défaut */
    public const DEFAULT_ASSIGNEE_TYPE_BY_KIND = [
        'tech_watch' => 'devforge',
        'feature' => 'devforge',
        'bug' => 'debug',
        'ops' => 'deployment',
        'github_pr' => 'github',
        'other' => 'devforge',
    ];

    public function available(): bool
    {
        return Schema::hasTable('ai_agent_missions');
    }

    /**
     * @param  array{status?: string, kind?: string, q?: string, agent_id?: int|null}  $filters
     * @return Collection<int, AiAgentMission>
     */
    public function list(Team $team, array $filters = [], int $limit = 50): Collection
    {
        if (! $this->available()) {
            return collect();
        }

        $query = AiAgentMission::query()
            ->with(['assignee:id,uuid,name,type', 'agent:id,uuid,name,type'])
            ->where('team_id', $team->id)
            ->orderByRaw("CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END")
            ->orderByDesc('updated_at')
            ->limit(max(1, min($limit, 100)));

        if (! empty($filters['status']) && in_array($filters['status'], self::STATUSES, true)) {
            $query->where('status', $filters['status']);
        }

        if (! empty($filters['kind']) && in_array($filters['kind'], self::KINDS, true)) {
            $query->where('kind', $filters['kind']);
        }

        if (isset($filters['agent_id']) && is_numeric($filters['agent_id'])) {
            $query->where(function ($q) use ($filters): void {
                $q->where('agent_id', (int) $filters['agent_id'])
                    ->orWhere('assignee_agent_id', (int) $filters['agent_id']);
            });
        }

        $q = trim((string) ($filters['q'] ?? ''));
        if ($q !== '') {
            $like = '%'.str_replace(['%', '_'], ['\\%', '\\_'], $q).'%';
            $query->where(function ($inner) use ($like): void {
                $inner->where('title', 'like', $like)
                    ->orWhere('description', 'like', $like);
            });
        }

        return $query->get();
    }

    /**
     * @param  array<string, mixed>  $input
     * @return AiAgentMission|array{error: string}
     */
    public function create(Team $team, array $input, ?AiAgent $creator = null): AiAgentMission|array
    {
        if (! $this->available()) {
            return ['error' => 'Table missions indisponible (migration manquante).'];
        }

        $title = trim((string) ($input['title'] ?? ''));
        if ($title === '') {
            return ['error' => 'title requis'];
        }

        $kind = $this->normalizeKind($input['kind'] ?? 'other');
        $status = $this->normalizeStatus($input['status'] ?? 'open');
        $priority = $this->normalizePriority($input['priority'] ?? 'normal');
        $dedupeKey = isset($input['dedupe_key']) ? trim((string) $input['dedupe_key']) : null;

        $assigneeResolution = $this->resolveAssignee($team, $input, $kind);
        if (isset($assigneeResolution['error'])) {
            return $assigneeResolution;
        }

        $metadata = is_array($input['metadata'] ?? null) ? $input['metadata'] : [];
        if (($assigneeResolution['assignee_type'] ?? null) !== null) {
            $metadata['assignee_type'] = $assigneeResolution['assignee_type'];
        }
        if (! empty($input['blocked_reason'])) {
            $metadata['blocked_reason'] = mb_substr(trim((string) $input['blocked_reason']), 0, 1000);
        }
        if (! empty($input['parent_mission_uuid'])) {
            $metadata['parent_mission_uuid'] = trim((string) $input['parent_mission_uuid']);
        }

        if ($dedupeKey !== null && $dedupeKey !== '') {
            $existing = AiAgentMission::query()
                ->where('team_id', $team->id)
                ->where('dedupe_key', mb_substr($dedupeKey, 0, 190))
                ->first();

            if ($existing instanceof AiAgentMission) {
                if (in_array($existing->status, ['done', 'cancelled'], true)) {
                    $existing->update([
                        'status' => 'open',
                        'completed_at' => null,
                        'title' => mb_substr($title, 0, 200),
                        'description' => $this->nullableString($input['description'] ?? $existing->description, 8000),
                        'priority' => $priority,
                        'assignee_agent_id' => $assigneeResolution['assignee_agent_id'],
                        'metadata' => array_merge(is_array($existing->metadata) ? $existing->metadata : [], $metadata),
                    ]);
                }

                return $existing->fresh(['assignee', 'agent']) ?? $existing;
            }
        }

        return AiAgentMission::create([
            'team_id' => $team->id,
            'agent_id' => $creator?->id,
            'assignee_agent_id' => $assigneeResolution['assignee_agent_id'],
            'resource_uuid' => $this->nullableString($input['resource_uuid'] ?? null, 64),
            'kind' => $kind,
            'status' => $status,
            'priority' => $priority,
            'title' => mb_substr($title, 0, 200),
            'description' => $this->nullableString($input['description'] ?? null, 8000),
            'source' => $this->nullableString($input['source'] ?? null, 64),
            'dedupe_key' => $dedupeKey !== null && $dedupeKey !== '' ? mb_substr($dedupeKey, 0, 190) : null,
            'metadata' => $metadata === [] ? null : $metadata,
            'due_at' => null,
            'completed_at' => in_array($status, ['done', 'cancelled'], true) ? now() : null,
        ])->load(['assignee', 'agent']);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return AiAgentMission|array{error: string}
     */
    public function update(Team $team, string $missionUuid, array $input): AiAgentMission|array
    {
        if (! $this->available()) {
            return ['error' => 'Table missions indisponible.'];
        }

        $mission = AiAgentMission::query()
            ->where('team_id', $team->id)
            ->where('uuid', $missionUuid)
            ->first();

        if (! $mission instanceof AiAgentMission) {
            return ['error' => 'Mission introuvable.'];
        }

        $payload = [];
        $metadata = is_array($mission->metadata) ? $mission->metadata : [];

        if (array_key_exists('title', $input)) {
            $title = trim((string) $input['title']);
            if ($title === '') {
                return ['error' => 'title vide'];
            }
            $payload['title'] = mb_substr($title, 0, 200);
        }

        if (array_key_exists('description', $input)) {
            $payload['description'] = $this->nullableString($input['description'], 8000);
        }

        if (array_key_exists('kind', $input)) {
            $payload['kind'] = $this->normalizeKind($input['kind']);
        }

        if (array_key_exists('status', $input)) {
            $status = $this->normalizeStatus($input['status']);
            $payload['status'] = $status;
            $payload['completed_at'] = in_array($status, ['done', 'cancelled'], true) ? now() : null;
            if ($status !== 'blocked') {
                unset($metadata['blocked_reason']);
            }
        }

        if (array_key_exists('priority', $input)) {
            $payload['priority'] = $this->normalizePriority($input['priority']);
        }

        if (array_key_exists('assignee_agent_uuid', $input) || array_key_exists('assignee_type', $input)) {
            $kind = $payload['kind'] ?? $mission->kind;
            $resolution = $this->resolveAssignee($team, $input, (string) $kind);
            if (isset($resolution['error'])) {
                return $resolution;
            }
            $payload['assignee_agent_id'] = $resolution['assignee_agent_id'];
            if (($resolution['assignee_type'] ?? null) !== null) {
                $metadata['assignee_type'] = $resolution['assignee_type'];
            }
        }

        if (array_key_exists('resource_uuid', $input)) {
            $payload['resource_uuid'] = $this->nullableString($input['resource_uuid'], 64);
        }

        if (array_key_exists('blocked_reason', $input)) {
            $reason = trim((string) $input['blocked_reason']);
            if ($reason === '') {
                unset($metadata['blocked_reason']);
            } else {
                $metadata['blocked_reason'] = mb_substr($reason, 0, 1000);
                if (! isset($payload['status'])) {
                    $payload['status'] = 'blocked';
                    $payload['completed_at'] = null;
                }
            }
        }

        if (array_key_exists('run_uuid', $input)) {
            $runUuid = trim((string) $input['run_uuid']);
            if ($runUuid === '') {
                unset($metadata['run_uuid']);
            } else {
                $metadata['run_uuid'] = mb_substr($runUuid, 0, 64);
            }
        }

        if (array_key_exists('metadata', $input) && is_array($input['metadata'])) {
            $metadata = array_merge($metadata, $input['metadata']);
        }

        $payload['metadata'] = $metadata === [] ? null : $metadata;

        if ($payload !== []) {
            $mission->update($payload);
        }

        return $mission->fresh(['assignee', 'agent']);
    }

    /**
     * Transition en masse (ex. nettoyer les claims fantômes in_progress → done).
     *
     * @return array{updated: int}|array{error: string}
     */
    public function bulkTransition(Team $team, string $fromStatus, string $toStatus): array
    {
        if (! $this->available()) {
            return ['error' => 'Table missions indisponible.'];
        }

        $from = $this->normalizeStatus($fromStatus);
        $to = $this->normalizeStatus($toStatus);

        if (! in_array($from, ['open', 'in_progress', 'blocked'], true)) {
            return ['error' => 'Statut source non autorisé pour un bulk.'];
        }

        if (! in_array($to, ['done', 'cancelled', 'open'], true)) {
            return ['error' => 'Statut cible non autorisé pour un bulk.'];
        }

        $missions = AiAgentMission::query()
            ->where('team_id', $team->id)
            ->where('status', $from)
            ->orderBy('id')
            ->limit(200)
            ->get();

        $updated = 0;

        foreach ($missions as $mission) {
            $input = [
                'status' => $to,
                'metadata' => [
                    'bulk_closed_at' => now()->toISOString(),
                    'bulk_closed_from' => $from,
                    'bulk_closed_to' => $to,
                ],
            ];

            if ($to === 'open') {
                $input['blocked_reason'] = '';
            }

            $result = $this->update($team, $mission->uuid, $input);
            if ($result instanceof AiAgentMission) {
                $updated++;
            }
        }

        return ['updated' => $updated];
    }

    /**
     * Claim atomique : open → in_progress + assignee = agent courant.
     *
     * @return AiAgentMission|array{error: string}
     */
    public function claim(Team $team, string $missionUuid, AiAgent $agent): AiAgentMission|array
    {
        if (! $this->available()) {
            return ['error' => 'Table missions indisponible.'];
        }

        if ((int) $agent->team_id !== (int) $team->id) {
            return ['error' => 'Agent hors équipe.'];
        }

        return DB::transaction(function () use ($team, $missionUuid, $agent): AiAgentMission|array {
            $mission = AiAgentMission::query()
                ->where('team_id', $team->id)
                ->where('uuid', $missionUuid)
                ->lockForUpdate()
                ->first();

            if (! $mission instanceof AiAgentMission) {
                return ['error' => 'Mission introuvable.'];
            }

            if ($mission->status === 'in_progress' && (int) $mission->assignee_agent_id === (int) $agent->id) {
                return $mission->fresh(['assignee', 'agent']) ?? $mission;
            }

            if (! in_array($mission->status, ['open', 'blocked'], true)) {
                return ['error' => 'Mission non claimable (statut: '.$mission->status.').'];
            }

            if ($mission->assignee_agent_id !== null
                && (int) $mission->assignee_agent_id !== (int) $agent->id
                && $mission->status === 'in_progress') {
                return ['error' => 'Mission déjà assignée à un autre agent.'];
            }

            $metadata = is_array($mission->metadata) ? $mission->metadata : [];
            $metadata['claimed_at'] = now()->toISOString();
            unset($metadata['blocked_reason']);

            $mission->update([
                'status' => 'in_progress',
                'assignee_agent_id' => $agent->id,
                'completed_at' => null,
                'metadata' => $metadata,
            ]);

            return $mission->fresh(['assignee', 'agent']) ?? $mission;
        });
    }

    /**
     * @return AiAgentMission|array{error: string}
     */
    public function show(Team $team, string $missionUuid): AiAgentMission|array
    {
        if (! $this->available()) {
            return ['error' => 'Table missions indisponible.'];
        }

        $mission = AiAgentMission::query()
            ->with(['assignee:id,uuid,name,type', 'agent:id,uuid,name,type'])
            ->where('team_id', $team->id)
            ->where('uuid', $missionUuid)
            ->first();

        if (! $mission instanceof AiAgentMission) {
            return ['error' => 'Mission introuvable.'];
        }

        return $mission;
    }

    public function defaultAssigneeTypeForKind(string $kind): string
    {
        $kind = $this->normalizeKind($kind);

        return self::DEFAULT_ASSIGNEE_TYPE_BY_KIND[$kind] ?? 'devforge';
    }

    /**
     * Résout le premier agent actif d'un type dans l'équipe.
     */
    public function findAgentByType(Team $team, string $type): ?AiAgent
    {
        $type = trim($type);
        if ($type === '') {
            return null;
        }

        return AiAgent::query()
            ->where('team_id', $team->id)
            ->where('type', $type)
            ->where('is_active', true)
            ->orderBy('id')
            ->first();
    }

    /**
     * Crée ou réutilise une mission tech-watch (dédupliquée), assignée à un implementer.
     *
     * @param  array<string, mixed>  $metadata
     */
    public function upsertTechWatch(
        Team $team,
        AiAgent $agent,
        string $title,
        string $description,
        string $dedupeKey,
        array $metadata = [],
        ?string $resourceUuid = null,
    ): ?AiAgentMission {
        $result = $this->create($team, [
            'title' => $title,
            'description' => $description,
            'kind' => 'tech_watch',
            'status' => 'open',
            'priority' => 'normal',
            'source' => 'tech-watch',
            'dedupe_key' => $dedupeKey,
            'resource_uuid' => $resourceUuid,
            'metadata' => $metadata,
            'assignee_type' => 'devforge',
        ], $agent);

        return $result instanceof AiAgentMission ? $result : null;
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{assignee_agent_id: int|null, assignee_type: string|null}|array{error: string}
     */
    private function resolveAssignee(Team $team, array $input, string $kind): array
    {
        $uuid = isset($input['assignee_agent_uuid']) ? trim((string) $input['assignee_agent_uuid']) : '';
        $type = isset($input['assignee_type']) ? trim((string) $input['assignee_type']) : '';

        if ($uuid !== '') {
            $id = AiAgent::query()
                ->where('team_id', $team->id)
                ->where('uuid', $uuid)
                ->value('id');

            if ($id === null) {
                return ['error' => 'assignee_agent_uuid introuvable dans l’équipe.'];
            }

            $agentType = AiAgent::query()->whereKey($id)->value('type');

            return [
                'assignee_agent_id' => (int) $id,
                'assignee_type' => is_string($agentType) ? $agentType : null,
            ];
        }

        if ($type === '') {
            $type = $this->defaultAssigneeTypeForKind($kind);
        }

        $agent = $this->findAgentByType($team, $type);

        return [
            'assignee_agent_id' => $agent?->id,
            'assignee_type' => $type,
        ];
    }

    private function normalizeKind(mixed $value): string
    {
        $kind = strtolower(trim((string) $value));

        return in_array($kind, self::KINDS, true) ? $kind : 'other';
    }

    private function normalizeStatus(mixed $value): string
    {
        $status = strtolower(trim((string) $value));

        return in_array($status, self::STATUSES, true) ? $status : 'open';
    }

    private function normalizePriority(mixed $value): string
    {
        $priority = strtolower(trim((string) $value));

        return in_array($priority, self::PRIORITIES, true) ? $priority : 'normal';
    }

    private function nullableString(mixed $value, int $max): ?string
    {
        if (! is_string($value) && ! is_numeric($value)) {
            return null;
        }

        $trimmed = trim((string) $value);

        return $trimmed === '' ? null : mb_substr($trimmed, 0, $max);
    }
}
