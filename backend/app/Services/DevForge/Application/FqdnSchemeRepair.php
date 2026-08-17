<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use App\Models\ApplicationPreview;
use App\Models\ServiceApplication;
use App\Models\StandaloneLibsql;
use Throwable;

class FqdnSchemeRepair
{
    public function __construct(private readonly ApplicationDomainService $domains) {}

    /**
     * @return array{
     *     applications: int,
     *     previews: int,
     *     services: int,
     *     databases: int,
     *     redeployed: int
     * }
     */
    public function repair(bool $redeploy = false): array
    {
        $result = [
            'applications' => 0,
            'previews' => 0,
            'services' => 0,
            'databases' => 0,
            'redeployed' => 0,
        ];

        Application::query()
            ->where(function ($query): void {
                $query->whereNotNull('fqdn')->orWhereNotNull('docker_compose_domains');
            })
            ->with(['destination.server', 'settings'])
            ->chunkById(50, function ($applications) use ($redeploy, &$result): void {
                foreach ($applications as $application) {
                    if (! $this->repairApplication($application)) {
                        continue;
                    }

                    $result['applications']++;

                    if ($redeploy && $application->build_pack !== 'dockercompose') {
                        try {
                            $queued = $this->domains->queueRestart($application);
                            if ($queued['queued']) {
                                $result['redeployed']++;
                            }
                        } catch (Throwable) {
                            continue;
                        }
                    }
                }
            });

        ApplicationPreview::query()
            ->where(function ($query): void {
                $query->whereNotNull('fqdn')->orWhereNotNull('docker_compose_domains');
            })
            ->chunkById(50, function ($previews) use (&$result): void {
                foreach ($previews as $preview) {
                    if ($this->repairPreview($preview)) {
                        $result['previews']++;
                    }
                }
            });

        ServiceApplication::query()
            ->whereNotNull('fqdn')
            ->with('service')
            ->chunkById(50, function ($services) use ($redeploy, &$result): void {
                foreach ($services as $serviceApplication) {
                    if (! $this->repairServiceApplication($serviceApplication)) {
                        continue;
                    }

                    $result['services']++;

                    if ($redeploy && $serviceApplication->isRunning()) {
                        try {
                            $serviceApplication->restart();
                            $result['redeployed']++;
                        } catch (Throwable) {
                            continue;
                        }
                    }
                }
            });

        StandaloneLibsql::query()
            ->whereNotNull('fqdn')
            ->chunkById(50, function ($databases) use (&$result): void {
                foreach ($databases as $database) {
                    if ($this->repairDatabase($database)) {
                        $result['databases']++;
                    }
                }
            });

        return $result;
    }

    private function repairApplication(Application $application): bool
    {
        $changed = false;

        $normalizedFqdn = normalize_fqdn_list($application->fqdn);
        if ($normalizedFqdn !== $application->fqdn) {
            $application->fqdn = $normalizedFqdn;
            $changed = true;
        }

        $normalizedCompose = normalize_compose_domains_json($application->docker_compose_domains);
        if ($normalizedCompose !== $application->docker_compose_domains) {
            $application->docker_compose_domains = $normalizedCompose;
            $changed = true;
        }

        if (! $changed) {
            return false;
        }

        $application->save();
        $this->domains->refreshProxyLabels($application, force: true);

        return true;
    }

    private function repairPreview(ApplicationPreview $preview): bool
    {
        $changed = false;

        $normalizedFqdn = normalize_fqdn_list($preview->fqdn);
        if ($normalizedFqdn !== $preview->fqdn) {
            $preview->fqdn = $normalizedFqdn;
            $changed = true;
        }

        $normalizedCompose = normalize_compose_domains_json($preview->docker_compose_domains);
        if ($normalizedCompose !== $preview->docker_compose_domains) {
            $preview->docker_compose_domains = $normalizedCompose;
            $changed = true;
        }

        if (! $changed) {
            return false;
        }

        $preview->save();

        return true;
    }

    private function repairServiceApplication(ServiceApplication $serviceApplication): bool
    {
        $normalizedFqdn = normalize_fqdn_list($serviceApplication->fqdn);
        if ($normalizedFqdn === $serviceApplication->fqdn) {
            return false;
        }

        $serviceApplication->fqdn = $normalizedFqdn;
        $serviceApplication->save();

        return true;
    }

    private function repairDatabase(StandaloneLibsql $database): bool
    {
        $normalizedFqdn = normalize_fqdn_list($database->fqdn);
        if ($normalizedFqdn === $database->fqdn) {
            return false;
        }

        $database->fqdn = $normalizedFqdn;
        $database->save();

        return true;
    }
}
