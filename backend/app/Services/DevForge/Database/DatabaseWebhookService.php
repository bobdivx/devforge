<?php

namespace App\Services\DevForge\Database;

use Illuminate\Database\Eloquent\Model;

class DatabaseWebhookService
{
    /**
     * @return array{deploy_webhook_url: string}
     */
    public function show(Model $database): array
    {
        return [
            'deploy_webhook_url' => generateDeployWebhook($database),
        ];
    }
}
