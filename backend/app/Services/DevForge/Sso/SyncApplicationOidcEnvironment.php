<?php

namespace App\Services\DevForge\Sso;

use App\Models\Application;
use App\Models\EnvironmentVariable;

class SyncApplicationOidcEnvironment
{
    public const AUTO_COMMENT = 'devforge:auto:oidc';

    public function sync(?Application $application = null, bool $refreshPocketIdClient = true): int
    {
        $values = SsoProtection::oidcEnvironmentForApps();
        if ($values === []) {
            return 0;
        }

        if ($application !== null) {
            $updated = $this->syncApplication($application, $values);
            if ($refreshPocketIdClient) {
                $this->refreshPocketIdAppClient();
            }

            return $updated;
        }

        $updated = 0;
        Application::query()->orderBy('id')->each(function (Application $app) use ($values, &$updated): void {
            $updated += $this->syncApplication($app, $values);
        });
        if ($refreshPocketIdClient) {
            $this->refreshPocketIdAppClient();
        }

        return $updated;
    }

    /**
     * Register the current apps' public origins on the shared Pocket ID client.
     * Without this, a first deploy of a custom domain (e.g. popcornn.app) keeps
     * sending a redirect_uri that Pocket ID has never seen.
     */
    private function refreshPocketIdAppClient(): void
    {
        app(ProvisionPocketIdClients::class)->handle();
    }

    /**
     * @param  array<string, string>  $values
     */
    private function syncApplication(Application $application, array $values): int
    {
        $updated = 0;

        foreach (array_merge($values, $this->applicationAuthValues($application)) as $key => $value) {
            if ($this->upsert($application, $key, $value)) {
                $updated++;
            }
        }

        return $updated;
    }

    /**
     * @return array<string, string>
     */
    private function applicationAuthValues(Application $application): array
    {
        $origin = SsoProtection::primaryPublicOrigin($application);
        if ($origin === null) {
            return [];
        }

        $callback = $origin.'/api/auth/callback/pocket-id';

        return [
            'AUTH_URL' => $origin,
            'NEXTAUTH_URL' => $origin,
            'AUTH_TRUST_HOST' => 'true',
            'OIDC_REDIRECT_URI' => $callback,
            'AUTH_POCKET_ID_REDIRECT_URI' => $callback,
        ];
    }

    private function upsert(Application $application, string $key, string $value): bool
    {
        $existing = $application->environment_variables()->where('key', $key)->first();
        if ($existing) {
            if (! $this->isManaged($existing)) {
                return false;
            }

            $dirty = $existing->value !== $value || $existing->comment !== self::AUTO_COMMENT;
            if ($dirty) {
                $existing->value = $value;
                $existing->comment = self::AUTO_COMMENT;
                $existing->is_runtime = true;
                $existing->is_buildtime = true;
                $existing->save();
            }

            $this->syncPreview($application, $key, $value);

            return $dirty;
        }

        EnvironmentVariable::create([
            'key' => $key,
            'value' => $value,
            'comment' => self::AUTO_COMMENT,
            'is_multiline' => false,
            'is_literal' => false,
            'is_runtime' => true,
            'is_buildtime' => true,
            'is_preview' => false,
            'resourceable_type' => Application::class,
            'resourceable_id' => $application->id,
        ]);

        return true;
    }

    private function syncPreview(Application $application, string $key, string $value): void
    {
        $preview = $application->environment_variables_preview()->where('key', $key)->first();
        if (! $preview || ! $this->isManaged($preview)) {
            return;
        }

        if ($preview->value === $value && $preview->comment === self::AUTO_COMMENT) {
            return;
        }

        $preview->value = $value;
        $preview->comment = self::AUTO_COMMENT;
        $preview->is_runtime = true;
        $preview->is_buildtime = true;
        $preview->save();
    }

    private function isManaged(EnvironmentVariable $variable): bool
    {
        return (string) $variable->comment === self::AUTO_COMMENT;
    }
}
