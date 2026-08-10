<?php

namespace App\Services\DevForge\Github;

use App\Models\Server;
use App\Models\Team;
use App\Support\ValidationPatterns;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class GithubRunnerInventory
{
    private const DEFAULT_IMAGE = 'myoung34/github-runner:latest';

    private const SENSITIVE_ENV_KEYS = [
        'ACCESS_TOKEN',
        'RUNNER_TOKEN',
        'GITHUB_TOKEN',
        'TOKEN',
        'PASSWORD',
        'SECRET',
        'PRIVATE_KEY',
    ];

    public function __construct(
        private readonly GithubAppCatalog $githubAppCatalog,
    ) {}

    /**
     * @return array<int, array<string, mixed>>
     */
    public function listForTeam(Team $team): array
    {
        $cacheKey = 'devforge.github.runners.list.'.$team->id;

        /** @var array<int, array<string, mixed>> $cached */
        $cached = Cache::remember($cacheKey, now()->addSeconds(30), function () use ($team): array {
            $runners = $this->serversForTeam($team)
                ->flatMap(fn (Server $server): Collection => $this->runnersOnServer($server, enrichEnv: false))
                ->values();

            // List stays fast: GitHub status only from existing cache entries (no cold API calls).
            return $this->enrichWithGithubStatus($team, $runners, allowColdFetch: false)
                ->sortBy([
                    ['server_name', 'asc'],
                    ['name', 'asc'],
                ], SORT_NATURAL)
                ->values()
                ->all();
        });

        return is_array($cached) ? $cached : [];
    }

    /**
     * @return array<string, mixed>
     */
    public function show(Team $team, string $serverUuid, string $containerName): array
    {
        $server = $this->serverForTeam($team, $serverUuid);
        $runner = $this->findRunner($server, $containerName);
        $environment = $this->safeEnvironment($server, $containerName);

        $repoUrl = $runner['repo_url']
            ?? $this->envValue($environment, 'REPO_URL');
        $runnerName = $this->envValue($environment, 'RUNNER_NAME')
            ?? $runner['runner_name'];

        $presented = [
            ...$runner,
            'repo_url' => $repoUrl,
            'runner_name' => $runnerName,
            'environment' => $environment,
        ];

        try {
            $enriched = $this->enrichWithGithubStatus($team, collect([$presented]), allowColdFetch: true)->first();
        } catch (\Throwable) {
            $enriched = null;
        }

        return is_array($enriched) ? $enriched : $this->withEmptyGithubFields($presented);
    }

    /**
     * @return array<string, mixed>
     */
    public function logs(Team $team, string $serverUuid, string $containerName, int $lines = 200): array
    {
        $lines = max(10, min($lines, 1000));
        $server = $this->serverForTeam($team, $serverUuid);
        $this->assertValidContainerName($containerName);

        if (! $server->isFunctional()) {
            return $this->unavailableLogs(
                container: $containerName,
                reason: 'server_unavailable',
                message: 'Le serveur n’est pas joignable.',
            );
        }

        // Prefer inventory match, but still attempt docker logs by name when discovery is flaky.
        try {
            $this->findRunner($server, $containerName);
        } catch (ModelNotFoundException) {
            if (! $this->containerExistsByName($server, $containerName)) {
                throw (new ModelNotFoundException)->setModel('GithubRunner', [$containerName]);
            }
        } catch (ValidationException $e) {
            throw $e;
        }

        $status = getContainerStatus($server, $containerName);

        try {
            $rawLogs = getContainerLogs($server, $containerName, $lines);
        } catch (\Throwable) {
            return [
                ...$this->unavailableLogs(
                    container: $containerName,
                    reason: 'logs_unavailable',
                    message: 'Impossible de lire les logs du runner.',
                ),
                'container_status' => $status,
            ];
        }

        return [
            'available' => true,
            'reason' => null,
            'message' => null,
            'container' => $containerName,
            'container_status' => $status,
            'line_count' => $lines,
            'items' => $this->parseLines(is_string($rawLogs) ? $rawLogs : ''),
        ];
    }

    /**
     * @return array{ok: bool, action: string, message: string, runner: array<string, mixed>}
     */
    public function action(Team $team, string $serverUuid, string $containerName, string $action): array
    {
        $action = strtolower($action);
        if (! in_array($action, ['start', 'stop', 'restart'], true)) {
            throw ValidationException::withMessages([
                'action' => ['Action invalide. Utilisez start, stop ou restart.'],
            ]);
        }

        $server = $this->serverForTeam($team, $serverUuid);
        $this->assertValidContainerName($containerName);
        $this->findRunner($server, $containerName);

        if (! $server->isFunctional()) {
            throw ValidationException::withMessages([
                'server' => ['Le serveur n’est pas joignable.'],
            ]);
        }

        match ($action) {
            'start' => $server->startUnmanaged($containerName),
            'stop' => $server->stopUnmanaged($containerName),
            'restart' => $server->restartUnmanaged($containerName),
        };

        Cache::forget('devforge.github.runners.list.'.$team->id);

        $runner = $this->show($team, $serverUuid, $containerName);

        return [
            'ok' => true,
            'action' => $action,
            'message' => match ($action) {
                'start' => 'Runner démarré.',
                'stop' => 'Runner arrêté.',
                'restart' => 'Runner redémarré.',
            },
            'runner' => $runner,
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function create(Team $team, array $input): array
    {
        $validated = validator($input, [
            'auth_mode' => ['nullable', 'string', 'in:registration,pat'],
            'access_token' => ['nullable', 'string', 'max:512'],
            'use_saved_pat' => ['nullable', 'boolean'],
            'save_pat' => ['nullable', 'boolean'],
            'github_app_uuid' => ['nullable', 'string', 'max:64'],
            'owner' => ['required', 'string', 'max:100', 'regex:/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/'],
            'repo' => ['required', 'string', 'max:100', 'regex:/^[A-Za-z0-9._-]+$/'],
            'server_uuid' => ['required', 'string', 'max:64'],
            'runner_name' => ['required', ...ValidationPatterns::containerNameRules(64)],
            'container_name' => ['nullable', ...ValidationPatterns::containerNameRules(64)],
            'labels' => ['nullable', 'string', 'max:255'],
            'image' => ['nullable', 'string', 'max:255', 'regex:/^[A-Za-z0-9][A-Za-z0-9._\/:-]*$/'],
            'network_mode' => ['nullable', 'string', 'in:bridge,host,none'],
            'timezone' => ['nullable', 'string', 'max:64', 'regex:/^[A-Za-z0-9_\\/+-]+$/'],
            'replace_existing' => ['nullable', 'boolean'],
            'recreate' => ['nullable', 'boolean'],
            'volumes' => ['nullable', 'array', 'max:20'],
            'volumes.*' => ['string', 'max:512'],
            'extra_env' => ['nullable', 'array', 'max:30'],
            'extra_env.*.key' => ['required', 'string', 'max:128', 'regex:/^[A-Z][A-Z0-9_]*$/'],
            'extra_env.*.value' => ['nullable', 'string', 'max:2048'],
        ])->validate();

        $authMode = (string) ($validated['auth_mode'] ?? 'registration');
        $useSavedPat = (bool) ($validated['use_saved_pat'] ?? false);
        $savePat = (bool) ($validated['save_pat'] ?? false);

        if ($authMode === 'pat' && $useSavedPat && ! filled($validated['github_app_uuid'] ?? null)) {
            throw ValidationException::withMessages([
                'github_app_uuid' => ['Choisissez une GitHub App pour réutiliser son PAT enregistré.'],
            ]);
        }

        if ($authMode === 'pat' && ! $useSavedPat && ! filled($validated['access_token'] ?? null)) {
            throw ValidationException::withMessages([
                'access_token' => ['Un Personal Access Token GitHub est requis, ou réutilisez un PAT enregistré.'],
            ]);
        }

        if ($authMode === 'registration' && ! filled($validated['github_app_uuid'] ?? null)) {
            throw ValidationException::withMessages([
                'github_app_uuid' => ['Une GitHub App est requise pour générer un jeton d’enregistrement.'],
            ]);
        }

        if ($savePat && ! filled($validated['github_app_uuid'] ?? null)) {
            throw ValidationException::withMessages([
                'github_app_uuid' => ['Choisissez une GitHub App pour y enregistrer le PAT.'],
            ]);
        }

        $githubApp = filled($validated['github_app_uuid'] ?? null)
            ? $this->githubAppCatalog->appForTeam($team, (string) $validated['github_app_uuid'])
            : null;
        $server = $this->serverForTeam($team, $validated['server_uuid']);

        if (! $server->isFunctional()) {
            throw ValidationException::withMessages([
                'server_uuid' => ['Le serveur n’est pas joignable.'],
            ]);
        }

        $containerName = $validated['container_name']
            ?? 'github-runner-'.Str::slug($validated['runner_name'], '-');
        $this->assertValidContainerName($containerName);

        $volumes = collect($validated['volumes'] ?? [])
            ->map(fn ($volume): string => trim((string) $volume))
            ->filter(fn (string $volume): bool => $volume !== '')
            ->values()
            ->all();

        foreach ($volumes as $index => $volume) {
            $this->assertSafeVolumeMount($volume, "volumes.{$index}");
        }

        $extraEnv = collect($validated['extra_env'] ?? [])
            ->map(fn ($entry): array => [
                'key' => strtoupper(trim((string) data_get($entry, 'key', ''))),
                'value' => (string) data_get($entry, 'value', ''),
            ])
            ->filter(fn (array $entry): bool => $entry['key'] !== '')
            ->reject(fn (array $entry): bool => in_array($entry['key'], [
                'REPO_URL',
                'RUNNER_URL',
                'RUNNER_NAME',
                'RUNNER_TOKEN',
                'ACCESS_TOKEN',
                'PAT_TOKEN',
                'RUNNER_SCOPE',
                'LABELS',
                'RUNNER_LABELS',
                'RUNNER_WORKDIR',
                'TZ',
                'RUNNER_REPLACE_EXISTING',
            ], true))
            ->values()
            ->all();

        $exists = $this->containerExists($server, $containerName);
        if ($exists && ! ($validated['recreate'] ?? false)) {
            throw ValidationException::withMessages([
                'container_name' => ["Le conteneur {$containerName} existe déjà sur ce serveur."],
            ]);
        }

        if ($exists && ($validated['recreate'] ?? false)) {
            $this->removeContainer($server, $containerName);
        }

        if ($authMode === 'pat') {
            if ($useSavedPat) {
                $savedPat = trim((string) ($githubApp?->packages_token ?? ''));
                if ($savedPat === '') {
                    throw ValidationException::withMessages([
                        'use_saved_pat' => [
                            'Aucun PAT enregistré sur cette GitHub App. Collez-en un, ou enregistrez-le dans Sources → GitHub.',
                        ],
                    ]);
                }
                $authToken = $savedPat;
            } else {
                $authToken = trim((string) $validated['access_token']);
                if ($savePat && $githubApp) {
                    $this->githubAppCatalog->updatePackagesToken($githubApp, $authToken);
                    $githubApp->refresh();
                }
            }
        } else {
            $registration = $this->githubAppCatalog->registrationToken(
                $githubApp,
                $validated['owner'],
                $validated['repo'],
            );
            $authToken = $registration['token'];
        }

        $repoUrl = 'https://github.com/'.$validated['owner'].'/'.$validated['repo'];
        $image = filled($validated['image'] ?? null) ? (string) $validated['image'] : self::DEFAULT_IMAGE;
        $labels = filled($validated['labels'] ?? null) ? (string) $validated['labels'] : 'self-hosted,devforge';
        $networkMode = filled($validated['network_mode'] ?? null) ? (string) $validated['network_mode'] : 'bridge';
        $timezone = filled($validated['timezone'] ?? null) ? (string) $validated['timezone'] : 'UTC';
        $replaceExisting = array_key_exists('replace_existing', $validated)
            ? (bool) $validated['replace_existing']
            : true;

        $command = $this->buildDockerRunCommand(
            containerName: $containerName,
            image: $image,
            repoUrl: $repoUrl,
            runnerName: $validated['runner_name'],
            authToken: $authToken,
            authMode: $authMode,
            labels: $labels,
            networkMode: $networkMode,
            timezone: $timezone,
            replaceExisting: $replaceExisting,
            volumes: $volumes,
            extraEnv: $extraEnv,
        );

        try {
            instant_remote_process([$command], $server);
        } catch (\Throwable $e) {
            throw ValidationException::withMessages([
                'server_uuid' => ['Échec du démarrage du conteneur runner : '.$e->getMessage()],
            ]);
        }

        // Allow docker a moment before listing the new container.
        usleep(400_000);

        Cache::forget('devforge.github.runners.list.'.$team->id);

        try {
            $runner = $this->show($team, $server->uuid, $containerName);
        } catch (\Throwable) {
            // Container was started; discovery can lag — don't fail the whole create.
            $runner = [
                'id' => $server->uuid.':'.$containerName,
                'name' => $containerName,
                'container_id' => null,
                'image' => $image,
                'state' => 'created',
                'status' => 'Créé (inventaire en cours de synchronisation)',
                'created' => null,
                'server_uuid' => $server->uuid,
                'server_name' => $server->name,
                'repo_url' => $repoUrl,
                'runner_name' => $validated['runner_name'],
                'github_status' => null,
                'github_busy' => null,
                'github_runner_id' => null,
                'github_repo' => $validated['owner'].'/'.$validated['repo'],
                'source' => 'docker',
            ];
        }

        return [
            'message' => 'Runner créé et démarré.',
            'runner' => $runner,
        ];
    }

    /**
     * @return array{ok: bool, message: string, container: string}
     */
    public function destroy(Team $team, string $serverUuid, string $containerName): array
    {
        $server = $this->serverForTeam($team, $serverUuid);
        $this->assertValidContainerName($containerName);
        $this->findRunner($server, $containerName);

        if (! $server->isFunctional()) {
            throw ValidationException::withMessages([
                'server' => ['Le serveur n’est pas joignable.'],
            ]);
        }

        $this->removeContainer($server, $containerName);
        Cache::forget('devforge.github.runners.list.'.$team->id);

        return [
            'ok' => true,
            'message' => 'Runner supprimé.',
            'container' => $containerName,
        ];
    }

    /**
     * @param  array<int, string>  $volumes
     * @param  array<int, array{key: string, value: string}>  $extraEnv
     */
    public function buildDockerRunCommand(
        string $containerName,
        string $image,
        string $repoUrl,
        string $runnerName,
        string $authToken,
        string $authMode = 'registration',
        string $labels = 'self-hosted,devforge',
        string $networkMode = 'bridge',
        string $timezone = 'UTC',
        bool $replaceExisting = true,
        array $volumes = [],
        array $extraEnv = [],
    ): string {
        $parts = [
            'docker run -d',
            '--name '.escapeshellarg($containerName),
            '--restart unless-stopped',
            '--privileged',
            '--network '.escapeshellarg($networkMode),
            '-v /var/run/docker.sock:/var/run/docker.sock',
        ];

        foreach ($volumes as $volume) {
            $parts[] = '-v '.escapeshellarg($volume);
        }

        $parts = [
            ...$parts,
            '-e '.escapeshellarg('REPO_URL='.$repoUrl),
            '-e '.escapeshellarg('RUNNER_URL='.$repoUrl),
            '-e '.escapeshellarg('RUNNER_NAME='.$runnerName),
            '-e '.escapeshellarg('RUNNER_SCOPE=repo'),
            '-e '.escapeshellarg('LABELS='.$labels),
            '-e '.escapeshellarg('RUNNER_LABELS='.$labels),
            '-e '.escapeshellarg('RUNNER_WORKDIR=/tmp/runner/work'),
            '-e '.escapeshellarg('TZ='.$timezone),
            '-e '.escapeshellarg('RUNNER_REPLACE_EXISTING='.($replaceExisting ? 'true' : 'false')),
        ];

        if ($authMode === 'pat') {
            // Classic / fine-grained PAT: popcorn + myoung34 mint a registration token from it.
            $parts[] = '-e '.escapeshellarg('ACCESS_TOKEN='.$authToken);
            $parts[] = '-e '.escapeshellarg('PAT_TOKEN='.$authToken);
        } else {
            // Short-lived registration token (works for myoung34 via RUNNER_TOKEN and popcorn via ACCESS_TOKEN).
            $parts[] = '-e '.escapeshellarg('RUNNER_TOKEN='.$authToken);
            $parts[] = '-e '.escapeshellarg('ACCESS_TOKEN='.$authToken);
            $parts[] = '-e '.escapeshellarg('PAT_TOKEN='.$authToken);
        }

        foreach ($extraEnv as $entry) {
            $parts[] = '-e '.escapeshellarg($entry['key'].'='.$entry['value']);
        }

        $parts = [
            ...$parts,
            '--label '.escapeshellarg('com.devforge.runner=true'),
            '--label '.escapeshellarg('com.devforge.runner.repo_url='.$repoUrl),
            '--label '.escapeshellarg('com.devforge.runner.name='.$runnerName),
            '--label '.escapeshellarg('com.devforge.runner.auth_mode='.$authMode),
            '--label '.escapeshellarg('com.casaos.app_id=github-runners'),
            escapeshellarg($image),
        ];

        return implode(' ', $parts);
    }

    /**
     * @return array{owner: string, repo: string}|null
     */
    public function parseRepoUrl(?string $repoUrl): ?array
    {
        if (! filled($repoUrl)) {
            return null;
        }

        $value = trim((string) $repoUrl);
        if (preg_match('#(?:github\.com[:/]|/)(?P<owner>[^/\s]+)(?:/|:)(?P<repo>[^/\s#?]+?)(?:\.git)?/?$#i', $value, $matches) !== 1) {
            return null;
        }

        return [
            'owner' => $matches['owner'],
            'repo' => rtrim($matches['repo'], '.git'),
        ];
    }

    /**
     * @param  array<string, mixed>  $container
     */
    public function isGithubRunnerContainer(array $container): bool
    {
        $names = $this->containerNameCandidates($container);
        $name = strtolower(implode(' ', $names));
        $image = strtolower((string) data_get($container, 'Image', ''));
        $labels = strtolower((string) data_get($container, 'Labels', ''));

        if ($name === '') {
            return false;
        }

        if (str_contains($name, 'github-runner') || str_contains($name, 'actions-runner')) {
            return true;
        }

        if (str_contains($image, 'github-runner') || str_contains($image, 'github-actions-runner') || str_contains($image, 'actions-runner')) {
            return true;
        }

        if (str_contains($labels, 'github-runners') || str_contains($labels, 'github.actions.runner') || str_contains($labels, 'com.devforge.runner=true')) {
            return true;
        }

        foreach ($names as $candidate) {
            if (preg_match('/(^|[.-])runner($|[.-])/', strtolower($candidate)) === 1 && (
                str_contains($image, 'runner') || str_contains($labels, 'runner')
            )) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  Collection<int, array<string, mixed>>  $runners
     * @return Collection<int, array<string, mixed>>
     */
    public function enrichWithGithubStatus(Team $team, Collection $runners, bool $allowColdFetch = true): Collection
    {
        $apps = $this->githubAppCatalog->appsForTeam($team);
        if ($apps->isEmpty()) {
            return $runners->map(fn (array $runner): array => $this->withEmptyGithubFields($runner));
        }

        $repoCache = [];

        return $runners->map(function (array $runner) use ($apps, &$repoCache, $allowColdFetch): array {
            $parsed = $this->parseRepoUrl($runner['repo_url'] ?? null);
            if ($parsed === null) {
                return $this->withEmptyGithubFields($runner);
            }

            $cacheKey = strtolower($parsed['owner'].'/'.$parsed['repo']);
            if (! array_key_exists($cacheKey, $repoCache)) {
                $repoCache[$cacheKey] = $this->fetchGithubRunnersForRepo(
                    $apps,
                    $parsed['owner'],
                    $parsed['repo'],
                    $allowColdFetch,
                );
            }

            $githubRunners = collect($repoCache[$cacheKey])
                ->filter(fn ($githubRunner): bool => is_array($githubRunner))
                ->values();

            $match = $githubRunners->first(function (array $githubRunner) use ($runner): bool {
                $localName = strtolower((string) ($runner['runner_name'] ?? $runner['name'] ?? ''));
                $remoteName = strtolower((string) ($githubRunner['name'] ?? ''));

                return $localName !== '' && $remoteName !== '' && $localName === $remoteName;
            });

            if (! is_array($match)) {
                return [
                    ...$this->withEmptyGithubFields($runner),
                    'github_repo' => $parsed['owner'].'/'.$parsed['repo'],
                ];
            }

            $status = strtolower((string) ($match['status'] ?? 'offline'));
            if (($match['busy'] ?? false) === true) {
                $status = 'busy';
            }

            return [
                ...$runner,
                'github_status' => $status,
                'github_busy' => (bool) ($match['busy'] ?? false),
                'github_runner_id' => (int) ($match['id'] ?? 0) ?: null,
                'github_labels' => is_array($match['labels'] ?? null) ? $match['labels'] : [],
                'github_repo' => $parsed['owner'].'/'.$parsed['repo'],
                'source' => 'both',
            ];
        });
    }

    /**
     * @param  Collection<int, \App\Models\GithubApp>  $apps
     * @return array<int, array<string, mixed>>
     */
    private function fetchGithubRunnersForRepo(Collection $apps, string $owner, string $repo, bool $allowColdFetch = true): array
    {
        $cacheKey = 'devforge.github.runners.'.strtolower($owner.'/'.$repo);

        if (! $allowColdFetch) {
            $cached = Cache::get($cacheKey);

            return is_array($cached) ? $cached : [];
        }

        try {
            /** @var array<int, array<string, mixed>> $cached */
            $cached = Cache::remember($cacheKey, now()->addSeconds(45), function () use ($apps, $owner, $repo): array {
                foreach ($apps as $app) {
                    try {
                        return $this->githubAppCatalog->runners($app, $owner, $repo);
                    } catch (\Throwable) {
                        continue;
                    }
                }

                return [];
            });

            return is_array($cached) ? $cached : [];
        } catch (\Throwable) {
            return [];
        }
    }

    /**
     * @param  array<string, mixed>  $runner
     * @return array<string, mixed>
     */
    private function withEmptyGithubFields(array $runner): array
    {
        return [
            ...$runner,
            'github_status' => null,
            'github_busy' => null,
            'github_runner_id' => null,
            'github_labels' => [],
            'github_repo' => null,
            'source' => 'docker',
        ];
    }

    /**
     * @return Collection<int, Server>
     */
    private function serversForTeam(Team $team): Collection
    {
        return Server::query()
            ->with('settings')
            ->where('team_id', $team->id)
            ->orderBy('name')
            ->get();
    }

    private function serverForTeam(Team $team, string $serverUuid): Server
    {
        $server = Server::query()
            ->where('team_id', $team->id)
            ->where('uuid', $serverUuid)
            ->first();

        if (! $server) {
            throw (new ModelNotFoundException)->setModel(Server::class, [$serverUuid]);
        }

        return $server;
    }

    /**
     * @return Collection<int, array<string, mixed>>
     */
    private function runnersOnServer(Server $server, bool $enrichEnv = true): Collection
    {
        try {
            if (! $server->isFunctional()) {
                return collect([]);
            }

            $containers = $this->loadRunnerContainers($server);
        } catch (\Throwable) {
            return collect([]);
        }

        return $containers
            ->filter(fn ($container): bool => is_array($container) && $this->isGithubRunnerContainer($container))
            ->map(function (array $container) use ($server, $enrichEnv): array {
                $runner = $this->presentContainer($server, $container);

                if (! $enrichEnv) {
                    return $runner;
                }

                $environment = $this->safeEnvironment($server, $runner['name']);

                return [
                    ...$runner,
                    'repo_url' => $runner['repo_url'] ?? $this->envValue($environment, 'REPO_URL'),
                    'runner_name' => $this->envValue($environment, 'RUNNER_NAME') ?? $runner['runner_name'],
                ];
            })
            ->values();
    }

    /**
     * Prefer filtered docker queries to avoid shipping the full container list over SSH.
     *
     * @return Collection<int, array<string, mixed>>
     */
    private function loadRunnerContainers(Server $server): Collection
    {
        $command = implode(' ; ', [
            "docker ps -a --filter name=github-runner --format '{{json .}}'",
            "docker ps -a --filter name=actions-runner --format '{{json .}}'",
            "docker ps -a --filter label=com.casaos.app_id=github-runners --format '{{json .}}'",
            "docker ps -a --filter label=com.devforge.runner=true --format '{{json .}}'",
        ]);

        $raw = instant_remote_process([$command], $server, false, false, 12);
        $containers = format_docker_command_output_to_json(is_string($raw) ? $raw : '');

        return collect($containers)
            ->filter(fn ($container): bool => is_array($container))
            ->unique(fn (array $container): string => (string) data_get($container, 'ID', data_get($container, 'Id', data_get($container, 'Names', ''))))
            ->values();
    }

    /**
     * @return array<string, mixed>
     */
    private function findRunner(Server $server, string $containerName, bool $refresh = false): array
    {
        $this->assertValidContainerName($containerName);

        if (! $server->isFunctional()) {
            throw ValidationException::withMessages([
                'server' => ['Le serveur n’est pas joignable.'],
            ]);
        }

        try {
            $match = $this->loadRunnerContainers($server)->first(function ($container) use ($containerName): bool {
                if (! is_array($container)) {
                    return false;
                }

                return $this->containerNamesMatch($container, $containerName)
                    && $this->isGithubRunnerContainer($container);
            });
        } catch (\Throwable) {
            $match = null;
        }

        if (! is_array($match)) {
            $match = $this->inspectRunnerContainer($server, $containerName);
        }

        if (! is_array($match)) {
            throw (new ModelNotFoundException)->setModel('GithubRunner', [$containerName]);
        }

        unset($refresh);

        return $this->presentContainer($server, $match);
    }

    private function containerExists(Server $server, string $containerName): bool
    {
        try {
            $containers = $this->loadRunnerContainers($server);
        } catch (\Throwable) {
            return $this->containerExistsByName($server, $containerName);
        }

        return $containers->contains(function ($container) use ($containerName): bool {
            if (! is_array($container)) {
                return false;
            }

            return $this->containerNamesMatch($container, $containerName);
        }) || $this->containerExistsByName($server, $containerName);
    }

    private function containerExistsByName(Server $server, string $containerName): bool
    {
        try {
            $raw = instant_remote_process([
                'docker inspect '.escapeshellarg($containerName).' --format "{{.Id}}"',
            ], $server, false, false, 8);
        } catch (\Throwable) {
            return false;
        }

        return is_string($raw) && trim($raw) !== '';
    }

    /**
     * @return array<string, mixed>|null
     */
    private function inspectRunnerContainer(Server $server, string $containerName): ?array
    {
        try {
            $raw = instant_remote_process([
                'docker ps -a --filter name='.escapeshellarg($containerName)." --format '{{json .}}'",
            ], $server, false, false, 10);
            $containers = format_docker_command_output_to_json(is_string($raw) ? $raw : '');
        } catch (\Throwable) {
            return null;
        }

        $match = $containers->first(function ($container) use ($containerName): bool {
            return is_array($container)
                && $this->containerNamesMatch($container, $containerName)
                && $this->isGithubRunnerContainer($container);
        });

        return is_array($match) ? $match : null;
    }

    /**
     * @param  array<string, mixed>  $container
     */
    private function containerNamesMatch(array $container, string $containerName): bool
    {
        $needle = strtolower($this->normalizeContainerName($containerName));

        foreach ($this->containerNameCandidates($container) as $candidate) {
            if (strtolower($candidate) === $needle) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array<string, mixed>  $container
     * @return array<int, string>
     */
    private function containerNameCandidates(array $container): array
    {
        $raw = (string) data_get($container, 'Names', data_get($container, 'Name', ''));

        return collect(preg_split('/[,\s]+/', $raw) ?: [])
            ->map(fn (string $name): string => $this->normalizeContainerName($name))
            ->filter(fn (string $name): bool => $name !== '')
            ->values()
            ->all();
    }

    /**
     * @param  array<string, mixed>  $container
     * @return array<string, mixed>
     */
    private function presentContainer(Server $server, array $container): array
    {
        $candidates = $this->containerNameCandidates($container);
        $name = $candidates[0] ?? $this->normalizeContainerName((string) data_get($container, 'Names', data_get($container, 'Name', '')));
        $state = strtolower((string) data_get($container, 'State', ''));
        $status = (string) data_get($container, 'Status', $state);
        $labels = (string) data_get($container, 'Labels', '');

        return [
            'id' => $server->uuid.':'.$name,
            'name' => $name,
            'container_id' => (string) data_get($container, 'ID', data_get($container, 'Id', '')),
            'image' => (string) data_get($container, 'Image', ''),
            'state' => $state !== '' ? $state : $this->inferStateFromStatus($status),
            'status' => $status,
            'created' => (string) data_get($container, 'CreatedAt', data_get($container, 'Created', '')),
            'server_uuid' => $server->uuid,
            'server_name' => $server->name,
            'repo_url' => $this->extractLabelValue($labels, 'repo_url')
                ?? $this->extractLabelValue($labels, 'com.devforge.runner.repo_url'),
            'runner_name' => $this->extractLabelValue($labels, 'runner_name')
                ?? $this->extractLabelValue($labels, 'com.devforge.runner.name')
                ?? $name,
        ];
    }

    /**
     * @param  array<int, array{key: string, value: string}>  $environment
     */
    private function envValue(array $environment, string $key): ?string
    {
        foreach ($environment as $entry) {
            if (strcasecmp($entry['key'], $key) === 0) {
                $value = trim($entry['value']);
                if ($value === '' || $value === '••••••••') {
                    return null;
                }

                return $value;
            }
        }

        return null;
    }

    /**
     * @return array<int, array{key: string, value: string}>
     */
    private function safeEnvironment(Server $server, string $containerName): array
    {
        try {
            $raw = instant_remote_process([
                'docker inspect '.escapeshellarg($containerName)." --format '{{range .Config.Env}}{{println .}}{{end}}'",
            ], $server, false);
        } catch (\Throwable) {
            return [];
        }

        if (! is_string($raw) || blank($raw)) {
            return [];
        }

        return collect(preg_split("/\r\n|\n|\r/", $raw) ?: [])
            ->map(fn (string $line): string => trim($line))
            ->filter(fn (string $line): bool => $line !== '' && str_contains($line, '='))
            ->map(function (string $line): array {
                [$key, $value] = explode('=', $line, 2);
                $key = trim($key);

                return [
                    'key' => $key,
                    'value' => $this->isSensitiveEnvKey($key)
                        ? '••••••••'
                        : (function_exists('sanitize_utf8_text') ? sanitize_utf8_text($value) : $value),
                ];
            })
            ->filter(fn (array $entry): bool => $entry['key'] !== '')
            ->values()
            ->all();
    }

    private function isSensitiveEnvKey(string $key): bool
    {
        $upper = strtoupper($key);

        foreach (self::SENSITIVE_ENV_KEYS as $needle) {
            if ($upper === $needle || str_ends_with($upper, '_'.$needle)) {
                return true;
            }
        }

        return false;
    }

    private function normalizeContainerName(string $name): string
    {
        return ltrim(trim($name), '/');
    }

    private function inferStateFromStatus(string $status): string
    {
        $lower = strtolower($status);

        return match (true) {
            str_starts_with($lower, 'up') => 'running',
            str_starts_with($lower, 'exited') => 'exited',
            str_starts_with($lower, 'created') => 'created',
            str_starts_with($lower, 'restarting') => 'restarting',
            str_starts_with($lower, 'paused') => 'paused',
            str_starts_with($lower, 'dead') => 'dead',
            default => $lower !== '' ? $lower : 'unknown',
        };
    }

    private function extractLabelValue(string $labels, string $key): ?string
    {
        if ($labels === '') {
            return null;
        }

        foreach (explode(',', $labels) as $pair) {
            $parts = explode('=', $pair, 2);
            if (count($parts) !== 2) {
                continue;
            }

            if (strcasecmp(trim($parts[0]), $key) === 0) {
                $value = trim($parts[1]);

                return $value !== '' ? $value : null;
            }
        }

        return null;
    }

    private function assertValidContainerName(string $name): void
    {
        if (! ValidationPatterns::isValidContainerName($name)) {
            throw ValidationException::withMessages([
                'container' => ['Nom de conteneur invalide.'],
            ]);
        }
    }

    private function assertSafeVolumeMount(string $volume, string $field): void
    {
        $parts = explode(':', $volume);
        if (count($parts) < 2 || count($parts) > 3) {
            throw ValidationException::withMessages([
                $field => ['Volume invalide. Format attendu : /host/path:/container/path[:ro|rw].'],
            ]);
        }

        [$host, $container] = $parts;
        $mode = $parts[2] ?? null;

        if ($host === '' || $container === '' || ! str_starts_with($host, '/') || ! str_starts_with($container, '/')) {
            throw ValidationException::withMessages([
                $field => ['Les chemins host et conteneur doivent être absolus.'],
            ]);
        }

        if (str_contains($host, '..') || str_contains($container, '..')) {
            throw ValidationException::withMessages([
                $field => ['Les chemins de volume ne doivent pas contenir « .. ».'],
            ]);
        }

        if ($mode !== null && ! in_array($mode, ['ro', 'rw'], true)) {
            throw ValidationException::withMessages([
                $field => ['Mode de volume invalide. Utilisez ro ou rw.'],
            ]);
        }

        $forbiddenPrefixes = ['/etc', '/root', '/boot', '/proc', '/sys', '/dev', '/var/run'];
        foreach ($forbiddenPrefixes as $prefix) {
            if ($host === $prefix || str_starts_with($host, $prefix.'/')) {
                throw ValidationException::withMessages([
                    $field => ["Le montage de {$prefix} est interdit."],
                ]);
            }
        }
    }

    private function removeContainer(Server $server, string $containerName): void
    {
        try {
            instant_remote_process([
                'docker rm -f '.escapeshellarg($containerName),
            ], $server);
        } catch (\Throwable $e) {
            throw ValidationException::withMessages([
                'container' => ['Impossible de supprimer le conteneur : '.$e->getMessage()],
            ]);
        }
    }

    /**
     * @return array<int, array{cursor: int, message: string}>
     */
    private function parseLines(string $rawLogs): array
    {
        if (blank($rawLogs)) {
            return [];
        }

        return collect(preg_split("/\r\n|\n|\r/", $rawLogs) ?: [])
            ->values()
            ->map(fn (string $line, int $index): array => [
                'cursor' => $index + 1,
                'message' => function_exists('sanitize_utf8_text') ? sanitize_utf8_text($line) : $line,
            ])
            ->all();
    }

    /**
     * @return array<string, mixed>
     */
    private function unavailableLogs(string $container, string $reason, string $message): array
    {
        return [
            'available' => false,
            'reason' => $reason,
            'message' => $message,
            'container' => $container,
            'container_status' => null,
            'line_count' => 0,
            'items' => [],
        ];
    }
}
