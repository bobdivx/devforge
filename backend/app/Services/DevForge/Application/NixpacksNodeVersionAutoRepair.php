<?php

namespace App\Services\DevForge\Application;

use App\Enums\ApplicationDeploymentStatus;
use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use Illuminate\Support\Facades\Cache;
use Throwable;
use Visus\Cuid2\Cuid2;

class NixpacksNodeVersionAutoRepair
{
    public function __construct(
        private readonly NixpacksNodeVersionResolver $resolver,
        private readonly NixpacksNodeVersionApplier $applier,
    ) {}

    public function repairAndRedeploy(Application $application, ApplicationDeploymentQueue $queue): ?string
    {
        if (! in_array((string) $application->build_pack, ['nixpacks', 'railpack'], true)) {
            return null;
        }

        $logs = $this->logsToText($queue->logs);
        if (! $this->resolver->logsLookLikeEngineMismatch($logs)) {
            return null;
        }

        $current = $this->applier->current($application) ?? NixpacksNodeVersionResolver::DEFAULT;
        $next = $this->resolver->resolveFromBuildError($logs, $current);
        if ($next === null) {
            return null;
        }

        $cacheKey = 'nixpacks-node-autorepair:'.$application->id.':'.($queue->commit ?: 'HEAD').':'.$next;
        if (! Cache::add($cacheKey, true, now()->addHours(6))) {
            return null;
        }

        if (! $this->applier->apply($application, $next)) {
            return null;
        }

        $key = $this->applier->keyFor($application);
        $queue->addLogEntry("{$key} ajusté automatiquement : {$current} → {$next}. Nouveau déploiement lancé.");

        try {
            queue_application_deployment(
                application: $application,
                deployment_uuid: (string) new Cuid2,
                commit: $queue->commit ?: null,
                force_rebuild: true,
                no_questions_asked: true,
                pull_request_id: (int) ($queue->pull_request_id ?? 0),
            );
        } catch (Throwable $exception) {
            $queue->addLogEntry('Impossible de relancer le déploiement après ajustement Node : '.$exception->getMessage(), 'stderr');

            return $next;
        }

        return $next;
    }

    public function logsToText(mixed $logs): string
    {
        if (is_string($logs) && $logs !== '') {
            $decoded = json_decode($logs, true);
            if (is_array($decoded)) {
                return $this->entriesToText($decoded);
            }

            return $logs;
        }

        if (is_array($logs)) {
            return $this->entriesToText($logs);
        }

        return '';
    }

    /**
     * @param  list<mixed>  $entries
     */
    private function entriesToText(array $entries): string
    {
        $lines = [];
        foreach ($entries as $entry) {
            if (is_string($entry)) {
                $lines[] = $entry;

                continue;
            }

            if (! is_array($entry)) {
                continue;
            }

            $lines[] = (string) ($entry['output'] ?? $entry['message'] ?? '');
        }

        return implode("\n", $lines);
    }
}
