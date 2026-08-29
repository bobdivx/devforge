<?php

namespace App\Services\DevForge\Agent;

use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\EnvironmentVariable;
use App\Services\DevForge\Database\LibsqlConnectionEnvSync;
use App\Services\DevForge\SecretRedactor;
use Throwable;

class ApplicationWorkspaceChatContext
{
    public const FAILED_LOG_LINES = 15;

    /**
     * Live pack injected into agent chat (system prompt), never shown as a user bubble.
     * Secret values are never included — keys + shape hints only.
     *
     * @return array<string, mixed>
     */
    public function build(Application $application): array
    {
        $status = $this->resourceStatus($application);
        $pack = array_filter([
            'application_uuid' => (string) $application->uuid,
            'application_name' => (string) $application->name,
            'application_status' => $status,
            'git_repository' => is_string($application->git_repository) ? $application->git_repository : null,
            'git_branch' => is_string($application->git_branch) ? $application->git_branch : null,
            'build_pack' => is_string($application->build_pack) ? $application->build_pack : null,
            'fqdn' => is_string($application->fqdn) ? $application->fqdn : null,
            'health_check_enabled' => (bool) $application->health_check_enabled,
            'health_check_path' => filled($application->health_check_path) ? (string) $application->health_check_path : null,
            'health_check_port' => filled($application->health_check_port) ? (string) $application->health_check_port : null,
            'health_check_return_code' => filled($application->health_check_return_code) ? (string) $application->health_check_return_code : null,
            'ports_exposes' => filled($application->ports_exposes) ? (string) $application->ports_exposes : null,
            'start_command' => filled($application->start_command) ? (string) $application->start_command : null,
            'build_command' => filled($application->build_command) ? (string) $application->build_command : null,
            'detected_framework' => filled($application->detected_framework) ? (string) $application->detected_framework : null,
            'has_custom_nginx' => filled($application->custom_nginx_configuration),
        ], fn (mixed $value): bool => $value !== null && $value !== '');

        $pack['latest_deployment'] = $this->latestDeployment($application);
        $pack['env_var_hints'] = $this->envVarHints($application);
        $pack['linked_databases'] = $this->linkedDatabases($application);
        $pack['workspace_brief'] = $this->formatPromptBlock($pack);

        return $pack;
    }

    /**
     * @param  array<string, mixed>  $pack
     */
    public function formatPromptBlock(array $pack): string
    {
        $uuid = trim((string) ($pack['application_uuid'] ?? ''));
        if ($uuid === '') {
            return '';
        }

        $name = (string) ($pack['application_name'] ?? 'Application');
        $status = (string) ($pack['application_status'] ?? 'inconnu');
        $gitRepository = (string) ($pack['git_repository'] ?? 'inconnu');
        $gitBranch = (string) ($pack['git_branch'] ?? 'inconnu');
        $buildPack = (string) ($pack['build_pack'] ?? 'inconnu');
        $fqdn = (string) ($pack['fqdn'] ?? 'aucun');
        $healthEnabled = ! empty($pack['health_check_enabled']) ? 'oui' : 'non';
        $healthPath = (string) ($pack['health_check_path'] ?? '—');
        $healthPort = (string) ($pack['health_check_port'] ?? '—');
        $healthCode = (string) ($pack['health_check_return_code'] ?? '—');
        $ports = (string) ($pack['ports_exposes'] ?? 'inconnu');
        $start = (string) ($pack['start_command'] ?? 'défaut');
        $build = (string) ($pack['build_command'] ?? 'défaut');
        $framework = (string) ($pack['detected_framework'] ?? 'inconnu');
        $nginx = ! empty($pack['has_custom_nginx']) ? 'oui' : 'non';

        $envLines = $this->formatEnvHints($pack['env_var_hints'] ?? []);
        $dbLines = $this->formatLinkedDatabases($pack['linked_databases'] ?? []);
        $deployBlock = $this->formatLatestDeployment($pack['latest_deployment'] ?? null);

        return trim(<<<CONTEXT

        Champ d'application (scope obligatoire pour ce chat) :
        Tu es dans le workspace de CETTE application. Tu as déjà son statut, ses variables d'environnement (clés et formes, jamais les secrets), ses logs de déploiement et ses paramètres runtime. Si l'utilisateur dit « corrige » (ou équivalent), diagnostique à partir de CE contexte : ne redemande pas le status, n'appelle pas get_resource_status juste pour le connaître.

        - Application : {$name} ({$uuid})
        - Statut ressource : {$status}
        - Dépôt : {$gitRepository}
        - Branche : {$gitBranch}
        - Build pack : {$buildPack}
        - Framework détecté : {$framework}
        - Domaines : {$fqdn}
        - Ports exposés : {$ports}
        - Start command : {$start}
        - Build command : {$build}
        - Healthcheck : enabled={$healthEnabled} path={$healthPath} port={$healthPort} return_code={$healthCode}
        - Nginx custom : {$nginx}
        {$deployBlock}
        - Variables d'environnement (clés seulement, jamais les valeurs secrètes) :
        {$envLines}
        - Bases liées :
        {$dbLines}

        Traite chaque demande comme portant sur CETTE application.
        Pour les outils (read_application_source, write_application_source, upsert_application_env_var, control_resource, get_deployment_logs, get_resource_status, etc.), utilise application_uuid={$uuid} sans redemander l'UUID.
        CONTEXT);
    }

