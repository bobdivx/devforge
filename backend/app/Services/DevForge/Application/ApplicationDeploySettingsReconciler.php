<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentDirectives;
use Throwable;

class ApplicationDeploySettingsReconciler
{
    public function __construct(
        private readonly ApplicationRuntimeSettingsDetector $detector,
        private readonly ApplicationRuntimeSettingsService $runtimeSettings,
    ) {}

    /**
     * Detect stack from the repo and apply missing/default runtime settings before deploy.
     *
     * @return array{applied: bool, framework: string|null, changes: list<string>}
     */
    public function reconcile(Application $application): array
    {
        try {
            $application->loadMissing(['settings', 'environment.project.team']);
            $team = $application->team();
            if (! $team instanceof Team) {
                return $this->noop();
            }

            $result = $this->detector->detect($team, $application);

            return $this->applyDetection($application, $result);
        } catch (Throwable) {
            return $this->noop();
        }
    }

    /**
     * Apply a detection payload (unit-testable without GitHub).
     *
     * @param  array{
     *     available?: bool,
     *     suggestions?: array<string, mixed>,
     *     reasons?: list<string>
     * }  $result
     * @return array{applied: bool, framework: string|null, changes: list<string>}
     */
    public function applyDetection(Application $application, array $result): array
    {
        if (! ($result['available'] ?? false)) {
            return $this->noop();
        }

        $suggestions = is_array($result['suggestions'] ?? null) ? $result['suggestions'] : [];
        if ($suggestions === []) {
            return $this->noop();
        }

        $application->loadMissing('settings');

        $framework = is_string($suggestions['framework'] ?? null) && $suggestions['framework'] !== ''
            ? (string) $suggestions['framework']
            : null;

        $suggestedStatic = (bool) ($suggestions['is_static'] ?? false);
        $suggestedPublish = AgentDirectives::normalizePublishDirectory(
            is_string($suggestions['publish_directory'] ?? null) ? (string) $suggestions['publish_directory'] : null,
        ) ?? '/';

        $currentPublish = AgentDirectives::normalizePublishDirectory($application->publish_directory) ?? '/';
        $publishUnset = $this->publishLooksUnset($currentPublish);
        $currentStatic = (bool) ($application->settings?->is_static ?? false);

        $payload = [];
        $changes = [];

        if ($framework !== null && $application->detected_framework !== $framework) {
            $application->detected_framework = $framework;
            $application->save();
            $changes[] = "detected_framework={$framework}";
        }

        if ($suggestedStatic && ! $currentStatic) {
            $payload['is_static'] = true;
            $changes[] = 'is_static=true';
        }

        // Critical: wrongly-enabled nginx static breaks Astro/Next SSR healthchecks (port 80 vs 4321).
        $ssrFrameworks = ['astro-ssr', 'next', 'nuxt', 'node'];
        if (! $suggestedStatic && $currentStatic && in_array($framework, $ssrFrameworks, true)) {
            $payload['is_static'] = false;
            $changes[] = 'is_static=false';
        }

        if ($publishUnset && $suggestedPublish !== '/') {
            $payload['publish_directory'] = $suggestedPublish;
            $changes[] = "publish_directory={$suggestedPublish}";
        }

        if ($suggestedStatic && (isset($payload['is_static']) || isset($payload['publish_directory']))) {
            $ports = is_string($suggestions['ports_exposes'] ?? null) ? (string) $suggestions['ports_exposes'] : '80';
            if (! filled($application->ports_exposes) || (string) $application->ports_exposes === '3000') {
                $payload['ports_exposes'] = $ports;
                $changes[] = "ports_exposes={$ports}";
            }
        }

        // Non-static (SSR/Node): apply detected listen port when unset or still on Coolify default 3000/80.
        if (! $suggestedStatic) {
            $suggestedPorts = is_string($suggestions['ports_exposes'] ?? null) ? (string) $suggestions['ports_exposes'] : null;
            $currentPorts = trim((string) ($application->ports_exposes ?? ''));
            $looksLikeDefault = $currentPorts === '' || in_array($currentPorts, ['3000', '80'], true);
            if ($suggestedPorts !== null && $suggestedPorts !== '' && $looksLikeDefault && $suggestedPorts !== $currentPorts) {
                $payload['ports_exposes'] = $suggestedPorts;
                $changes[] = "ports_exposes={$suggestedPorts}";
            }
        }

        foreach (['install_command', 'build_command', 'start_command'] as $commandKey) {
            $suggested = $suggestions[$commandKey] ?? null;
            if (! is_string($suggested) || trim($suggested) === '') {
                continue;
            }
            $current = $application->{$commandKey};
            if (filled($current)) {
                continue;
            }
            if ($suggestedStatic && $commandKey === 'start_command') {
                continue;
            }
            $payload[$commandKey] = $suggested;
            $changes[] = "{$commandKey} set";
        }

        // When switching away from static, clear a missing start command with the SSR default.
        if (! $suggestedStatic && isset($payload['is_static']) && $payload['is_static'] === false) {
            $suggestedStart = $suggestions['start_command'] ?? null;
            if (is_string($suggestedStart) && trim($suggestedStart) !== '' && ! filled($application->start_command) && ! isset($payload['start_command'])) {
                $payload['start_command'] = $suggestedStart;
                $changes[] = 'start_command set';
            }
        }

        $this->applyHealthcheckDefaults($application, $suggestions, $suggestedStatic, $payload, $changes);

        if ($payload !== []) {
            $payload['redeploy'] = false;
            $this->runtimeSettings->update($application, $payload);
        }

        return [
            'applied' => $changes !== [],
            'framework' => $framework,
            'changes' => $changes,
        ];
    }

