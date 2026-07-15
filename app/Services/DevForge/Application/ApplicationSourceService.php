<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Agent\Tool\AgentGithubTools;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\CurrentTeamResources;
use App\Services\DevForge\Github\GithubAppCatalog;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ApplicationSourceService
{
    public function __construct(
        private readonly CurrentTeamResources $teamResources,
        private readonly GithubAppCatalog $githubAppCatalog,
        private readonly CoreResourceAction $resourceAction,
    ) {}

    public function applicationForUser(User $user, string $applicationUuid): Application
    {
        return $this->teamResources->application($user, $applicationUuid);
    }

    public function applicationForTeam(Team $team, string $applicationUuid): Application
    {
        return $this->teamResources->applicationForTeam($team, $applicationUuid);
    }

    /**
     * @return array<string, mixed>
     */
    public function info(Application $application): array
    {
        $application->loadMissing('source');
        $repository = ApplicationGitRepositoryParser::parseOwnerRepo($application->git_repository);
        $baseDirectory = ApplicationGitRepositoryParser::normalizeSourcePath($application->base_directory ?: '');

        return [
            'available' => $application->is_github_based() && $repository !== null && $application->source !== null,
            'reason' => $this->unavailableReason($application, $repository),
            'git_repository' => $application->git_repository,
            'git_branch' => $application->git_branch,
            'git_commit_sha' => $application->git_commit_sha,
            'base_directory' => $baseDirectory,
            'initial_path' => $baseDirectory,
            'owner' => $repository['owner'] ?? null,
            'repo' => $repository['repo'] ?? null,
            'github_app_uuid' => $application->source?->uuid,
            'github_app_name' => $application->source?->name,
            'html_url' => $repository
                ? "https://github.com/{$repository['owner']}/{$repository['repo']}/tree/".rawurlencode((string) $application->git_branch).($baseDirectory !== '' ? '/'.str_replace('%2F', '/', rawurlencode($baseDirectory)) : '')
                : null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function listDirectory(Team $team, Application $application, ?string $path = null): array
    {
        $context = $this->resolveGithubContext($application);
        $directory = ApplicationGitRepositoryParser::normalizeSourcePath($path ?? $context['initial_path']);

        $result = $this->githubTools($team)->listDir(
            $context['github_app_uuid'],
            $context['owner'],
            $context['repo'],
            $directory,
            $context['ref'],
        );

        if (isset($result['error'])) {
            throw ValidationException::withMessages(['source' => $result['error']]);
        }

        $entries = collect($result['entries'] ?? [])
            ->map(fn (array $entry): array => [
                'name' => (string) ($entry['name'] ?? ''),
                'path' => (string) ($entry['path'] ?? ''),
                'type' => ($entry['type'] ?? '') === 'dir' ? 'directory' : 'file',
                'size' => (int) ($entry['size'] ?? 0),
            ])
            ->sortBy([
                fn (array $entry) => $entry['type'] === 'directory' ? 0 : 1,
                fn (array $entry) => strnatcasecmp($entry['name'], ''),
            ])
            ->values()
            ->all();

        return [
            'path' => $directory,
            'parent_path' => $this->parentPath($directory, $context['initial_path']),
            'entries' => $entries,
            'entry_count' => count($entries),
            'ref' => $context['ref'],
            'repository' => "{$context['owner']}/{$context['repo']}",
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function readFile(Team $team, Application $application, string $path): array
    {
        $context = $this->resolveGithubContext($application);
        $filePath = ApplicationGitRepositoryParser::normalizeSourcePath($path);

        if ($filePath === '') {
            throw ValidationException::withMessages(['path' => 'Chemin de fichier requis.']);
        }

        $result = $this->githubTools($team)->readFile(
            $context['github_app_uuid'],
            $context['owner'],
            $context['repo'],
            $filePath,
            $context['ref'],
        );

        if (isset($result['error'])) {
            throw ValidationException::withMessages(['source' => $result['error']]);
        }

        return [
            'path' => $result['path'] ?? $filePath,
            'content' => $result['content'] ?? '',
            'size' => (int) ($result['size'] ?? 0),
            'truncated' => (bool) ($result['truncated'] ?? false),
            'sha' => $result['sha'] ?? null,
            'ref' => $context['ref'],
            'repository' => "{$context['owner']}/{$context['repo']}",
        ];
    }

    /**
     * @param  array{sha?: ?string, mode?: string, redeploy?: bool, branch_name?: ?string, pr_title?: ?string, pr_body?: ?string}  $options
     * @return array<string, mixed>
     */
    public function writeFile(
        Team $team,
        Application $application,
        string $path,
        string $content,
        string $commitMessage,
        ?string $sha = null,
        array $options = [],
    ): array {
        $context = $this->resolveGithubContext($application);
        $filePath = ApplicationGitRepositoryParser::normalizeSourcePath($path);
        $mode = ($options['mode'] ?? 'direct') === 'pull_request' ? 'pull_request' : 'direct';
        $redeploy = array_key_exists('redeploy', $options)
            ? (bool) $options['redeploy']
            : $mode === 'direct';

        if ($filePath === '') {
            throw ValidationException::withMessages(['path' => 'Chemin de fichier requis.']);
        }

        $commitMessage = trim($commitMessage);
        if ($commitMessage === '') {
            throw ValidationException::withMessages(['commit_message' => 'Message de commit requis.']);
        }

        if (mb_strlen($content) > 32000) {
            throw ValidationException::withMessages(['content' => 'Contenu trop volumineux (max 32 Ko).']);
        }

        $githubTools = $this->githubTools($team);
        $sha = $this->resolveFileSha($githubTools, $context, $filePath, $sha);

        if ($mode === 'pull_request') {
            return $this->writeViaPullRequest(
                $githubTools,
                $context,
                $application,
                $filePath,
                $content,
                $commitMessage,
                $sha,
                $options,
            );
        }

        $result = $this->commitFileToBranch(
            $githubTools,
            $context,
            $filePath,
            $content,
            $commitMessage,
            $sha,
            $context['ref'],
        );

        $response = [
            'mode' => 'direct',
            'path' => $result['path'] ?? $filePath,
            'sha' => $result['sha'] ?? null,
            'commit_sha' => $result['commit_sha'] ?? null,
            'commit_url' => $result['commit_url'] ?? null,
            'ref' => $context['ref'],
            'branch' => $context['ref'],
            'repository' => "{$context['owner']}/{$context['repo']}",
            'size' => (int) ($result['size'] ?? mb_strlen($content)),
            'redeploy' => null,
        ];

        if ($redeploy) {
            $deploy = $this->resourceAction->execute($application, 'applications', 'deploy', [
                'instant_deploy' => true,
            ]);

            $response['redeploy'] = [
                'queued' => (bool) ($deploy['queued'] ?? false),
                'deployment_uuid' => $deploy['deployment_uuid'] ?? null,
                'message' => $deploy['message'] ?? null,
            ];
        }

        return $response;
    }

    /**
     * @param  array{branch_name?: ?string, pr_title?: ?string, pr_body?: ?string}  $options
     * @param  array{github_app_uuid: string, owner: string, repo: string, ref: string, initial_path: string}  $context
     * @return array<string, mixed>
     */
    private function writeViaPullRequest(
        AgentGithubTools $githubTools,
        array $context,
        Application $application,
        string $filePath,
        string $content,
        string $commitMessage,
        ?string $sha,
        array $options,
    ): array {
        $head = $githubTools->getBranchHeadSha(
            $context['github_app_uuid'],
            $context['owner'],
            $context['repo'],
            $context['ref'],
        );

        if (isset($head['error'])) {
            throw ValidationException::withMessages(['source' => $head['error']]);
        }

        if (! is_string($head['sha'] ?? null) || $head['sha'] === '') {
            throw ValidationException::withMessages(['source' => 'Impossible de résoudre le HEAD de la branche déployée.']);
        }

        $branchName = $this->resolveBranchName($application, $filePath, $options['branch_name'] ?? null);
        $branch = $githubTools->createBranch(
            $context['github_app_uuid'],
            $context['owner'],
            $context['repo'],
            $branchName,
            $head['sha'],
        );

        if (isset($branch['error'])) {
            throw ValidationException::withMessages(['source' => $branch['error']]);
        }

        $result = $this->commitFileToBranch(
            $githubTools,
            $context,
            $filePath,
            $content,
            $commitMessage,
            $sha,
            $branchName,
        );

        $prTitle = trim((string) ($options['pr_title'] ?? $commitMessage));
        $prBody = trim((string) ($options['pr_body'] ?? "Modifié via DevForge : `{$filePath}` sur l'application {$application->name}."));
        $pullRequest = $githubTools->createPullRequest(
            $context['github_app_uuid'],
            $context['owner'],
            $context['repo'],
            $prTitle,
            $branchName,
            $context['ref'],
            $prBody,
        );

        if (isset($pullRequest['error'])) {
            throw ValidationException::withMessages(['source' => $pullRequest['error']]);
        }

        return [
            'mode' => 'pull_request',
            'path' => $result['path'] ?? $filePath,
            'sha' => $result['sha'] ?? null,
            'commit_sha' => $result['commit_sha'] ?? null,
            'commit_url' => $result['commit_url'] ?? null,
            'ref' => $context['ref'],
            'branch' => $branchName,
            'repository' => "{$context['owner']}/{$context['repo']}",
            'size' => (int) ($result['size'] ?? mb_strlen($content)),
            'pull_request_number' => $pullRequest['number'] ?? null,
            'pull_request_url' => $pullRequest['html_url'] ?? null,
            'redeploy' => [
                'queued' => false,
                'message' => 'Redéploiement différé — fusionnez la PR sur la branche déployée.',
            ],
        ];
    }

    /**
     * @param  array{github_app_uuid: string, owner: string, repo: string, ref: string, initial_path: string}  $context
     * @return array<string, mixed>
     */
    private function commitFileToBranch(
        AgentGithubTools $githubTools,
        array $context,
        string $filePath,
        string $content,
        string $commitMessage,
        ?string $sha,
        string $branch,
    ): array {
        $result = $githubTools->writeFile(
            $context['github_app_uuid'],
            $context['owner'],
            $context['repo'],
            $filePath,
            $content,
            $commitMessage,
            $sha,
            $branch,
        );

        if (isset($result['error'])) {
            throw ValidationException::withMessages(['source' => $result['error']]);
        }

        return $result;
    }

    /**
     * @param  array{github_app_uuid: string, owner: string, repo: string, ref: string, initial_path: string}  $context
     */
    private function resolveFileSha(
        AgentGithubTools $githubTools,
        array $context,
        string $filePath,
        ?string $sha,
    ): ?string {
        if ($sha !== null && $sha !== '') {
            return $sha;
        }

        $existing = $githubTools->readFile(
            $context['github_app_uuid'],
            $context['owner'],
            $context['repo'],
            $filePath,
            $context['ref'],
        );

        if (isset($existing['error'])) {
            return null;
        }

        return is_string($existing['sha'] ?? null) ? $existing['sha'] : null;
    }

    private function resolveBranchName(Application $application, string $filePath, ?string $requested): string
    {
        $basename = pathinfo($filePath, PATHINFO_FILENAME);
        $slug = Str::slug((string) $basename);
        $slug = $slug !== '' ? $slug : 'edit';
        $default = 'devforge/'.Str::limit($slug, 24, '').'-'.now()->format('Ymd-His');

        if ($requested === null || trim($requested) === '') {
            return $default;
        }

        $branch = trim($requested);
        $branch = preg_replace('/[^a-zA-Z0-9._\/-]+/', '-', $branch) ?? $branch;
        $branch = trim((string) $branch, './-');

        if ($branch === '') {
            return $default;
        }

        return Str::limit($branch, 120, '');
    }

    /**
     * @param  array{owner: string, repo: string}|null  $repository
     */
    private function unavailableReason(Application $application, ?array $repository): ?string
    {
        if (! $application->is_github_based() || $application->source === null) {
            return 'Cette application n’est pas liée à une GitHub App Coolify.';
        }

        if ($repository === null) {
            return 'Impossible de déterminer le dépôt GitHub à partir de l’URL configurée.';
        }

        return null;
    }

    /**
     * @return array{github_app_uuid: string, owner: string, repo: string, ref: string, initial_path: string}
     */
    private function resolveGithubContext(Application $application): array
    {
        $application->loadMissing('source');
        $repository = ApplicationGitRepositoryParser::parseOwnerRepo($application->git_repository);

        if (! $application->is_github_based() || $application->source === null || $repository === null) {
            throw ValidationException::withMessages([
                'source' => $this->unavailableReason($application, $repository) ?? 'Source indisponible.',
            ]);
        }

        return [
            'github_app_uuid' => (string) $application->source->uuid,
            'owner' => $repository['owner'],
            'repo' => $repository['repo'],
            'ref' => (string) ($application->git_branch ?: 'main'),
            'initial_path' => ApplicationGitRepositoryParser::normalizeSourcePath($application->base_directory ?: ''),
        ];
    }

    private function parentPath(string $directory, string $rootPath): ?string
    {
        if ($directory === '' || $directory === $rootPath) {
            return null;
        }

        $parent = dirname(str_replace('\\', '/', $directory));

        if ($parent === '.' || $parent === '') {
            return $rootPath === '' ? null : $rootPath;
        }

        if ($rootPath !== '' && $parent !== $rootPath && ! str_starts_with($parent, $rootPath.'/')) {
            return $rootPath;
        }

        return $parent;
    }

    private function githubTools(Team $team): AgentGithubTools
    {
        return new AgentGithubTools(
            $team,
            app(\App\Services\DevForge\Core\CoreResourceCatalog::class),
            $this->githubAppCatalog,
        );
    }
}