    private function resourceStatus(Application $application): string
    {
        $raw = $application->getAttributes()['status'] ?? null;
        if (is_string($raw) && $raw !== '') {
            return $raw;
        }

        try {
            $status = $application->status;
            if (is_string($status) && $status !== '') {
                return $status;
            }
        } catch (Throwable) {
        }

        return 'inconnu';
    }

    /**
     * @return array<string, mixed>|null
     */
    private function latestDeployment(Application $application): ?array
    {
        try {
            $deployment = ApplicationDeploymentQueue::query()
                ->where('application_id', (string) $application->id)
                ->orderByDesc('id')
                ->first([
                    'id',
                    'deployment_uuid',
                    'status',
                    'logs',
                    'created_at',
                    'updated_at',
                    'finished_at',
                ]);
        } catch (Throwable) {
            return null;
        }

        if (! $deployment instanceof ApplicationDeploymentQueue) {
            return null;
        }

        $pack = [
            'uuid' => (string) $deployment->deployment_uuid,
            'status' => (string) $deployment->status,
            'started_at' => $deployment->created_at?->toIso8601String(),
        ];

        if ((string) $deployment->status === 'failed') {
            $pack['failed_logs'] = $this->failedLogLines($application, $deployment);
        }

        return $pack;
    }

    /**
     * @return list<string>
     */
    private function failedLogLines(Application $application, ApplicationDeploymentQueue $deployment): array
    {
        $entries = json_decode((string) $deployment->logs, true);
        if (! is_array($entries)) {
            return [];
        }

        $lines = [];
        foreach ($entries as $entry) {
            if (! is_array($entry) || ! empty($entry['hidden'])) {
                continue;
            }
            $message = trim((string) ($entry['output'] ?? $entry['message'] ?? $entry['line'] ?? ''));
            if ($message === '') {
                continue;
            }
            $lines[] = $message;
        }

        $lines = array_slice($lines, -self::FAILED_LOG_LINES);

        try {
            $redactor = app(SecretRedactor::class);
            $lines = array_map(
                fn (string $line): string => $redactor->redact($line, $application),
                $lines,
            );
        } catch (Throwable) {
        }

        return array_values($lines);
    }

    /**
     * @return list<array{key: string, length: int, scheme: string, is_placeholder: bool}>
     */
    private function envVarHints(Application $application): array
    {
        try {
            $variables = $application->environment_variables()
                ->where('is_preview', false)
                ->orderBy('key')
                ->get();
        } catch (Throwable) {
            return [];
        }

        return $variables
            ->map(function (EnvironmentVariable $variable): array {
                $value = '';
                try {
                    $value = (string) ($variable->value ?? '');
                } catch (Throwable) {
                    $value = '';
                }

                $isPlaceholder = $value === ''
                    || $value === '********'
                    || str_starts_with($value, '[REQUIS');

                return [
                    'key' => (string) $variable->key,
                    'length' => mb_strlen($value),
                    'scheme' => $this->valueScheme($value),
                    'is_placeholder' => $isPlaceholder,
                ];
            })
            ->values()
            ->all();
    }