    /**
     * @param  array<string, mixed>  $suggestions
     * @param  array<string, mixed>  $payload
     * @param  list<string>  $changes
     */
    private function applyHealthcheckDefaults(
        Application $application,
        array $suggestions,
        bool $suggestedStatic,
        array &$payload,
        array &$changes,
    ): void {
        $suggestedPort = is_string($suggestions['health_check_port'] ?? null)
            ? trim((string) $suggestions['health_check_port'])
            : (is_string($suggestions['ports_exposes'] ?? null) ? trim((string) $suggestions['ports_exposes']) : null);
        if ($suggestedStatic) {
            $suggestedPort = $suggestedPort ?: '80';
        }

        $currentHealthPort = filled($application->health_check_port)
            ? trim((string) $application->health_check_port)
            : '';
        $healthPortLooksDefault = $currentHealthPort === '' || in_array($currentHealthPort, ['80', '3000'], true);

        if ($suggestedPort !== null && $suggestedPort !== '' && $healthPortLooksDefault && $suggestedPort !== $currentHealthPort) {
            $payload['health_check_port'] = $suggestedPort;
            $changes[] = "health_check_port={$suggestedPort}";
        }

        $suggestedPath = is_string($suggestions['health_check_path'] ?? null)
            ? trim((string) $suggestions['health_check_path'])
            : null;
        $currentPath = trim((string) ($application->health_check_path ?: ''));
        if ($suggestedPath !== null && $suggestedPath !== '' && $currentPath === '') {
            $payload['health_check_path'] = $suggestedPath;
            $changes[] = "health_check_path={$suggestedPath}";
        }

        if (array_key_exists('health_check_enabled', $suggestions)) {
            $suggestedEnabled = (bool) $suggestions['health_check_enabled'];
            if ($suggestedEnabled && ! (bool) $application->health_check_enabled) {
                $payload['health_check_enabled'] = true;
                $changes[] = 'health_check_enabled=true';
            }
        }
    }

    private function publishLooksUnset(?string $publishDirectory): bool
    {
        $normalized = AgentDirectives::normalizePublishDirectory($publishDirectory);

        return $normalized === null || $normalized === '/';
    }

    /**
     * @return array{applied: bool, framework: string|null, changes: list<string>}
     */
    private function noop(): array
    {
        return [
            'applied' => false,
            'framework' => null,
            'changes' => [],
        ];
    }
}
