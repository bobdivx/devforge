<?php

namespace App\Services\DevForge\Agent;

/**
 * Décide quelle réparation déterministe lancer quand le LLM refuse d'émettre des tool_calls.
 */
class AgentChatRepairStrategy
{
    public const ISSUE_PERMISSIONS = 'permissions';

    public const ISSUE_BRANCH = 'branch';

    public const ISSUE_NPM_AUTH = 'npm_auth';

    public const ISSUE_NGINX_PUBLISH = 'nginx_publish';

    public const ISSUE_BASE_CONFIG = 'base_config';

    public const ISSUE_PUPPETEER = 'puppeteer';

    public const ISSUE_GENERIC = 'generic';

    /** Outils de lecture / diagnostic — ne comptent pas comme correction. */
    private const DIAGNOSTIC_TOOLS = [
        'get_deployment_logs',
        'get_application_git_info',
        'list_github_branches',
        'list_application_env_vars',
        'list_application_source',
        'read_application_source',
        'get_application_runtime_settings',
        'get_resource_status',
        'docker_logs',
        'http_request',
        'spawn_task',
        'todo_read',
        'todo_write',
        'web_search',
        'mission_list',
        'mission_show',
    ];

    public static function detectIssue(string $logsBlob): string
    {
        $blob = mb_strtolower($logsBlob);

        if (AgentDirectives::isCoolifyBaseConfigPathIssue($logsBlob)) {
            return self::ISSUE_BASE_CONFIG;
        }

        if (str_contains($blob, 'permission denied') || str_contains($blob, 'tee:')) {
            return self::ISSUE_PERMISSIONS;
        }

        if (
            str_contains($blob, 'remote branch')
            || str_contains($blob, 'could not find remote branch')
        ) {
            return self::ISSUE_BRANCH;
        }

        if (AgentDirectives::isNpmPrivateRegistryAuthIssue($logsBlob)) {
            return self::ISSUE_NPM_AUTH;
        }

        if (AgentDirectives::isMissingStaticPublishDirectoryIssue($logsBlob)) {
            return self::ISSUE_NGINX_PUBLISH;
        }

        if (
            str_contains($blob, 'puppeteer')
            || str_contains($blob, 'chromium')
            || str_contains($blob, 'chrome-headless')
            || str_contains($blob, 'failed to launch the browser process')
        ) {
            return self::ISSUE_PUPPETEER;
        }

        return self::ISSUE_GENERIC;
    }

    /**
     * @param  list<array<string, mixed>>|mixed  $steps
     */
    public static function stepsIncludeCorrectiveAction(mixed $steps): bool
    {
        if (! is_array($steps)) {
            return false;
        }

        foreach ($steps as $step) {
            if (! is_array($step)) {
                continue;
            }

            $name = (string) ($step['name'] ?? '');
            $status = (string) ($step['status'] ?? '');

            if ($name === '' || in_array($name, self::DIAGNOSTIC_TOOLS, true)) {
                continue;
            }

            if (in_array($status, ['done', 'awaiting_approval'], true)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  list<array<string, mixed>>|mixed  $correctionActions
     */
    public static function hasRecordedCorrection(mixed $correctionActions): bool
    {
        return is_array($correctionActions) && $correctionActions !== [];
    }

    /**
     * Filet autonome après échec deploy : harness même si le LLM n'a fait que lire les logs.
     *
     * @param  list<array<string, mixed>>|mixed  $correctionActions
     */
    public static function shouldFallbackToHarness(
        ?string $event,
        bool $autoFallbackEnabled,
        bool $harnessAlreadyUsed,
        mixed $correctionActions,
    ): bool {
        if (! $autoFallbackEnabled || $harnessAlreadyUsed) {
            return false;
        }

        if (! in_array($event, ['deployment_failed', 'application_readiness_failed'], true)) {
            return false;
        }

        return ! self::hasRecordedCorrection($correctionActions);
    }
}
