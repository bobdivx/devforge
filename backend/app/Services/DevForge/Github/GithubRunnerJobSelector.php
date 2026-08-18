<?php

namespace App\Services\DevForge\Github;

class GithubRunnerJobSelector
{
    /**
     * @param  array{runner_name?: string, github_runner_id?: int|null, github_labels?: array<int, string>, labels?: array<int, string>}  $runner
     * @param  array<int, array<string, mixed>>  $runs
     * @param  array<int, array<int, array<string, mixed>>>  $jobsByRunId
     * @return array{
     *     available: bool,
     *     repo: string|null,
     *     message: string|null,
     *     counts: array{in_progress: int, queued: int, failure: int},
     *     items: array<int, array<string, mixed>>
     * }
     */
    public function present(array $runner, array $runs, array $jobsByRunId, ?string $repo = null): array
    {
        $items = [];

        foreach ($runs as $run) {
            if (! is_array($run)) {
                continue;
            }

            $runId = (int) ($run['id'] ?? 0);
            $jobs = $jobsByRunId[$runId] ?? [];
            if ($jobs === []) {
                $synthetic = $this->presentRunFallback($runner, $run);
                if ($synthetic !== null) {
                    $items[] = $synthetic;
                }

                continue;
            }

            foreach ($jobs as $job) {
                if (! is_array($job)) {
                    continue;
                }

                $presented = $this->presentJob($runner, $run, $job);
                if ($presented !== null) {
                    $items[] = $presented;
                }
            }
        }

        $items = collect($items)
            ->unique(fn (array $item): string => (string) ($item['id'] ?? ''))
            ->sortBy(function (array $item): array {
                $order = ['in_progress' => 0, 'queued' => 1, 'failure' => 2];

                return [
                    $order[$item['bucket']] ?? 9,
                    $item['updated_at'] ?? $item['started_at'] ?? '',
                ];
            })
            ->values()
            ->all();

        $counts = [
            'in_progress' => 0,
            'queued' => 0,
            'failure' => 0,
        ];
        foreach ($items as $item) {
            $bucket = (string) ($item['bucket'] ?? '');
            if (array_key_exists($bucket, $counts)) {
                $counts[$bucket]++;
            }
        }

        return [
            'available' => true,
            'repo' => $repo,
            'message' => null,
            'counts' => $counts,
            'items' => $items,
        ];
    }

    /**
     * @return array{owner: string, repo: string}|null
     */
    public function parseRepository(?string $value): ?array
    {
        if (! filled($value)) {
            return null;
        }

        $normalized = trim((string) $value);
        if (preg_match('~^(?P<owner>[A-Za-z0-9_.-]+)/(?P<repo>[A-Za-z0-9_.-]+?)(?:\.git)?$~', $normalized, $matches) === 1) {
            return [
                'owner' => $matches['owner'],
                'repo' => $matches['repo'],
            ];
        }

        if (preg_match('~(?:github\.com[:/])(?P<owner>[^/\s]+)(?:/|:)(?P<repo>[^/\s#?]+)/?$~i', $normalized, $matches) !== 1) {
            return null;
        }

        $repo = $matches['repo'];
        if (str_ends_with(strtolower($repo), '.git')) {
            $repo = substr($repo, 0, -4);
        }

        return [
            'owner' => $matches['owner'],
            'repo' => $repo,
        ];
    }

