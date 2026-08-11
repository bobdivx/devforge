<?php

namespace App\Services\DevForge\Docker;

use App\Actions\Service\StartService;
use App\Models\Application;
use App\Models\Service;
use App\Models\Team;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Visus\Cuid2\Cuid2;

/**
 * Poll opt-in dockerimage apps / services and redeploy when a registry digest changed.
 */
class DockerImageAutoUpdater
{
    public function __construct(
        private readonly DockerImageUpdateChecker $checker,
    ) {}

    /**
     * @return array{checked: int, updated: int, skipped: int, errors: int, results: list<array<string, mixed>>}
     */
    public function run(): array
    {
        $results = [];
        $checked = 0;
        $updated = 0;
        $skipped = 0;
        $errors = 0;

        $applications = Application::query()
            ->where('build_pack', 'dockerimage')
            ->whereHas('settings', fn ($query) => $query->where('is_image_auto_update_enabled', true))
            ->with(['settings', 'environment.project.team', 'destination.server'])
            ->get();

        foreach ($applications as $application) {
            $checked++;
            $outcome = $this->processApplication($application);
            $results[] = $outcome;
            match ($outcome['status'] ?? 'error') {
                'updated' => $updated++,
                'skipped' => $skipped++,
                default => $errors++,
            };
        }

        $services = Service::query()
            ->where('is_image_auto_update_enabled', true)
            ->with(['applications', 'environment.project.team', 'server'])
            ->get();

        foreach ($services as $service) {
            $checked++;
            $outcome = $this->processService($service);
            $results[] = $outcome;
            match ($outcome['status'] ?? 'error') {
                'updated' => $updated++,
                'skipped' => $skipped++,
                default => $errors++,
            };
        }

        return [
            'checked' => $checked,
            'updated' => $updated,
            'skipped' => $skipped,
            'errors' => $errors,
            'results' => $results,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function applyForApplication(Application $application, bool $force = false): array
    {
        return $this->processApplication($application, forceApply: $force);
    }

    /**
     * @return array<string, mixed>
     */
    public function applyForService(Service $service, bool $force = false): array
    {
        return $this->processService($service, forceApply: $force);
    }

    /**
     * True only when digest comparison proves an update (MVP policy).
     *
     * @param  array<string, mixed>  $check
     */
    public function shouldAutoApply(array $check): bool
    {
        return ($check['ok'] ?? false) === true
            && ($check['update_available'] ?? null) === true
            && ($check['comparison'] ?? null) === 'running_digest';
    }

    /**
     * @return array<string, mixed>
     */
    private function processApplication(Application $application, bool $forceApply = false): array
    {
        $team = $application->environment?->project?->team;
        if (! $team instanceof Team) {
            return [
                'status' => 'error',
                'resource_type' => 'application',
                'uuid' => $application->uuid,
                'error' => 'Team introuvable.',
            ];
        }

        $server = $application->destination?->server;
        if ($server === null || ! $server->isFunctional()) {
            return [
                'status' => 'skipped',
                'resource_type' => 'application',
                'uuid' => $application->uuid,
                'reason' => 'Serveur indisponible.',
            ];
        }

        $check = $this->checker->check(
            team: $team,
            applicationUuid: $application->uuid,
            inspectRunning: true,
        );

        if (! $forceApply && ! $this->shouldAutoApply($check)) {
            return [
                'status' => 'skipped',
                'resource_type' => 'application',
                'uuid' => $application->uuid,
                'name' => $application->name,
                'reason' => $this->skipReason($check),
                'check' => $check,
            ];
        }

        if ($forceApply && (($check['ok'] ?? false) !== true || ($check['update_available'] ?? null) !== true)) {
            return [
                'status' => 'skipped',
                'resource_type' => 'application',
                'uuid' => $application->uuid,
                'name' => $application->name,
                'reason' => $this->skipReason($check),
                'check' => $check,
            ];
        }

        return $this->withLock("docker-image-auto-update:app:{$application->uuid}", function () use ($application, $check, $team) {
            $deploymentUuid = new Cuid2;
            $result = queue_application_deployment(
                application: $application,
                deployment_uuid: $deploymentUuid,
                force_rebuild: false,
                is_api: true,
            );

            if (($result['status'] ?? null) === 'queue_full') {
                return [
                    'status' => 'error',
                    'resource_type' => 'application',
                    'uuid' => $application->uuid,
                    'error' => (string) ($result['message'] ?? 'Queue pleine.'),
                    'check' => $check,
                ];
            }

            if (($result['status'] ?? null) === 'skipped') {
                return [
                    'status' => 'skipped',
                    'resource_type' => 'application',
                    'uuid' => $application->uuid,
                    'reason' => (string) ($result['message'] ?? 'Déploiement ignoré.'),
                    'check' => $check,
                ];
            }

            auditLog('devforge.docker.image_auto_update', [
                'team_id' => $team->id,
                'resource_type' => 'application',
                'resource_uuid' => $application->uuid,
                'deployment_uuid' => $deploymentUuid->toString(),
            ]);

            Log::info('Docker image auto-update queued for application', [
                'application_uuid' => $application->uuid,
                'deployment_uuid' => $deploymentUuid->toString(),
            ]);

            return [
                'status' => 'updated',
                'resource_type' => 'application',
                'uuid' => $application->uuid,
                'name' => $application->name,
                'deployment_uuid' => $deploymentUuid->toString(),
                'check' => $check,
            ];
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function processService(Service $service, bool $forceApply = false): array
    {
        $team = $service->environment?->project?->team;
        if (! $team instanceof Team) {
            return [
                'status' => 'error',
                'resource_type' => 'service',
                'uuid' => $service->uuid,
                'error' => 'Team introuvable.',
            ];
        }

        $server = $service->server;
        if ($server === null || ! $server->isFunctional()) {
            return [
                'status' => 'skipped',
                'resource_type' => 'service',
                'uuid' => $service->uuid,
                'reason' => 'Serveur indisponible.',
            ];
        }

        $check = $this->checker->checkService($team, $service->uuid, inspectRunning: true);

        if (! $forceApply && ! $this->shouldAutoApply($check)) {
            return [
                'status' => 'skipped',
                'resource_type' => 'service',
                'uuid' => $service->uuid,
                'name' => $service->name,
                'reason' => $this->skipReason($check),
                'check' => $check,
            ];
        }

        if ($forceApply && (($check['ok'] ?? false) !== true || ($check['update_available'] ?? null) !== true)) {
            return [
                'status' => 'skipped',
                'resource_type' => 'service',
                'uuid' => $service->uuid,
                'name' => $service->name,
                'reason' => $this->skipReason($check),
                'check' => $check,
            ];
        }

        return $this->withLock("docker-image-auto-update:service:{$service->uuid}", function () use ($service, $check, $team) {
            StartService::dispatch($service, true);

            auditLog('devforge.docker.image_auto_update', [
                'team_id' => $team->id,
                'resource_type' => 'service',
                'resource_uuid' => $service->uuid,
            ]);

            Log::info('Docker image auto-update queued for service', [
                'service_uuid' => $service->uuid,
            ]);

            return [
                'status' => 'updated',
                'resource_type' => 'service',
                'uuid' => $service->uuid,
                'name' => $service->name,
                'check' => $check,
            ];
        });
    }

    /**
     * @param  array<string, mixed>  $check
     */
    private function skipReason(array $check): string
    {
        if (isset($check['error'])) {
            return (string) $check['error'];
        }

        if (($check['update_available'] ?? null) === false) {
            return 'Déjà à jour.';
        }

        if (($check['comparison'] ?? null) !== 'running_digest') {
            return 'Comparaison inconclusive (digest running requis pour l’auto-update).';
        }

        return 'Aucune mise à jour applicable.';
    }

    /**
     * @param  callable(): array<string, mixed>  $callback
     * @return array<string, mixed>
     */
    private function withLock(string $key, callable $callback): array
    {
        $lock = Cache::lock($key, 300);
        if (! $lock->get()) {
            return [
                'status' => 'skipped',
                'reason' => 'Mise à jour déjà en cours (lock).',
            ];
        }

        try {
            return $callback();
        } finally {
            optional($lock)->release();
        }
    }
}
