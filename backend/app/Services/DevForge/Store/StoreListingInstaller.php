<?php

namespace App\Services\DevForge\Store;

use App\Enums\BuildPackTypes;
use App\Models\StoreListing;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Application\ApplicationEnvironmentVariableCatalog;
use App\Services\DevForge\Application\ApplicationFromGithubCreator;
use App\Services\DevForge\Application\ApplicationRuntimeSettingsService;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Visus\Cuid2\Cuid2;

class StoreListingInstaller
{
    public function __construct(
        private readonly ApplicationFromGithubCreator $applicationFromGithubCreator,
        private readonly ApplicationRuntimeSettingsService $runtimeSettingsService,
        private readonly ApplicationEnvironmentVariableCatalog $environmentVariableCatalog,
    ) {}

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     application: \App\Models\Application,
     *     listing: StoreListing,
     *     instant_deploy: bool,
     *     env_import: array{created: int, updated: int, skipped: array<int, array{key: string, reason: string}>}|null
     * }
     */
    public function install(User $user, Team $team, StoreListing $listing, array $input): array
    {
        abort_unless(
            $listing->isPublished() || $listing->isOwnedBy($team),
            404,
            'Fiche Store introuvable.',
        );

        $defaults = is_array($listing->runtime_defaults) ? $listing->runtime_defaults : [];
        $schema = is_array($listing->env_schema) ? $listing->env_schema : [];
        $provided = is_array($input['env_values'] ?? null) ? $input['env_values'] : [];

        $this->assertRequiredEnvValues($schema, $provided);

        $buildPack = (string) ($defaults['build_pack'] ?? BuildPackTypes::NIXPACKS->value);
        $portsExposes = $this->firstPort((string) ($defaults['ports_exposes'] ?? '3000'));
        $instantDeploy = (bool) ($input['instant_deploy'] ?? true);

        $createInput = [
            'project_uuid' => $input['project_uuid'] ?? null,
            'environment_uuid' => $input['environment_uuid'] ?? null,
            'destination_uuid' => $input['destination_uuid'] ?? null,
            'github_app_uuid' => $input['github_app_uuid'] ?? null,
            'git_repository' => $listing->git_repository,
            'git_branch' => $listing->git_branch,
            'build_pack' => $buildPack,
            'ports_exposes' => $portsExposes,
            'name' => filled($input['name'] ?? null) ? trim((string) $input['name']) : $listing->name,
            'instant_deploy' => false,
            'domains' => $input['domains'] ?? null,
        ];

        $result = $this->applicationFromGithubCreator->create($user, $team, $createInput);
        $application = $result['application'];

        $runtimeUpdate = $defaults;
        $runtimeUpdate['redeploy'] = false;
        $this->runtimeSettingsService->update($application, $runtimeUpdate);

        $created = 0;
        $updated = 0;
        foreach ($schema as $item) {
            if (! is_array($item) || ! filled($item['key'] ?? null)) {
                continue;
            }

            $key = (string) $item['key'];
            $isSecret = (bool) ($item['is_secret'] ?? false);
            $value = array_key_exists($key, $provided)
                ? (string) $provided[$key]
                : ($isSecret ? null : ($item['default'] ?? null));

            if ($value === null || $value === '') {
                continue;
            }

            $existing = $application->environment_variables()->where('key', $key)->exists();
            $this->environmentVariableCatalog->upsert($application, [
                'key' => $key,
                'value' => $value,
                'is_preview' => false,
                'is_runtime' => (bool) ($item['is_runtime'] ?? true),
                'is_buildtime' => (bool) ($item['is_buildtime'] ?? true),
                'comment' => is_string($item['description'] ?? null) ? $item['description'] : null,
            ]);
            if ($existing) {
                $updated++;
            } else {
                $created++;
            }
        }

        DB::transaction(function () use ($listing, $team, $application, $user): void {
            $listing->installs()->create([
                'team_id' => $team->id,
                'application_id' => $application->id,
                'installed_by' => $user->id,
            ]);
            $listing->increment('install_count');
        });

        if ($instantDeploy) {
            queue_application_deployment(
                application: $application->fresh() ?? $application,
                deployment_uuid: new Cuid2,
                no_questions_asked: true,
                is_api: true,
            );
        }

        auditLog('devforge.store.installed', [
            'team_id' => $team->id,
            'listing_uuid' => $listing->uuid,
            'listing_slug' => $listing->slug,
            'application_uuid' => $application->uuid,
            'user_id' => $user->id,
            'instant_deploy' => $instantDeploy,
        ]);

        return [
            'application' => $application->fresh(['environment.project', 'destination.server']) ?? $application,
            'listing' => $listing->fresh() ?? $listing,
            'instant_deploy' => $instantDeploy,
            'env_import' => [
                'created' => $created,
                'updated' => $updated,
                'skipped' => [],
            ],
        ];
    }

    /**
     * @param  array<int, mixed>  $schema
     * @param  array<string, mixed>  $provided
     */
    private function assertRequiredEnvValues(array $schema, array $provided): void
    {
        $errors = [];

        foreach ($schema as $item) {
            if (! is_array($item) || ! filled($item['key'] ?? null)) {
                continue;
            }

            if (! (bool) ($item['required'] ?? false)) {
                continue;
            }

            $key = (string) $item['key'];
            $isSecret = (bool) ($item['is_secret'] ?? false);
            $hasProvided = filled($provided[$key] ?? null);
            $hasDefault = ! $isSecret && filled($item['default'] ?? null);

            if (! $hasProvided && ! $hasDefault) {
                $errors["env_values.{$key}"] = "La variable {$key} est obligatoire.";
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }

    private function firstPort(string $portsExposes): int
    {
        $first = (int) explode(',', $portsExposes)[0];

        return $first > 0 ? $first : 3000;
    }
}
