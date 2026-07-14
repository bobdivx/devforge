<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\InstanceSettings;
use App\Models\OauthSetting;
use Illuminate\Http\JsonResponse;

class OauthSettingsController extends Controller
{
    public function __invoke(): JsonResponse
    {
        $settings = InstanceSettings::get();
        $this->authorize('view', $settings);

        return response()->json([
            'data' => OauthSetting::query()
                ->orderBy('provider')
                ->get()
                ->map(fn (OauthSetting $oauthSetting): array => [
                    'id' => $oauthSetting->id,
                    'provider' => $oauthSetting->provider,
                    'enabled' => (bool) $oauthSetting->enabled,
                    'client_id' => filled($oauthSetting->client_id) ? '********' : null,
                    'client_secret' => filled($oauthSetting->client_secret) ? '********' : null,
                    'redirect_uri' => $oauthSetting->redirect_uri,
                    'tenant' => $oauthSetting->tenant,
                    'base_url' => $oauthSetting->base_url,
                ])
                ->values()
                ->all(),
        ]);
    }
}
