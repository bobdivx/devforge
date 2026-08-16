<?php

namespace App\Services\DevForge\Agent;

/**
 * Décide si la boucle chat doit continuer malgré une réponse texte sans tool_calls.
 * Porté depuis forge-iteration-policy.ts (Forge → DevForge).
 */
class AgentUntilDonePolicy
{
    /** @var list<string> */
    private const MUTATION_TOOLS = [
        'write_application_source',
        'write_remote_file',
        'upsert_application_env_var',
        'update_application_runtime_settings',
        'update_application_advanced_settings',
        'update_application_git_branch',
        'fix_application_host_permissions',
        'fix_coolify_base_config_path',
        'control_resource',
        'exec_command',
        'spawn_task',
        'yield_wait',
        'delegate_task',
        'memory_write',
    ];

    /** @var list<string> */
    private const EXPLORE_PREFIXES = [
        'list_',
        'get_',
        'read_',
        'search_',
        'docker_logs',
        'http_request',
    ];

    /**
     * @param  list<string>  $toolsUsedThisRun
     * @return array{continue: bool, reason: string, nudge?: string}
     */
    public function decide(
        string $userMessage,
        string $assistantReply,
        array $toolsUsedThisRun,
        int $continueNudges,
        int $maxContinueNudges = 4,
    ): array {
        $reply = trim($assistantReply);

        if ($this->hasDoneMarker($reply)) {
            return ['continue' => false, 'reason' => 'done'];
        }

        if ($continueNudges >= $maxContinueNudges) {
            return ['continue' => false, 'reason' => 'nudge_cap'];
        }

        if (! $this->isActionOriented($userMessage)) {
            if (mb_strlen($reply) > 40) {
                return ['continue' => false, 'reason' => 'answered'];
            }

            return ['continue' => false, 'reason' => 'not_action'];
        }

        if ($toolsUsedThisRun === []) {
            return [
                'continue' => true,
                'reason' => 'no_tools_yet',
                'nudge' => '[DEVFORGE_CONTINUE] La demande est actionnable mais tu n\'as encore appelé AUCUN outil. '
                    .'N\'explique pas : APPELLE immédiatement les outils nécessaires. '
                    .'Quand le travail est réellement terminé, termine par [DEVFORGE_DONE].',
            ];
        }

        if ($this->onlyExplored($toolsUsedThisRun) && ! $this->hasMutation($toolsUsedThisRun)) {
            return [
                'continue' => true,
                'reason' => 'explore_only',
                'nudge' => '[DEVFORGE_CONTINUE] Tu as exploré (lecture / listes) mais tu n\'as pas encore modifié '
                    .'la config/code ni matérialisé le résultat. Passe à l\'ACTION maintenant '
                    .'(write_application_source, update_application_runtime_settings, control_resource, etc.). '
                    .'Termine par [DEVFORGE_DONE] quand c\'est fait.',
            ];
        }

        if ($this->looksLikeIntentionOnly($reply) && ! $this->hasMutation($toolsUsedThisRun)) {
            return [
                'continue' => true,
                'reason' => 'intention_only',
                'nudge' => '[DEVFORGE_CONTINUE] Tu as annoncé une intention au lieu d\'agir. '
                    .'Exécute les tool_calls maintenant (pas de nouvelle checklist). '
                    .'Termine par [DEVFORGE_DONE] uniquement quand le travail est réellement fait.',
            ];
        }

        return ['continue' => false, 'reason' => 'answered'];
    }

    public function stripDoneMarker(string $reply): string
    {
        return trim((string) preg_replace('/\[DEVFORGE_DONE\]|<\/?DEVFORGE_DONE[^>]*>/iu', '', $reply));
    }

    public function hasDoneMarker(string $reply): bool
    {
        return (bool) preg_match(
            '/\[DEVFORGE_DONE\]|<DEVFORGE_DONE\b|t[aâ]che termin[eé]e|travail termin[eé]|impl[eé]mentation termin[eé]e/iu',
            $reply,
        );
    }

    public function isActionOriented(string $userMessage): bool
    {
        return (bool) preg_match(
            '/\b(am[eé]liore|impl[eé]mente|corrige|fix|ajoute|cr[eé]e|modifie|fais|ex[eé]cute|d[eé]ploie|int[eè]gre|r[eé]par|red[eé]ploi|installe|supprime|build|deploy|improve|implement|create|update|write|apply)\b/iu',
            $userMessage,
        );
    }

    public function looksLikeIntentionOnly(string $reply): bool
    {
        $text = trim($reply);
        if ($text === '') {
            return true;
        }
        if ($this->hasDoneMarker($text)) {
            return false;
        }

        return (bool) preg_match(
            '/\b(je vais|je peux|je propose|ensuite je|prochaine [eé]tape|je vais explorer|je vais utiliser|let me|i will|i\'ll|next i)\b/iu',
            $text,
        ) && mb_strlen($text) < 1200;
    }

    /** @param  list<string>  $tools */
    public function hasMutation(array $tools): bool
    {
        foreach ($tools as $tool) {
            if (in_array($tool, self::MUTATION_TOOLS, true)) {
                return true;
            }
        }

        return false;
    }

    /** @param  list<string>  $tools */
    public function onlyExplored(array $tools): bool
    {
        if ($tools === []) {
            return false;
        }

        foreach ($tools as $tool) {
            $matched = false;
            foreach (self::EXPLORE_PREFIXES as $prefix) {
                if (str_starts_with($tool, $prefix) || $tool === $prefix) {
                    $matched = true;
                    break;
                }
            }
            if (! $matched && ! in_array($tool, ['memory_read', 'list_tool_packages', 'enable_tool_package'], true)) {
                return false;
            }
        }

        return true;
    }
}
