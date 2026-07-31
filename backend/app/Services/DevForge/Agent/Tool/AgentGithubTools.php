<?php

namespace App\Services\DevForge\Agent\Tool;

use App\Models\Application;
use App\Models\Team;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\Github\GithubAppCatalog;
use Illuminate\Support\Facades\Http;

class AgentGithubTools
{
    public function __construct(
        private readonly Team $team,
        private readonly CoreResourceCatalog $catalog,
        private readonly GithubAppCatalog $githubCatalog,
    ) {}

    /** @return array<mixed> */
    public function listApps(): array
    {
        return [
            'apps' => $this->githubCatalog
                ->appsForTeam($this->team)
                ->map(fn ($app): array => $this->githubCatalog->presentApp($app))
                ->values()
                ->all(),
        ];
    }

    /** @return array<mixed> */
    public function listRepos(string $githubAppUuid): array
    {
        try {
            $githubApp = $this->githubCatalog->appForTeam($this->team, $githubAppUuid);

            return ['repositories' => $this->githubCatalog->repositories($githubApp)];
        } catch (\Throwable $exception) {
            return ['error' => mb_substr($exception->getMessage(), 0, 500)];
        }
    }

    /** @return array<mixed> */
    public function listBranches(string $githubAppUuid, string $owner, string $repo): array
    {
        try {
            $githubApp = $this->githubCatalog->appForTeam($this->team, $githubAppUuid);

            return ['branches' => $this->githubCatalog->branches($githubApp, $owner, $repo)];
        } catch (\Throwable $exception) {
            return ['error' => mb_substr($exception->getMessage(), 0, 500)];
        }
    }

    /** @return array<mixed> */
    public function readFile(string $githubAppUuid, string $owner, string $repo, string $path, ?string $ref = null): array
    {
        return $this->fetchGithubContent($githubAppUuid, $owner, $repo, $path, $ref, decodeFile: true);
    }

    /** @return array<mixed> */
    public function getBranchHeadSha(string $githubAppUuid, string $owner, string $repo, string $branch): array
    {
        $ref = $this->gitRefPath($branch);

        return $this->apiGet($githubAppUuid, "/repos/{$owner}/{$repo}/git/ref/{$ref}", [], function (array $payload): array {
            return [
                'sha' => $payload['object']['sha'] ?? null,
                'ref' => $payload['ref'] ?? null,
            ];
        }, single: true);
    }

    /** @return array<mixed> */
    public function createBranch(
        string $githubAppUuid,
        string $owner,
        string $repo,
        string $branchName,
        string $sha,
    ): array {
        return $this->apiPost($githubAppUuid, "/repos/{$owner}/{$repo}/git/refs", [
            'ref' => "refs/heads/{$branchName}",
            'sha' => $sha,
        ], function (array $payload): array {
            return [
                'branch' => str_replace('refs/heads/', '', (string) ($payload['ref'] ?? '')),
                'sha' => $payload['object']['sha'] ?? null,
            ];
        });
    }

    /** @return array<mixed> */
    public function createPullRequest(
        string $githubAppUuid,
        string $owner,
        string $repo,
        string $title,
        string $head,
        string $base,
        string $body = '',
    ): array {
        return $this->apiPost($githubAppUuid, "/repos/{$owner}/{$repo}/pulls", [
            'title' => mb_substr(trim($title), 0, 256),
            'head' => $head,
            'base' => $base,
            'body' => mb_substr(trim($body), 0, 4000),
        ], function (array $payload): array {
            return [
                'number' => $payload['number'] ?? null,
                'title' => $payload['title'] ?? null,
                'state' => $payload['state'] ?? null,
                'html_url' => $payload['html_url'] ?? null,
                'head' => $payload['head']['ref'] ?? null,
                'base' => $payload['base']['ref'] ?? null,
            ];
        });
    }

