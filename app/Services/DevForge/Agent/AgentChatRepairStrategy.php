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

    public const ISSUE_GENERIC = 'generic';

    public static function detectIssue(string $logsBlob): string
    {
        $blob = mb_strtolower($logsBlob);

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

        return self::ISSUE_GENERIC;
    }
}
