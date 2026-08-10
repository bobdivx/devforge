<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentMission;
use App\Models\Application;
use App\Models\ApplicationPreview;
use App\Models\Team;
use App\Services\DevForge\Agent\Tool\AgentGithubTools;
use App\Services\DevForge\Application\ApplicationPreviewCatalog;
use App\Services\DevForge\Application\ApplicationSourceService;

/**
 * Flux produit : demande de fonctionnalité → PR → preview URL → valider/merger.
 */
class AgentFeatureDelivery
{
    public const WORKFLOW = 'feature_delivery';

    public function __construct(
        private readonly AgentMissionBoard $missionBoard,
        private readonly AgentRunLauncher $agentRunLauncher,
        private readonly ApplicationPreviewCatalog $previewCatalog,
        private readonly ApplicationSourceService $applicationSourceService,
        private readonly AgentGithubTools $githubTools,
    ) {}

    /**
     * @return array{mission: AiAgentMission, dispatched: bool, run_uuid: string|null}|array{error: string}
     */
    public function createRequest(
        Team $team,
        Application $application,
        string $title,
        ?string $description = null,
        string $priority = 'normal',
        bool $dispatchNow = true,
    ): array {
        $title = trim($title);
        if ($title === '') {
            return ['error' => 'Titre requis.'];
        }

        $description = trim((string) $description);
        $body = $description !== ''
            ? $description
            : 'Implémente cette fonctionnalité sur l’application liée.';

        $body .= "\n\n---\n"
            ."Contraintes DevForge (feature_delivery) :\n"
            ."- Toujours write_application_source en mode=pull_request (jamais commit direct sur la branche principale).\n"
            ."- Après la PR : note le numéro/URL ; la preview Coolify se crée si les preview deployments sont activés.\n"
            ."- Lance run_application_tests si possible.\n"
            ."- Ne merge PAS toi-même : l’utilisateur valide via l’UI « Valider & merger ».\n"
            ."- Termine par mission_update(status=blocked, blocked_reason=« En attente de validation preview ») "
            .'quand la PR est prête, ou status=done seulement si déjà mergée.';

        $created = $this->missionBoard->create($team, [
            'title' => $title,
            'description' => $body,
            'kind' => 'feature',
            'priority' => $priority,
            'resource_uuid' => $application->uuid,
            'assignee_type' => 'devforge',
            'source' => 'feature_request',
            'metadata' => [
                'workflow' => self::WORKFLOW,
                'force_pull_request' => true,
                'awaiting' => 'implementation',
                'application_uuid' => $application->uuid,
                'application_name' => $application->name,
                'preview_deployments_enabled' => (bool) ($application->settings?->is_preview_deployments_enabled
                    ?? $application->loadMissing('settings')->settings?->is_preview_deployments_enabled
                    ?? false),
            ],
        ]);

        if (is_array($created) && isset($created['error'])) {
            return $created;
        }

        /** @var AiAgentMission $mission */
        $mission = $created;
        $runUuid = null;
        $dispatched = false;

        if ($dispatchNow) {
            $dispatch = $this->dispatchNow($team, $mission);
            $dispatched = $dispatch['dispatched'];
            $runUuid = $dispatch['run_uuid'];
            $mission = $dispatch['mission'];
        }

        return [
            'mission' => $mission->fresh(['assignee:id,uuid,name,type', 'agent:id,uuid,name,type']),
            'dispatched' => $dispatched,
            'run_uuid' => $runUuid,
        ];
    }

