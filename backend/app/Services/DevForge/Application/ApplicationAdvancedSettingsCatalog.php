<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use Illuminate\Validation\ValidationException;

class ApplicationAdvancedSettingsCatalog
{
    /**
     * @return array{
     *     disable_build_cache: bool,
     *     inject_build_args_to_dockerfile: bool,
     *     include_source_commit_in_build: bool,
     *     is_consistent_container_name_enabled: bool,
     *     is_auto_deploy_enabled: bool,
     *     is_git_submodules_enabled: bool,
     *     is_git_lfs_enabled: bool,
     *     is_git_shallow_clone_enabled: bool,
     *     is_pr_deployments_public_enabled: bool,
     *     is_force_https_enabled: bool,
     *     is_gzip_enabled: bool,
     *     is_stripprefix_enabled: bool,
     *     is_log_drain_enabled: bool,
     *     connect_to_docker_network: bool,
     *     stop_grace_period: int|null,
     *     max_restart_count: int,
     *     capabilities: array{
     *         git_based: bool,
     *         dockercompose: bool,
     *         log_drain_server: bool
     *     }
     * }
     */
    public function show(Application $application): array
    {
        return $this->present($application);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     disable_build_cache: bool,
     *     inject_build_args_to_dockerfile: bool,
     *     include_source_commit_in_build: bool,
     *     is_consistent_container_name_enabled: bool,
     *     is_auto_deploy_enabled: bool,
     *     is_git_submodules_enabled: bool,
     *     is_git_lfs_enabled: bool,
     *     is_git_shallow_clone_enabled: bool,
     *     is_pr_deployments_public_enabled: bool,
     *     is_force_https_enabled: bool,
     *     is_gzip_enabled: bool,
     *     is_stripprefix_enabled: bool,
     *     is_log_drain_enabled: bool,
     *     connect_to_docker_network: bool,
     *     stop_grace_period: int|null,
     *     max_restart_count: int,
     *     capabilities: array{
     *         git_based: bool,
     *         dockercompose: bool,
     *         log_drain_server: bool
     *     },
     *     message: string
     * }
     */
    public function update(Application $application, array $input): array
    {
        $settings = $application->settings;
        abort_unless($settings !== null, 404);

        $validated = validator($input, [
            'disable_build_cache' => ['sometimes', 'boolean'],
            'inject_build_args_to_dockerfile' => ['sometimes', 'boolean'],
            'include_source_commit_in_build' => ['sometimes', 'boolean'],
            'is_consistent_container_name_enabled' => ['sometimes', 'boolean'],
            'is_auto_deploy_enabled' => ['sometimes', 'boolean'],
            'is_git_submodules_enabled' => ['sometimes', 'boolean'],
            'is_git_lfs_enabled' => ['sometimes', 'boolean'],
            'is_git_shallow_clone_enabled' => ['sometimes', 'boolean'],
            'is_pr_deployments_public_enabled' => ['sometimes', 'boolean'],
            'is_force_https_enabled' => ['sometimes', 'boolean'],
            'is_gzip_enabled' => ['sometimes', 'boolean'],
            'is_stripprefix_enabled' => ['sometimes', 'boolean'],
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

        $resetLabels = false;
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
            'is_consistent_container_name_enabled',
            'is_auto_deploy_enabled',
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

        if (array_key_exists('max_restart_count', $validated)) {
            $application->max_restart_count = (int) $validated['max_restart_count'];
            $application->save();
        }

        if ($resetLabels) {
            $this->resetDefaultLabels($application->fresh(['settings']));
        }

        return [
            ...$this->present($application->fresh(['settings', 'destination.server'])),
            'message' => 'Paramètres avancés mis à jour.',
        ];
    }

    /**
     * @return array{
     *     disable_build_cache: bool,
     *     inject_build_args_to_dockerfile: bool,
     *     include_source_commit_in_build: bool,
     *     is_consistent_container_name_enabled: bool,
     *     is_auto_deploy_enabled: bool,
     *     is_git_submodules_enabled: bool,
     *     is_git_lfs_enabled: bool,
     *     is_git_shallow_clone_enabled: bool,
     *     is_pr_deployments_public_enabled: bool,
     *     is_force_https_enabled: bool,
     *     is_gzip_enabled: bool,
     *     is_stripprefix_enabled: bool,
     *     is_log_drain_enabled: bool,
     *     connect_to_docker_network: bool,
     *     stop_grace_period: int|null,
     *     max_restart_count: int,
     *     capabilities: array{
     *         git_based: bool,
     *         dockercompose: bool,
     *         log_drain_server: bool
     *     }
     * }
     */
    private function present(Application $application): array
    {
        $settings = $application->settings;
        abort_unless($settings !== null, 404);

        $server = $application->destination?->server;

        return [
            'disable_build_cache' => (bool) $settings->disable_build_cache,
            'inject_build_args_to_dockerfile' => (bool) ($settings->inject_build_args_to_dockerfile ?? true),
            'include_source_commit_in_build' => (bool) ($settings->include_source_commit_in_build ?? false),
            'is_consistent_container_name_enabled' => (bool) $settings->is_consistent_container_name_enabled,
            'is_auto_deploy_enabled' => (bool) $settings->is_auto_deploy_enabled,
            'is_git_submodules_enabled' => (bool) $settings->is_git_submodules_enabled,
            'is_git_lfs_enabled' => (bool) $settings->is_git_lfs_enabled,
            'is_git_shallow_clone_enabled' => (bool) ($settings->is_git_shallow_clone_enabled ?? false),
            'is_pr_deployments_public_enabled' => (bool) ($settings->is_pr_deployments_public_enabled ?? false),
            'is_force_https_enabled' => (bool) $settings->is_force_https_enabled,
            'is_gzip_enabled' => (bool) ($settings->is_gzip_enabled ?? true),
            'is_stripprefix_enabled' => (bool) ($settings->is_stripprefix_enabled ?? true),
            'is_log_drain_enabled' => (bool) $settings->is_log_drain_enabled,
            'connect_to_docker_network' => (bool) $settings->connect_to_docker_network,
            'stop_grace_period' => $settings->stop_grace_period !== null
                ? (int) $settings->stop_grace_period
                : null,
            'max_restart_count' => (int) ($application->max_restart_count ?? 10),
            'capabilities' => [
                'git_based' => $application->git_based(),
                'dockercompose' => $application->build_pack === 'dockercompose',
                'log_drain_server' => $server ? $server->isLogDrainEnabled() : false,
            ],
        ];
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
