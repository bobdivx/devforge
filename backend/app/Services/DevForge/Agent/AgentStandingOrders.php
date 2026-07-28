<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentStandingOrder;
use Illuminate\Support\Collection;

/**
 * Standing orders par application / agent (politique permanente, inspiré OpenClaw).
 */
class AgentStandingOrders
{
    /**
     * @param  array<string, mixed>  $context
     */
    public function promptBlock(AiAgent $agent, array $context = []): string
    {
        if (! $this->available()) {
            return '';
        }

        $resourceUuid = $agent->resource_uuid
            ?: (is_string($context['application_uuid'] ?? null) ? $context['application_uuid'] : null);

        $rows = $this->forAgent($agent, $resourceUuid, $context['event'] ?? null);
        if ($rows->isEmpty()) {
            return '';
        }

        $lines = ['STANDING ORDERS (autorité permanente — respecter sauf contradiction de sécurité) :'];
        foreach ($rows as $row) {
            /** @var AiAgentStandingOrder $row */
            $lines[] = "### {$row->title}";
            if (is_array($row->triggers) && $row->triggers !== []) {
                $lines[] = 'Triggers: '.implode(', ', $row->triggers);
            }
            if ($row->approval_gates) {
                $lines[] = 'Gates: '.$row->approval_gates;
            }
            if ($row->escalation) {
                $lines[] = 'Escalade: '.$row->escalation;
            }
            $lines[] = trim((string) $row->body);
            $lines[] = '';
        }

        return trim(implode("\n", $lines));
    }

    /**
     * @return Collection<int, AiAgentStandingOrder>
     */
    public function forAgent(AiAgent $agent, ?string $resourceUuid = null, mixed $trigger = null): Collection
    {
        if (! $this->available()) {
            return collect();
        }

        $query = AiAgentStandingOrder::query()
            ->where('team_id', $agent->team_id)
            ->where('is_active', true)
            ->where(function ($q) use ($agent, $resourceUuid) {
                $q->whereNull('agent_id')
                    ->orWhere('agent_id', $agent->id);
            })
            ->where(function ($q) use ($resourceUuid) {
                $q->whereNull('resource_uuid');
                if ($resourceUuid) {
                    $q->orWhere('resource_uuid', $resourceUuid);
                }
            })
            ->orderByDesc('priority')
            ->orderBy('id');

        $rows = $query->get();

        if ($trigger === null || $trigger === '') {
            return $rows;
        }

        $triggerStr = (string) $trigger;

        return $rows->filter(function (AiAgentStandingOrder $row) use ($triggerStr) {
            $triggers = $row->triggers ?? [];
            if (! is_array($triggers) || $triggers === []) {
                return true;
            }

            return in_array($triggerStr, $triggers, true)
                || in_array('*', $triggers, true)
                || in_array('all', $triggers, true);
        })->values();
    }

    public function available(): bool
    {
        try {
            return \Illuminate\Support\Facades\Schema::hasTable('ai_agent_standing_orders');
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * Standing order deploy intégrée (fallback si aucune row DB).
     */
    public function defaultDeployFailureBody(): string
    {
        return implode("\n", [
            'Sur échec de déploiement :',
            '1. Agis en orchestrateur : spawn_task leaf_profile=diagnose puis yield_wait.',
            '2. Après review : spawn_task leaf_profile=fix puis yield_wait.',
            '3. Après review : spawn_task leaf_profile=redeploy (1× max) puis yield_wait.',
            '4. Rapport final dans le chat overview — jamais de 2e redeploy.',
            '5. Respecte les gates d’approbation du mode permission.',
        ]);
    }
}
