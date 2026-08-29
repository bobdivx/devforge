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
