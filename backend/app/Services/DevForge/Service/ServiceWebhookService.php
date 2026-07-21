<?php

namespace App\Services\DevForge\Service;

use App\Models\Service;

class ServiceWebhookService
{
    /**
     * @return array{deploy_webhook_url: string}
     */
    public function show(Service $service): array
    {
        return [
            'deploy_webhook_url' => generateDeployWebhook($service),
        ];
    }
}
