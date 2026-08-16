<?php

namespace App\Console\Commands;

use App\Services\DevForge\Backup\EnsureInstanceS3Backup;
use Illuminate\Console\Command;

class EnsureS3BackupCommand extends Command
{
    protected $signature = 'devforge:ensure-s3-backup
        {--skip-test : Enregistre la destination sans tester la connexion S3}';

    protected $description = 'Synchronise la destination S3 depuis le .env et l’active sur les sauvegardes.';

    public function __construct(private readonly EnsureInstanceS3Backup $ensureInstanceS3Backup)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $result = $this->ensureInstanceS3Backup->sync(testConnection: ! $this->option('skip-test'));

        match ($result['status']) {
            'ok' => $this->info($result['message']),
            'skipped' => $this->warn($result['message']),
            default => $this->error($result['message']),
        };

        if ($result['storage_uuid']) {
            $this->line('Destination : '.$result['storage_uuid']);
        }

        if ($result['attached_backups'] > 0) {
            $this->line("Plannings liés : {$result['attached_backups']}");
        }

        return $result['status'] === 'error' ? self::FAILURE : self::SUCCESS;
    }
}
