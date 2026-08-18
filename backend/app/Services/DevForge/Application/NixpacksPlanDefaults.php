<?php

namespace App\Services\DevForge\Application;

/**
 * Defaults Nixpacks portables (tous les NAS / hôtes).
 * Puppeteer tente sinon de télécharger Chrome et échoue sans unzip/tar.exe.
 */
class NixpacksPlanDefaults
{
    /**
     * Archives nixpkgs par major Node, alignées sur Nixpacks récent.
     * Nixpacks 1.41 pin encore ffeebf0…, où `nodejs_24` n'existe pas.
     *
     * @see https://github.com/railwayapp/nixpacks/blob/main/src/providers/node/mod.rs
     *
     * @var array<string, string>
     */
    public const NODE_NIXPKGS_ARCHIVES = [
        '22' => 'e6f23dc08d3624daab7094b701aa3954923c6bbb',
        '24' => '23f9169c4ccce521379e602cc82ed873a1f1b52b',
    ];

    /**
     * @param  array<string, mixed>  $plan
     * @return array<string, mixed>
     */
    public function apply(array $plan, string $detectedType, bool $skipPuppeteerBrowserDownload = true): array
    {
        $aptPackages = data_get($plan, 'phases.setup.aptPkgs', []);
        if (! is_array($aptPackages)) {
            $aptPackages = [];
        }

        foreach (['curl', 'wget', 'unzip'] as $package) {
            if (! in_array($package, $aptPackages, true)) {
                $aptPackages[] = $package;
            }
        }

        data_set($plan, 'phases.setup.aptPkgs', $aptPackages);

        if ($detectedType !== 'node') {
            return $plan;
        }

        $variables = collect(data_get($plan, 'variables', []));

        if ($skipPuppeteerBrowserDownload) {
            $variables->put('PUPPETEER_SKIP_DOWNLOAD', 'true');
            $variables->put('PUPPETEER_SKIP_CHROMIUM_DOWNLOAD', 'true');
        } else {
            $variables->forget('PUPPETEER_SKIP_DOWNLOAD');
            $variables->forget('PUPPETEER_SKIP_CHROMIUM_DOWNLOAD');
        }

        data_set($plan, 'variables', $variables->all());

        return $this->pinNodeNixpkgsArchive($plan);
    }

    /**
     * @param  array<string, mixed>  $plan
     * @return array<string, mixed>
     */
    private function pinNodeNixpkgsArchive(array $plan): array
    {
        $major = $this->requestedNodeMajor($plan);
        if ($major === null) {
            return $plan;
        }

        $archive = self::NODE_NIXPKGS_ARCHIVES[$major] ?? null;
        if ($archive === null) {
            return $plan;
        }

        data_set($plan, 'nixpkgsArchive', $archive);
        data_set($plan, 'phases.setup.nixpkgsArchive', $archive);

        return $plan;
    }

    /**
     * @param  array<string, mixed>  $plan
     */
    private function requestedNodeMajor(array $plan): ?string
    {
        $version = (string) data_get($plan, 'variables.NIXPACKS_NODE_VERSION', '');
        if (preg_match('/^(\d+)/', $version, $match) === 1) {
            return $match[1];
        }

        $packages = data_get($plan, 'phases.setup.nixPkgs', []);
        if (! is_array($packages)) {
            return null;
        }

        foreach ($packages as $package) {
            if (is_string($package) && preg_match('/^nodejs_(\d+)/', $package, $match) === 1) {
                return $match[1];
            }
        }

        return null;
    }
}
