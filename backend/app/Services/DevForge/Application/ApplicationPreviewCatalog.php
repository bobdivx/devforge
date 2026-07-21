<?php

namespace App\Services\DevForge\Application;

use App\Actions\Application\CleanupPreviewDeployment;
use App\Models\Application;
use App\Models\ApplicationPreview;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class ApplicationPreviewCatalog
{
    /**
     * @return array<int, array<string, mixed>>
     */
    public function list(Application $application): array
    {
        return $application->previews()
            ->get()
            ->map(fn (ApplicationPreview $preview): array => $this->present($preview))
            ->values()
            ->all();
    }

    /**
     * @return array{is_preview_deployments_enabled: bool, preview_url_template: string}
     */
    public function settings(Application $application): array
    {
        $application->loadMissing('settings');

        return [
            'is_preview_deployments_enabled' => (bool) ($application->settings?->is_preview_deployments_enabled ?? false),
            'preview_url_template' => (string) ($application->preview_url_template ?: '{{pr_id}}.{{domain}}'),
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{is_preview_deployments_enabled: bool, preview_url_template: string}
     */
    public function updateSettings(Application $application, array $input): array
    {
        $validated = validator($input, [
            'is_preview_deployments_enabled' => ['sometimes', 'boolean'],
            'preview_url_template' => ['sometimes', 'string', 'max:255'],
        ])->validate();

        if ($validated === []) {
            throw ValidationException::withMessages([
                'input' => 'Au moins un champ doit être fourni.',
            ]);
        }

        $application->loadMissing('settings');

        if (array_key_exists('is_preview_deployments_enabled', $validated)) {
            if (! $application->settings) {
                throw ValidationException::withMessages([
                    'is_preview_deployments_enabled' => 'Les paramètres de l’application sont introuvables.',
                ]);
            }

            $application->settings->is_preview_deployments_enabled = (bool) $validated['is_preview_deployments_enabled'];
            $application->settings->save();
        }

        if (array_key_exists('preview_url_template', $validated)) {
            $template = str_replace(' ', '', trim((string) $validated['preview_url_template']));

            if ($template === '') {
                throw ValidationException::withMessages([
                    'preview_url_template' => 'Le modèle d’URL preview est obligatoire.',
                ]);
            }

            $application->preview_url_template = $template;
            $application->save();
        }

        return $this->settings($application->fresh(['settings']));
    }

    /**
     * @return array{message: string, pull_request_id: int}
     */
    public function destroy(Application $application, int $pullRequestId): array
    {
        if ($pullRequestId <= 0) {
            throw ValidationException::withMessages([
                'pull_request_id' => 'Identifiant de pull request invalide.',
            ]);
        }

        $preview = ApplicationPreview::query()
            ->where('application_id', $application->id)
            ->where('pull_request_id', $pullRequestId)
            ->first();

        if (! $preview) {
            throw new HttpException(404, 'Preview introuvable.');
        }

        $preview->delete();
        CleanupPreviewDeployment::run($application, $pullRequestId, $preview);

        return [
            'message' => 'Suppression du preview mise en file.',
            'pull_request_id' => $pullRequestId,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function present(ApplicationPreview $preview): array
    {
        $status = (string) ($preview->status ?? '');

        return [
            'uuid' => $preview->uuid,
            'pull_request_id' => (int) $preview->pull_request_id,
            'pull_request_html_url' => $preview->pull_request_html_url,
            'fqdn' => $preview->fqdn,
            'status' => $status !== '' ? $status : null,
            'is_running' => $preview->isRunning(),
            'git_type' => $preview->git_type,
            'docker_registry_image_tag' => $preview->docker_registry_image_tag,
            'last_online_at' => $this->iso($preview->last_online_at),
            'created_at' => $this->iso($preview->created_at),
            'updated_at' => $this->iso($preview->updated_at),
        ];
    }

    private function iso(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (is_object($value) && method_exists($value, 'toIso8601String')) {
            return $value->toIso8601String();
        }

        return (string) $value;
    }
}
