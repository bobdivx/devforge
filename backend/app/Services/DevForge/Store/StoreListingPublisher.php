<?php

namespace App\Services\DevForge\Store;

use App\Models\Application;
use App\Models\StoreListing;
use App\Models\Team;
use App\Rules\ValidGitBranch;
use App\Services\DevForge\Application\ApplicationEnvironmentVariableCatalog;
use App\Services\DevForge\Application\ApplicationRuntimeSettingsService;
use App\Support\ValidationPatterns;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class StoreListingPublisher
{
    /**
     * @var list<string>
     */
    private const SECRET_KEY_HINTS = [
        'SECRET',
        'PASSWORD',
        'TOKEN',
        'PRIVATE',
        'CREDENTIAL',
        'API_KEY',
    ];

    public function __construct(
        private readonly ApplicationEnvironmentVariableCatalog $environmentVariableCatalog,
        private readonly ApplicationRuntimeSettingsService $runtimeSettingsService,
    ) {}

    /**
     * @return array{
     *     publishable: bool,
     *     reason: string|null,
     *     listing: array<string, mixed>|null,
     *     suggested_slug: string,
     *     suggested_name: string,
     *     git_repository: string|null,
     *     git_branch: string|null,
     *     runtime_defaults: array<string, mixed>,
     *     environment_variables: array<int, array<string, mixed>>
     * }
     */
    public function preview(Application $application): array
    {
        $application->loadMissing(['settings', 'environment.project']);

        $listing = StoreListing::query()
            ->where('source_application_id', $application->id)
            ->first();

        $reason = $this->unpublishedReason($application);
        $runtimeDefaults = $this->runtimeSettingsService->present($application);
        unset($runtimeDefaults['supports_static_toggle']);

        return [
            'publishable' => $reason === null,
            'reason' => $reason,
            'listing' => $listing instanceof StoreListing ? $this->presentListing($listing, owned: true) : null,
            'suggested_slug' => $this->uniqueSlug(Str::slug($application->name) ?: 'app'),
            'suggested_name' => $application->name,
            'git_repository' => $this->normalizeGitRepository((string) $application->git_repository),
            'git_branch' => $application->git_branch,
            'runtime_defaults' => $runtimeDefaults,
            'environment_variables' => $this->previewEnvironmentVariables($application),
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     */
    public function publish(Team $team, Application $application, array $input): StoreListing
    {
        $reason = $this->unpublishedReason($application);
        if ($reason !== null) {
            throw ValidationException::withMessages([
                'application' => $reason,
            ]);
        }

        $listing = StoreListing::query()->where('source_application_id', $application->id)->first();
        $validated = $this->validateListingInput($input, $application, listing: $listing);
        $payload = $this->listingPayload($team, $application, $validated, $listing);

        if ($listing instanceof StoreListing) {
            abort_unless($listing->isOwnedBy($team), 403, 'Cette fiche Store appartient à une autre équipe.');
            $listing->fill($payload);
            $listing->status = StoreListing::STATUS_PUBLISHED;
            $listing->save();

            return $listing->fresh(['team']) ?? $listing;
        }

        return StoreListing::query()->create($payload)->load('team');
    }

    /**
     * @param  array<string, mixed>  $input
     */
    public function update(Team $team, StoreListing $listing, array $input): StoreListing
    {
        abort_unless($listing->isOwnedBy($team), 403, 'Cette fiche Store appartient à une autre équipe.');

        $application = $listing->sourceApplication;
        $validated = $this->validateListingInput($input, $application, updating: true, listing: $listing);
        $listing->fill($this->updatePayload($validated, $application));
        $listing->save();

        return $listing->fresh(['team']) ?? $listing;
    }

    public function unpublish(Team $team, StoreListing $listing): StoreListing
    {
        abort_unless($listing->isOwnedBy($team), 403, 'Cette fiche Store appartient à une autre équipe.');

        $listing->status = StoreListing::STATUS_UNPUBLISHED;
        $listing->save();

        return $listing->fresh(['team']) ?? $listing;
    }

    /**
     * @return array<string, mixed>
     */
    public function presentListing(StoreListing $listing, bool $owned): array
    {
        $listing->loadMissing('team');

        return [
            'uuid' => $listing->uuid,
            'slug' => $listing->slug,
            'name' => $listing->name,
            'description' => $listing->description,
            'category' => $listing->category,
            'icon_url' => $listing->icon_url,
            'website_url' => $listing->website_url,
            'git_repository' => $listing->git_repository,
            'git_branch' => $listing->git_branch,
            'git_commit_sha' => $owned ? $listing->git_commit_sha : null,
            'runtime_defaults' => $listing->runtime_defaults ?? [],
            'env_schema' => $this->presentEnvSchema($listing->env_schema ?? [], includeDefaults: true),
            'status' => $listing->status,
            'install_count' => $listing->install_count,
            'owned' => $owned,
            'publisher' => [
                'team_name' => $listing->team?->name,
            ],
            'created_at' => $listing->created_at?->toIso8601String(),
            'updated_at' => $listing->updated_at?->toIso8601String(),
        ];
    }

    public function unpublishedReason(Application $application): ?string
    {
        if (! $application->isRunning()) {
            return 'L’application doit être en cours d’exécution pour être publiée sur le Store.';
        }

        $repository = $this->normalizeGitRepository((string) $application->git_repository);
        if ($repository === null || $repository === '' || preg_match('/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/', $repository) !== 1) {
            return 'L’application doit avoir un dépôt Git (owner/repo) pour être publiée.';
        }

        if (! filled($application->git_branch)) {
            return 'L’application doit avoir une branche Git pour être publiée.';
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    private function validateListingInput(array $input, ?Application $application, bool $updating = false, ?StoreListing $listing = null): array
    {
        $slugRule = Rule::unique('store_listings', 'slug');
        if ($listing instanceof StoreListing) {
            $slugRule = $slugRule->ignore($listing->id);
        }

        $validated = validator($input, [
            'name' => [$updating ? 'sometimes' : 'required', 'string', 'max:255'],
            'slug' => [$updating ? 'sometimes' : 'nullable', 'string', 'max:80', 'regex:/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $slugRule],
            'description' => ['nullable', 'string', 'max:4000'],
            'category' => ['nullable', 'string', Rule::in(StoreListing::CATEGORIES)],
            'icon_url' => ['nullable', 'string', 'max:2048'],
            'website_url' => ['nullable', 'string', 'max:2048'],
            'git_branch' => ['nullable', 'string', new ValidGitBranch],
            'runtime_defaults' => ['nullable', 'array'],
            'runtime_defaults.build_pack' => ['nullable', 'string', Rule::in(['nixpacks', 'railpack', 'static', 'dockerfile', 'dockercompose', 'dockerimage'])],
            'runtime_defaults.is_static' => ['nullable', 'boolean'],
            'runtime_defaults.start_command' => ['nullable', 'string', 'max:1000'],
            'runtime_defaults.install_command' => ['nullable', 'string', 'max:1000'],
            'runtime_defaults.build_command' => ['nullable', 'string', 'max:1000'],
            'runtime_defaults.ports_exposes' => ['nullable', 'string', 'max:100', 'regex:/^(\d+)(,\d+)*$/'],
            'runtime_defaults.base_directory' => ['nullable', 'string', 'max:255'],
            'runtime_defaults.publish_directory' => ['nullable', 'string', 'max:255'],
            'runtime_defaults.detected_framework' => ['nullable', 'string', 'max:64'],
            'runtime_defaults.health_check_enabled' => ['nullable', 'boolean'],
            'runtime_defaults.health_check_type' => ['nullable', 'string', Rule::in(['http', 'cmd'])],
            'runtime_defaults.health_check_path' => ['nullable', 'string', 'max:255'],
            'runtime_defaults.health_check_port' => ['nullable', 'string', 'max:10'],
            'env_schema' => ['nullable', 'array', 'max:200'],
            'env_schema.*.key' => ValidationPatterns::environmentVariableKeyRules(),
            'env_schema.*.included' => ['sometimes', 'boolean'],
            'env_schema.*.is_secret' => ['sometimes', 'boolean'],
            'env_schema.*.required' => ['sometimes', 'boolean'],
            'env_schema.*.default' => ['nullable', 'string', 'max:8192'],
            'env_schema.*.description' => ['nullable', 'string', 'max:256'],
            'env_schema.*.is_runtime' => ['sometimes', 'boolean'],
            'env_schema.*.is_buildtime' => ['sometimes', 'boolean'],
        ], ValidationPatterns::environmentVariableKeyMessages('env_schema.*.key'))->validate();

        if ($application instanceof Application) {
            $allowedKeys = collect($this->previewEnvironmentVariables($application))->pluck('key');
            foreach ($validated['env_schema'] ?? [] as $index => $item) {
                if (! $allowedKeys->contains($item['key'])) {
                    throw ValidationException::withMessages([
                        "env_schema.{$index}.key" => "La variable {$item['key']} n’existe pas sur cette application.",
                    ]);
                }
            }
        }

        return $validated;
    }

    /**
     * @param  array<string, mixed>  $validated
     * @return array<string, mixed>
     */
    private function listingPayload(Team $team, Application $application, array $validated, ?StoreListing $existing = null): array
    {
        $name = trim((string) $validated['name']);
        $slug = filled($validated['slug'] ?? null)
            ? (string) $validated['slug']
            : ($existing?->slug ?? $this->uniqueSlug(Str::slug($name) ?: 'app'));

        return [
            'name' => $name,
            'slug' => $slug,
            'description' => $this->nullableTrim($validated['description'] ?? null),
            'category' => $validated['category'] ?? 'other',
            'icon_url' => $this->nullableTrim($validated['icon_url'] ?? null),
            'website_url' => $this->nullableTrim($validated['website_url'] ?? null),
            'team_id' => $team->id,
            'source_application_id' => $application->id,
            'git_repository' => (string) $this->normalizeGitRepository((string) $application->git_repository),
            'git_branch' => filled($validated['git_branch'] ?? null)
                ? (string) $validated['git_branch']
                : (string) $application->git_branch,
            'git_commit_sha' => $application->git_commit_sha,
            'runtime_defaults' => $this->normalizeRuntimeDefaults(
                $validated['runtime_defaults'] ?? null,
                $application,
            ),
            'env_schema' => $this->normalizeEnvSchema($validated['env_schema'] ?? []),
            'status' => StoreListing::STATUS_PUBLISHED,
        ];
    }

    /**
     * @param  array<string, mixed>  $validated
     * @return array<string, mixed>
     */
    private function updatePayload(array $validated, ?Application $application): array
    {
        $payload = [];

        foreach (['name', 'slug', 'description', 'category', 'icon_url', 'website_url', 'git_branch'] as $field) {
            if (array_key_exists($field, $validated)) {
                $payload[$field] = in_array($field, ['description', 'icon_url', 'website_url'], true)
                    ? $this->nullableTrim($validated[$field])
                    : $validated[$field];
            }
        }

        if (array_key_exists('runtime_defaults', $validated)) {
            $payload['runtime_defaults'] = $this->normalizeRuntimeDefaults(
                $validated['runtime_defaults'],
                $application,
            );
        }

        if (array_key_exists('env_schema', $validated)) {
            $payload['env_schema'] = $this->normalizeEnvSchema($validated['env_schema'] ?? []);
        }

        return $payload;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function previewEnvironmentVariables(Application $application): array
    {
        return collect($this->environmentVariableCatalog->list($application)['production'])
            ->filter(fn (array $variable): bool => (bool) ($variable['is_editable'] ?? false))
            ->map(function (array $variable): array {
                $key = (string) $variable['key'];
                $secret = $this->looksLikeSecret($key);

                return [
                    'key' => $key,
                    'has_value' => (bool) ($variable['has_value'] ?? false),
                    'is_secret' => $secret,
                    'included' => ! $secret,
                    'required' => $secret,
                    'default' => null,
                    'description' => $variable['comment'],
                    'is_runtime' => (bool) ($variable['is_runtime'] ?? true),
                    'is_buildtime' => (bool) ($variable['is_buildtime'] ?? true),
                ];
            })
            ->values()
            ->all();
    }

    /**
     * @param  array<int, mixed>  $items
     * @return array<int, array<string, mixed>>
     */
    private function normalizeEnvSchema(array $items): array
    {
        $schema = [];

        foreach ($items as $item) {
            if (! is_array($item)) {
                continue;
            }

            if (array_key_exists('included', $item) && ! (bool) $item['included']) {
                continue;
            }

            $isSecret = (bool) ($item['is_secret'] ?? $this->looksLikeSecret((string) $item['key']));

            $schema[] = [
                'key' => $item['key'],
                'is_secret' => $isSecret,
                'required' => (bool) ($item['required'] ?? $isSecret),
                'default' => $isSecret ? null : $this->nullableTrim($item['default'] ?? null),
                'description' => $this->nullableTrim($item['description'] ?? null),
                'is_runtime' => (bool) ($item['is_runtime'] ?? true),
                'is_buildtime' => (bool) ($item['is_buildtime'] ?? true),
            ];
        }

        return $schema;
    }

    /**
     * @param  array<int, mixed>  $schema
     * @return array<int, array<string, mixed>>
     */
    private function presentEnvSchema(array $schema, bool $includeDefaults): array
    {
        return collect($schema)
            ->filter(fn (mixed $item): bool => is_array($item) && filled($item['key'] ?? null))
            ->map(function (array $item) use ($includeDefaults): array {
                $isSecret = (bool) ($item['is_secret'] ?? false);

                return [
                    'key' => $item['key'],
                    'is_secret' => $isSecret,
                    'required' => (bool) ($item['required'] ?? false),
                    'default' => ($includeDefaults && ! $isSecret) ? ($item['default'] ?? null) : null,
                    'has_default' => ! $isSecret && filled($item['default'] ?? null),
                    'description' => $item['description'] ?? null,
                    'is_runtime' => (bool) ($item['is_runtime'] ?? true),
                    'is_buildtime' => (bool) ($item['is_buildtime'] ?? true),
                ];
            })
            ->values()
            ->all();
    }

    /**
     * @param  array<string, mixed>|null  $overrides
     * @return array<string, mixed>
     */
    private function normalizeRuntimeDefaults(?array $overrides, ?Application $application): array
    {
        $base = $application instanceof Application
            ? $this->runtimeSettingsService->present($application)
            : [];
        unset($base['supports_static_toggle']);

        $merged = array_merge($base, $overrides ?? []);

        return [
            'build_pack' => $merged['build_pack'] ?? 'nixpacks',
            'is_static' => (bool) ($merged['is_static'] ?? false),
            'start_command' => $this->nullableTrim($merged['start_command'] ?? null),
            'install_command' => $this->nullableTrim($merged['install_command'] ?? null),
            'build_command' => $this->nullableTrim($merged['build_command'] ?? null),
            'ports_exposes' => (string) ($merged['ports_exposes'] ?? '3000'),
            'base_directory' => (string) ($merged['base_directory'] ?? '/'),
            'publish_directory' => (string) ($merged['publish_directory'] ?? '/'),
            'detected_framework' => $this->nullableTrim($merged['detected_framework'] ?? null),
            'health_check_enabled' => (bool) ($merged['health_check_enabled'] ?? true),
            'health_check_type' => $merged['health_check_type'] ?? 'http',
            'health_check_path' => (string) ($merged['health_check_path'] ?? '/'),
            'health_check_port' => $this->nullableTrim($merged['health_check_port'] ?? null),
        ];
    }

    public function uniqueSlug(string $base): string
    {
        $slug = $base !== '' ? $base : 'app';
        $candidate = $slug;
        $suffix = 2;

        while (StoreListing::query()->where('slug', $candidate)->exists()) {
            $candidate = $slug.'-'.$suffix;
            $suffix++;
        }

        return $candidate;
    }

    public function normalizeGitRepository(string $repository): ?string
    {
        $trimmed = trim($repository);
        if ($trimmed === '') {
            return null;
        }

        if (preg_match('#github\.com[:/](?P<repo>[^/]+/[^/]+?)(?:\.git)?/?$#i', $trimmed, $matches) === 1) {
            return $matches['repo'];
        }

        if (preg_match('/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/', $trimmed) === 1) {
            return $trimmed;
        }

        return $trimmed;
    }

    public function looksLikeSecret(string $key): bool
    {
        if (str_starts_with($key, 'NEXT_PUBLIC_') || str_starts_with($key, 'PUBLIC_') || str_starts_with($key, 'VITE_')) {
            return false;
        }

        foreach (self::SECRET_KEY_HINTS as $hint) {
            if (str_contains(strtoupper($key), $hint)) {
                return true;
            }
        }

        return str_ends_with(strtoupper($key), '_KEY');
    }

    private function nullableTrim(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $trimmed = trim((string) $value);

        return $trimmed === '' ? null : $trimmed;
    }
}
