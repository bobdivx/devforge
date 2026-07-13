<?php

namespace App\Services\DevForge\Database;

use App\Actions\Database\StartDatabase;
use App\Models\StandaloneLibsql;
use App\Models\User;
use Illuminate\Support\Str;

class LibsqlDatabaseAccessService
{
    public function __construct(
        private readonly LibsqlConnectionEnvSync $libsqlConnectionEnvSync,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function credentials(StandaloneLibsql $database): array
    {
        $values = $this->libsqlConnectionEnvSync->valuesFor($database);

        return [
            'auth_user' => $values['auth_user'],
            'auth_token' => $values['token'],
            'internal_url' => $values['full_url'],
            'external_url' => $database->external_db_url,
            'turso_database_url' => $values['turso_url'],
            'turso_database_url_external' => $values['turso_url_external'],
            'turso_auth_token' => $values['token'],
            'libsql_url' => $values['full_url'],
            'is_public' => (bool) $database->is_public,
            'public_port' => $database->is_public ? $database->public_port : null,
            'env_profiles' => [
                'turso' => [
                    'TURSO_DATABASE_URL' => $values['turso_url'],
                    'TURSO_AUTH_TOKEN' => $values['token'],
                ],
                'turso_remote' => $values['turso_url_external'] ? [
                    'TURSO_DATABASE_URL' => $values['turso_url_external'],
                    'TURSO_AUTH_TOKEN' => $values['token'],
                ] : null,
                'libsql_url' => [
                    'LIBSQL_URL' => $values['full_url'],
                ],
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function regenerateToken(User $user, StandaloneLibsql $database, bool $redeployApplications = true): array
    {
        $database->libsql_auth_token = Str::password(length: 64, symbols: false);
        $database->save();

        $synced = $this->libsqlConnectionEnvSync->syncLinkedApplications($database, $redeployApplications);

        auditLog('devforge.database.token_regenerated', [
            'database_uuid' => $database->uuid,
            'user_id' => $user->id,
            'synced_env_vars' => $synced['updated_variables'],
        ]);

        return [
            ...$this->credentials($database),
            'synced_applications' => $synced['applications'],
            'redeployments_queued' => $synced['redeployments_queued'],
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function updatePublicAccess(User $user, StandaloneLibsql $database, array $input): array
    {
        $validated = validator($input, [
            'enabled' => ['required', 'boolean'],
            'public_port' => ['nullable', 'integer', 'min:1024', 'max:65535'],
            'redeploy_applications' => ['nullable', 'boolean'],
        ])->validate();

        $enabled = (bool) $validated['enabled'];
        $database->is_public = $enabled;
        $database->public_port = $enabled
            ? (int) ($validated['public_port'] ?? ($database->public_port ?: $this->defaultPublicPort($database)))
            : null;
        $database->save();

        if ($database->isRunning()) {
            StartDatabase::dispatch($database);
        }

        $synced = $this->libsqlConnectionEnvSync->syncLinkedApplications(
            $database,
            (bool) ($validated['redeploy_applications'] ?? false),
        );

        auditLog('devforge.database.public_access_updated', [
            'database_uuid' => $database->uuid,
            'user_id' => $user->id,
            'is_public' => $enabled,
            'public_port' => $database->public_port,
        ]);

        return [
            ...$this->credentials($database),
            'synced_applications' => $synced['applications'],
            'redeployments_queued' => $synced['redeployments_queued'],
        ];
    }

    private function defaultPublicPort(StandaloneLibsql $database): int
    {
        return 18080 + ($database->id % 1000);
    }
}
