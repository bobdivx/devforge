<?php

namespace App\Services\DevForge\Database;

use App\Models\Application;
use App\Models\EnvironmentVariable;
use App\Models\StandaloneLibsql;
use Illuminate\Database\Eloquent\Model;
use Visus\Cuid2\Cuid2;

class LibsqlConnectionEnvSync
{
    public const LINK_COMMENT_PREFIX = 'devforge:database:';

    /**
     * @return array<int, string>
     */
    public static function allowedEnvKeys(): array
    {
        return ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'LIBSQL_URL', 'DATABASE_URL'];
    }

    /**
     * @return array{auth_user: string, token: string, turso_url: string, turso_url_external: ?string, full_url: string, full_url_external: ?string}
     */
    public function valuesFor(Model $database): array
    {
        abort_unless($database instanceof StandaloneLibsql, 422, 'Seules les bases libSQL sont supportées.');

        $authUser = (string) ($database->libsql_auth_user ?: 'libsql');
        $token = (string) $database->libsql_auth_token;
        $host = (string) $database->uuid;

        $tursoUrlExternal = null;
        if ($database->is_public) {
            $domainHost = $database->publicDomainHost();
            if ($domainHost) {
                // Public hostname is terminated by Traefik/Caddy with TLS.
                $tursoUrlExternal = "libsql://{$domainHost}";
            } elseif ($database->public_port) {
                $serverIp = $database->destination?->server?->getIp;
                if (! empty($serverIp)) {
                    // Raw TCP proxy is plain HTTP.
                    $tursoUrlExternal = "http://{$serverIp}:{$database->public_port}";
                }
            }
        }

        // Internal Docker network is plain HTTP. Never embed credentials —
        // clients use TURSO_AUTH_TOKEN as a Bearer JWT (SQLD_AUTH_JWT_KEY).
        $tursoUrl = "http://{$host}:8080";

        return [
            'auth_user' => $authUser,
            'token' => $token,
            'turso_url' => $tursoUrl,
            'turso_url_external' => $tursoUrlExternal,
            'full_url' => $tursoUrl,
            'full_url_external' => $database->external_db_url,
        ];
    }

    /**
     * @return array<int, string>
     */
    public function resolveEnvKeysForApplication(Application $application, ?string $preferredKey = null): array
    {
        if ($preferredKey !== null && $preferredKey !== '') {
            return $this->expandEnvKeyPreference($preferredKey);
        }

        $existingKeys = $application->environment_variables()
            ->where('is_preview', false)
            ->pluck('key');

        if ($existingKeys->contains('TURSO_DATABASE_URL') || $existingKeys->contains('TURSO_AUTH_TOKEN')) {
            return ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'];
        }

        if ($existingKeys->contains('LIBSQL_URL')) {
            return ['LIBSQL_URL', 'TURSO_AUTH_TOKEN'];
        }

        return ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'];
    }

    /**
     * @return array<int, string>
     */
    public function expandEnvKeyPreference(string $envKey): array
    {
        return match ($envKey) {
            'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN' => ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'],
            'LIBSQL_URL', 'DATABASE_URL' => [$envKey, 'TURSO_AUTH_TOKEN'],
            default => [$envKey],
        };
    }

    public function valueForEnvKey(string $envKey, array $values): ?string
    {
        return match ($envKey) {
            'TURSO_DATABASE_URL' => $values['turso_url'],
            'TURSO_AUTH_TOKEN' => $values['token'],
            'LIBSQL_URL', 'DATABASE_URL' => $values['full_url'],
            default => null,
        };
    }

    /**
     * @return array{env_keys: array<int, string>, primary_env_key: string}
     */
    public function applyConnection(
        Application $application,
        StandaloneLibsql $database,
        ?string $preferredKey,
        bool $isRuntime,
        bool $isBuildtime,
    ): array {
        $values = $this->valuesFor($database);
        $envKeys = $this->resolveEnvKeysForApplication($application, $preferredKey);
        $comment = self::LINK_COMMENT_PREFIX.$database->uuid;

        foreach ($envKeys as $envKey) {
            $value = $this->valueForEnvKey($envKey, $values);
            if ($value === null) {
                continue;
            }

            $application->environment_variables()->updateOrCreate(
                [
                    'key' => $envKey,
                    'is_preview' => false,
                ],
                [
                    'value' => $value,
                    'is_runtime' => $isRuntime,
                    'is_buildtime' => $isBuildtime,
                    'is_literal' => false,
                    'is_multiline' => false,
                    'is_shown_once' => false,
                    'comment' => $comment,
                    'resourceable_type' => $application->getMorphClass(),
                    'resourceable_id' => $application->id,
                ],
            );
        }

        $application->environment_variables()
            ->where('is_preview', false)
            ->where('comment', $comment)
            ->whereNotIn('key', $envKeys)
            ->delete();

        return [
            'env_keys' => $envKeys,
            'primary_env_key' => $envKeys[0],
        ];
    }

    /**
     * @return array{updated_variables: int, applications: array<int, string>, redeployments_queued: int}
     */
    public function syncLinkedApplications(StandaloneLibsql $database, bool $redeployApplications = false): array
    {
        $values = $this->valuesFor($database);
        $comment = self::LINK_COMMENT_PREFIX.$database->uuid;

        $variables = EnvironmentVariable::query()
            ->where('is_preview', false)
            ->where('comment', $comment)
            ->where('resourceable_type', Application::class)
            ->with('resourceable')
            ->get();

        $applications = [];
        $updated = 0;
        $redeployments = 0;

        foreach ($variables as $variable) {
            $value = $this->valueForEnvKey($variable->key, $values);
            if ($value === null) {
                continue;
            }

            $variable->update(['value' => $value]);
            $updated++;

            if ($variable->resourceable instanceof Application) {
                $applications[$variable->resourceable->uuid] = $variable->resourceable->name;

                if ($redeployApplications) {
                    $deploymentUuid = new Cuid2;
                    $result = queue_application_deployment(
                        application: $variable->resourceable,
                        deployment_uuid: $deploymentUuid,
                        force_rebuild: false,
                        restart_only: false,
                        is_api: true,
                        no_questions_asked: true,
                    );

                    if ($result['status'] !== 'skipped' && $result['status'] !== 'queue_full') {
                        $redeployments++;
                    }
                }
            }
        }

        return [
            'updated_variables' => $updated,
            'applications' => array_values(array_map(
                fn (string $uuid, string $name): array => ['uuid' => $uuid, 'name' => $name],
                array_keys($applications),
                array_values($applications),
            )),
            'redeployments_queued' => $redeployments,
        ];
    }
}