    /** @return array<mixed> */
    public function writeFile(
        string $githubAppUuid,
        string $owner,
        string $repo,
        string $path,
        string $content,
        string $message,
        ?string $sha = null,
        ?string $branch = null,
    ): array {
        if (mb_strlen($content) > 32000) {
            return ['error' => 'Contenu trop volumineux (max 32 Ko).'];
        }

        $message = trim($message);
        if ($message === '') {
            return ['error' => 'Message de commit requis.'];
        }

        try {
            $githubApp = $this->githubCatalog->appForTeam($this->team, $githubAppUuid);
            $token = generateGithubInstallationToken($githubApp);
            if (! $token) {
                return ['error' => 'Impossible de générer un token GitHub App.'];
            }

            $payload = [
                'message' => mb_substr($message, 0, 500),
                'content' => base64_encode($content),
            ];

            if ($sha !== null && $sha !== '') {
                $payload['sha'] = $sha;
            }

            if ($branch !== null && $branch !== '') {
                $payload['branch'] = $branch;
            }

            $response = Http::GitHub($githubApp->api_url, $token)
                ->timeout(30)
                ->put($this->contentsEndpoint($owner, $repo, $path), $payload);

            if (! $response->successful()) {
                return ['error' => mb_substr($response->json('message', 'Échec écriture GitHub'), 0, 500)];
            }

            $json = $response->json();
            if (! is_array($json)) {
                return ['error' => 'Réponse GitHub inattendue.'];
            }

            return [
                'path' => $json['content']['path'] ?? $path,
                'sha' => $json['content']['sha'] ?? null,
                'commit_sha' => $json['commit']['sha'] ?? null,
                'commit_url' => $json['commit']['html_url'] ?? null,
                'branch' => $branch,
                'size' => (int) ($json['content']['size'] ?? mb_strlen($content)),
            ];
        } catch (\Throwable $exception) {
            return ['error' => mb_substr($exception->getMessage(), 0, 500)];
        }
    }

    /** @return array<mixed> */
    public function mergePullRequest(
        string $githubAppUuid,
        string $owner,
        string $repo,
        int $number,
        string $mergeMethod = 'squash',
        ?string $commitTitle = null,
    ): array {
        $method = in_array($mergeMethod, ['merge', 'squash', 'rebase'], true) ? $mergeMethod : 'squash';
        $payload = ['merge_method' => $method];
        if ($commitTitle !== null && trim($commitTitle) !== '') {
            $payload['commit_title'] = mb_substr(trim($commitTitle), 0, 256);
        }

        return $this->apiPut($githubAppUuid, "/repos/{$owner}/{$repo}/pulls/{$number}/merge", $payload, function (array $json): array {
            return [
                'merged' => (bool) ($json['merged'] ?? false),
                'sha' => $json['sha'] ?? null,
                'message' => $json['message'] ?? null,
            ];
        });
    }

    /** @return array<mixed> */
    public function closePullRequest(
        string $githubAppUuid,
        string $owner,
        string $repo,
        int $number,
    ): array {
        return $this->apiPatch($githubAppUuid, "/repos/{$owner}/{$repo}/pulls/{$number}", [
            'state' => 'closed',
        ], function (array $json): array {
            return [
                'number' => $json['number'] ?? null,
                'state' => $json['state'] ?? null,
                'html_url' => $json['html_url'] ?? null,
            ];
        });
    }

    /** @return array<mixed> */
    public function commentPullRequest(
        string $githubAppUuid,
        string $owner,
        string $repo,
        int $number,
        string $body,
    ): array {
        $body = trim($body);
        if ($body === '') {
            return ['error' => 'Commentaire vide.'];
        }

        return $this->apiPost($githubAppUuid, "/repos/{$owner}/{$repo}/issues/{$number}/comments", [
            'body' => mb_substr($body, 0, 65000),
        ], function (array $json): array {
            return [
                'id' => $json['id'] ?? null,
                'html_url' => $json['html_url'] ?? null,
                'body' => mb_substr((string) ($json['body'] ?? ''), 0, 500),
            ];
        });
    }

