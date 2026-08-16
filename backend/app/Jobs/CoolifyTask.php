<?php

namespace App\Jobs;

/**
 * @deprecated Use RemoteProcessJob. Kept so queued payloads still unserialize.
 */
class CoolifyTask extends RemoteProcessJob
{
    public function displayName(): string
    {
        return RemoteProcessJob::class;
    }
}