    /**
     * @return array{dispatched: bool, run_uuid: string|null, mission: AiAgentMission}
     */
    public function dispatchNow(Team $team, AiAgentMission $mission): array
    {
        $worker = $this->resolveWorker($team, $mission);
        if (! $worker instanceof AiAgent || ! $worker->hasLlmProvider() || $worker->status === 'running') {
            return ['dispatched' => false, 'run_uuid' => null, 'mission' => $mission];
        }

        $claimed = $this->missionBoard->claim($team, $mission->uuid, $worker);
        if (! $claimed instanceof AiAgentMission) {
            return ['dispatched' => false, 'run_uuid' => null, 'mission' => $mission];
        }

        $run = $this->agentRunLauncher->queue($worker, 'event', [
            'event' => 'mission_work',
            'mission_uuid' => $claimed->uuid,
            'mission_kind' => $claimed->kind,
            'mission_title' => $claimed->title,
            'application_uuid' => $claimed->resource_uuid,
            'resource_uuid' => $claimed->resource_uuid,
            'force_pull_request' => true,
            'workflow' => self::WORKFLOW,
        ]);

        $meta = is_array($claimed->metadata) ? $claimed->metadata : [];
        $meta['last_dispatched_at'] = now()->toISOString();
        $meta['awaiting'] = 'implementation';
        if ($run !== null) {
            $meta['run_uuid'] = $run->uuid;
        }
        $claimed->update(['metadata' => $meta]);

        return [
            'dispatched' => $run !== null,
            'run_uuid' => $run?->uuid,
            'mission' => $claimed->fresh(['assignee:id,uuid,name,type', 'agent:id,uuid,name,type']),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function deliveryStatus(Team $team, AiAgentMission $mission): array
    {
        abort_unless((int) $mission->team_id === (int) $team->id, 404);

        $meta = is_array($mission->metadata) ? $mission->metadata : [];
        $application = $this->resolveApplication($team, $mission->resource_uuid);
        $prNumber = isset($meta['pull_request_number']) ? (int) $meta['pull_request_number'] : null;
        $preview = null;
        $previewsEnabled = false;

        if ($application instanceof Application) {
            $settings = $this->previewCatalog->settings($application);
            $previewsEnabled = (bool) $settings['is_preview_deployments_enabled'];
            if ($prNumber !== null && $prNumber > 0) {
                $preview = $this->findPreview($application, $prNumber);
            }
        }

        $awaiting = (string) ($meta['awaiting'] ?? 'implementation');
        if ($mission->status === 'done') {
            $awaiting = 'merged';
        } elseif ($preview && ! empty($preview['fqdn']) && in_array($awaiting, ['implementation', 'preview'], true)) {
            $awaiting = 'review';
        } elseif ($prNumber && $awaiting === 'implementation') {
            $awaiting = $previewsEnabled ? 'preview' : 'review';
        }

        return [
            'workflow' => self::WORKFLOW,
            'awaiting' => $awaiting,
            'force_pull_request' => (bool) ($meta['force_pull_request'] ?? true),
            'application_uuid' => $mission->resource_uuid,
            'application_name' => $meta['application_name'] ?? $application?->name,
            'pull_request_number' => $prNumber,
            'pull_request_url' => $meta['pull_request_url'] ?? null,
            'branch' => $meta['branch'] ?? null,
            'preview' => $preview,
            'preview_deployments_enabled' => $previewsEnabled,
            'can_validate' => $prNumber !== null && $prNumber > 0 && $mission->status !== 'done',
            'run_uuid' => $meta['run_uuid'] ?? null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function validateAndMerge(
        Team $team,
        AiAgentMission $mission,
        string $mergeMethod = 'squash',
    ): array {
        abort_unless((int) $mission->team_id === (int) $team->id, 404);

        $meta = is_array($mission->metadata) ? $mission->metadata : [];
        $prNumber = (int) ($meta['pull_request_number'] ?? 0);
        if ($prNumber <= 0) {
            return ['error' => 'Aucune PR enregistrée sur cette mission.'];
        }

        $application = $this->resolveApplication($team, $mission->resource_uuid);
        if (! $application instanceof Application) {
            return ['error' => 'Application liée introuvable.'];
        }

        try {
            $context = $this->applicationSourceService->sourceContext($team, $application);
        } catch (\Throwable $exception) {
            return ['error' => mb_substr($exception->getMessage(), 0, 300)];
        }

        $merge = $this->githubTools->mergePullRequest(
            (string) $context['github_app_uuid'],
            (string) $context['owner'],
            (string) $context['repo'],
            $prNumber,
            $mergeMethod,
            'feat: '.$mission->title,
        );

        if (isset($merge['error'])) {
            return $merge;
        }

        $meta['awaiting'] = 'merged';
        $meta['merged_at'] = now()->toISOString();
        $meta['merge_sha'] = $merge['sha'] ?? null;
        unset($meta['blocked_reason']);

        $this->missionBoard->update($team, $mission->uuid, [
            'status' => 'done',
            'metadata' => $meta,
            'blocked_reason' => null,
        ]);

        return [
            'ok' => true,
            'merged' => (bool) ($merge['merged'] ?? true),
            'sha' => $merge['sha'] ?? null,
            'message' => $merge['message'] ?? 'PR mergée.',
            'pull_request_number' => $prNumber,
            'pull_request_url' => $meta['pull_request_url'] ?? null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function requestChanges(Team $team, AiAgentMission $mission, string $feedback): array
    {
        abort_unless((int) $mission->team_id === (int) $team->id, 404);

        $feedback = trim($feedback);
        if ($feedback === '') {
            return ['error' => 'Feedback requis.'];
        }

        $meta = is_array($mission->metadata) ? $mission->metadata : [];
        $prNumber = (int) ($meta['pull_request_number'] ?? 0);
        $application = $this->resolveApplication($team, $mission->resource_uuid);

        if ($prNumber > 0 && $application instanceof Application) {
            try {
                $context = $this->applicationSourceService->sourceContext($team, $application);
                $this->githubTools->commentPullRequest(
                    (string) $context['github_app_uuid'],
                    (string) $context['owner'],
                    (string) $context['repo'],
                    $prNumber,
                    "Feedback DevForge (demande de changements) :\n\n".$feedback,
                );
            } catch (\Throwable) {
                // comment best-effort
            }
        }

        $meta['awaiting'] = 'implementation';
        $meta['review_feedback'] = mb_substr($feedback, 0, 4000);
        $meta['review_feedback_at'] = now()->toISOString();

        $updated = $this->missionBoard->update($team, $mission->uuid, [
            'status' => 'open',
            'metadata' => $meta,
            'blocked_reason' => null,
        ]);

        if ($updated instanceof AiAgentMission) {
            $this->dispatchNow($team, $updated);
        }

        return [
            'ok' => true,
            'message' => 'Feedback enregistré — l’agent va reprendre la mission.',
        ];
    }

    public function attachPullRequest(
        AiAgentMission $mission,
        int $pullRequestNumber,
        ?string $pullRequestUrl = null,
        ?string $branch = null,
    ): void {
        if ($pullRequestNumber <= 0) {
            return;
        }

        $meta = is_array($mission->metadata) ? $mission->metadata : [];
        $meta['pull_request_number'] = $pullRequestNumber;
        if ($pullRequestUrl) {
            $meta['pull_request_url'] = $pullRequestUrl;
        }
        if ($branch) {
            $meta['branch'] = $branch;
        }
        $meta['awaiting'] = 'preview';
        $mission->metadata = $meta;
        $mission->save();
    }

    /**
     * @return array<string, mixed>|null
     */
    public function findPreview(Application $application, int $pullRequestId): ?array
    {
        $preview = ApplicationPreview::query()
            ->where('application_id', $application->id)
            ->where('pull_request_id', $pullRequestId)
            ->first();

        if (! $preview) {
            return null;
        }

        return [
            'uuid' => $preview->uuid,
            'pull_request_id' => (int) $preview->pull_request_id,
            'pull_request_html_url' => $preview->pull_request_html_url,
            'fqdn' => $preview->fqdn,
            'status' => $preview->status,
            'is_running' => method_exists($preview, 'isRunning')
                ? (bool) $preview->isRunning()
                : in_array((string) $preview->status, ['running', 'healthy', 'exited:0'], true),
        ];
    }

    public function isFeatureDelivery(AiAgentMission $mission): bool
    {
        $meta = is_array($mission->metadata) ? $mission->metadata : [];

        return ($meta['workflow'] ?? null) === self::WORKFLOW
            || (($mission->kind === 'feature') && ($meta['force_pull_request'] ?? false) === true);
    }

    private function resolveWorker(Team $team, AiAgentMission $mission): ?AiAgent
    {
        if ($mission->assignee_agent_id !== null) {
            return AiAgent::query()
                ->where('team_id', $team->id)
                ->where('id', $mission->assignee_agent_id)
                ->where('is_active', true)
                ->first();
        }

        return AiAgent::query()
            ->where('team_id', $team->id)
            ->where('type', 'devforge')
            ->where('is_active', true)
            ->whereNull('parent_agent_id')
            ->orderBy('id')
            ->first();
    }

    private function resolveApplication(Team $team, ?string $uuid): ?Application
    {
        if (! is_string($uuid) || trim($uuid) === '') {
            return null;
        }

        return Application::query()
            ->where('uuid', $uuid)
            ->whereRelation('environment.project', 'team_id', $team->id)
            ->with(['settings', 'source'])
            ->first();
    }
}
