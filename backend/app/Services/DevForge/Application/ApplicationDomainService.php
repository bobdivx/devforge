<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Validation\ValidationException;
use Spatie\Url\Url;

class ApplicationDomainService
{
    /**
     * @return array{
     *     domains: array<int, string>,
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
     *     fqdn: string|null,
     *     redirect: string,
     *     wildcard_domain: string|null,
     *     build_pack: string|null,
     *     sslip_warning: bool
     * }
     */
    public function update(Application $application, array $input): array
    {
        if ($application->build_pack === 'dockercompose') {
            throw ValidationException::withMessages([
                'domains' => 'Les domaines globaux ne s’appliquent pas aux applications dockercompose. Configurez les domaines par service dans Coolify.',
            ]);
        }

        $validated = validator($input, [
            'domains' => ['nullable', 'string', 'max:5000'],
            'redirect' => ['nullable', 'string', 'in:both,www,non-www'],
            'force_domain_override' => ['nullable', 'boolean'],
        ])->validate();

        $force = (bool) ($validated['force_domain_override'] ?? false);

        if (array_key_exists('domains', $validated)) {
            $fqdn = $this->normalizeDomains($validated['domains']);
            $application->fqdn = $fqdn;

            if ($fqdn !== null) {
                $this->assertNoConflicts($application, $force);
            }
        }

        if (array_key_exists('redirect', $validated) && $validated['redirect'] !== null) {
            $this->assertRedirectCompatible($application, $validated['redirect']);
            $application->redirect = $validated['redirect'];
        }

        $application->save();
        $this->refreshLabels($application);
        $application->refresh();
        $application->loadMissing(['destination.server.settings']);

        return $this->present($application);
    }

    /**
     * @return array{
     *     domains: array<int, string>,
     *     fqdn: string|null,
     *     redirect: string,
     *     wildcard_domain: string|null,
     *     build_pack: string|null,
     *     sslip_warning: bool
     * }
     */
    public function generate(Application $application): array
    {
        if ($application->build_pack === 'dockercompose') {
            throw ValidationException::withMessages([
                'domains' => 'La génération de domaine n’est pas disponible pour les applications dockercompose.',
            ]);
        }

        $application->loadMissing(['destination.server.settings']);
        $server = $application->destination?->server;
        abort_unless($server !== null, 422, 'Aucun serveur de destination trouvé pour cette application.');

        $application->fqdn = generateUrl(server: $server, random: $application->uuid);
        $application->save();
        $this->refreshLabels($application);
        $application->refresh();
        $application->loadMissing(['destination.server.settings']);

        return $this->present($application);
    }

    /**
     * @return array{
     *     domains: array<int, string>,
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
        $domains = str($fqdn ?? '')
            ->explode(',')
            ->map(fn (string $domain): string => trim($domain))
            ->filter()
            ->values()
            ->all();

        $wildcard = data_get($application, 'destination.server.settings.wildcard_domain');

        return [
            'domains' => $domains,
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

    private function refreshLabels(Application $application): void
    {
        $application->loadMissing(['destination.server', 'settings']);

        $server = $application->destination?->server;
        if ($server === null || $server->proxyType() === 'NONE') {
            return;
        }

        $readonly = (bool) ($application->settings?->is_container_label_readonly_enabled ?? true);
        if (! $readonly && filled($application->custom_labels)) {
            return;
        }

        $customLabels = str(implode('|coolify|', generateLabelsApplication($application)))->replace('|coolify|', "\n");
        $application->custom_labels = base64_encode((string) $customLabels);
        $application->save();
    }
}
