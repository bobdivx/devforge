<?php

namespace App\Console\Commands;

use App\Services\DevForge\Application\FqdnSchemeRepair;
use Illuminate\Console\Command;

class RepairFqdnSchemesCommand extends Command
{
    protected $signature = 'devforge:repair-fqdn-schemes
        {--redeploy : Redémarre les ressources dont le FQDN a été corrigé}';

    protected $description = 'Ajoute https:// aux domaines stockés sans schéma pour que Traefik route le Host.';

    public function __construct(private readonly FqdnSchemeRepair $repair)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $result = $this->repair->repair(redeploy: (bool) $this->option('redeploy'));

        $this->info(sprintf(
            'FQDN réparés : %d application(s), %d preview(s), %d service(s), %d base(s). Redémarrages : %d.',
            $result['applications'],
            $result['previews'],
            $result['services'],
            $result['databases'],
            $result['redeployed'],
        ));

        return self::SUCCESS;
    }
}