    /** @return array<mixed> */
    public function listDir(string $githubAppUuid, string $owner, string $repo, string $path = '', ?string $ref = null): array
    {
        $result = $this->fetchGithubContent($githubAppUuid, $owner, $repo, $path, $ref, decodeFile: false);

        if (isset($result['error'])) {
            return $result;
        }

        if (($result['type'] ?? '') === 'file') {
            return ['error' => 'Le chemin pointe vers un fichier. Utilise read_github_file.'];
        }

        $entries = collect($result['entries'] ?? [])
            ->map(fn (array $entry): array => [
                'name' => $entry['name'] ?? null,
                'path' => $entry['path'] ?? null,
                'type' => $entry['type'] ?? null,
                'size' => $entry['size'] ?? null,
            ])
            ->values()
            ->all();

        return ['path' => $path, 'entries' => $entries];
    }

    /** @return array<mixed> */
    public function applicationGitInfo(string $applicationUuid): array
    {
        $application = $this->catalog->find($this->team, 'applications', $applicationUuid);

        if (! $application instanceof Application) {
            return ['error' => "Application {$applicationUuid} introuvable."];
        }

        $application->loadMissing('source');

        return [
            'uuid' => $application->uuid,
            'name' => $application->name,
            'git_repository' => $application->git_repository,
            'git_branch' => $application->git_branch,
            'git_commit_sha' => $application->git_commit_sha,
            'build_pack' => $application->build_pack,
            'fqdn' => $application->fqdn,
            'github_app_uuid' => $application->source?->uuid,
            'github_app_name' => $application->source?->name,
            'is_github_based' => $application->is_github_based(),
        ];
    }

    /** @return array<mixed> */
    public function listPullRequests(
        string $githubAppUuid,
        string $owner,
        string $repo,
        string $state = 'open',
        int $limit = 10,
    ): array {
        $limit = max(1, min($limit, 30));

        return $this->apiGet($githubAppUuid, "/repos/{$owner}/{$repo}/pulls", [
            'state' => in_array($state, ['open', 'closed', 'all'], true) ? $state : 'open',
            'per_page' => $limit,
        ], fn (array $items): array => [
            'pull_requests' => collect($items)->map(fn (array $pr): array => [
                'number' => $pr['number'] ?? null,
                'title' => $pr['title'] ?? null,
                'state' => $pr['state'] ?? null,
                'user' => $pr['user']['login'] ?? null,
                'head' => $pr['head']['ref'] ?? null,
                'base' => $pr['base']['ref'] ?? null,
                'html_url' => $pr['html_url'] ?? null,
                'updated_at' => $pr['updated_at'] ?? null,
                'created_at' => $pr['created_at'] ?? null,
                'merged_at' => $pr['merged_at'] ?? null,
            ])->values()->all(),
        ]);
    }

    /** @return array<mixed> */
    public function getPullRequest(string $githubAppUuid, string $owner, string $repo, int $number): array
    {
        return $this->apiGet($githubAppUuid, "/repos/{$owner}/{$repo}/pulls/{$number}", [], function (array $pr): array {
            return [
                'pull_request' => [
                    'number' => $pr['number'] ?? null,
                    'title' => $pr['title'] ?? null,
                    'body' => mb_substr((string) ($pr['body'] ?? ''), 0, 4000),
                    'state' => $pr['state'] ?? null,
                    'user' => $pr['user']['login'] ?? null,
                    'head' => [
                        'ref' => $pr['head']['ref'] ?? null,
                        'sha' => $pr['head']['sha'] ?? null,
                    ],
                    'base' => [
                        'ref' => $pr['base']['ref'] ?? null,
                        'sha' => $pr['base']['sha'] ?? null,
                    ],
                    'mergeable' => $pr['mergeable'] ?? null,
                    'merged' => $pr['merged'] ?? null,
                    'html_url' => $pr['html_url'] ?? null,
                    'changed_files' => $pr['changed_files'] ?? null,
                    'additions' => $pr['additions'] ?? null,
                    'deletions' => $pr['deletions'] ?? null,
                ],
            ];
        }, single: true);
    }

