<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\InstanceSettings;
use Illuminate\Http\JsonResponse;

class SettingsController extends Controller
{
    public function __invoke(): JsonResponse
    {
        $settings = InstanceSettings::get();
        $this->authorize('view', $settings);

        return response()->json([
            'data' => [
                'instance_name' => $settings->instance_name,
                'fqdn' => $settings->fqdn,
                'is_registration_enabled' => (bool) $settings->is_registration_enabled,
                'is_api_enabled' => (bool) $settings->is_api_enabled,
                'is_auto_update_enabled' => (bool) $settings->is_auto_update_enabled,
                'is_dns_validation_enabled' => (bool) $settings->is_dns_validation_enabled,
                'instance_timezone' => $settings->instance_timezone,
                'is_mcp_server_enabled' => (bool) $settings->is_mcp_server_enabled,
            ],
        ]);
    }
}
