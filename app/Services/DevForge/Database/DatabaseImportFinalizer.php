<?php

namespace App\Services\DevForge\Database;

use Illuminate\Database\Eloquent\Model;

class DatabaseImportFinalizer
{
    public function __construct(
        private readonly StandaloneDatabaseRuntimeGuard $runtimeGuard,
        private readonly LinkedDatabaseEnvSync $linkedDatabaseEnvSync,
    ) {}

    /**
     * @return array{
     *     restarted: bool,
     *     format: string,
     *     message: string,
     *     linked_applications: array<int, array{uuid: string, name: string}>,
     *     env_variables_synced: int,
     *     redeployments_queued: int,
     * }
     */
    public function finalize(Model $database, string $format, string $baseMessage): array
    {
        $this->runtimeGuard->ensureRunning($database);

        $synced = $this->linkedDatabaseEnvSync->syncLinkedApplications($database, redeployApplications: true);

        return [
            'restarted' => true,
            'format' => $format,
            'message' => $this->buildCompletionMessage($baseMessage, $synced),
            'linked_applications' => $synced['applications'],
            'env_variables_synced' => $synced['updated_variables'],
            'redeployments_queued' => $synced['redeployments_queued'],
        ];
    }

    /**
     * @param  array{updated_variables: int, applications: array<int, array{uuid: string, name: string}>, redeployments_queued: int}  $synced
     */
    private function buildCompletionMessage(string $baseMessage, array $synced): string
    {
        $parts = [$baseMessage];

        if ($synced['updated_variables'] > 0) {
            $applicationCount = count($synced['applications']);
            $parts[] = sprintf(
                '%d variable(s) d’environnement synchronisée(s) sur %d application(s) rattachée(s).',
                $synced['updated_variables'],
                $applicationCount,
            );
        }

        if ($synced['redeployments_queued'] > 0) {
            $parts[] = sprintf(
                '%d redéploiement(s) planifié(s) pour appliquer les nouvelles variables.',
                $synced['redeployments_queued'],
            );
        }

        return implode(' ', $parts);
    }
}
