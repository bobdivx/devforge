<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentMission;
use App\Models\Team;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Schema;

/**
 * Tableau de missions (bugs / features / veille) pour les agents DevForge.
 */
class AgentMissionBoard
{
    public const KINDS = ['bug', 'feature', 'tech_watch', 'github_pr', 'ops', 'other'];

    public const STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'];

    public const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

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
                        'metadata' => is_array($input['metadata'] ?? null)
                            ? array_merge(is_array($existing->metadata) ? $existing->metadata : [], $input['metadata'])
                            : $existing->metadata,
                    ]);
                }

                return $existing->fresh() ?? $existing;
            }
        }

        return AiAgentMission::create([
            'team_id' => $team->id,
            'agent_id' => $creator?->id,
            'assignee_agent_id' => $this->resolveAssigneeId($team, $input['assignee_agent_uuid'] ?? null),
            'resource_uuid' => $this->nullableString($input['resource_uuid'] ?? null, 64),
            'kind' => $kind,
            'status' => $status,
            'priority' => $priority,
            'title' => mb_substr($title, 0, 200),
            'description' => $this->nullableString($input['description'] ?? null, 8000),
            'source' => $this->nullableString($input['source'] ?? null, 64),
            'dedupe_key' => $dedupeKey !== null && $dedupeKey !== '' ? mb_substr($dedupeKey, 0, 190) : null,
            'metadata' => is_array($input['metadata'] ?? null) ? $input['metadata'] : null,
            'due_at' => null,
            'completed_at' => in_array($status, ['done', 'cancelled'], true) ? now() : null,
        ]);
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
        }

        if (array_key_exists('priority', $input)) {
            $payload['priority'] = $this->normalizePriority($input['priority']);
        }

        if (array_key_exists('assignee_agent_uuid', $input)) {
            $payload['assignee_agent_id'] = $this->resolveAssigneeId($team, $input['assignee_agent_uuid']);
        }

        if (array_key_exists('resource_uuid', $input)) {
            $payload['resource_uuid'] = $this->nullableString($input['resource_uuid'], 64);
        }

        if (array_key_exists('metadata', $input) && is_array($input['metadata'])) {
            $payload['metadata'] = array_merge(is_array($mission->metadata) ? $mission->metadata : [], $input['metadata']);
        }

        if ($payload !== []) {
            $mission->update($payload);
        }

        return $mission->fresh();
    }

    /**
     * Crée ou réutilise une mission tech-watch (dédupliquée).
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
            'assignee_agent_uuid' => $agent->uuid,
        ], $agent);

        return $result instanceof AiAgentMission ? $result : null;
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

    private function resolveAssigneeId(Team $team, mixed $uuid): ?int
    {
        $uuid = is_string($uuid) ? trim($uuid) : '';
        if ($uuid === '') {
            return null;
        }

        return AiAgent::query()
            ->where('team_id', $team->id)
            ->where('uuid', $uuid)
            ->value('id');
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
