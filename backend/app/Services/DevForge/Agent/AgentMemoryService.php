<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentMemory;
use App\Models\Team;
use Illuminate\Support\Collection;

/**
 * Mémoire individuelle (agent) + partagée (équipe / projet) — porté depuis Forge.
 */
class AgentMemoryService
{
    public const SCOPE_AGENT = 'agent';

    public const SCOPE_SHARED = 'shared';

    public const SCOPE_PROJECT = 'project';

    /** @return list<string> */
    public static function scopes(): array
    {
        return [self::SCOPE_AGENT, self::SCOPE_SHARED, self::SCOPE_PROJECT];
    }

    public function parseScope(mixed $raw, string $fallback = self::SCOPE_AGENT): string
    {
        $value = strtolower(trim((string) $raw));

        return match ($value) {
            'shared', 'org', 'team' => self::SCOPE_SHARED,
            'project', 'projet', 'resource' => self::SCOPE_PROJECT,
            'agent', 'self', 'individual' => self::SCOPE_AGENT,
            default => $fallback,
        };
    }

    /**
     * @param  list<string>|null  $tags
     */
    public function write(
        Team $team,
        string $content,
        string $scope = self::SCOPE_AGENT,
        ?AiAgent $agent = null,
        ?string $resourceUuid = null,
        ?array $tags = null,
    ): AiAgentMemory|array {
        $content = trim($content);
        if ($content === '') {
            return ['error' => 'contenu vide'];
        }
        if (mb_strlen($content) > 8000) {
            return ['error' => 'contenu trop long (max 8000)'];
        }

        $scope = $this->parseScope($scope);
        if ($scope === self::SCOPE_AGENT && $agent === null) {
            return ['error' => 'agent requis pour scope=agent'];
        }
        if ($scope === self::SCOPE_PROJECT && ($resourceUuid === null || trim($resourceUuid) === '')) {
            return ['error' => 'resource_uuid requis pour scope=project'];
        }

        $tagList = is_array($tags) ? array_values(array_filter(array_map('strval', $tags))) : [];
        if (! in_array("scope:{$scope}", $tagList, true)) {
            array_unshift($tagList, "scope:{$scope}");
        }

        return AiAgentMemory::query()->create([
            'team_id' => $team->id,
            'agent_id' => $scope === self::SCOPE_AGENT ? $agent?->id : null,
            'scope' => $scope,
            'resource_uuid' => $scope === self::SCOPE_PROJECT ? trim((string) $resourceUuid) : null,
            'content' => $content,
            'tags' => $tagList,
        ]);
    }

    /**
     * @return Collection<int, AiAgentMemory>
     */
    public function listForPrompt(
        Team $team,
        ?AiAgent $agent = null,
        ?string $resourceUuid = null,
        int $limitPerScope = 15,
    ): Collection {
        $query = AiAgentMemory::query()
            ->where('team_id', $team->id)
            ->where(function ($q) use ($agent, $resourceUuid) {
                $q->where('scope', self::SCOPE_SHARED);
                if ($agent !== null) {
                    $q->orWhere(function ($inner) use ($agent) {
                        $inner->where('scope', self::SCOPE_AGENT)
                            ->where('agent_id', $agent->id);
                    });
                }
                if ($resourceUuid !== null && trim($resourceUuid) !== '') {
                    $q->orWhere(function ($inner) use ($resourceUuid) {
                        $inner->where('scope', self::SCOPE_PROJECT)
                            ->where('resource_uuid', trim($resourceUuid));
                    });
                }
            })
            ->orderByDesc('created_at')
            ->limit($limitPerScope * 3)
            ->get();

        // Cap par scope
        $byScope = ['agent' => 0, 'shared' => 0, 'project' => 0];

        return $query->filter(function (AiAgentMemory $row) use (&$byScope, $limitPerScope) {
            $scope = $row->scope;
            if (! isset($byScope[$scope])) {
                return false;
            }
            if ($byScope[$scope] >= $limitPerScope) {
                return false;
            }
            $byScope[$scope]++;

            return true;
        })->values();
    }

    /**
     * @return Collection<int, AiAgentMemory>
     */
    public function listByScope(
        Team $team,
        string $scope,
        ?AiAgent $agent = null,
        ?string $resourceUuid = null,
        int $limit = 30,
        ?string $query = null,
    ): Collection {
        $scope = $this->parseScope($scope);
        $builder = AiAgentMemory::query()
            ->where('team_id', $team->id)
            ->where('scope', $scope)
            ->orderByDesc('created_at')
            ->limit($limit);

        if ($scope === self::SCOPE_AGENT && $agent !== null) {
            $builder->where('agent_id', $agent->id);
        }
        if ($scope === self::SCOPE_PROJECT && $resourceUuid !== null) {
            $builder->where('resource_uuid', trim($resourceUuid));
        }
        if ($query !== null && trim($query) !== '') {
            $builder->where('content', 'like', '%'.trim($query).'%');
        }

        return $builder->get();
    }

    /**
     * @param  Collection<int, AiAgentMemory>  $rows
     */
    public function formatPromptBlock(Collection $rows): string
    {
        if ($rows->isEmpty()) {
            return implode("\n", [
                'MÉMOIRE :',
                '- Aucun souvenir persisté pour le moment.',
                '- Utilise memory_write(scope="agent"|"shared"|"project", content="…") pour mémoriser.',
                '- Utilise memory_read(scope=…) pour relire pendant la tâche.',
            ]);
        }

        $sections = [
            self::SCOPE_AGENT => 'MÉMOIRE AGENT (individuelle) :',
            self::SCOPE_SHARED => 'MÉMOIRE PARTAGÉE (équipe) :',
            self::SCOPE_PROJECT => 'MÉMOIRE PROJET :',
        ];

        $parts = [];
        foreach ($sections as $scope => $title) {
            $scoped = $rows->where('scope', $scope)->values();
            if ($scoped->isEmpty()) {
                continue;
            }
            $lines = $scoped->map(function (AiAgentMemory $row): string {
                $content = mb_strlen($row->content) > 400
                    ? mb_substr($row->content, 0, 399).'…'
                    : $row->content;

                return "- #{$row->id}: {$content}";
            })->all();
            $parts[] = $title."\n".implode("\n", $lines);
        }

        $parts[] = 'Outils : memory_read / memory_write (scope=agent|shared|project). Préfère shared pour les conventions d’équipe.';

        return implode("\n\n", $parts);
    }

    /**
     * @param  Collection<int, AiAgentMemory>  $rows
     */
    public function formatToolOutput(string $scopeLabel, Collection $rows): string
    {
        if ($rows->isEmpty()) {
            return "Aucune mémoire ({$scopeLabel}).";
        }

        return $rows->map(function (AiAgentMemory $row): string {
            $when = $row->created_at?->toIso8601String() ?? '';

            return "#{$row->id} [{$row->scope}]{$when}\n{$row->content}";
        })->implode("\n\n---\n\n");
    }
}
