<?php

namespace App\Services\DevForge\Github;

use App\Models\GithubApp;
use Illuminate\Support\Str;

class GithubAppManifestPermissions
{
    /**
     * Permissions demanded when registering a DevForge GitHub App.
     *
     * @return array<string, 'read'|'write'>
     */
    public static function permissions(): array
    {
        return [
            'contents' => 'write',
            'metadata' => 'read',
            'emails' => 'read',
            'administration' => 'write',
            'packages' => 'read',
            'actions' => 'write',
            'workflows' => 'write',
            'pull_requests' => 'write',
        ];
    }

    /**
     * Webhook events subscribed at GitHub App registration.
     *
     * @return list<string>
     */
    public static function events(): array
    {
        return ['push', 'pull_request'];
    }

    public static function permissionsUrl(GithubApp $githubApp): ?string
    {
        $htmlUrl = rtrim((string) $githubApp->html_url, '/');
        $slug = Str::kebab((string) $githubApp->name);
        if ($htmlUrl === '' || $slug === '') {
            return null;
        }

        if (filled($githubApp->organization)) {
            return $htmlUrl.'/organizations/'.$githubApp->organization.'/settings/apps/'.$slug.'/permissions';
        }

        return $htmlUrl.'/settings/apps/'.$slug.'/permissions';
    }

    public static function installationSettingsUrl(GithubApp $githubApp): ?string
    {
        $htmlUrl = rtrim((string) $githubApp->html_url, '/');
        $installationId = $githubApp->installation_id;
        if ($htmlUrl === '' || blank($installationId)) {
            return null;
        }

        if (filled($githubApp->organization)) {
            return $htmlUrl.'/organizations/'.$githubApp->organization.'/settings/installations/'.$installationId;
        }

        return $htmlUrl.'/settings/installations/'.$installationId;
    }

    /**
     * @return list<string>
     */
    public static function missingRightsSteps(?string $permissionsUrl = null, ?string $installationSettingsUrl = null): array
    {
        return [
            $permissionsUrl
                ? 'Ouvrir les permissions de la GitHub App : '.$permissionsUrl
                : 'Ouvrir GitHub → Settings → Developer settings → GitHub Apps → Permissions.',
            'Passer Administration, Contents, Actions et Workflows sur Read and write, puis enregistrer.',
            $installationSettingsUrl
                ? 'Accepter les nouvelles permissions sur l’installation : '.$installationSettingsUrl
                : 'Accepter les nouvelles permissions sur l’installation GitHub (Settings → Applications).',
        ];
    }

    public static function missingRightsHelpText(GithubApp $githubApp): string
    {
        return implode(' ', self::missingRightsSteps(
            self::permissionsUrl($githubApp),
            self::installationSettingsUrl($githubApp),
        ));
    }
}
