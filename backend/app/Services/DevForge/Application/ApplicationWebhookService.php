<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use Illuminate\Validation\ValidationException;

class ApplicationWebhookService
{
    /** @var list<string> */
    public const SECRET_FIELDS = [
        'manual_webhook_secret_github',
        'manual_webhook_secret_gitlab',
        'manual_webhook_secret_bitbucket',
        'manual_webhook_secret_gitea',
    ];

    /**
     * @return array<string, mixed>
     */
    public function show(Application $application): array
    {
        $manualWebhooksAvailable = $this->manualWebhooksAvailable($application);

        return [
            'deploy_webhook_url' => generateDeployWebhook($application),
            'manual_webhooks_available' => $manualWebhooksAvailable,
            'uses_git_app' => ! $manualWebhooksAvailable,
            'manual' => $manualWebhooksAvailable ? [
                'github' => [
                    'url' => generateGitManualWebhook($application, 'github'),
                    'secret_set' => filled($application->manual_webhook_secret_github),
                    'configuration_url' => $application->gitWebhook ?? null,
                ],
                'gitlab' => [
                    'url' => generateGitManualWebhook($application, 'gitlab'),
                    'secret_set' => filled($application->manual_webhook_secret_gitlab),
                ],
                'bitbucket' => [
                    'url' => generateGitManualWebhook($application, 'bitbucket'),
                    'secret_set' => filled($application->manual_webhook_secret_bitbucket),
                ],
                'gitea' => [
                    'url' => generateGitManualWebhook($application, 'gitea'),
                    'secret_set' => filled($application->manual_webhook_secret_gitea),
                ],
            ] : null,
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function update(Application $application, array $input): array
    {
        if (! $this->manualWebhooksAvailable($application)) {
            throw ValidationException::withMessages([
                'manual' => 'Les webhooks manuels ne sont pas disponibles pour les applications liées à une Git App.',
            ]);
        }

        $validated = validator($input, [
            'manual_webhook_secret_github' => ['sometimes', 'nullable', 'string', 'max:255'],
            'manual_webhook_secret_gitlab' => ['sometimes', 'nullable', 'string', 'max:255'],
            'manual_webhook_secret_bitbucket' => ['sometimes', 'nullable', 'string', 'max:255'],
            'manual_webhook_secret_gitea' => ['sometimes', 'nullable', 'string', 'max:255'],
        ])->validate();

        $updates = [];

        foreach (self::SECRET_FIELDS as $field) {
            if (! array_key_exists($field, $validated)) {
                continue;
            }

            $value = $validated[$field];

            if ($value === null) {
                $updates[$field] = null;
                continue;
            }

            $trimmed = trim((string) $value);

            if ($trimmed === '') {
                continue;
            }

            $updates[$field] = $trimmed;
        }

        if ($updates !== []) {
            $application->update($updates);
            $application->refresh();
        }

        return $this->show($application);
    }

    private function manualWebhooksAvailable(Application $application): bool
    {
        return blank($application->source_id) || (int) $application->source_id === 0;
    }
}