    /** @return array<mixed> */
    public function listWorkflowRuns(
        string $githubAppUuid,
        string $owner,
        string $repo,
        ?string $branch = null,
        int $limit = 10,
        ?string $status = null,
        ?string $conclusion = null,
    ): array {
        $limit = max(1, min($limit, 30));
        $query = ['per_page' => $limit];
        if ($branch) {
            $query['branch'] = $branch;
        }
        if (filled($status)) {
            $query['status'] = $status;
        }

        return $this->apiGet($githubAppUuid, "/repos/{$owner}/{$repo}/actions/runs", $query, function (array $payload) use ($conclusion): array {
            $runs = collect($payload['workflow_runs'] ?? []);
            if (filled($conclusion)) {
                $runs = $runs->filter(
                    fn (array $run): bool => strcasecmp((string) ($run['conclusion'] ?? ''), (string) $conclusion) === 0,
                );
            }

            return [
                'workflow_runs' => $runs->map(fn (array $run): array => [
                    'id' => $run['id'] ?? null,
                    'name' => $run['name'] ?? null,
                    'workflow_id' => $run['workflow_id'] ?? null,
                    'path' => $run['path'] ?? null,
                    'status' => $run['status'] ?? null,
                    'conclusion' => $run['conclusion'] ?? null,
                    'head_branch' => $run['head_branch'] ?? null,
                    'head_sha' => $run['head_sha'] ?? null,
                    'html_url' => $run['html_url'] ?? null,
                    'created_at' => $run['created_at'] ?? null,
                    'updated_at' => $run['updated_at'] ?? null,
                ])->values()->all(),
            ];
        }, rootKey: 'workflow_runs');
    }

    /** @return array<mixed> */
    public function getWorkflowRun(string $githubAppUuid, string $owner, string $repo, int $runId): array
    {
        return $this->apiGet($githubAppUuid, "/repos/{$owner}/{$repo}/actions/runs/{$runId}", [], function (array $run): array {
            return [
                'workflow_run' => [
                    'id' => $run['id'] ?? null,
                    'name' => $run['name'] ?? null,
                    'workflow_id' => $run['workflow_id'] ?? null,
                    'path' => $run['path'] ?? null,
                    'status' => $run['status'] ?? null,
                    'conclusion' => $run['conclusion'] ?? null,
                    'head_branch' => $run['head_branch'] ?? null,
                    'head_sha' => $run['head_sha'] ?? null,
                    'html_url' => $run['html_url'] ?? null,
                    'jobs_url' => $run['jobs_url'] ?? null,
                    'created_at' => $run['created_at'] ?? null,
                    'updated_at' => $run['updated_at'] ?? null,
                ],
            ];
        }, single: true);
    }

    /** @return array<mixed> */
    public function listWorkflows(string $githubAppUuid, string $owner, string $repo): array
    {
        return $this->apiGet($githubAppUuid, "/repos/{$owner}/{$repo}/actions/workflows", ['per_page' => 100], fn (array $payload): array => [
            'workflows' => collect($payload['workflows'] ?? [])->map(fn (array $workflow): array => [
                'id' => $workflow['id'] ?? null,
                'name' => $workflow['name'] ?? null,
                'path' => $workflow['path'] ?? null,
                'state' => $workflow['state'] ?? null,
                'html_url' => $workflow['html_url'] ?? null,
                'badge_url' => $workflow['badge_url'] ?? null,
            ])->values()->all(),
        ], rootKey: 'workflows');
    }

