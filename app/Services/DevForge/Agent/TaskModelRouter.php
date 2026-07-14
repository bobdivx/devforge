<?php

namespace App\Services\DevForge\Agent;

use App\Enums\TaskModelTier;

/**
 * Routage intelligent Auto → tier (léger / standard / complexe) → modèles Gemini chat.
 */
class TaskModelRouter
{
    /** @var array<string, array<int, string>> */
    private const TIER_MODEL_PRIORITY = [
        'light' => [
            'gemini-2.0-flash-lite',
            'gemini-2.5-flash-lite',
        ],
        'standard' => [
            'gemini-2.5-flash',
            'gemini-2.0-flash',
        ],
        'heavy' => [
            'gemini-2.5-flash',
            'gemini-2.0-flash',
            'gemini-2.5-pro',
        ],
    ];

    /**
     * @param  array<string, mixed>  $context
     */
    public function classify(string $message, string $trigger, string $agentType, array $context = []): TaskModelTier
    {
        $event = (string) ($context['event'] ?? '');
        $lower = mb_strtolower(trim($message));

        if (in_array($event, ['deployment_failed'], true)) {
            return TaskModelTier::Standard;
        }

        if ($agentType === 'security') {
            return TaskModelTier::Heavy;
        }

        if (in_array($trigger, ['scheduled'], true) && in_array($agentType, ['debug', 'devforge', 'deployment'], true)) {
            return TaskModelTier::Standard;
        }

        if ($lower !== '' && $this->matchesHeavyPatterns($lower)) {
            return TaskModelTier::Heavy;
        }

        if ($lower !== '' && $this->matchesLightPatterns($lower)) {
            return TaskModelTier::Light;
        }

        if (in_array($event, ['deployment_build_started', 'deployment_build_completed'], true)) {
            return TaskModelTier::Standard;
        }

        if (in_array($agentType, ['debug', 'devforge', 'github', 'deployment'], true)) {
            return TaskModelTier::Standard;
        }

        return TaskModelTier::Light;
    }

    /**
     * @param  array<string, mixed>  $context
     */
    public function reason(string $message, string $trigger, string $agentType, array $context, TaskModelTier $tier): string
    {
        $event = (string) ($context['event'] ?? '');

        return match (true) {
            $event === 'deployment_failed' => 'Échec de déploiement — diagnostic logs (Flash).',
            $event === 'delegated' && ($context['ephemeral'] ?? false) => 'Sous-tâche éphémère isolée.',
            $trigger === 'chat' && $tier === TaskModelTier::Light => 'Question ou inspection simple.',
            $trigger === 'chat' && $tier === TaskModelTier::Heavy => 'Analyse multi-étapes ou correction demandée.',
            $tier === TaskModelTier::Heavy => 'Tâche complexe (logs, root cause, sécurité).',
            $tier === TaskModelTier::Standard => 'Diagnostic ou exploration GitHub / infra.',
            default => 'Tâche légère — modèle rapide privilégié.',
        };
    }

    /** @return array{tier: string, tier_label: string, model_label: string, reason: string, display: string} */
    public function routingPayload(TaskModelTier $tier, string $reason): array
    {
        return [
            'tier' => $tier->value,
            'tier_label' => $tier->label(),
            'model_label' => $tier->modelLabel(),
            'reason' => $reason,
            'display' => 'Auto · '.$tier->modelLabel(),
        ];
    }

    /**
     * @param  array<int, string>  $available
     * @return array<int, string>
     */
    public function prioritizeModelsForTier(TaskModelTier $tier, array $available): array
    {
        $compatible = array_values(array_filter(
            $available,
            fn (string $id): bool => LlmModelResolver::isStableToolCallingGeminiModel($id),
        ));

        $priority = self::TIER_MODEL_PRIORITY[$tier->value] ?? [];
        $ordered = [];

        foreach ($priority as $model) {
            if (in_array($model, $compatible, true)) {
                $ordered[] = $model;
            }
        }

        foreach ($compatible as $id) {
            if (! in_array($id, $ordered, true) && $this->modelMatchesTier($id, $tier)) {
                $ordered[] = $id;
            }
        }

        if ($ordered !== []) {
            return $ordered;
        }

        return LlmModelResolver::prioritizeGeminiModels($compatible !== [] ? $compatible : LlmModelResolver::defaultAutoGeminiModels());
    }

    private function modelMatchesTier(string $modelId, TaskModelTier $tier): bool
    {
        $id = mb_strtolower($modelId);

        return match ($tier) {
            TaskModelTier::Light => str_contains($id, 'lite'),
            TaskModelTier::Standard => str_contains($id, 'flash') && ! str_contains($id, 'lite'),
            TaskModelTier::Heavy => str_contains($id, 'pro'),
        };
    }

    private function matchesHeavyPatterns(string $lower): bool
    {
        return (bool) preg_match(
            '/(root cause|cause racine|analys(e|er)|corrige|correction|optimis|debug|d[ée]bog|s[ée]curit|audit|incident|post-mortem|refactor|architecture|multi.?[ée]tape)/u',
            $lower,
        ) || mb_strlen($lower) > 400;
    }

    private function matchesLightPatterns(string $lower): bool
    {
        return (bool) preg_match(
            '/^(liste|list|quel est|quels sont|as.?tu acc|peux.?tu acc|y.?a.?t.?il|statut|status|combien|hello|bonjour)/u',
            $lower,
        ) || mb_strlen($lower) < 80;
    }
}
