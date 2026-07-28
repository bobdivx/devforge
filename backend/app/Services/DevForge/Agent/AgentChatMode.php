<?php

namespace App\Services\DevForge\Agent;

/**
 * Modes chat Plan / Build / Debug — porté depuis Forge vers DevForge.
 * Forge sera supprimé ; Coolify = DevForge.
 */
class AgentChatMode
{
    public const PLAN = 'plan';

    public const BUILD = 'build';

    public const DEBUG = 'debug';

    /** @var list<string> */
    public const ALL = [self::PLAN, self::BUILD, self::DEBUG];

    /** Outils interdits en mode plan (mutations / déploiements). */
    private const PLAN_BLOCKED = [
        'write_application_source',
        'write_remote_file',
        'write_github_file',
        'upsert_application_env_var',
        'update_application_runtime_settings',
        'update_application_git_branch',
        'fix_application_host_permissions',
        'fix_coolify_base_config_path',
        'control_resource',
        'exec_command',
        'install_tool',
        'create_github_branch',
        'create_github_pull_request',
        'merge_github_pull_request',
        'close_github_pull_request',
        'comment_github_pull_request',
        'spawn_task',
        'delegate_task',
    ];

    public static function parse(mixed $raw): string
    {
        $value = strtolower(trim((string) $raw));

        return in_array($value, self::ALL, true) ? $value : self::BUILD;
    }

    public static function label(string $mode): string
    {
        return match (self::parse($mode)) {
            self::PLAN => 'Planifier',
            self::DEBUG => 'Déboguer',
            default => 'Construire',
        };
    }

    public static function systemAddon(string $mode): string
    {
        return match (self::parse($mode)) {
            self::PLAN => implode("\n", [
                'MODE PLAN (actif) :',
                '- Explore, lis le code/logs/doc, propose un plan structuré avant toute modification.',
                '- N’exécute pas d’outils destructifs ou de déploiement ; privilégie lecture et synthèse.',
                '- Termine par étapes numérotées, risques, et critères de succès.',
            ]),
            self::DEBUG => implode("\n", [
                'MODE DEBUG (actif) :',
                '- Reproduis le problème, formule une hypothèse, puis applique un correctif minimal.',
                '- Utilise logs, lecture de fichiers et inspect avant d’écrire.',
                '- Explique la cause racine et ce qui a été vérifié. Termine par [DEVFORGE_DONE] si corrigé.',
            ]),
            default => implode("\n", [
                'MODE BUILD (actif) :',
                '- Implémente la demande de façon directe avec les outils disponibles.',
                '- Garde les changements focalisés et testables. Termine par [DEVFORGE_DONE] quand c’est fait.',
            ]),
        };
    }

    /**
     * @param  list<string>  $toolNames
     * @return list<string>
     */
    public static function filterToolNames(array $toolNames, string $mode): array
    {
        if (self::parse($mode) !== self::PLAN) {
            return $toolNames;
        }

        return array_values(array_filter(
            $toolNames,
            fn (string $name): bool => ! in_array($name, self::PLAN_BLOCKED, true),
        ));
    }

    public static function isToolAllowed(string $toolName, string $mode): bool
    {
        if (self::parse($mode) !== self::PLAN) {
            return true;
        }

        return ! in_array($toolName, self::PLAN_BLOCKED, true);
    }
}
