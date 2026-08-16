<?php

namespace App\Services\DevForge\Github;

use App\Models\GithubApp;
use App\Models\Team;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

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
        $account = $this->installationAccount($githubApp);
        $accountLogin = is_string($account['login'] ?? null) ? (string) $account['login'] : null;
        $displayName = $accountLogin
            ?? (filled($githubApp->organization) ? (string) $githubApp->organization : null)
            ?? (string) $githubApp->name;

        return [
            'uuid' => $githubApp->uuid,
            'name' => $githubApp->name,
            'display_name' => $displayName,
            'account_login' => $accountLogin,
            'account_type' => is_string($account['type'] ?? null) ? (string) $account['type'] : null,
            'account_avatar_url' => is_string($account['avatar_url'] ?? null) ? (string) $account['avatar_url'] : null,
            'account_html_url' => is_string($account['html_url'] ?? null) ? (string) $account['html_url'] : null,
            'organization' => $githubApp->organization,
            'html_url' => $githubApp->html_url,
            'is_system_wide' => (bool) $githubApp->is_system_wide,
            'has_packages_token' => filled($githubApp->packages_token),
            'installation_id' => $githubApp->installation_id,
        ];
    }

    /**
     * @param  array{name?: string, organization?: string|null}  $input
     */
    public function createDraftForTeam(Team $team, array $input = []): GithubApp
    {
        $name = trim((string) ($input['name'] ?? ''));

        return GithubApp::create([
            'name' => $name !== '' ? $name : substr(generate_random_name(), 0, 30),
            'organization' => filled($input['organization'] ?? null) ? $input['organization'] : null,
            'api_url' => 'https://api.github.com',
            'html_url' => 'https://github.com',
            'custom_user' => 'git',
            'custom_port' => 22,
            'is_system_wide' => false,
            'team_id' => $team->id,
        ]);
    }

    /**
     * @return array{action_url: string, manifest: array<string, mixed>}
     */
    public function manifestLaunch(
        GithubApp $githubApp,
        bool $previewDeployments = true,
        bool $administration = false,
    ): array {
        $state = Str::random(64);
        Cache::put('github-app-setup-state:'.hash('sha256', $state), [
            'action' => 'manifest',
            'github_app_id' => $githubApp->id,
            'team_id' => $githubApp->team_id,
        ], now()->addMinutes(60));

        $baseUrl = $this->webhookBaseUrl();
        $webhookBaseUrl = $baseUrl.'/webhooks';
        $path = filled($githubApp->organization)
            ? 'organizations/'.$githubApp->organization.'/settings/apps/new'
            : 'settings/apps/new';

        $permissions = [
            'contents' => 'read',
            'metadata' => 'read',
            'emails' => 'read',
            'administration' => $administration ? 'write' : 'read',
            'packages' => 'read',
        ];
        $events = ['push'];
        if ($previewDeployments) {
            $permissions['pull_requests'] = 'write';
            $events[] = 'pull_request';
        }

        return [
            'action_url' => rtrim((string) $githubApp->html_url, '/').'/'.$path.'?state='.$state,
            'manifest' => [
                'name' => $githubApp->name,
                'url' => $baseUrl,
                'hook_attributes' => [
                    'url' => $webhookBaseUrl.'/source/github/events',
                    'active' => true,
                ],
                'redirect_url' => $webhookBaseUrl.'/source/github/redirect',
                'callback_urls' => [$baseUrl.'/login/github/app'],
                'public' => false,
                'request_oauth_on_install' => false,
                'setup_url' => $webhookBaseUrl.'/source/github/install',
                'setup_on_update' => true,
                'default_permissions' => $permissions,
                'default_events' => $events,
            ],
        ];
    }

    public function installationUrl(GithubApp $githubApp): string
    {
        return getInstallationPath($githubApp);
    }

    private function webhookBaseUrl(): string
    {
        $settings = instanceSettings();
        $fqdn = is_string($settings->fqdn) ? trim($settings->fqdn) : '';
        $baseUrl = $fqdn !== '' ? rtrim($fqdn, '/') : request()->getSchemeAndHttpHost();

        if (! str_starts_with($baseUrl, 'http://') && ! str_starts_with($baseUrl, 'https://')) {
            $baseUrl = 'https://'.$baseUrl;
        }

        return rtrim($baseUrl, '/');
    }

    /**
     * @return array{login?: string, type?: string, avatar_url?: string, html_url?: string}
     */
    public function installationAccount(GithubApp $githubApp): array
    {
        if (blank($githubApp->installation_id)) {
            return [];
        }

        $cacheKey = 'devforge.github_app.installation_account.'.$githubApp->uuid;

        try {
            /** @var array{login?: string, type?: string, avatar_url?: string, html_url?: string} $cached */
            $cached = Cache::remember($cacheKey, now()->addHour(), function () use ($githubApp): array {
                $jwt = generateGithubJwt($githubApp);
                $response = Http::withToken($jwt)
                    ->withHeaders([
                        'Accept' => 'application/vnd.github+json',
                        'X-GitHub-Api-Version' => '2022-11-28',
                    ])
                    ->timeout(15)
                    ->get(rtrim((string) $githubApp->api_url, '/').'/app/installations/'.$githubApp->installation_id);

                if (! $response->successful()) {
                    return [];
                }

                $account = data_get($response->json(), 'account', []);
                if (! is_array($account)) {
                    return [];
                }

                return array_filter([
                    'login' => is_string($account['login'] ?? null) ? (string) $account['login'] : null,
                    'type' => is_string($account['type'] ?? null) ? (string) $account['type'] : null,
                    'avatar_url' => is_string($account['avatar_url'] ?? null) ? (string) $account['avatar_url'] : null,
                    'html_url' => is_string($account['html_url'] ?? null) ? (string) $account['html_url'] : null,
                ], static fn ($value): bool => $value !== null && $value !== '');
            });

            return is_array($cached) ? $cached : [];
        } catch (\Throwable) {
            return [];
        }
    }

    /**
     * @return array{uuid: string, name: string, has_packages_token: bool}
     */
    public function updatePackagesToken(GithubApp $githubApp, ?string $token): array
    {
        $normalized = is_string($token) ? trim($token) : '';
        $githubApp->packages_token = $normalized !== '' ? $normalized : null;
        $githubApp->save();

        return [
            'uuid' => $githubApp->uuid,
            'name' => $githubApp->name,
            'has_packages_token' => filled($githubApp->packages_token),
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function runners(GithubApp $githubApp, string $owner, string $repo): array
    {
        $token = $this->apiToken($githubApp);
        abort_unless($token, 400, 'Impossible de générer un jeton GitHub.');

        $runners = collect();
        $page = 1;

        while ($page <= 20) {
            $response = Http::GitHub($githubApp->api_url, $token)
                ->timeout(8)
                ->retry(1, 100, throw: false)
                ->get("/repos/{$owner}/{$repo}/actions/runners", [
                    'per_page' => 100,
                    'page' => $page,
                ]);

            abort_unless(
                $response->status() === 200,
                $response->status(),
                $response->json('message', 'Impossible de lister les runners GitHub.'),
            );

            $batch = $response->json('runners', []);
            if (! is_array($batch) || $batch === []) {
                break;
            }

            $runners = $runners->concat($batch);
            if (count($batch) < 100) {
                break;
            }

            $page++;
        }

        return $runners
            ->map(fn (array $runner): array => [
                'id' => (int) data_get($runner, 'id'),
                'name' => (string) data_get($runner, 'name', ''),
                'os' => (string) data_get($runner, 'os', ''),
                'status' => (string) data_get($runner, 'status', 'offline'),
                'busy' => (bool) data_get($runner, 'busy', false),
                'labels' => collect(data_get($runner, 'labels', []))
                    ->map(fn ($label): string => is_array($label)
                        ? (string) data_get($label, 'name', '')
                        : (string) $label)
                    ->filter()
                    ->values()
                    ->all(),
            ])
            ->values()
            ->all();
    }

    /**
     * @return array{token: string, expires_at: string|null}
     */
    public function registrationToken(GithubApp $githubApp, string $owner, string $repo): array
    {
        $candidates = $this->tokenCandidatesForRunnerRegistration($githubApp);
        if ($candidates === []) {
            throw ValidationException::withMessages([
                'github_app_uuid' => [
                    'Impossible de générer un jeton GitHub. Vérifiez la GitHub App (installation token) ou ajoutez un packages token avec droit Administration sur le dépôt.',
                ],
            ]);
        }

        $lastStatus = 0;
        $lastMessage = 'Impossible de créer un jeton d’enregistrement runner.';

        foreach ($candidates as $token) {
            // GitHub rejects a JSON body of [] / {} for this endpoint (422 schema error).
            $response = Http::GitHub($githubApp->api_url, $token)
                ->timeout(20)
                ->retry(2, 200, throw: false)
                ->withBody('', 'application/json')
                ->post("/repos/{$owner}/{$repo}/actions/runners/registration-token");

            $lastStatus = $response->status();
            $lastMessage = (string) $response->json('message', $lastMessage);

            if (! in_array($lastStatus, [200, 201], true)) {
                continue;
            }

            $runnerToken = (string) $response->json('token', '');
            if ($runnerToken === '') {
                continue;
            }

            return [
                'token' => $runnerToken,
                'expires_at' => is_string($response->json('expires_at'))
                    ? (string) $response->json('expires_at')
                    : null,
            ];
        }

        throw ValidationException::withMessages([
            'github_app_uuid' => [
                $this->registrationTokenFailureMessage($owner, $repo, $lastStatus, $lastMessage),
            ],
        ]);
    }

    private function registrationTokenFailureMessage(
        string $owner,
        string $repo,
        int $status,
        string $githubMessage,
    ): string {
        $repoLabel = $owner.'/'.$repo;

        return match (true) {
            $status === 401 => "GitHub a refusé l’authentification pour {$repoLabel}. Vérifiez le packages token ou la GitHub App.",
            $status === 403 => "Permission insuffisante pour créer un runner sur {$repoLabel}. La GitHub App (ou le packages token) doit avoir le droit Administration (écriture) sur le dépôt.",
            $status === 404 => "Dépôt {$repoLabel} introuvable, ou la GitHub App n’y a pas accès.",
            $status === 422 => "GitHub a rejeté la demande de jeton pour {$repoLabel}".($githubMessage !== '' ? " : {$githubMessage}" : '.'),
            default => trim($githubMessage) !== ''
                ? "Impossible d’obtenir un jeton d’enregistrement pour {$repoLabel} (HTTP {$status}) : {$githubMessage}"
                : "Impossible d’obtenir un jeton d’enregistrement pour {$repoLabel} (HTTP {$status}).",
        };
    }

    /**
     * @return array<int, string>
     */
    private function tokenCandidatesForRunnerRegistration(GithubApp $githubApp): array
    {
        $candidates = [];

        // Packages / PAT often has admin:repo; GitHub App installation tokens frequently lack Administration.
        if (filled($githubApp->packages_token)) {
            $candidates[] = (string) $githubApp->packages_token;
        }

        try {
            $installationToken = generateGithubInstallationToken($githubApp);
            if (filled($installationToken)) {
                $candidates[] = $installationToken;
            }
        } catch (\Throwable) {
            // Ignore and rely on packages token when present.
        }

        return array_values(array_unique($candidates));
    }

    private function apiToken(GithubApp $githubApp): ?string
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
