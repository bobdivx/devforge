<?php

namespace App\Services\DevForge\Readiness;

use App\Jobs\DevForge\ApplicationDomainProbeJob;
use App\Models\AiAgentRun;
use App\Models\Application;
use App\Models\ApplicationReadiness;
use App\Models\ApplicationReadinessIntervention;
use App\Services\DevForge\Agent\DeploymentReadinessAgentDispatcher;
use App\Services\DevForge\Core\CoreResourceAction;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

class ApplicationReadinessService
{
    public function __construct(
        private readonly HealthCheckBootstrapper $healthCheckBootstrapper,
        private readonly ApplicationDomainProbe $domainProbe,
        private readonly ReadinessAgentOutcomeParser $outcomeParser,
        private readonly DeploymentReadinessAgentDispatcher $readinessAgentDispatcher,
        private readonly CoreResourceAction $coreResourceAction,
    ) {}

    public function ensureFor(Application $application, bool $autonomousEnabled = true): ApplicationReadiness
    {
        $maxRounds = max(1, (int) config('devforge.readiness_max_rounds', 5));

        return ApplicationReadiness::query()->firstOrCreate(
            ['application_id' => $application->id],
            [
                'status' => ApplicationReadiness::STATUS_IDLE,
                'autonomous_enabled' => $autonomousEnabled,
                'round' => 0,
                'max_rounds' => $maxRounds,
            ],
        );
    }

    public function onDeploymentFinished(Application $application, string $deploymentUuid): void
    {
        if (! (bool) config('devforge.readiness_enabled', true)) {
            return;
        }

        $readiness = $this->ensureFor($application, true);

        if (! $readiness->autonomous_enabled) {
            return;
        }

        $this->healthCheckBootstrapper->ensureEnabled($application->fresh() ?? $application);

        $readiness->update([
            'status' => ApplicationReadiness::STATUS_PROBING,
            'last_deployment_uuid' => $deploymentUuid,
            'round' => 0,
            'max_rounds' => max(1, (int) ($readiness->max_rounds ?: config('devforge.readiness_max_rounds', 5))),
            'active_intervention_id' => null,
            'last_probe_error' => null,
        ]);

        $this->cancelOpenInterventions($application);

        $this->scheduleProbe($application);
    }

    public function scheduleProbe(Application $application, ?int $delaySeconds = null): void
    {
        $delay = $delaySeconds ?? max(0, (int) config('devforge.readiness_probe_delay_seconds', 90));

        $job = ApplicationDomainProbeJob::dispatch($application->uuid);

        if ($delay > 0) {
            $job->delay(now()->addSeconds($delay));
        }
    }

    /**
     * @return array{
     *     ok: bool,
     *     url: string|null,
     *     status: int|null,
     *     error: string|null,
     *     skipped: bool,
     *     readiness: ApplicationReadiness
     * }
     */
    public function runProbe(Application $application, bool $dispatchAgentOnFailure = true): array
    {
        $readiness = $this->ensureFor($application);
        $readiness->update(['status' => ApplicationReadiness::STATUS_PROBING]);

        $result = $this->domainProbe->probe($application);

        $readiness->update([
            'last_probe_at' => now(),
            'last_probe_ok' => $result['ok'],
            'last_probe_error' => $result['error'],
            'last_http_status' => $result['status'],
        ]);

        if ($result['ok']) {
            $this->markHealthy($readiness);
            $this->resolveActiveIntervention($readiness, $application);

            return [...$result, 'readiness' => $readiness->fresh() ?? $readiness];
        }

        if ($result['skipped']) {
            $readiness->update([
                'status' => ApplicationReadiness::STATUS_IDLE,
            ]);

            return [...$result, 'readiness' => $readiness->fresh() ?? $readiness];
        }

        if (! $readiness->autonomous_enabled || ! $dispatchAgentOnFailure) {
            $readiness->update(['status' => ApplicationReadiness::STATUS_FAILED]);

            return [...$result, 'readiness' => $readiness->fresh() ?? $readiness];
        }

        $this->handleProbeFailure($application, $readiness, $result);

        return [...$result, 'readiness' => $readiness->fresh() ?? $readiness];
    }

    public function markHealthy(ApplicationReadiness $readiness): void
    {
        $readiness->update([
            'status' => ApplicationReadiness::STATUS_HEALTHY,
            'last_probe_ok' => true,
            'last_probe_error' => null,
            'round' => 0,
            'active_intervention_id' => null,
        ]);
    }