    /** @return array<mixed> */
    public function listWorkflowJobs(string $githubAppUuid, string $owner, string $repo, int $runId): array
    {
        return $this->apiGet($githubAppUuid, "/repos/{$owner}/{$repo}/actions/runs/{$runId}/jobs", ['per_page' => 50], fn (array $payload): array => [
            'jobs' => collect($payload['jobs'] ?? [])->map(fn (array $job): array => [
                'id' => $job['id'] ?? null,
                'name' => $job['name'] ?? null,
                'status' => $job['status'] ?? null,
                'conclusion' => $job['conclusion'] ?? null,
                'html_url' => $job['html_url'] ?? null,
                'started_at' => $job['started_at'] ?? null,
                'completed_at' => $job['completed_at'] ?? null,
                'steps' => collect($job['steps'] ?? [])->map(fn (array $step): array => [
                    'name' => $step['name'] ?? null,
                    'status' => $step['status'] ?? null,
                    'conclusion' => $step['conclusion'] ?? null,
                    'number' => $step['number'] ?? null,
                ])->values()->all(),
            ])->values()->all(),
        ], rootKey: 'jobs');
    }

    /** @return array<mixed> */
    public function getWorkflowJobLogs(
        string $githubAppUuid,
        string $owner,
        string $repo,
        int $jobId,
        int $maxChars = 12000,
    ): array {
        $maxChars = max(1000, min($maxChars, 30000));

        try {
            $githubApp = $this->githubCatalog->appForTeam($this->team, $githubAppUuid);
            $token = generateGithubInstallationToken($githubApp);
            if (! $token) {
                return ['error' => 'Impossible de générer un token GitHub App.'];
            }

            $response = Http::GitHub($githubApp->api_url, $token)
                ->timeout(30)
                ->withHeaders(['Accept' => 'application/vnd.github+json'])
                ->get("/repos/{$owner}/{$repo}/actions/jobs/{$jobId}/logs");

            if (! $response->successful()) {
                return ['error' => mb_substr($response->json('message') ?? $response->body() ?: 'Échec lecture logs job', 0, 500)];
            }

            $body = (string) $response->body();
            $truncated = mb_strlen($body) > $maxChars;
            if ($truncated) {
                $body = mb_substr($body, -$maxChars);
            }

            return [
                'job_id' => $jobId,
                'truncated' => $truncated,
                'logs' => $body,
            ];
        } catch (\Throwable $exception) {
            return ['error' => mb_substr($exception->getMessage(), 0, 500)];
        }
    }

    /** @return array<mixed> */
    public function rerunWorkflowRun(
        string $githubAppUuid,
        string $owner,
        string $repo,
        int $runId,
        bool $failedOnly = false,
    ): array {
        $endpoint = $failedOnly
            ? "/repos/{$owner}/{$repo}/actions/runs/{$runId}/rerun-failed-jobs"
            : "/repos/{$owner}/{$repo}/actions/runs/{$runId}/rerun";

        return $this->apiPostEmpty($githubAppUuid, $endpoint, [
            'ok' => true,
            'run_id' => $runId,
            'failed_only' => $failedOnly,
            'message' => $failedOnly
                ? 'Relance des jobs en échec demandée.'
                : 'Relance complète du workflow demandée.',
        ]);
    }

    /** @return array<mixed> */
    public function dispatchWorkflow(
        string $githubAppUuid,
        string $owner,
        string $repo,
        string $workflowIdOrFilename,
        string $ref,
        array $inputs = [],
    ): array {
        if ($workflowIdOrFilename === '' || $ref === '') {
            return ['error' => 'workflow_id (ou fichier .yml) et ref (branche/tag) sont requis.'];
        }

        $payload = ['ref' => $ref];
        if ($inputs !== []) {
            $payload['inputs'] = $inputs;
        }

        try {
            $githubApp = $this->githubCatalog->appForTeam($this->team, $githubAppUuid);
            $token = generateGithubInstallationToken($githubApp);
            if (! $token) {
                return ['error' => 'Impossible de générer un token GitHub App.'];
            }

            $response = Http::GitHub($githubApp->api_url, $token)
                ->timeout(30)
                ->post("/repos/{$owner}/{$repo}/actions/workflows/{$workflowIdOrFilename}/dispatches", $payload);

            if (! $response->successful()) {
                return ['error' => mb_substr($response->json('message', 'Échec API GitHub'), 0, 500)];
            }

            return [
                'ok' => true,
                'workflow' => $workflowIdOrFilename,
                'ref' => $ref,
                'message' => 'workflow_dispatch déclenché.',
            ];
        } catch (\Throwable $exception) {
            return ['error' => mb_substr($exception->getMessage(), 0, 500)];
        }
    }

