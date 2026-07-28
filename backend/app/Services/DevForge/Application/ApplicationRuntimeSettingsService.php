<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Visus\Cuid2\Cuid2;

class ApplicationRuntimeSettingsService
{
    /**
     * @return array<string, mixed>
     */
    public function show(Application $application): array
    {
        $application->loadMissing('settings');

        return $this->present($application);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{settings: array<string, mixed>, redeploy: array<string, mixed>|null}
     */
    public function update(Application $application, array $input): array
    {
        $application->loadMissing('settings');

        $validated = validator($input, [
            'is_static' => ['sometimes', 'boolean'],
            'start_command' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'install_command' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'build_command' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'ports_exposes' => ['sometimes', 'nullable', 'string', 'max:100', 'regex:/^(\d+)(,\d+)*$/'],
            'base_directory' => ['sometimes', 'nullable', 'string', 'max:255'],
            'publish_directory' => ['sometimes', 'nullable', 'string', 'max:255'],
            'detected_framework' => ['sometimes', 'nullable', 'string', 'max:64'],
            'health_check_enabled' => ['sometimes', 'boolean'],
            'health_check_type' => ['sometimes', 'nullable', 'string', Rule::in(['http', 'cmd'])],
            'health_check_path' => ['sometimes', 'nullable', 'string', 'max:255'],
            'health_check_port' => ['sometimes', 'nullable', 'string', 'max:10'],
            'build_pack' => ['sometimes', 'string', Rule::in(['nixpacks', 'railpack', 'static', 'dockerfile', 'dockercompose', 'dockerimage'])],
            'redeploy' => ['sometimes', 'boolean'],
        ])->validate();

        $shouldRedeploy = (bool) ($validated['redeploy'] ?? true);
        unset($validated['redeploy']);

        $wasStatic = (bool) ($application->settings?->is_static ?? false);
        $settingsChanged = false;
        $needsRebuild = false;

        if (array_key_exists('start_command', $validated)) {
            $application->start_command = $this->nullableTrim($validated['start_command']);
            $needsRebuild = true;
        }
        if (array_key_exists('install_command', $validated)) {
            $application->install_command = $this->nullableTrim($validated['install_command']);
            $needsRebuild = true;
        }
        if (array_key_exists('build_command', $validated)) {
            $application->build_command = $this->nullableTrim($validated['build_command']);
            $needsRebuild = true;
        }
        $hasPortsDeferred = array_key_exists('ports_exposes', $validated);
        $portsDeferred = $hasPortsDeferred
            ? $this->nullableTrim($validated['ports_exposes'])
            : null;

        if (array_key_exists('base_directory', $validated)) {
            $application->base_directory = $this->nullableTrim($validated['base_directory']) ?? '/';
            $needsRebuild = true;
        }
        if (array_key_exists('publish_directory', $validated)) {
            $application->publish_directory = $this->nullableTrim($validated['publish_directory']) ?? '/';
            $needsRebuild = true;
        }
        if (array_key_exists('detected_framework', $validated)) {
            $application->detected_framework = $this->nullableTrim($validated['detected_framework']);
        }
        if (array_key_exists('health_check_enabled', $validated)) {
            $application->health_check_enabled = (bool) $validated['health_check_enabled'];
        }
        if (array_key_exists('health_check_type', $validated) && $validated['health_check_type'] !== null) {
            $application->health_check_type = $validated['health_check_type'];
        }
        if (array_key_exists('health_check_path', $validated)) {
            $application->health_check_path = $this->nullableTrim($validated['health_check_path']) ?? '/';
        }
        if (array_key_exists('health_check_port', $validated)) {
            $application->health_check_port = $this->nullableTrim($validated['health_check_port']);
        }
        if (array_key_exists('build_pack', $validated)) {
            $application->build_pack = $validated['build_pack'];
            $needsRebuild = true;
            if (! in_array($validated['build_pack'], ['nixpacks', 'railpack'], true)) {
                $validated['is_static'] = false;
            }
            if ($validated['build_pack'] === 'static') {
                $application->ports_exposes = '80';
                $validated['is_static'] = true;
            }
        }

        if (array_key_exists('is_static', $validated)) {
            $settings = $application->settings;
            if ($settings === null) {
                $settings = $application->settings()->create([
                    'is_static' => false,
                ]);
                $application->setRelation('settings', $settings);
                $wasStatic = false;
            }

            $isStatic = (bool) $validated['is_static'];
            if ((bool) $settings->is_static !== $isStatic) {
                $settingsChanged = true;
                $needsRebuild = true;
            }
            $settings->is_static = $isStatic;

            if ($isStatic && ! $wasStatic) {
                $application->custom_nginx_configuration = defaultNginxConfiguration('static');
                if (! filled($application->ports_exposes) && ! $hasPortsDeferred) {
                    $application->ports_exposes = '80';
                }
            }

            $settings->save();
        }

        if ($hasPortsDeferred) {
            $application->ports_exposes = $portsDeferred !== null && $portsDeferred !== ''
                ? $portsDeferred
                : $application->ports_exposes;
            $needsRebuild = true;
        }

        $application->save();
        $changed = $application->wasChanged() || $settingsChanged;

        $application->refresh();
        $application->loadMissing('settings');

        $redeploy = null;
        if ($shouldRedeploy && $changed) {
            $redeploy = $this->queueRedeploy($application, forceRebuild: $needsRebuild);
        }

        return [
            'settings' => $this->present($application),
            'redeploy' => $redeploy,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function present(Application $application): array
    {
        $settings = $application->settings;

        return [
            'build_pack' => $application->build_pack,
            'is_static' => (bool) ($settings?->is_static ?? false),
            'start_command' => $application->start_command,
            'install_command' => $application->install_command,
            'build_command' => $application->build_command,
            'ports_exposes' => (string) ($application->ports_exposes ?? ''),
            'base_directory' => $application->base_directory ?: '/',
            'publish_directory' => $application->publish_directory ?: '/',
            'detected_framework' => $application->detected_framework ?: null,
            'health_check_enabled' => (bool) $application->health_check_enabled,
            'health_check_type' => $application->health_check_type ?: 'http',
            'health_check_path' => $application->health_check_path ?: '/',
            'health_check_port' => filled($application->health_check_port)
                ? (string) $application->health_check_port
                : null,
            'supports_static_toggle' => in_array($application->build_pack, ['nixpacks', 'railpack'], true),
        ];
    }

    /**
     * @return array{queued: bool, deployment_uuid: string|null, message: string}
     */
    private function queueRedeploy(Application $application, bool $forceRebuild): array
    {
        $deploymentUuid = new Cuid2;
        $result = queue_application_deployment(
            application: $application,
            deployment_uuid: $deploymentUuid,
            force_rebuild: $forceRebuild,
            restart_only: false,
            is_api: true,
            no_questions_asked: true,
        );

        if ($result['status'] === 'queue_full') {
            throw new HttpException(429, (string) $result['message']);
        }

        return [
            'queued' => $result['status'] !== 'skipped',
            'deployment_uuid' => $result['status'] !== 'skipped' ? $deploymentUuid->toString() : null,
            'message' => (string) ($result['message'] ?? 'Deployment queued.'),
        ];
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