    /**
     * @param  array{ok: bool, url: string|null, status: int|null, error: string|null, skipped: bool}  $probeResult
     */
    public function handleProbeFailure(Application $application, ApplicationReadiness $readiness, array $probeResult): void
    {
        $maxRounds = max(1, (int) ($readiness->max_rounds ?: config('devforge.readiness_max_rounds', 5)));
        $nextRound = (int) $readiness->round + 1;

        if ($nextRound > $maxRounds) {
            $readiness->update([
                'status' => ApplicationReadiness::STATUS_FAILED,
                'round' => $nextRound,
                'last_probe_error' => $probeResult['error'] ?? 'Plafond de tours atteint.',
            ]);

            Log::warning('DevForge readiness: plafond de tours atteint.', [
                'application_uuid' => $application->uuid,
                'round' => $nextRound,
                'max_rounds' => $maxRounds,
            ]);

            return;
        }

        $readiness->update([
            'status' => ApplicationReadiness::STATUS_RECOVERING,
            'round' => $nextRound,
        ]);

        $run = $this->readinessAgentDispatcher->dispatch(
            application: $application,
            readiness: $readiness->fresh() ?? $readiness,
            probeResult: $probeResult,
        );

        if ($run === null) {
            $readiness->update([
                'status' => ApplicationReadiness::STATUS_FAILED,
                'last_probe_error' => ($probeResult['error'] ?? 'Probe failed').' — aucun agent disponible.',
            ]);
        }
    }

    public function handleAgentOutcome(AiAgentRun $run): void
    {
        $metadata = $run->metadata ?? [];
        if (($metadata['event'] ?? null) !== DeploymentReadinessAgentDispatcher::EVENT) {
            return;
        }

        $applicationUuid = (string) ($metadata['application_uuid'] ?? '');
        if ($applicationUuid === '') {
            return;
        }

        $application = Application::query()->where('uuid', $applicationUuid)->first();
        if (! $application instanceof Application) {
            return;
        }

        $readiness = $this->ensureFor($application);
        $parsed = $this->outcomeParser->parse($run->summary, $metadata);

        $run->mergeMetadata(['readiness_outcome' => $parsed]);

        match ($parsed['outcome']) {
            'auto_fixed' => $this->afterAutoFixed($application, $readiness),
            'failed' => $readiness->update([
                'status' => ApplicationReadiness::STATUS_FAILED,
                'last_probe_error' => $parsed['summary'] ?? 'L\'agent n\'a pas pu corriger le problème.',
            ]),
            default => $this->createIntervention($application, $readiness, $run, $parsed),
        };
    }

