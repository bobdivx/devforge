<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Application;
use App\Models\Team;
use App\Services\DevForge\Agent\Tool\AgentGithubTools;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\Github\GithubAppCatalog;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Surveille les PR ouvertes des agents type `github` et lance un run event
 * lorsqu'une PR est nouvelle ou mise à jour.
 */
class GithubPrWatchDispatcher
{
    public function __construct(
        private readonly AgentRunLauncher $agentRunLauncher,
        private readonly CoreResourceCatalog $catalog,
        private readonly GithubAppCatalog $githubCatalog,
    ) {}

    /**
     * @return array{checked: int, dispatched: int, skipped: int}
     */
    public function dispatchDue(): array
    {
        if (! config('devforge.agents_enabled') || ! config('devforge.agents_github_pr_watch', true)) {
            return ['checked' => 0, 'dispatched' => 0, 'skipped' => 0];
        }

        $agents = AiAgent::query()
            ->where('is_active', true)
            ->where('type', 'github')
            ->where('status', '!=', 'running')
            ->with(['team', 'providerConfig'])
            ->get();

        $checked = 0;
        $dispatched = 0;
        $skipped = 0;

        foreach ($agents as $agent) {
            $target = $this->resolveWatchTarget($agent);

            if ($target === null) {
                $skipped++;

                continue;
            }

            $checked++;
            $dispatched += $this->watchAgent($agent, $target);
        }

        return compact('checked', 'dispatched', 'skipped');
    }

    /**
     * @param  array{github_app_uuid: string, owner: string, repo: string, application_uuid: ?string}  $target
     */
    private function watchAgent(AiAgent $agent, array $target): int
    {
        $team = $agent->team;

        if (! $team instanceof Team) {
            return 0;
        }

        $tools = new AgentGithubTools($team, $this->catalog, $this->githubCatalog);
        $result = $tools->listPullRequests(
            $target['github_app_uuid'],
            $target['owner'],
            $target['repo'],
            'open',
            20,
        );

        if (isset($result['error'])) {
            Log::warning('DevForge: échec surveillance PR GitHub.', [
                'agent_uuid' => $agent->uuid,
                'error' => $result['error'],
            ]);

            return 0;
        }

        $pullRequests = is_array($result['pull_requests'] ?? null) ? $result['pull_requests'] : [];
        $count = 0;

        foreach ($pullRequests as $pr) {
            if (! is_array($pr) || ! isset($pr['number'])) {
                continue;
            }

            $number = (int) $pr['number'];
            $updatedAt = (string) ($pr['updated_at'] ?? $pr['created_at'] ?? '');
            $fingerprint = $this->fingerprint($number, $updatedAt);
            $cacheKey = "devforge:github-pr-watch:{$agent->id}:{$number}";

            if (Cache::get($cacheKey) === $fingerprint) {
                continue;
            }

            if ($this->wasRecentlyHandled($team, $agent, $number, $fingerprint)) {
                Cache::put($cacheKey, $fingerprint, now()->addDays(7));

                continue;
            }

            $context = [
                'event' => 'github_pr_updated',
                'github_app_uuid' => $target['github_app_uuid'],
                'owner' => $target['owner'],
                'repo' => $target['repo'],
                'pull_request_number' => $number,
                'pull_request' => $pr,
                'application_uuid' => $target['application_uuid'],
                'fingerprint' => $fingerprint,
            ];

            $run = $this->agentRunLauncher->queue($agent, 'event', $context);

            if ($run instanceof AiAgentRun) {
                Cache::put($cacheKey, $fingerprint, now()->addDays(7));
                $count++;

                Log::info('DevForge: agent GitHub déclenché pour PR.', [
                    'agent_uuid' => $agent->uuid,
                    'run_uuid' => $run->uuid,
                    'pr' => $number,
                    'repo' => "{$target['owner']}/{$target['repo']}",
                ]);
            }
        }

        return $count;
    }

    /**
     * @return array{github_app_uuid: string, owner: string, repo: string, application_uuid: ?string}|null
     */
    private function resolveWatchTarget(AiAgent $agent): ?array
    {
        $metadata = is_array($agent->metadata) ? $agent->metadata : [];
        $watch = is_array($metadata['github_watch'] ?? null) ? $metadata['github_watch'] : [];

        $githubAppUuid = trim((string) ($watch['github_app_uuid'] ?? ''));
        $owner = trim((string) ($watch['owner'] ?? ''));
        $repo = trim((string) ($watch['repo'] ?? ''));
        $applicationUuid = is_string($agent->resource_uuid) && $agent->resource_uuid !== ''
            ? $agent->resource_uuid
            : null;

        if ($githubAppUuid !== '' && $owner !== '' && $repo !== '') {
            return [
                'github_app_uuid' => $githubAppUuid,
                'owner' => $owner,
                'repo' => $repo,
                'application_uuid' => $applicationUuid,
            ];
        }

        if ($applicationUuid === null) {
            return null;
        }

        $application = Application::where('uuid', $applicationUuid)->first();

        if (! $application instanceof Application || ! $application->is_github_based()) {
            return null;
        }

        $parsed = $this->parseOwnerRepo((string) $application->git_repository);
        $appUuid = $application->source?->uuid;

        if ($parsed === null || ! is_string($appUuid) || $appUuid === '') {
            return null;
        }

        return [
            'github_app_uuid' => $appUuid,
            'owner' => $parsed['owner'],
            'repo' => $parsed['repo'],
            'application_uuid' => $application->uuid,
        ];
    }

    /** @return array{owner: string, repo: string}|null */
    private function parseOwnerRepo(string $repository): ?array
    {
        $normalized = preg_replace('#\.git$#', '', trim($repository)) ?? '';

        if (preg_match('#github\.com[:/](?P<owner>[^/]+)/(?P<repo>[^/]+)#i', $normalized, $matches) === 1) {
            return [
                'owner' => $matches['owner'],
                'repo' => $matches['repo'],
            ];
        }

        if (preg_match('#^(?P<owner>[^/]+)/(?P<repo>[^/]+)$#', $normalized, $matches) === 1) {
            return [
                'owner' => $matches['owner'],
                'repo' => $matches['repo'],
            ];
        }

        return null;
    }

    private function fingerprint(int $number, string $updatedAt): string
    {
        return hash('sha256', $number.'|'.$updatedAt);
    }

    private function wasRecentlyHandled(Team $team, AiAgent $agent, int $prNumber, string $fingerprint): bool
    {
        return AiAgentRun::query()
            ->where('agent_id', $agent->id)
            ->where('trigger', 'event')
            ->where('created_at', '>=', now()->subDay())
            ->where(function ($query) use ($prNumber, $fingerprint): void {
                $query->where('metadata->pull_request_number', $prNumber)
                    ->where(function ($inner) use ($fingerprint): void {
                        $inner->where('metadata->fingerprint', $fingerprint)
                            ->orWhere('logs', 'like', '%"fingerprint":"'.$fingerprint.'"%');
                    });
            })
            ->where(function ($query): void {
                $query->whereIn('status', ['pending', 'running', 'completed', 'awaiting_approval'])
                    ->orWhere(function ($failed): void {
                        $failed->where('status', 'failed')->where('iterations', '>', 0);
                    });
            })
            ->whereHas('agent', fn ($query) => $query->where('team_id', $team->id))
            ->exists();
    }
}
