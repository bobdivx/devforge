<?php

namespace App\Services\DevForge\Database;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Validation\ValidationException;

class DatabaseHealthcheckCatalog
{
    /**
     * @return array{
     *     health_check_enabled: bool,
     *     health_check_interval: int,
     *     health_check_timeout: int,
     *     health_check_retries: int,
     *     health_check_start_period: int,
     *     probe_label: string,
     *     restart_required: bool
     * }
     */
    public function show(Model $database): array
    {
        return $this->present($database, restartRequired: false);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     health_check_enabled: bool,
     *     health_check_interval: int,
     *     health_check_timeout: int,
     *     health_check_retries: int,
     *     health_check_start_period: int,
     *     probe_label: string,
     *     restart_required: bool,
     *     message: string
     * }
     */
    public function update(Model $database, array $input): array
    {
        $validated = validator($input, [
            'health_check_enabled' => ['sometimes', 'boolean'],
            'health_check_interval' => ['sometimes', 'integer', 'min:1'],
            'health_check_timeout' => ['sometimes', 'integer', 'min:1'],
            'health_check_retries' => ['sometimes', 'integer', 'min:1'],
            'health_check_start_period' => ['sometimes', 'integer', 'min:0'],
        ])->validate();

        if ($validated === []) {
            throw ValidationException::withMessages([
                'input' => 'Au moins un champ doit être fourni.',
            ]);
        }

        foreach ($validated as $field => $value) {
            $database->{$field} = $value;
        }

        $database->save();

        if (method_exists($database, 'isConfigurationChanged')) {
            $database->isConfigurationChanged(true);
        }

        return [
            ...$this->present($database->fresh(), restartRequired: true),
            'message' => 'Healthcheck mis à jour. Redémarrez la base pour appliquer les changements.',
        ];
    }

    /**
     * @return array{
     *     health_check_enabled: bool,
     *     health_check_interval: int,
     *     health_check_timeout: int,
     *     health_check_retries: int,
     *     health_check_start_period: int,
     *     probe_label: string,
     *     restart_required: bool
     * }
     */
    private function present(Model $database, bool $restartRequired): array
    {
        return [
            'health_check_enabled' => (bool) ($database->health_check_enabled ?? true),
            'health_check_interval' => (int) ($database->health_check_interval ?? 15),
            'health_check_timeout' => (int) ($database->health_check_timeout ?? 5),
            'health_check_retries' => (int) ($database->health_check_retries ?? 5),
            'health_check_start_period' => (int) ($database->health_check_start_period ?? 5),
            'probe_label' => $this->probeLabel($database),
            'restart_required' => $restartRequired,
        ];
    }

    private function probeLabel(Model $database): string
    {
        return match (class_basename($database)) {
            'StandalonePostgresql' => 'psql — SELECT 1',
            'StandaloneMysql' => 'mysqladmin ping',
            'StandaloneMariadb' => 'healthcheck.sh (InnoDB)',
            'StandaloneMongodb' => 'echo ok',
            'StandaloneRedis' => 'redis-cli ping',
            'StandaloneKeydb' => 'keydb-cli ping',
            'StandaloneDragonfly' => 'redis-cli ping',
            'StandaloneClickhouse' => 'clickhouse-client — SELECT 1',
            'StandaloneLibsql' => 'TCP :8080',
            default => 'Probe Docker intégré',
        };
    }
}
