<?php

namespace App\Services\DevForge\Github;

use App\Models\GithubApp;
use App\Models\Team;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Http;

class GithubAppCatalog
{
    /**
     * @return Collection<int, GithubApp>
     */
    public function appsForTeam(Team $team): Collection
    {
        return GithubApp::query()
            ->where(function ($query) use ($team): void {
                $query->where('team_id', $team->id)
                    ->orWhere('is_system_wide', true);
            })
            ->where('is_public', false)
            ->whereNotNull('app_id')
            ->orderBy('name')
            ->get();
    }

    public function appForTeam(Team $team, string $githubAppUuid): GithubApp
    {
        $githubApp = GithubApp::query()
            ->where('uuid', $githubAppUuid)
            ->where(function ($query) use ($team): void {
                $query->where('team_id', $team->id)
                    ->orWhere('is_system_wide', true);
            })
            ->where('is_public', false)
            ->whereNotNull('app_id')
            ->first();

        if (! $githubApp) {
            throw (new ModelNotFoundException)->setModel(GithubApp::class, [$githubAppUuid]);
        }

        return $githubApp;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function repositories(GithubApp $githubApp): array
    {
        $token = generateGithubInstallationToken($githubApp);
        abort_unless($token, 400, 'Failed to generate GitHub App token.');

        $repositories = collect();
        $page = 1;
        $maxPages = 100;

        while ($page <= $maxPages) {
            $response = Http::GitHub($githubApp->api_url, $token)
                ->timeout(20)
                ->retry(3, 200, throw: false)
                ->get('/installation/repositories', [
                    'per_page' => 100,
                    'page' => $page,
                ]);

            abort_unless($response->status() === 200, $response->status(), $response->json('message', 'Failed to load repositories.'));

            $repos = $response->json('repositories', []);
            if ($repos === []) {
                break;
            }

            $repositories = $repositories->concat($repos);
            $page++;
        }

        return $repositories
            ->sortBy('name')
            ->map(fn (array $repository): array => $this->presentRepository($repository))
            ->values()
            ->all();
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function branches(GithubApp $githubApp, string $owner, string $repo): array
    {
        $token = generateGithubInstallationToken($githubApp);
        abort_unless($token, 400, 'Failed to generate GitHub App token.');

        $branches = collect();
        $page = 1;

        while (true) {
            $response = Http::GitHub($githubApp->api_url, $token)
                ->timeout(20)
                ->retry(3, 200, throw: false)
                ->get("/repos/{$owner}/{$repo}/branches", [
                    'per_page' => 100,
                    'page' => $page,
                ]);

            abort_unless($response->status() === 200, $response->status(), $response->json('message', 'Failed to load branches.'));

            $json = $response->json();
            if ($json === []) {
                break;
            }

            $branches = $branches->concat(collect($json));
            if (count($json) < 100) {
                break;
            }

            $page++;
        }

        return sortBranchesByPriority($branches)
            ->map(fn (array $branch): array => [
                'name' => data_get($branch, 'name'),
                'protected' => (bool) data_get($branch, 'protected', false),
            ])
            ->values()
            ->all();
    }

    /**
     * @return array<string, mixed>
     */
    public function presentApp(GithubApp $githubApp): array
    {
        return [
            'uuid' => $githubApp->uuid,
            'name' => $githubApp->name,
            'organization' => $githubApp->organization,
            'html_url' => $githubApp->html_url,
            'is_system_wide' => (bool) $githubApp->is_system_wide,
        ];
    }

    /**
     * @param  array<string, mixed>  $repository
     * @return array<string, mixed>
     */
    private function presentRepository(array $repository): array
    {
        return [
            'id' => data_get($repository, 'id'),
            'name' => data_get($repository, 'name'),
            'full_name' => data_get($repository, 'full_name'),
            'owner' => data_get($repository, 'owner.login'),
            'private' => (bool) data_get($repository, 'private', false),
            'html_url' => data_get($repository, 'html_url'),
            'default_branch' => data_get($repository, 'default_branch', 'main'),
            'description' => data_get($repository, 'description'),
        ];
    }
}
