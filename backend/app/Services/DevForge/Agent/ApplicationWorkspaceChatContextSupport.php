<?php

namespace App\Services\DevForge\Agent;

use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\EnvironmentVariable;
use App\Services\DevForge\Database\LibsqlConnectionEnvSync;
use App\Services\DevForge\SecretRedactor;
use Throwable;

trait ApplicationWorkspaceChatContextSupport
{
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
                    'rollback',
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
            'at' => $deployment->finished_at?->toIso8601String()
                ?? $deployment->updated_at?->toIso8601String()
                ?? $deployment->created_at?->toIso8601String(),
            'rollback' => (bool) ($deployment->rollback ?? false),
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
        $started = (string) ($deployment['at'] ?? $deployment['started_at'] ?? 'inconnu');
        $rollback = ! empty($deployment['rollback']) ? ' rollback=oui' : '';
        $block = "- Dernier déploiement : {$uuid} status={$status} at={$started}{$rollback}";

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
