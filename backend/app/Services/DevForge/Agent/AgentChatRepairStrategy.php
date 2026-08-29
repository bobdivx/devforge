<?php

namespace App\Services\DevForge\Agent;

use App\Services\DevForge\Application\NixpacksNodeVersionResolver;

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

    public const ISSUE_NODE_ENGINE = 'node_engine';

    public const ISSUE_HEALTHCHECK_PORT = 'healthcheck_port';

    public const ISSUE_PROXY_PORT = 'proxy_port';

    public const ISSUE_ASTRO_STATIC_RUNTIME = 'astro_static_runtime';

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
        'mission_claim',
        'mission_create',
        'request_user_input',
        'run_application_tests',
    ];

    /**
     * @param  array{
     *     detected_framework?: string|null,
     *     start_command?: string|null,
     *     ports_exposes?: string|null,
     *     is_static?: bool,
     *     build_pack?: string|null,
     *     detector_framework?: string|null
     * }|null  $context
     */
    public static function detectIssue(string $logsBlob, ?array $context = null): string
    {
        $blob = mb_strtolower($logsBlob);

        if (AgentDirectives::isCoolifyBaseConfigPathIssue($logsBlob)) {
            return self::ISSUE_BASE_CONFIG;
        }

        // Astro static lancé avec node ./dist/server/entry.mjs — avant healthcheck/nginx (sinon faux SSR).
        // Un 404 nginx /status ou un healthcheck fail sur une app SSR connue n'est PAS une preuve static.
        if (
            AgentDirectives::isMissingAstroServerEntryIssue($logsBlob)
            && self::shouldClassifyAsAstroStaticRuntime($logsBlob, $context)
        ) {
            return self::ISSUE_ASTRO_STATIC_RUNTIME;
        }

        // Healthcheck sur mauvais port (ex. curl :3000 alors qu’Astro écoute :4321) — avant permissions.
        if (AgentDirectives::isHealthcheckPortMismatchIssue($logsBlob)) {
            return self::ISSUE_HEALTHCHECK_PORT;
        }

        // 502 Bad Gateway / Host Error : labels Traefik souvent restés sur port 80 alors que l’app écoute 4321/3000.
        if (AgentDirectives::isBadGatewayProxyPortIssue($logsBlob)) {
            return self::ISSUE_PROXY_PORT;
        }

        // « tee: » seul est trop large (faux positifs) — exiger permission denied.
        if (
            str_contains($blob, 'permission denied')
            || (bool) preg_match('/tee:.*permission\s+denied/iu', $logsBlob)
        ) {
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

        if (app(NixpacksNodeVersionResolver::class)->logsLookLikeEngineMismatch($logsBlob)) {
            return self::ISSUE_NODE_ENGINE;
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
     * Ne classer ISSUE_ASTRO_STATIC_RUNTIME que si entry.mjs est vraiment absent
     * ET que le détecteur (ou l'absence de signaux SSR) dit static.
     *
     * @param  array<string, mixed>|null  $context
     */
    public static function shouldClassifyAsAstroStaticRuntime(string $logsBlob, ?array $context): bool
    {
        $context = $context ?? [];

        $detectorFramework = is_string($context['detector_framework'] ?? null)
            ? (string) $context['detector_framework']
            : null;
        $storedFramework = is_string($context['detected_framework'] ?? null)
            ? (string) $context['detected_framework']
            : null;
        $startCommand = is_string($context['start_command'] ?? null) ? (string) $context['start_command'] : null;
        $portsExposes = is_string($context['ports_exposes'] ?? null) ? (string) $context['ports_exposes'] : null;

        $knownSsr = AgentDirectives::isAstroSsrFramework($detectorFramework)
            || AgentDirectives::looksLikeAstroSsrSignals($storedFramework, $startCommand, $portsExposes);

        if ($knownSsr) {
            return false;
        }

        if (AgentDirectives::looksLikeNginxStatusOrHealthcheckOnly($logsBlob)) {
            return false;
        }

        if ($detectorFramework !== null && $detectorFramework !== '') {
            return $detectorFramework === 'astro-static';
        }

        return AgentDirectives::isMissingAstroServerEntryIssue($logsBlob);
    }

    /**
     * @param  array<string, mixed>|null  $context
     * @return array<string, mixed>
     */
    public static function astroRuntimeSettingsForDetection(?string $detectorFramework, ?array $context = null): array
    {
        $context = $context ?? [];
        $stored = is_string($context['detected_framework'] ?? null) ? (string) $context['detected_framework'] : null;
        $start = is_string($context['start_command'] ?? null) ? (string) $context['start_command'] : null;
        $ports = is_string($context['ports_exposes'] ?? null) ? (string) $context['ports_exposes'] : null;

        if (
            AgentDirectives::isAstroSsrFramework($detectorFramework)
            || AgentDirectives::looksLikeAstroSsrSignals($stored, $start, $ports)
        ) {
            return AgentDirectives::astroSsrNixpacksRuntimeSettings();
        }

        return AgentDirectives::astroStaticNginxRuntimeSettings();
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
