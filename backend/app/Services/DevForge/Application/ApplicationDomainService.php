<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use App\Models\Server;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;
use Spatie\Url\Url;
use Throwable;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Visus\Cuid2\Cuid2;

class ApplicationDomainService
{
    /**
     * @return array{
     *     domains: array<int, string>,
     *     managed_domain: string|null,
     *     fqdn: string|null,
     *     redirect: string,
     *     wildcard_domain: string|null,
     *     build_pack: string|null,
     *     sslip_warning: bool
     * }
     */
    public function show(Application $application): array
    {
        $application->loadMissing(['destination.server.settings']);

        return $this->present($application);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     domains: array<int, string>,
     *     managed_domain: string|null,
     *     fqdn: string|null,
     *     redirect: string,
     *     wildcard_domain: string|null,
     *     build_pack: string|null,
     *     sslip_warning: bool,
     *     redeploy: array{queued: bool, deployment_uuid: string|null, message: string}|null
     * }
     */
    public function update(Application $application, array $input): array
    {
        if ($application->build_pack === 'dockercompose') {
            throw ValidationException::withMessages([
                'domains' => 'Les domaines globaux ne s’appliquent pas aux applications dockercompose. Configurez les domaines par service dans DevForge.',
            ]);
        }

        $validated = validator($input, [
            'domains' => ['nullable', 'string', 'max:5000'],
            'redirect' => ['nullable', 'string', 'in:both,www,non-www'],
            'force_domain_override' => ['nullable', 'boolean'],
            'redeploy' => ['sometimes', 'boolean'],
        ])->validate();

        $force = (bool) ($validated['force_domain_override'] ?? false);
        $shouldRedeploy = (bool) ($validated['redeploy'] ?? true);
        $previousFqdn = $application->fqdn;
        $previousRedirect = (string) ($application->redirect ?: 'both');
        $routingChanged = false;

        if (array_key_exists('domains', $validated)) {
            $fqdn = $this->normalizeDomains($validated['domains']);
            $fqdn = $this->preserveManagedDomain($fqdn, $application);
            $application->fqdn = $fqdn;

            if ($fqdn !== $previousFqdn) {
                $routingChanged = true;
            }

            if ($fqdn !== null) {
                $this->assertNoConflicts($application, $force);
            }
        }

        if (array_key_exists('redirect', $validated) && $validated['redirect'] !== null) {
            $this->assertRedirectCompatible($application, $validated['redirect']);
            $application->redirect = $validated['redirect'];

            if ($validated['redirect'] !== $previousRedirect) {
                $routingChanged = true;
            }
        }

        $application->save();
        $this->refreshLabels($application, force: true);
        $application->refresh();
        $application->loadMissing(['destination.server.settings']);

        $redeploy = null;
        if ($shouldRedeploy && $routingChanged) {
            $redeploy = $this->queueRedeploy($application);
        }

        return [
            ...$this->present($application),
            'redeploy' => $redeploy,
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     domains: array<int, string>,
     *     managed_domain: string|null,
     *     fqdn: string|null,
     *     redirect: string,
     *     wildcard_domain: string|null,
     *     build_pack: string|null,
     *     sslip_warning: bool,
     *     redeploy: array{queued: bool, deployment_uuid: string|null, message: string}|null
     * }
     */
    public function generate(Application $application, array $input = []): array
    {
        if ($application->build_pack === 'dockercompose') {
            throw ValidationException::withMessages([
                'domains' => 'La génération de domaine n’est pas disponible pour les applications dockercompose.',
            ]);
        }

        $validated = validator($input, [
            'redeploy' => ['sometimes', 'boolean'],
            'previous_wildcard' => ['sometimes', 'nullable', 'string', 'max:255'],
        ])->validate();

        $shouldRedeploy = (bool) ($validated['redeploy'] ?? true);
        $previousFqdn = $application->fqdn;
        $previousWildcard = is_string($validated['previous_wildcard'] ?? null)
            ? (string) $validated['previous_wildcard']
            : null;

        $application->loadMissing(['destination.server.settings']);
        $server = $application->destination?->server;
        abort_unless($server !== null, 422, 'Aucun serveur de destination trouvé pour cette application.');

        $application->fqdn = $this->composeGeneratedFqdn($application, $server, $previousWildcard);
        $application->save();
        $this->refreshLabels($application, force: true);
        $application->refresh();
        $application->loadMissing(['destination.server.settings']);

        $redeploy = null;
        if ($shouldRedeploy && $application->fqdn !== $previousFqdn) {
            $redeploy = $this->queueRedeploy($application);
        }

        return [
            ...$this->present($application),
            'redeploy' => $redeploy,
        ];
    }

    /**
     * Recalcule les URLs générées (nomdelapp.domaine + UUID) pour toutes les apps.
     */
    public function regenerateManagedDomains(?string $previousWildcard = null, bool $redeploy = false): int
    {
        $updated = 0;

        Application::query()
            ->with(['destination.server.settings', 'settings'])
            ->where('build_pack', '!=', 'dockercompose')
            ->chunkById(50, function ($applications) use ($previousWildcard, $redeploy, &$updated): void {
                foreach ($applications as $application) {
                    try {
                        $before = $application->fqdn;
                        $this->generate($application, [
                            'redeploy' => $redeploy,
                            'previous_wildcard' => $previousWildcard,
                        ]);
                        if ($application->fresh()->fqdn !== $before) {
                            $updated++;
                        }
                    } catch (Throwable) {
                        continue;
                    }
                }
            });

        return $updated;
    }

    /**
     * @return array{
     *     domains: array<int, string>,
     *     managed_domain: string|null,
     *     fqdn: string|null,
     *     redirect: string,
     *     wildcard_domain: string|null,
     *     build_pack: string|null,
     *     sslip_warning: bool
     * }
     */
    private function present(Application $application): array
    {
        $fqdn = $application->fqdn;
        $domains = $this->parseDomainList($fqdn)->all();
        $managedDomain = collect($domains)
            ->first(fn (string $domain): bool => $this->isManagedDomain($domain, $application));

        $wildcard = data_get($application, 'destination.server.settings.wildcard_domain');
        if (! filled($wildcard)) {
            $wildcard = instance_apps_wildcard_domain();
        }

        return [
            'domains' => $domains,
            'managed_domain' => $managedDomain,
            'fqdn' => $fqdn,
            'redirect' => (string) ($application->redirect ?: 'both'),
            'wildcard_domain' => filled($wildcard) ? (string) $wildcard : null,
            'build_pack' => $application->build_pack,
            'sslip_warning' => filled($fqdn) && (bool) sslipDomainWarning($fqdn),
        ];
    }

    private function normalizeDomains(?string $domains): ?string
    {
        if ($domains === null) {
            return null;
        }

        $normalized = str($domains)->replaceEnd(',', '')->replaceStart(',', '')->trim()->toString();
        if ($normalized === '') {
            return null;
        }

        $errors = [];
        $urls = str($normalized)->trim()->explode(',')->map(function (string $domain) use (&$errors) {
            $domain = trim($domain);
            if ($domain === '') {
                return null;
            }

            try {
                Url::fromString($domain, ['http', 'https']);
            } catch (\Throwable) {
                $errors[] = "URL invalide : {$domain}";

                return null;
            }

            return str($domain)->lower()->toString();
        })->filter()->unique()->values();

        if ($errors !== []) {
            throw ValidationException::withMessages([
                'domains' => $errors,
            ]);
        }

        return $urls->implode(',');
    }

    /**
     * Réinjecte le domaine DevForge (UUID) s’il existait déjà, pour qu’il ne puisse pas être retiré.
     */
    private function preserveManagedDomain(?string $incomingFqdn, Application $application): ?string
    {
        $existingManaged = $this->parseDomainList($application->fqdn)
            ->first(fn (string $domain): bool => $this->isManagedDomain($domain, $application));

        if ($existingManaged === null) {
            return $incomingFqdn;
        }

        $preserved = str($existingManaged)->lower()->toString();
        $custom = $this->parseDomainList($incomingFqdn)
            ->reject(fn (string $domain): bool => $this->isGeneratedDomain($domain, $application))
            ->values();

        // Custom domains first so notifications / COOLIFY_URL prefer the real URL.
        return $custom->merge([$preserved])->unique()->implode(',');
    }

    /**
     * @return Collection<int, string>
     */
    private function parseDomainList(?string $fqdn): Collection
    {
        return str($fqdn ?? '')
            ->explode(',')
            ->map(fn (string $domain): string => trim($domain))
            ->filter()
            ->values();
    }

    private function composeGeneratedFqdn(Application $application, Server $server, ?string $previousWildcard = null): string
    {
        $managed = str(generateUrl(server: $server, random: $application->uuid))->lower()->toString();
        $pretty = str(generateUrl(
            server: $server,
            random: application_url_slug((string) $application->name, (string) $application->uuid),
        ))->lower()->toString();

        $generated = collect([$pretty, $managed])
            ->filter(fn (string $domain): bool => $domain !== '')
            ->unique()
            ->values();

        $custom = $this->parseDomainList($application->fqdn)
            ->reject(fn (string $domain): bool => $this->isGeneratedDomain($domain, $application, $previousWildcard))
            ->reject(fn (string $domain): bool => $generated->contains(strtolower($domain)))
            ->values();

        return $custom->merge($generated)->unique()->implode(',');
    }

    private function isManagedDomain(string $domain, Application $application): bool
    {
        $uuid = strtolower((string) $application->uuid);
        if ($uuid === '') {
            return false;
        }

        try {
            $host = strtolower(Url::fromString($domain)->getHost());
        } catch (\Throwable) {
            return str_contains(strtolower($domain), $uuid);
        }

        return str_contains($host, $uuid);
    }

    private function isGeneratedDomain(string $domain, Application $application, ?string $previousWildcard = null): bool
    {
        if ($this->isManagedDomain($domain, $application)) {
            return true;
        }

        $normalized = strtolower(trim($domain));
        if (str_contains($normalized, 'sslip.io')) {
            return true;
        }

        try {
            $host = strtolower(Url::fromString($domain)->getHost());
        } catch (\Throwable) {
            return false;
        }

        $slug = application_url_slug((string) $application->name, (string) $application->uuid);
        $wildcardHosts = collect([
            data_get($application, 'destination.server.settings.wildcard_domain'),
            instance_apps_wildcard_domain(),
            $previousWildcard,
        ])
            ->map(fn (mixed $wildcard): ?string => $this->wildcardHost(is_string($wildcard) ? $wildcard : null))
            ->filter()
            ->unique();

        return $wildcardHosts->contains(fn (string $wildcardHost): bool => $host === $slug.'.'.$wildcardHost);
    }

    private function wildcardHost(?string $wildcard): ?string
    {
        if (! filled($wildcard)) {
            return null;
        }

        try {
            $host = strtolower(Url::fromString($wildcard)->getHost());
        } catch (\Throwable) {
            $normalized = normalize_apps_wildcard_domain($wildcard);
            if (! filled($normalized)) {
                return null;
            }

            try {
                $host = strtolower(Url::fromString($normalized)->getHost());
            } catch (\Throwable) {
                return null;
            }
        }

        return filled($host) ? $host : null;
    }

    private function assertNoConflicts(Application $application, bool $force): void
    {
        if ($force) {
            return;
        }

        $result = checkDomainUsage(resource: $application);
        if (! ($result['hasConflicts'] ?? false)) {
            return;
        }

        throw new HttpResponseException(response()->json([
            'message' => 'Domain conflicts detected. Use force_domain_override=true to proceed.',
            'conflicts' => $result['conflicts'] ?? [],
            'warning' => 'Using the same domain for multiple resources can cause routing conflicts and unpredictable behavior.',
        ], 409));
    }

    private function assertRedirectCompatible(Application $application, string $redirect): void
    {
        if ($redirect !== 'www') {
            return;
        }

        $hasWww = collect($application->fqdns)
            ->filter(fn ($fqdn) => str($fqdn)->contains('www.'))
            ->isNotEmpty();

        if (! $hasWww) {
            throw ValidationException::withMessages([
                'redirect' => 'La redirection vers www nécessite un domaine www dans la liste (et un enregistrement DNS A correspondant).',
            ]);
        }
    }

    private function refreshLabels(Application $application, bool $force = false): void
    {
        $application->loadMissing(['destination.server', 'settings']);

        $server = $application->destination?->server;
        if ($server === null || $server->proxyType() === 'NONE') {
            return;
        }

        $readonly = (bool) ($application->settings?->is_container_label_readonly_enabled ?? true);
        if (! $force && ! $readonly && filled($application->custom_labels)) {
            return;
        }

        $customLabels = str(implode('|coolify|', generateLabelsApplication($application)))->replace('|coolify|', "\n");
        $application->custom_labels = base64_encode((string) $customLabels);
        $application->save();
    }

    /**
     * @return array{queued: bool, deployment_uuid: string|null, message: string}
     */
    private function queueRedeploy(Application $application): array
    {
        $deploymentUuid = new Cuid2;
        $result = queue_application_deployment(
            application: $application,
            deployment_uuid: $deploymentUuid,
            force_rebuild: false,
            restart_only: true,
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
}
