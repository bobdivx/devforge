<?php

namespace App\Console\Commands;

use App\Services\DevForge\Agent\AgentSftExporter;
use Illuminate\Console\Command;

class DevForgeExportAgentSft extends Command
{
    protected $signature = 'devforge:export-agent-sft
                            {--path= : Chemin du JSONL ChatML de sortie}
                            {--team= : ID de team (sinon toutes les teams)}
                            {--limit= : Nombre max de conversations exportées}
                            {--all : Exporter toutes les teams et tous les types d\'agents}';

    protected $description = 'Exporte les traces Relanceur/deploy/repair en JSONL ChatML pour le fine-tune QLoRA';

    public function __construct(
        private readonly AgentSftExporter $exporter,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        $path = $this->option('path') ?: storage_path('app/qlora/agent-sft.jsonl');
        $team = $this->option('team');
        $limit = $this->option('limit');
        $all = (bool) $this->option('all');

        $teamId = ($team === null || $team === '') ? null : (int) $team;
        $limitInt = ($limit === null || $limit === '') ? null : max(0, (int) $limit);

        if ($limitInt === 0) {
            $this->error('--limit doit être un entier positif.');

            return self::FAILURE;
        }

        $this->info($all
            ? 'Export SFT : toutes les teams, tous les types d\'agents.'
            : 'Export SFT : traces Relanceur / deploy / repair (deployment, debug, devforge, metadata.role=deploy_operator).'
        );

        $result = $this->exporter->export(
            path: $path,
            teamId: $teamId,
            limit: $limitInt,
            all: $all,
        );

        $this->info("Écrit {$result['conversations']} conversation(s) ChatML dans {$result['path']} (ignorées : {$result['skipped']}).");

        return self::SUCCESS;
    }
}