    /**
     * @param  array<string, mixed>  $successPayload
     * @return array<mixed>
     */
    private function apiPostEmpty(string $githubAppUuid, string $endpoint, array $successPayload): array
    {
        try {
            $githubApp = $this->githubCatalog->appForTeam($this->team, $githubAppUuid);
            $token = generateGithubInstallationToken($githubApp);
            if (! $token) {
                return ['error' => 'Impossible de générer un token GitHub App.'];
            }

            $response = Http::GitHub($githubApp->api_url, $token)
                ->timeout(30)
                ->post($endpoint);

            if (! $response->successful()) {
                return ['error' => mb_substr($response->json('message', 'Échec API GitHub'), 0, 500)];
            }

            return $successPayload;
        } catch (\Throwable $exception) {
            return ['error' => mb_substr($exception->getMessage(), 0, 500)];
        }
    }

    /** @return array<mixed> */
    public function listCommits(
        string $githubAppUuid,
        string $owner,
        string $repo,
        ?string $branch = null,
        int $limit = 10,
    ): array {
        $limit = max(1, min($limit, 30));
        $query = ['per_page' => $limit];
        if ($branch) {
            $query['sha'] = $branch;
        }

        return $this->apiGet($githubAppUuid, "/repos/{$owner}/{$repo}/commits", $query, fn (array $items): array => [
            'commits' => collect($items)->map(fn (array $commit): array => [
                'sha' => $commit['sha'] ?? null,
                'message' => mb_substr((string) ($commit['commit']['message'] ?? ''), 0, 500),
                'author' => $commit['commit']['author']['name'] ?? null,
                'date' => $commit['commit']['author']['date'] ?? null,
                'html_url' => $commit['html_url'] ?? null,
            ])->values()->all(),
        ]);
    }

    /**
     * @param  callable(array): array  $mapper
     * @return array<mixed>
     */
    private function apiPost(
        string $githubAppUuid,
        string $endpoint,
        array $payload,
        callable $mapper,
    ): array {
        return $this->apiWrite('post', $githubAppUuid, $endpoint, $payload, $mapper);
    }

    /**
     * @param  callable(array): array  $mapper
     * @return array<mixed>
     */
    private function apiPut(
        string $githubAppUuid,
        string $endpoint,
        array $payload,
        callable $mapper,
    ): array {
        return $this->apiWrite('put', $githubAppUuid, $endpoint, $payload, $mapper);
    }

    /**
     * @param  callable(array): array  $mapper
     * @return array<mixed>
     */
    private function apiPatch(
        string $githubAppUuid,
        string $endpoint,
        array $payload,
        callable $mapper,
    ): array {
        return $this->apiWrite('patch', $githubAppUuid, $endpoint, $payload, $mapper);
    }

    /**
     * @param  callable(array): array  $mapper
     * @return array<mixed>
     */
    private function apiWrite(
        string $method,
        string $githubAppUuid,
        string $endpoint,
        array $payload,
        callable $mapper,
    ): array {
        try {
            $githubApp = $this->githubCatalog->appForTeam($this->team, $githubAppUuid);
            $token = generateGithubInstallationToken($githubApp);
            if (! $token) {
                return ['error' => 'Impossible de générer un token GitHub App.'];
            }

            $request = Http::GitHub($githubApp->api_url, $token)->timeout(30);
            $response = match ($method) {
                'put' => $request->put($endpoint, $payload),
                'patch' => $request->patch($endpoint, $payload),
                default => $request->post($endpoint, $payload),
            };

            if (! $response->successful()) {
                return ['error' => mb_substr($response->json('message', 'Échec API GitHub'), 0, 500)];
            }

            $json = $response->json();

            return is_array($json) ? $mapper($json) : ['error' => 'Réponse GitHub inattendue.'];
        } catch (\Throwable $exception) {
            return ['error' => mb_substr($exception->getMessage(), 0, 500)];
        }
    }

