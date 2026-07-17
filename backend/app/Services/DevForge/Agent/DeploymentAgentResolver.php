<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiProviderConfig;
use App\Models\Application;
use App\Models\Team;
use Illuminate\Support\Collection;

class DeploymentAgentResolver
{
    /** @var list<string> */
    public const BUILD_TYPES = ['deployment', 'debug', 'devforge'];

    /** @var list<string> */
    public const FAILURE_TYPES = ['deployment', 'debug', 'devforge'];

    public function resolveTeam(Application $application): ?Team
    {
        $application->loadMissing('environment.project.team');

        $team = $application->team();

        return $team instanceof Team ? $team : null;
    }

    /**
     * @param  list<string>  $types
     */
    public function resolve(Team $team, string $applicationUuid, array $types = self::BUILD_TYPES): ?AiAgent
    {
        return $this->candidates($team, $applicationUuid, $types)
            ->sortByDesc(fn (AiAgent $agent): int => $this->agentScore($agent, $applicationUuid, $types))
            ->first();
    }

    /**
     * @param  list<string>  $types
     * @return Collection<int, AiAgent>
     */
    public function candidates(Team $team, string $applicationUuid, array $types = self::BUILD_TYPES): Collection
    {
        return AiAgent::query()
            ->where('team_id', $team->id)
            ->whereIn('type', $types)
            ->where('is_active', true)
            ->get()
            ->map(function (AiAgent $agent): AiAgent {
                $agent->prepareForEventDispatch();

                return $agent->fresh() ?? $agent;
            })
            ->filter(fn (AiAgent $agent): bool => $agent->hasLlmProvider() && $this->agentScore($agent, $applicationUuid, $types) >= 0)
            ->filter(fn (AiAgent $agent): bool => $agent->status !== 'running');
    }

    /**
     * @return array<string, mixed>
     */
    public function diagnostics(Team $team, ?string $applicationUuid = null): array
    {
        $applicationUuid ??= '';
        $allAgents = AiAgent::query()
            ->where('team_id', $team->id)
            ->whereIn('type', self::BUILD_TYPES)
            ->get();

        $activeAgents = $allAgents->where('is_active', true);
        $withProvider = $activeAgents->filter(fn (AiAgent $agent): bool => $agent->hasLlmProvider());
        $busyAgents = $withProvider->filter(fn (AiAgent $agent): bool => $agent->status === 'running');
        $scopedOut = $applicationUuid !== ''
            ? $withProvider->filter(fn (AiAgent $agent): bool => $this->agentScore($agent, $applicationUuid, self::BUILD_TYPES) < 0)
            : collect();
        $eligible = $applicationUuid !== ''
            ? $this->candidates($team, $applicationUuid, self::BUILD_TYPES)
            : $withProvider->filter(fn (AiAgent $agent): bool => $agent->status !== 'running');

        $teamHasProvider = AiProviderConfig::query()
            ->where('team_id', $team->id)
            ->exists();

        /** @var list<array{code: string, message: string}> $blockers */
        $blockers = [];

        if (! config('devforge.agents_enabled')) {
            $blockers[] = [
                'code' => 'agents_disabled',
                'message' => 'Les agents IA sont désactivés (DEVFORGE_AGENTS_ENABLED).',
            ];
        }

        if (! $teamHasProvider && $withProvider->isEmpty()) {
            $blockers[] = [
                'code' => 'no_llm_provider',
                'message' => 'Aucun provider LLM configuré. Ajoutez-en un dans Paramètres → Intelligence Artificielle.',
            ];
        }

        if ($activeAgents->isEmpty()) {
            $blockers[] = [
                'code' => 'no_active_agent',
                'message' => 'Aucun agent Déploiement, DevForge ou Débogage actif.',
            ];
        } elseif ($eligible->isEmpty() && $withProvider->isNotEmpty() && $busyAgents->count() === $withProvider->count()) {
            $blockers[] = [
                'code' => 'agents_busy',
                'message' => 'Tous les agents éligibles sont déjà en cours d\'exécution.',
            ];
        } elseif ($eligible->isEmpty() && $scopedOut->isNotEmpty()) {
            $blockers[] = [
                'code' => 'agent_scoped_other_app',
                'message' => 'Les agents actifs sont liés à une autre application.',
            ];
        } elseif ($eligible->isEmpty() && $activeAgents->isNotEmpty() && $withProvider->isEmpty()) {
            $blockers[] = [
                'code' => 'agents_without_provider',
                'message' => 'Des agents existent mais aucun n\'a de provider LLM.',
            ];
        }

        return [
            'eligible_agents_count' => $eligible->count(),
            'active_agents_count' => $activeAgents->count(),
            'agents_with_provider_count' => $withProvider->count(),
            'agents_busy_count' => $busyAgents->count(),
            'team_has_llm_provider' => $teamHasProvider,
            'blockers' => $blockers,
            'eligible_agents' => $eligible
                ->map(fn (AiAgent $agent): array => [
                    'uuid' => $agent->uuid,
                    'name' => $agent->name,
                    'type' => $agent->type,
                ])
                ->values()
                ->all(),
        ];
    }

    /**
     * @param  list<string>  $types
     */
    private function agentScore(AiAgent $agent, string $applicationUuid, array $types): int
    {
        if ($applicationUuid !== '' && $agent->resource_uuid !== null && $agent->resource_uuid !== '' && $agent->resource_uuid !== $applicationUuid) {
            return -1;
        }

        $score = match ($agent->type) {
            'deployment' => 100,
            'devforge' => 95,
            'debug' => 50,
            default => in_array($agent->type, $types, true) ? 10 : 0,
        };

        if ($applicationUuid !== '' && $agent->resource_uuid === $applicationUuid) {
            $score += 50;
        } elseif ($agent->resource_uuid === null || $agent->resource_uuid === '') {
            $score += 10;
        }

        return $score;
    }
}
