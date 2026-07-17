<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use App\Models\GithubApp;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Auth npm.pkg.github.com au build.
 * Priorité : NODE_AUTH_TOKEN app → packages_token (PAT) sur la GitHub App → token d’installation (si packages:read).
 */
class GithubPackagesBuildAuthInjector
{
    public const TOKEN_KEYS = ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'NPM_AUTH_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN'];

    /**
     * @param  array<string, mixed>  $existingEnvKeys  clés déjà présentes dans le build env
     * @return array<string, string>  KEY => raw value (non échappée)
     */
    public function buildTimeAdditions(Application $application, array $existingEnvKeys = []): array
    {
        if ($this->hasUserToken($existingEnvKeys)) {
            return [];
        }

        $githubApp = $this->resolveGithubApp($application);
        if ($githubApp === null || (bool) $githubApp->is_public) {
            return [];
        }

        $token = $this->resolveBuildToken($githubApp);
        if ($token === null || $token === '') {
            return [];
        }

        return [
            'NODE_AUTH_TOKEN' => $token,
        ];
    }

    /**
     * @return array{
     *     ok: bool,
     *     can_auto_redeploy: bool,
     *     has_github_app: bool,
     *     has_packages_permission: bool,
     *     has_packages_token: bool,
     *     npm_probe_ok: bool|null,
     *     error: string|null,
     *     permissions_url: string|null,
     *     steps: list<string>
     * }
     */
    public function diagnose(Application $application): array
    {
        $githubApp = $this->resolveGithubApp($application);
        if ($githubApp === null) {
            return [
                'ok' => false,
                'can_auto_redeploy' => false,
                'has_github_app' => false,
                'has_packages_permission' => false,
                'has_packages_token' => false,
                'npm_probe_ok' => null,
                'error' => 'Application sans GitHub App privée — un PAT packages:read est requis.',
                'permissions_url' => null,
                'steps' => [
                    'Créer un PAT GitHub (classic) avec scope read:packages.',
                    'DevForge → GitHub → enregistrer le token Packages sur le compte, ou NODE_AUTH_TOKEN (build) sur l’app.',
                    'Vérifier .npmrc (//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}).',
                    'Relancer le déploiement.',
                ],
            ];
        }

        if ((bool) $githubApp->is_public) {
            return [
                'ok' => false,
                'can_auto_redeploy' => false,
                'has_github_app' => true,
                'has_packages_permission' => false,
                'has_packages_token' => false,
                'npm_probe_ok' => null,
                'error' => 'GitHub App publique — pas de token d’installation pour les packages privés.',
                'permissions_url' => null,
                'steps' => [
                    'Utiliser une GitHub App privée liée au dépôt, ou enregistrer un PAT packages:read.',
                    'DevForge → GitHub → token Packages, ou NODE_AUTH_TOKEN (build).',
                ],
            ];
        }

        $hasStoredPat = $this->storedPackagesToken($githubApp) !== null;
        $permissions = $this->installationPermissions($githubApp);
        $hasPackages = $this->hasPackagesRead($permissions);
        $permissionsUrl = $this->permissionsUrl($githubApp);

        if ($hasStoredPat) {
            return [
                'ok' => true,
                'can_auto_redeploy' => true,
                'has_github_app' => true,
                'has_packages_permission' => $hasPackages,
                'has_packages_token' => true,
                'npm_probe_ok' => true,
                'error' => null,
                'permissions_url' => $permissionsUrl,
                'steps' => [
                    'PAT packages enregistré sur la GitHub App.',
                    'Redéploiement : NODE_AUTH_TOKEN sera injecté au build automatiquement.',
                ],
            ];
        }

        if (! $hasPackages) {
            return [
                'ok' => false,
                'can_auto_redeploy' => false,
                'has_github_app' => true,
                'has_packages_permission' => false,
                'has_packages_token' => false,
                'npm_probe_ok' => false,
                'error' => 'Aucun token Packages enregistré — npm.pkg.github.com refuse le token d’installation (pas de packages:read).',
                'permissions_url' => $permissionsUrl,
                'steps' => array_values(array_filter([
                    'Créer un PAT GitHub (classic) avec scope read:packages (et repo si besoin).',
                    'Dans DevForge → GitHub → compte lié → enregistrer le token Packages.',
                    'Alternative : variable NODE_AUTH_TOKEN (build) sur l’application.',
                    'Ou activer Packages: Read-only sur la GitHub App puis accepter l’installation.',
                    $permissionsUrl ? 'Lien permissions GitHub App : '.$permissionsUrl : null,
                    'Relancer le déploiement.',
                ])),
            ];
        }

        $token = $this->installationToken($githubApp);
        if ($token === null || $token === '') {
            return [
                'ok' => false,
                'can_auto_redeploy' => false,
                'has_github_app' => true,
                'has_packages_permission' => true,
                'has_packages_token' => false,
                'npm_probe_ok' => null,
                'error' => 'Impossible de générer le token d’installation GitHub App.',
                'permissions_url' => $permissionsUrl,
                'steps' => [
                    'Vérifier que la GitHub App est installée (installation_id).',
                    'Ou enregistrer un PAT packages:read dans DevForge → GitHub.',
                ],
            ];
        }

        return [
            'ok' => true,
            'can_auto_redeploy' => true,
            'has_github_app' => true,
            'has_packages_permission' => true,
            'has_packages_token' => false,
            'npm_probe_ok' => true,
            'error' => null,
            'permissions_url' => $permissionsUrl,
            'steps' => [
                'Token GitHub App disponible avec packages:read.',
                'Redéploiement : NODE_AUTH_TOKEN sera injecté au build automatiquement.',
            ],
        ];
    }

    public function resolveGithubApp(Application $application): ?GithubApp
    {
        $application->loadMissing('source');
        $source = $application->source;

        if (! $source instanceof GithubApp) {
            return null;
        }

        return $source;
    }

    public function resolveBuildToken(GithubApp $githubApp): ?string
    {
        $stored = $this->storedPackagesToken($githubApp);
        if ($stored !== null) {
            return $stored;
        }

        $permissions = $this->installationPermissions($githubApp);
        if (! $this->hasPackagesRead($permissions)) {
            return null;
        }

        return $this->installationToken($githubApp);
    }

    public function storedPackagesToken(GithubApp $githubApp): ?string
    {
        $token = $githubApp->packages_token;

        return is_string($token) && trim($token) !== '' ? trim($token) : null;
    }

    public function installationToken(GithubApp $githubApp): ?string
    {
        try {
            $token = generateGithubInstallationToken($githubApp);

            return is_string($token) && $token !== '' ? $token : null;
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * @param  array<string, mixed>  $existingEnvKeys
     */
    public function hasUserToken(array $existingEnvKeys): bool
    {
        foreach (self::TOKEN_KEYS as $key) {
            if (array_key_exists($key, $existingEnvKeys)) {
                return true;
            }
            if (in_array($key, $existingEnvKeys, true)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array<string, mixed>
     */
    public function installationPermissions(GithubApp $githubApp): array
    {
        try {
            $jwt = generateGithubJwt($githubApp);
            $response = Http::withToken($jwt)
                ->withHeaders([
                    'Accept' => 'application/vnd.github+json',
                    'X-GitHub-Api-Version' => '2022-11-28',
                ])
                ->timeout(15)
                ->get(rtrim((string) $githubApp->api_url, '/').'/app/installations/'.$githubApp->installation_id);

            if (! $response->successful()) {
                return [];
            }

            $permissions = data_get($response->json(), 'permissions', []);

            return is_array($permissions) ? $permissions : [];
        } catch (Throwable) {
            return [];
        }
    }

    /**
     * @param  array<string, mixed>  $permissions
     */
    public function hasPackagesRead(array $permissions): bool
    {
        $level = strtolower((string) ($permissions['packages'] ?? ''));

        return in_array($level, ['read', 'write', 'admin'], true);
    }

    public function permissionsUrl(GithubApp $githubApp): ?string
    {
        try {
            $path = getPermissionsPath($githubApp);

            return is_string($path) && $path !== '' ? $path : null;
        } catch (Throwable) {
            return null;
        }
    }
}
