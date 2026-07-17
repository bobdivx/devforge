<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use App\Models\GithubApp;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Injecte un token GitHub App frais dans le build (NODE_AUTH_TOKEN) pour npm.pkg.github.com.
 * Ne persiste pas le token en base (expire ~1h) — injection à chaque déploiement.
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

        $token = $this->installationToken($githubApp);
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
                'npm_probe_ok' => null,
                'error' => 'Application sans GitHub App privée — un PAT packages:read est requis.',
                'permissions_url' => null,
                'steps' => [
                    'Créer un PAT GitHub (classic) avec scope packages:read (et repo si besoin).',
                    'Ajouter NODE_AUTH_TOKEN dans Variables Coolify (build).',
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
                'npm_probe_ok' => null,
                'error' => 'GitHub App publique — pas de token d’installation pour les packages privés.',
                'permissions_url' => null,
                'steps' => [
                    'Utiliser une GitHub App privée liée au dépôt, ou un PAT packages:read.',
                    'Ajouter NODE_AUTH_TOKEN (build) puis redéployer.',
                ],
            ];
        }

        $permissions = $this->installationPermissions($githubApp);
        $hasPackages = $this->hasPackagesRead($permissions);
        $permissionsUrl = $this->permissionsUrl($githubApp);

        if (! $hasPackages) {
            return [
                'ok' => false,
                'can_auto_redeploy' => false,
                'has_github_app' => true,
                'has_packages_permission' => false,
                'npm_probe_ok' => false,
                'error' => 'La GitHub App n’a pas la permission packages:read — npm.pkg.github.com refuse le token.',
                'permissions_url' => $permissionsUrl,
                'steps' => array_values(array_filter([
                    'Sur GitHub → Settings → Developer settings → GitHub Apps → « '.$githubApp->name.' ».',
                    'Permissions → Repository permissions → Packages : Read-only → Save.',
                    'Accepter les nouvelles permissions sur l’installation de l’app (org/compte).',
                    $permissionsUrl ? 'Lien permissions Coolify : '.$permissionsUrl : null,
                    'Relancer le déploiement — Coolify injectera NODE_AUTH_TOKEN au build automatiquement.',
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
                'npm_probe_ok' => null,
                'error' => 'Impossible de générer le token d’installation GitHub App.',
                'permissions_url' => $permissionsUrl,
                'steps' => [
                    'Vérifier que la GitHub App est installée (installation_id).',
                    'Sinon ajouter un PAT packages:read en NODE_AUTH_TOKEN (build).',
                ],
            ];
        }

        return [
            'ok' => true,
            'can_auto_redeploy' => true,
            'has_github_app' => true,
            'has_packages_permission' => true,
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