    public function bucketFor(?string $status, ?string $conclusion): ?string
    {
        $normalizedStatus = strtolower((string) $status);
        $normalizedConclusion = strtolower((string) $conclusion);

        if (in_array($normalizedStatus, ['queued', 'waiting', 'requested', 'pending', 'action_required'], true)) {
            return 'queued';
        }

        if ($normalizedStatus === 'in_progress') {
            return 'in_progress';
        }

        if ($normalizedStatus === 'completed' && in_array($normalizedConclusion, ['failure', 'timed_out', 'startup_failure'], true)) {
            return 'failure';
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $runner
     * @param  array<string, mixed>  $job
     */
    public function jobMatchesRunner(array $runner, array $job): bool
    {
        $runnerId = (int) ($runner['github_runner_id'] ?? 0);
        $jobRunnerId = (int) ($job['runner_id'] ?? 0);
        if ($runnerId > 0 && $jobRunnerId === $runnerId) {
            return true;
        }

        $localName = strtolower(trim((string) ($runner['runner_name'] ?? '')));
        $jobName = strtolower(trim((string) ($job['runner_name'] ?? '')));
        if ($localName !== '' && $jobName !== '' && $localName === $jobName) {
            return true;
        }

        $bucket = $this->bucketFor(
            isset($job['status']) ? (string) $job['status'] : null,
            isset($job['conclusion']) ? (string) $job['conclusion'] : null,
        );

        if ($bucket !== 'queued' || $jobName !== '') {
            return false;
        }

        return $this->labelsCompatible($this->normalizeLabels($job['labels'] ?? []), $this->runnerLabels($runner));
    }

    /**
     * @param  array<string, mixed>  $runner
     * @param  array<string, mixed>  $run
     * @param  array<string, mixed>  $job
     * @return array<string, mixed>|null
     */
    private function presentJob(array $runner, array $run, array $job): ?array
    {
        $bucket = $this->bucketFor(
            isset($job['status']) ? (string) $job['status'] : null,
            isset($job['conclusion']) ? (string) $job['conclusion'] : null,
        );
        if ($bucket === null || ! $this->jobMatchesRunner($runner, $job)) {
            return null;
        }

        return [
            'id' => (string) ($job['id'] ?? $run['id'] ?? ''),
            'run_id' => (int) ($run['id'] ?? 0) ?: null,
            'job_id' => (int) ($job['id'] ?? 0) ?: null,
            'name' => (string) ($job['name'] ?? 'Job'),
            'workflow_name' => (string) ($run['name'] ?? $run['display_title'] ?? 'Workflow'),
            'bucket' => $bucket,
            'status' => (string) ($job['status'] ?? ''),
            'conclusion' => $job['conclusion'] ?? null,
            'head_branch' => $run['head_branch'] ?? null,
            'head_sha' => $run['head_sha'] ?? null,
            'html_url' => $job['html_url'] ?? $run['html_url'] ?? null,
            'started_at' => $job['started_at'] ?? $run['run_started_at'] ?? $run['created_at'] ?? null,
            'completed_at' => $job['completed_at'] ?? null,
            'updated_at' => $job['completed_at'] ?? $run['updated_at'] ?? $job['started_at'] ?? null,
            'runner_name' => $job['runner_name'] ?? null,
            'assigned' => filled($job['runner_name'] ?? null) || (int) ($job['runner_id'] ?? 0) > 0,
        ];
    }

    /**
     * @param  array<string, mixed>  $runner
     * @param  array<string, mixed>  $run
     * @return array<string, mixed>|null
     */
    private function presentRunFallback(array $runner, array $run): ?array
    {
        $bucket = $this->bucketFor(
            isset($run['status']) ? (string) $run['status'] : null,
            isset($run['conclusion']) ? (string) $run['conclusion'] : null,
        );
        if ($bucket === null) {
            return null;
        }

        if ($bucket === 'failure') {
            return null;
        }

        $labels = $this->normalizeLabels(data_get($run, 'labels', []));
        if ($labels !== [] && ! $this->labelsCompatible($labels, $this->runnerLabels($runner))) {
            return null;
        }

        return [
            'id' => 'run-'.($run['id'] ?? uniqid()),
            'run_id' => (int) ($run['id'] ?? 0) ?: null,
            'job_id' => null,
            'name' => (string) ($run['display_title'] ?? $run['name'] ?? 'Workflow'),
            'workflow_name' => (string) ($run['name'] ?? 'Workflow'),
            'bucket' => $bucket,
            'status' => (string) ($run['status'] ?? ''),
            'conclusion' => $run['conclusion'] ?? null,
            'head_branch' => $run['head_branch'] ?? null,
            'head_sha' => $run['head_sha'] ?? null,
            'html_url' => $run['html_url'] ?? null,
            'started_at' => $run['run_started_at'] ?? $run['created_at'] ?? null,
            'completed_at' => $run['updated_at'] ?? null,
            'updated_at' => $run['updated_at'] ?? $run['created_at'] ?? null,
            'runner_name' => null,
            'assigned' => false,
        ];
    }

    /**
     * @param  array<int, string>  $jobLabels
     * @param  array<int, string>  $runnerLabels
     */
    public function labelsCompatible(array $jobLabels, array $runnerLabels): bool
    {
        $jobLabels = array_values(array_filter($jobLabels, fn (string $label): bool => $label !== ''));
        $runnerLabels = array_values(array_filter($runnerLabels, fn (string $label): bool => $label !== ''));

        if ($jobLabels === []) {
            return in_array('self-hosted', $runnerLabels, true) || $runnerLabels === [];
        }

        if ($this->isGithubHostedOnly($jobLabels)) {
            return false;
        }

        if ($runnerLabels === []) {
            return in_array('self-hosted', $jobLabels, true);
        }

        foreach ($jobLabels as $label) {
            if (! in_array($label, $runnerLabels, true)) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param  mixed  $labels
     * @return array<int, string>
     */
    public function normalizeLabels(mixed $labels): array
    {
        if (! is_array($labels)) {
            return [];
        }

        return collect($labels)
            ->map(function ($label): string {
                if (is_array($label)) {
                    return strtolower(trim((string) ($label['name'] ?? '')));
                }

                return strtolower(trim((string) $label));
            })
            ->filter()
            ->values()
            ->all();
    }

    /**
     * @param  array<string, mixed>  $runner
     * @return array<int, string>
     */
    private function runnerLabels(array $runner): array
    {
        $labels = $this->normalizeLabels($runner['github_labels'] ?? $runner['labels'] ?? []);
        $name = strtolower(trim((string) ($runner['runner_name'] ?? '')));
        if ($name !== '' && ! in_array($name, $labels, true)) {
            $labels[] = $name;
        }

        return $labels;
    }

    /**
     * @param  array<int, string>  $labels
     */
    private function isGithubHostedOnly(array $labels): bool
    {
        $hosted = [
            'ubuntu-latest',
            'ubuntu-22.04',
            'ubuntu-24.04',
            'ubuntu-20.04',
            'windows-latest',
            'windows-2022',
            'windows-2025',
            'macos-latest',
            'macos-13',
            'macos-14',
            'macos-15',
        ];

        if ($labels === []) {
            return false;
        }

        foreach ($labels as $label) {
            if (! in_array($label, $hosted, true)) {
                return false;
            }
        }

        return true;
    }
}