    private function valueScheme(string $value): string
    {
        $lower = strtolower($value);

        return match (true) {
            str_starts_with($lower, 'libsql:') => 'libsql',
            str_starts_with($lower, 'https://') => 'https',
            str_starts_with($lower, 'http://') => 'http',
            str_starts_with($lower, 'postgres:') || str_starts_with($lower, 'postgresql:') => 'postgres',
            str_starts_with($lower, 'mysql:') || str_starts_with($lower, 'mariadb:') => 'mysql',
            str_starts_with($lower, 'redis:') => 'redis',
            str_starts_with($lower, 'mongodb:') => 'mongodb',
            str_starts_with($lower, 'file:') => 'file',
            default => 'none',
        };
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function linkedDatabases(Application $application): array
    {
        try {
            $variables = $application->environment_variables()
                ->where('is_preview', false)
                ->get(['key', 'comment']);
        } catch (Throwable) {
            return [];
        }

        $byUuid = [];
        $prefix = LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX;
        foreach ($variables as $variable) {
            $comment = (string) ($variable->comment ?? '');
            if (! str_starts_with($comment, $prefix)) {
                continue;
            }
            $uuid = substr($comment, strlen($prefix));
            if ($uuid === '') {
                continue;
            }
            $byUuid[$uuid]['uuid'] = $uuid;
            $byUuid[$uuid]['env_keys'][] = $variable->key;
        }

        if ($byUuid === []) {
            return [];
        }

        try {
            $databases = $application->environment?->databases() ?? collect();
            foreach ($databases as $database) {
                $uuid = (string) ($database->uuid ?? '');
                if (! isset($byUuid[$uuid])) {
                    continue;
                }
                $engine = str((string) $database->type())->after('standalone-')->value();
                $byUuid[$uuid]['name'] = (string) $database->name;
                $byUuid[$uuid]['engine'] = $engine;
                $byUuid[$uuid]['status'] = is_string($database->status ?? null) ? $database->status : null;
            }
        } catch (Throwable) {
        }

        return array_values($byUuid);
    }

    /**
     * @param  mixed  $hints
     */
    private function formatEnvHints(mixed $hints): string
    {
        if (! is_array($hints) || $hints === []) {
            return '  (aucune)';
        }

        $lines = [];
        foreach ($hints as $hint) {
            if (! is_array($hint)) {
                continue;
            }
            $key = (string) ($hint['key'] ?? '');
            if ($key === '') {
                continue;
            }
            $scheme = (string) ($hint['scheme'] ?? 'none');
            $length = (int) ($hint['length'] ?? 0);
            $placeholder = ! empty($hint['is_placeholder']) ? 'placeholder' : 'set';
            $lines[] = "  - {$key} (len={$length}, scheme={$scheme}, {$placeholder})";
        }

        return $lines === [] ? '  (aucune)' : implode("\n", $lines);
    }

    /**
     * @param  mixed  $databases
     */
    private function formatLinkedDatabases(mixed $databases): string
    {
        if (! is_array($databases) || $databases === []) {
            return '  (aucune)';
        }

        $lines = [];
        foreach ($databases as $database) {
            if (! is_array($database)) {
                continue;
            }
            $name = (string) ($database['name'] ?? $database['uuid'] ?? 'db');
            $engine = (string) ($database['engine'] ?? 'inconnu');
            $status = (string) ($database['status'] ?? 'inconnu');
            $keys = $database['env_keys'] ?? [];
            $keyList = is_array($keys) ? implode(',', array_map('strval', $keys)) : '';
            $lines[] = "  - {$name} engine={$engine} status={$status} env={$keyList}";
        }

        return $lines === [] ? '  (aucune)' : implode("\n", $lines);
    }

    /**
     * @param  mixed  $deployment
     */
    private function formatLatestDeployment(mixed $deployment): string
    {
        if (! is_array($deployment) || $deployment === []) {
            return '- Dernier déploiement : aucun';
        }

        $uuid = (string) ($deployment['uuid'] ?? 'inconnu');
        $status = (string) ($deployment['status'] ?? 'inconnu');
        $started = (string) ($deployment['started_at'] ?? 'inconnu');
        $block = "- Dernier déploiement : {$uuid} status={$status} started_at={$started}";

        $logs = $deployment['failed_logs'] ?? [];
        if (is_array($logs) && $logs !== []) {
            $block .= "\n  Dernières lignes de log (échec, non hidden) :\n";
            foreach ($logs as $line) {
                if (! is_string($line) || $line === '') {
                    continue;
                }
                $block .= '    '.$line."\n";
            }
        }

        return rtrim($block);
    }
}
