<?php

namespace App\Console\Commands;

use App\Models\Team;
use App\Services\DevForge\Agent\DefaultAgentProvisioner;
use Illuminate\Console\Command;

class DevForgeEnsureDefaultAgents extends Command
{
    protected $signature = 'devforge:ensure-default-agents
                            {--team= : Team ID (if omitted, process all teams)}';

    protected $description = 'Provisionne les agents par défaut pour les teams qui ont un provider AI configuré';

    public function __construct(
        private readonly DefaultAgentProvisioner $provisioner,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        $teamId = $this->option('team');

        $query = Team::query();
        if ($teamId) {
            $query->where('id', $teamId);
        }

        $teams = $query->get();

        if ($teams->isEmpty()) {
            $this->info('Aucune team trouvée.');

            return self::SUCCESS;
        }

        $totalCreated = 0;

        foreach ($teams as $team) {
            $created = $this->provisioner->ensureDefaultAgents($team);
            if ($created > 0) {
                $this->info("Team {$team->id} ({$team->name}): {$created} agent(s) créé(s).");
                $totalCreated += $created;
            }
        }

        if ($totalCreated === 0) {
            $this->info('Tous les agents par défaut sont déjà provisionnés.');
        } else {
            $this->info("Total : {$totalCreated} agent(s) créé(s).");
        }

        return self::SUCCESS;
    }
}