    /**
     * @return array<string, mixed>
     */
    public function acknowledgeInterventionDone(Application $application, string $interventionUuid): array
    {
        $readiness = $this->ensureFor($application);
        $intervention = ApplicationReadinessIntervention::query()
            ->where('uuid', $interventionUuid)
            ->where('application_id', $application->id)
            ->firstOrFail();

        abort_unless(
            in_array($intervention->status, [
                ApplicationReadinessIntervention::STATUS_OPEN,
                ApplicationReadinessIntervention::STATUS_ACKNOWLEDGED,
            ], true),
            422,
            'Cette intervention n\'est plus active.',
        );

        $steps = collect($intervention->steps ?? [])
            ->map(function (array $step): array {
                $step['done'] = true;

                return $step;
            })
            ->values()
            ->all();

        $intervention->update([
            'steps' => $steps,
            'status' => ApplicationReadinessIntervention::STATUS_ACKNOWLEDGED,
            'user_acknowledged_at' => now(),
        ]);

        $readiness->update([
            'status' => ApplicationReadiness::STATUS_RECOVERING,
            'active_intervention_id' => $intervention->id,
        ]);

        $restart = $this->coreResourceAction->execute($application, 'applications', 'restart', []);

        $this->scheduleProbe($application, max(30, (int) config('devforge.readiness_probe_delay_seconds', 90)));

        return [
            'readiness' => $this->present($application),
            'restart' => $restart,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function updateAutonomous(Application $application, bool $enabled): array
    {
        $readiness = $this->ensureFor($application);
        $readiness->update(['autonomous_enabled' => $enabled]);

        if (! $enabled && in_array($readiness->status, [
            ApplicationReadiness::STATUS_PROBING,
            ApplicationReadiness::STATUS_RECOVERING,
        ], true)) {
            $readiness->update(['status' => ApplicationReadiness::STATUS_IDLE]);
        }

        return $this->present($application);
    }

    /**
     * @return array<string, mixed>
     */
    public function present(Application $application): array
    {
        try {
            if (! Schema::hasTable('application_readiness')) {
                return $this->degradedPresent($application, 'Tables de readiness absentes — lancez les migrations.');
            }

            $readiness = $this->ensureFor($application);
            $readiness->loadMissing('activeIntervention');

            $intervention = $readiness->activeIntervention;
            if (
                $intervention === null
                && $readiness->status === ApplicationReadiness::STATUS_AWAITING_USER
            ) {
                $intervention = ApplicationReadinessIntervention::query()
                    ->where('application_id', $application->id)
                    ->whereIn('status', [
                        ApplicationReadinessIntervention::STATUS_OPEN,
                        ApplicationReadinessIntervention::STATUS_ACKNOWLEDGED,
                    ])
                    ->latest('id')
                    ->first();
            }

            return [
                'uuid' => $readiness->uuid,
                'status' => $readiness->status,
                'autonomous_enabled' => $readiness->autonomous_enabled,
                'last_probe_at' => optional($readiness->last_probe_at)?->toIso8601String(),
                'last_probe_ok' => $readiness->last_probe_ok,
                'last_probe_error' => $readiness->last_probe_error,
                'last_http_status' => $readiness->last_http_status,
                'round' => $readiness->round,
                'max_rounds' => $readiness->max_rounds,
                'last_deployment_uuid' => $readiness->last_deployment_uuid,
                'probe_url' => $this->domainProbe->primaryUrl($application),
                'intervention' => $intervention ? [
                    'uuid' => $intervention->uuid,
                    'title' => $intervention->title,
                    'summary' => $intervention->summary,
                    'steps' => $intervention->steps ?? [],
                    'status' => $intervention->status,
                    'user_acknowledged_at' => optional($intervention->user_acknowledged_at)?->toIso8601String(),
                    'resolved_at' => optional($intervention->resolved_at)?->toIso8601String(),
                ] : null,
            ];
        } catch (QueryException|Throwable $exception) {
            Log::warning('DevForge readiness present failed; returning degraded payload.', [
                'application_uuid' => $application->uuid,
                'error' => $exception->getMessage(),
            ]);

            return $this->degradedPresent(
                $application,
                'Surveillance temporairement indisponible.',
            );
        }
    }

    /**
     * Stable payload so the UI never receives a 500 from readiness.
     *
     * @return array<string, mixed>
     */
    private function degradedPresent(Application $application, string $error): array
    {
        return [
            'uuid' => null,
            'status' => ApplicationReadiness::STATUS_IDLE,
            'autonomous_enabled' => false,
            'last_probe_at' => null,
            'last_probe_ok' => null,
            'last_probe_error' => $error,
            'last_http_status' => null,
            'round' => 0,
            'max_rounds' => max(1, (int) config('devforge.readiness_max_rounds', 5)),
            'last_deployment_uuid' => null,
            'probe_url' => $this->domainProbe->primaryUrl($application),
            'intervention' => null,
            'degraded' => true,
        ];
    }

    public function watchdogTick(): void
    {
        if (! (bool) config('devforge.readiness_enabled', true)) {
            return;
        }

        ApplicationReadiness::query()
            ->where('autonomous_enabled', true)
            ->whereIn('status', [
                ApplicationReadiness::STATUS_HEALTHY,
                ApplicationReadiness::STATUS_RECOVERING,
                ApplicationReadiness::STATUS_PROBING,
            ])
            ->where(function ($query): void {
                $query->whereNull('last_probe_at')
                    ->orWhere('last_probe_at', '<=', now()->subMinutes(
                        max(1, (int) config('devforge.readiness_watchdog_minutes', 3))
                    ));
            })
            ->with('application')
            ->limit(40)
            ->get()
            ->each(function (ApplicationReadiness $readiness): void {
                $application = $readiness->application;
                if (! $application instanceof Application) {
                    return;
                }

                // Watchdog: probe only; agent only if previously healthy (regression) or recovering.
                $dispatchAgent = in_array($readiness->status, [
                    ApplicationReadiness::STATUS_HEALTHY,
                    ApplicationReadiness::STATUS_RECOVERING,
                ], true);

                try {
                    ApplicationDomainProbeJob::dispatch($application->uuid, $dispatchAgent);
                } catch (\Throwable $exception) {
                    Log::warning('DevForge readiness watchdog: échec dispatch probe.', [
                        'application_uuid' => $application->uuid,
                        'error' => $exception->getMessage(),
                    ]);
                }
            });
    }

    private function afterAutoFixed(Application $application, ApplicationReadiness $readiness): void
    {
        $readiness->update(['status' => ApplicationReadiness::STATUS_RECOVERING]);
        $this->scheduleProbe($application, max(30, (int) config('devforge.readiness_probe_delay_seconds', 90)));
    }

    /**
     * @param  array{
     *     outcome: string,
     *     title: string,
     *     summary: string|null,
     *     steps: list<array{rank: int, text: string, done: bool}>
     * }  $parsed
     */
    private function createIntervention(
        Application $application,
        ApplicationReadiness $readiness,
        AiAgentRun $run,
        array $parsed,
    ): void {
        $enriched = $this->enrichInterventionForUser($readiness, $parsed);

        $intervention = ApplicationReadinessIntervention::query()->create([
            'application_id' => $application->id,
            'deployment_uuid' => $readiness->last_deployment_uuid,
            'agent_run_uuid' => $run->uuid,
            'title' => $enriched['title'],
            'summary' => $enriched['summary'],
            'steps' => $enriched['steps'],
            'status' => ApplicationReadinessIntervention::STATUS_OPEN,
        ]);

        $readiness->update([
            'status' => ApplicationReadiness::STATUS_AWAITING_USER,
            'active_intervention_id' => $intervention->id,
        ]);

        Log::info('DevForge readiness: intervention utilisateur créée.', [
            'application_uuid' => $application->uuid,
            'intervention_uuid' => $intervention->uuid,
            'agent_run_uuid' => $run->uuid,
        ]);
    }

    /**
     * Ensure the user-facing intervention always states the probe error and a concrete action.
     *
     * @param  array{
     *     outcome: string,
     *     title: string,
     *     summary: string|null,
     *     steps: list<array{rank: int, text: string, done: bool}>
     * }  $parsed
     * @return array{
     *     title: string,
     *     summary: string|null,
     *     steps: list<array{rank: int, text: string, done: bool}>
     * }
     */
    private function enrichInterventionForUser(ApplicationReadiness $readiness, array $parsed): array
    {
        $probeError = filled($readiness->last_probe_error)
            ? trim((string) $readiness->last_probe_error)
            : null;
        $httpStatus = $readiness->last_http_status !== null
            ? (int) $readiness->last_http_status
            : null;

        $errorLine = match (true) {
            $probeError !== null && $httpStatus !== null
                && ! str_contains(mb_strtolower($probeError), 'http '.$httpStatus) => "Erreur détectée : HTTP {$httpStatus} — {$probeError}",
            $probeError !== null => "Erreur détectée : {$probeError}",
            $httpStatus !== null => "Erreur détectée : HTTP {$httpStatus}",
            default => null,
        };

        $title = trim((string) $parsed['title']);
        $genericTitles = [
            'intervention requise',
            'intervention utilisateur requise',
            'action requise',
            'action humaine requise',
        ];
        if ($title === '' || in_array(mb_strtolower($title), $genericTitles, true)) {
            $title = match (true) {
                $httpStatus !== null => "Corriger l’erreur HTTP {$httpStatus}",
                $probeError !== null => 'Corriger l’erreur de disponibilité',
                default => 'Intervention utilisateur requise',
            };
        }

        $summary = filled($parsed['summary'] ?? null) ? trim((string) $parsed['summary']) : null;
        if ($errorLine !== null) {
            $needle = $probeError ?? (string) $httpStatus;
            $alreadyMentionsError = $summary !== null
                && $needle !== ''
                && mb_stripos($summary, $needle) !== false;

            if (! $alreadyMentionsError) {
                $summary = $summary !== null && $summary !== ''
                    ? $errorLine."\n\n".$summary
                    : $errorLine;
            }
        }

        $steps = $parsed['steps'];
        if ($steps === []) {
            $steps = [[
                'rank' => 1,
                'text' => 'Corriger le problème signalé ci-dessus, puis cliquer sur « C’est fait ».',
                'done' => false,
            ]];
        }

        return [
            'title' => mb_substr($title, 0, 255),
            'summary' => $summary,
            'steps' => $steps,
        ];
    }

    private function resolveActiveIntervention(ApplicationReadiness $readiness, Application $application): void
    {
        $open = ApplicationReadinessIntervention::query()
            ->where('application_id', $application->id)
            ->whereIn('status', [
                ApplicationReadinessIntervention::STATUS_OPEN,
                ApplicationReadinessIntervention::STATUS_ACKNOWLEDGED,
            ])
            ->get();

        foreach ($open as $intervention) {
            $intervention->update([
                'status' => ApplicationReadinessIntervention::STATUS_RESOLVED,
                'resolved_at' => now(),
            ]);
        }

        if ($readiness->active_intervention_id !== null) {
            $readiness->update(['active_intervention_id' => null]);
        }
    }

    private function cancelOpenInterventions(Application $application): void
    {
        ApplicationReadinessIntervention::query()
            ->where('application_id', $application->id)
            ->where('status', ApplicationReadinessIntervention::STATUS_OPEN)
            ->update([
                'status' => ApplicationReadinessIntervention::STATUS_CANCELLED,
            ]);
    }
}