    /**
     * @param  callable(array): array  $mapper
     * @return array<mixed>
     */
    private function apiGet(
        string $githubAppUuid,
        string $endpoint,
        array $query,
        callable $mapper,
        bool $single = false,
        ?string $rootKey = null,
    ): array {
        try {
            $githubApp = $this->githubCatalog->appForTeam($this->team, $githubAppUuid);
            $token = generateGithubInstallationToken($githubApp);
            if (! $token) {
                return ['error' => 'Impossible de générer un token GitHub App.'];
            }

            $response = Http::GitHub($githubApp->api_url, $token)
                ->timeout(20)
                ->get($endpoint, $query);

            if (! $response->successful()) {
                return ['error' => mb_substr($response->json('message', 'Échec API GitHub'), 0, 500)];
            }

            $json = $response->json();
            if ($single) {
                return is_array($json) ? $mapper($json) : ['error' => 'Réponse GitHub inattendue.'];
            }

            if ($rootKey !== null && is_array($json)) {
                return $mapper($json);
            }

            return is_array($json) ? $mapper($json) : ['error' => 'Réponse GitHub inattendue.'];
        } catch (\Throwable $exception) {
            return ['error' => mb_substr($exception->getMessage(), 0, 500)];
        }
    }

    /**
     * @return array<mixed>
     */
    private function fetchGithubContent(
        string $githubAppUuid,
        string $owner,
        string $repo,
        string $path,
        ?string $ref,
        bool $decodeFile,
    ): array {
        try {
            $githubApp = $this->githubCatalog->appForTeam($this->team, $githubAppUuid);
            $token = generateGithubInstallationToken($githubApp);
            if (! $token) {
                return ['error' => 'Impossible de générer un token GitHub App.'];
            }

            $endpoint = $this->contentsEndpoint($owner, $repo, $path);
            $query = $ref ? ['ref' => $ref] : [];

            $response = Http::GitHub($githubApp->api_url, $token)
                ->timeout(20)
                ->get($endpoint, $query);

            if (! $response->successful()) {
                return ['error' => mb_substr($response->json('message', 'Échec API GitHub'), 0, 500)];
            }

            $json = $response->json();

            if (is_array($json) && array_is_list($json)) {
                return ['type' => 'dir', 'entries' => $json];
            }

            if (! is_array($json) || ! isset($json['type'])) {
                return ['error' => 'Réponse GitHub inattendue.'];
            }

            if ($json['type'] === 'dir') {
                return ['type' => 'dir', 'entries' => []];
            }

            if ($decodeFile) {
                $content = base64_decode((string) ($json['content'] ?? ''), true);
                if ($content === false) {
                    return ['error' => 'Décodage du fichier impossible.'];
                }

                return [
                    'path' => $json['path'] ?? $path,
                    'sha' => $json['sha'] ?? null,
                    'size' => $json['size'] ?? null,
                    'content' => mb_substr($content, 0, 32000),
                    'truncated' => mb_strlen($content) > 32000,
                ];
            }

            return ['type' => 'file', 'path' => $json['path'] ?? $path];
        } catch (\Throwable $exception) {
            return ['error' => mb_substr($exception->getMessage(), 0, 500)];
        }
    }

    private function contentsEndpoint(string $owner, string $repo, string $path): string
    {
        $segments = array_map('rawurlencode', array_filter(explode('/', trim($path, '/'))));

        return '/repos/'.rawurlencode($owner).'/'.rawurlencode($repo).'/contents/'.implode('/', $segments);
    }

    private function gitRefPath(string $branch): string
    {
        $segments = array_map('rawurlencode', explode('/', trim($branch, '/')));

        return 'heads/'.implode('/', $segments);
    }
}
