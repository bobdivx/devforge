<?php

namespace App\Services\DevForge\Application;

/**
 * Defaults Nixpacks portables (tous les NAS / hôtes).
 * Puppeteer tente sinon de télécharger Chrome et échoue sans unzip/tar.exe.
 */
class NixpacksPlanDefaults
{
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

        return $plan;
    }
}
