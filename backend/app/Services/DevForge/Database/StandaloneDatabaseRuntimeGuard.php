<?php

namespace App\Services\DevForge\Database;

use App\Actions\Database\StartDatabase;
use App\Actions\Database\StopDatabase;
use App\Models\StandaloneLibsql;
use Illuminate\Database\Eloquent\Model;
use RuntimeException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class StandaloneDatabaseRuntimeGuard
{
    public function ensureRunning(Model $database): bool
    {
        if (! $this->isStandaloneDatabase($database)) {
            return false;
        }

        if (method_exists($database, 'isRunning') && $database->isRunning()) {
            return false;
        }

        if (! $this->serverIsFunctional($database)) {
            return false;
        }

        StartDatabase::run($database);

        return true;
    }

    public function stopForMaintenance(Model $database): bool
    {
        if (! $this->isStandaloneDatabase($database)) {
            return false;
        }

        if (method_exists($database, 'isRunning') && ! $database->isRunning()) {
            return false;
        }

        if (! $this->serverIsFunctional($database)) {
            return false;
        }

        StopDatabase::run($database, dockerCleanup: false);

        return true;
    }

    private function isStandaloneDatabase(Model $database): bool
    {
        return in_array($database->getMorphClass(), array_values(STANDALONE_DATABASE_MODELS), true);
    }

    private function serverIsFunctional(Model $database): bool
    {
        return (bool) $database->destination?->server?->isFunctional();
    }
}
