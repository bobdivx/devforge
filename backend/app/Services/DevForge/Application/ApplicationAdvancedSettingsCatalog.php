<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use App\Services\DevForge\Sso\SsoProtection;
use Illuminate\Validation\ValidationException;

class ApplicationAdvancedSettingsCatalog
{
    public function __construct(private readonly ApplicationDomainService $applicationDomainService) {}

    /**
     * @return array<string, mixed>
     */
    public function show(Application $application): array
    {
        return $this->present($application);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function update(Application $application, array $input): array
    {
        $settings = $application->settings;
        abort_unless($settings !== null, 404);

        $shouldRedeploy = (bool) ($input['redeploy'] ?? false);
        unset($input['redeploy']);

        $validated = validator($input, [
            'disable_build_cache' => ['sometimes', 'boolean'],
            'inject_build_args_to_dockerfile' => ['sometimes', 'boolean'],
            'include_source_commit_in_build' => ['sometimes', 'boolean'],
            'skip_puppeteer_browser_download' => ['sometimes', 'boolean'],
            'is_consistent_container_name_enabled' => ['sometimes', 'boolean'],
            'is_auto_deploy_enabled' => ['sometimes', 'boolean'],
            'is_image_auto_update_enabled' => ['sometimes', 'boolean'],
            'is_git_submodules_enabled' => ['sometimes', 'boolean'],
            'is_git_lfs_enabled' => ['sometimes', 'boolean'],
            'is_git_shallow_clone_enabled' => ['sometimes', 'boolean'],
            'is_pr_deployments_public_enabled' => ['sometimes', 'boolean'],
            'is_force_https_enabled' => ['sometimes', 'boolean'],
            'is_gzip_enabled' => ['sometimes', 'boolean'],
            'is_stripprefix_enabled' => ['sometimes', 'boolean'],
            'has_own_user_system' => ['sometimes', 'nullable', 'boolean'],
            'is_sso_protected' => ['sometimes', 'nullable', 'boolean'],
            'is_log_drain_enabled' => ['sometimes', 'boolean'],
            'connect_to_docker_network' => ['sometimes', 'boolean'],
            'stop_grace_period' => [
                'sometimes',
                'nullable',
                'integer',
                'min:'.MIN_STOP_GRACE_PERIOD_SECONDS,
                'max:'.MAX_STOP_GRACE_PERIOD_SECONDS,
            ],
            'max_restart_count' => ['sometimes', 'integer', 'min:0'],
        ])->validate();

        if ($validated === []) {
            throw ValidationException::withMessages([
                'input' => 'Au moins un champ doit être fourni.',
            ]);
        }

        if (array_key_exists('is_log_drain_enabled', $validated) && $validated['is_log_drain_enabled']) {
            $server = $application->destination?->server;
            if (! $server || ! $server->isLogDrainEnabled()) {
                throw ValidationException::withMessages([
                    'is_log_drain_enabled' => 'Le log drain n’est pas activé sur ce serveur.',
                ]);
            }
        }

        $accessFields = ['has_own_user_system', 'is_sso_protected'];
        $accessChanged = false;

        if (array_key_exists('has_own_user_system', $validated) && $validated['has_own_user_system'] !== $application->has_own_user_system) {
            $accessChanged = true;
        }
        if (array_key_exists('is_sso_protected', $validated) && $validated['is_sso_protected'] !== $application->is_sso_protected) {
            $accessChanged = true;
        }

        $resetLabels = $accessChanged;
        foreach (['is_force_https_enabled', 'is_gzip_enabled', 'is_stripprefix_enabled'] as $proxyFlag) {
            if (
                array_key_exists($proxyFlag, $validated)
                && (bool) $settings->{$proxyFlag} !== (bool) $validated[$proxyFlag]
            ) {
                $resetLabels = true;
                break;
            }
        }

        foreach ([
            'disable_build_cache',
            'inject_build_args_to_dockerfile',
            'include_source_commit_in_build',
            'skip_puppeteer_browser_download',
            'is_consistent_container_name_enabled',
            'is_auto_deploy_enabled',
            'is_image_auto_update_enabled',
            'is_git_submodules_enabled',
            'is_git_lfs_enabled',
            'is_git_shallow_clone_enabled',
            'is_pr_deployments_public_enabled',
            'is_force_https_enabled',
            'is_gzip_enabled',
            'is_stripprefix_enabled',
            'is_log_drain_enabled',
            'connect_to_docker_network',
        ] as $field) {
            if (array_key_exists($field, $validated)) {
                $settings->{$field} = (bool) $validated[$field];
            }
        }

        if (array_key_exists('stop_grace_period', $validated)) {
            $settings->stop_grace_period = $validated['stop_grace_period'];
        }

        $settings->save();

        if (array_key_exists('has_own_user_system', $validated) || array_key_exists('is_sso_protected', $validated)) {
            $this->applyAccessSettings($application, $validated);
            $application->save();
        }

        if (array_key_exists('max_restart_count', $validated)) {
            $application->max_restart_count = (int) $validated['max_restart_count'];
            $application->save();
        }

        $fresh = $application->fresh(['settings', 'destination.server']);
        abort_unless($fresh instanceof Application, 404);

        if ($resetLabels) {
            $this->resetDefaultLabels($fresh);
        }

        $accessOnly = collect(array_keys($validated))->diff($accessFields)->isEmpty();
        $payload = [
            ...$this->present($fresh->fresh(['settings', 'destination.server']) ?? $fresh),
            'message' => $accessOnly ? 'Accès Pocket ID mis à jour.' : 'Paramètres avancés mis à jour.',
            'redeploy' => null,
        ];

        if ($shouldRedeploy && $accessChanged) {
            $payload['redeploy'] = $this->applicationDomainService->queueRestart($fresh);
        }

        return $payload;
    }

    /**
     * @param  array<string, mixed>  $validated
     */
    private function applyAccessSettings(Application $application, array $validated): void
    {
        if (array_key_exists('has_own_user_system', $validated)) {
            $application->has_own_user_system = $validated['has_own_user_system'];
        }

        if (array_key_exists('is_sso_protected', $validated)) {
            $application->is_sso_protected = $validated['is_sso_protected'];
        }

        if ($application->has_own_user_system === true) {
            $application->is_sso_protected = false;

            return;
        }

        if ($application->is_sso_protected === true && $application->has_own_user_system === null) {
            $application->has_own_user_system = false;
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function present(Application $application): array
    {
        $settings = $application->settings;
        abort_unless($settings !== null, 404);

        $server = $application->destination?->server;
        $sso = $this->ssoContext($application);

        return [
            'disable_build_cache' => (bool) $settings->disable_build_cache,
            'inject_build_args_to_dockerfile' => (bool) ($settings->inject_build_args_to_dockerfile ?? true),
            'include_source_commit_in_build' => (bool) ($settings->include_source_commit_in_build ?? false),
            'skip_puppeteer_browser_download' => $settings->skipsPuppeteerBrowserDownload(),
            'is_consistent_container_name_enabled' => (bool) $settings->is_consistent_container_name_enabled,
            'is_auto_deploy_enabled' => (bool) $settings->is_auto_deploy_enabled,
            'is_image_auto_update_enabled' => (bool) ($settings->is_image_auto_update_enabled ?? false),
            'is_git_submodules_enabled' => (bool) $settings->is_git_submodules_enabled,
            'is_git_lfs_enabled' => (bool) $settings->is_git_lfs_enabled,
            'is_git_shallow_clone_enabled' => (bool) ($settings->is_git_shallow_clone_enabled ?? false),
            'is_pr_deployments_public_enabled' => (bool) ($settings->is_pr_deployments_public_enabled ?? false),
            'is_force_https_enabled' => (bool) $settings->is_force_https_enabled,
            'is_gzip_enabled' => (bool) ($settings->is_gzip_enabled ?? true),
            'is_stripprefix_enabled' => (bool) ($settings->is_stripprefix_enabled ?? true),
            'has_own_user_system' => $application->has_own_user_system,
            'is_sso_protected' => $application->is_sso_protected,
            ...$sso,
            'is_log_drain_enabled' => (bool) $settings->is_log_drain_enabled,
            'connect_to_docker_network' => (bool) $settings->connect_to_docker_network,
            'stop_grace_period' => $settings->stop_grace_period !== null
                ? (int) $settings->stop_grace_period
                : null,
            'max_restart_count' => (int) ($application->max_restart_count ?? 10),
            'capabilities' => [
                'git_based' => $application->git_based(),
                'dockercompose' => $application->build_pack === 'dockercompose',
                'dockerimage' => $application->build_pack === 'dockerimage',
                'log_drain_server' => $server ? $server->isLogDrainEnabled() : false,
            ],
        ];
    }

    /**
     * @return array{
     *     sso_protection_active: bool,
     *     sso_available: bool,
     *     sso_protect_apps_by_default: bool,
     *     pocket_id_url: string|null,
     *     apps_wildcard_domain: string|null
     * }
     */
    private function ssoContext(Application $application): array
    {
        try {
            $instance = instanceSettings();
            $urls = SsoProtection::publicUrls($instance);

            return [
                'sso_protection_active' => SsoProtection::shouldProtectApplication($application),
                'sso_available' => SsoProtection::isAppsProtectionConfigured($instance),
                'sso_protect_apps_by_default' => SsoProtection::shouldProtectApplicationsByDefault($instance),
                'pocket_id_url' => $instance->sso_pocket_id_url ?: ($urls['pocket_id'] ?? null),
                'apps_wildcard_domain' => $instance->apps_wildcard_domain,
            ];
        } catch (\Throwable) {
            return [
                'sso_protection_active' => false,
                'sso_available' => false,
                'sso_protect_apps_by_default' => false,
                'pocket_id_url' => null,
                'apps_wildcard_domain' => null,
            ];
        }
    }

    private function resetDefaultLabels(Application $application): void
    {
        $settings = $application->settings;
        if ($settings === null || $settings->is_container_label_readonly_enabled === false) {
            return;
        }

        $customLabels = str(implode('|coolify|', generateLabelsApplication($application)))->replace('|coolify|', "\n");
        $application->custom_labels = base64_encode($customLabels);
        $application->save();
    }
}
