<?php

namespace App\Services\DevForge\Github;

use App\Models\GithubApp;
use App\Models\Team;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class GithubRunnerJobMonitor
{
    public function __construct(
        private readonly GithubRunnerInventory $inventory,
        private readonly GithubAppCatalog $githubAppCatalog,
        private readonly GithubRunnerJobSelector $selector,
    ) {}

    /**
     * @return array{
     *     available: bool,
     *     repo: string|null,
     *     message: string|null,
     *     counts: array{in_progress: int, queued: int, failure: int},
     *     items: array<int, array<string, mixed>>
     * }
     */
    public function listForRunner(Team $team, string $serverUuid, string $containerName): array
    {
        $runner = $this->runnerPayload($team, $serverUuid, $containerName);
        $repository = $this->repositoryFromRunner($runner);

        if ($repository === null) {
            return $this->unavailable('Dépôt GitHub introuvable pour ce runner.');
        }

        $apps = $this->githubAppCatalog->appsForTeam($team);
        if ($apps->isEmpty()) {
            return $this->unavailable(
                'Aucune GitHub App n’est configurée pour lire les Actions.',
                $repository['owner'].'/'.$repository['repo'],
            );
        }

        $cacheKey = sprintf(
            'devforge.github.runner.jobs.%s.%s.%s',
            $team->id,
            $serverUuid,
            $containerName,
        );

        /** @var array<string, mixed>|null $cached */
        $cached = Cache::remember($cacheKey, now()->addSeconds(20), function () use ($apps, $runner, $repository): ?array {
            foreach ($apps as $app) {
                if (! $app instanceof GithubApp) {
                    continue;
                }

                try {
                    return $this->fetchJobs($app, $runner, $repository['owner'], $repository['repo']);
                } catch (\Throwable $exception) {
                    Log::warning('github_runner.jobs_fetch_failed', [
                        'app' => $app->uuid,
                        'repo' => $repository['owner'].'/'.$repository['repo'],
                        'message' => $exception->getMessage(),
                    ]);
                }
            }

            return null;
        });

        if (! is_array($cached)) {
            return $this->unavailable(
                'Impossible de lire les GitHub Actions de ce dépôt.',
                $repository['owner'].'/'.$repository['repo'],
            );
        }

        return $cached;
    }

    /**
     * @return array<string, mixed>
     */
    private function runnerPayload(Team $team, string $serverUuid, string $containerName): array
    {
        $listed = collect($this->inventory->listForTeam($team))->first(
            function (array $runner) use ($serverUuid, $containerName): bool {
                return ($runner['server_uuid'] ?? '') === $serverUuid
                    && ($runner['name'] ?? '') === $containerName;
            },
        );

        if (is_array($listed) && $this->repositoryFromRunner($listed) !== null) {
            return $listed;
        }

        return $this->inventory->show($team, $serverUuid, $containerName);
    }

    /**
     * @param  array<string, mixed>  $runner
     * @return array{owner: string, repo: string}|null
     */
    private function repositoryFromRunner(array $runner): ?array
    {
        return $this->selector->parseRepository(
            isset($runner['repo_url']) ? (string) $runner['repo_url'] : null,
        ) ?? $this->selector->parseRepository(
            isset($runner['github_repo']) ? (string) $runner['github_repo'] : null,
        );
    }

    /**
     * @param  array<string, mixed>  $runner
     * @return array<string, mixed>
     */
    private function fetchJobs(GithubApp $githubApp, array $runner, string $owner, string $repo): array
    {
        $token = $this->tokenFor($githubApp);
        if (! filled($token)) {
            throw new \RuntimeException('Impossible de générer un jeton GitHub.');
        }

        $runs = $this->fetchRuns($githubApp, $token, $owner, $repo);
        $jobsByRunId = $this->fetchJobsForRuns($githubApp, $token, $owner, $repo, $runs);

        return $this->selector->present($runner, $runs, $jobsByRunId, $owner.'/'.$repo);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function fetchRuns(GithubApp $githubApp, string $token, string $owner, string $repo): array
    {
        $runs = collect();

        foreach (['in_progress', 'queued', 'completed'] as $status) {
            $response = Http::GitHub($githubApp->api_url, $token)
                ->timeout(12)
                ->retry(1, 150, throw: false)
                ->get("/repos/{$owner}/{$repo}/actions/runs", [
                    'per_page' => $status === 'completed' ? 12 : 10,
                    'status' => $status,
                ]);

            if ($response->status() !== 200) {
                throw new \RuntimeException((string) $response->json('message', 'Lecture des workflow runs impossible.'));
            }

            $batch = $response->json('workflow_runs', []);
            if (! is_array($batch)) {
                continue;
            }

            foreach ($batch as $run) {
                if (is_array($run)) {
                    $runs->push($run);
                }
            }
        }

        return $runs
            ->unique(fn (array $run): int => (int) ($run['id'] ?? 0))
            ->values()
            ->all();
    }

    /**
     * @param  array<int, array<string, mixed>>  $runs
     * @return array<int, array<int, array<string, mixed>>>
     */
    private function fetchJobsForRuns(GithubApp $githubApp, string $token, string $owner, string $repo, array $runs): array
    {
        $targets = collect($runs)
            ->filter(function (array $run): bool {
                $bucket = $this->selector->bucketFor(
                    isset($run['status']) ? (string) $run['status'] : null,
                    isset($run['conclusion']) ? (string) $run['conclusion'] : null,
                );

                return $bucket !== null;
            })
            ->take(12)
            ->values();

        $jobsByRunId = [];

        foreach ($targets as $run) {
            $runId = (int) ($run['id'] ?? 0);
            if ($runId < 1) {
                continue;
            }

            $response = Http::GitHub($githubApp->api_url, $token)
                ->timeout(12)
                ->retry(1, 150, throw: false)
                ->get("/repos/{$owner}/{$repo}/actions/runs/{$runId}/jobs", [
                    'per_page' => 50,
                ]);

            if ($response->status() !== 200) {
                continue;
            }

            $jobs = $response->json('jobs', []);
            $jobsByRunId[$runId] = is_array($jobs) ? array_values(array_filter($jobs, 'is_array')) : [];
        }

        return $jobsByRunId;
    }

    private function tokenFor(GithubApp $githubApp): ?string
    {
        try {
            $installationToken = generateGithubInstallationToken($githubApp);
            if (filled($installationToken)) {
                return $installationToken;
            }
        } catch (\Throwable) {
            // Fall back to packages PAT when the GitHub App cannot mint an installation token.
        }

        return filled($githubApp->packages_token) ? (string) $githubApp->packages_token : null;
    }

    /**
     * @return array{
     *     available: bool,
     *     repo: string|null,
     *     message: string|null,
     *     counts: array{in_progress: int, queued: int, failure: int},
     *     items: array<int, array<string, mixed>>
     * }
     */
    private function unavailable(string $message, ?string $repo = null): array
    {
        return [
            'available' => false,
            'repo' => $repo,
            'message' => $message,
            'counts' => [
                'in_progress' => 0,
                'queued' => 0,
                'failure' => 0,
            ],
            'items' => [],
        ];
    }
}
