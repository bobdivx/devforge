<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\InstanceSettings;
use App\Models\OauthSetting;
use App\Services\DevForge\InstanceSettingsUpdater;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OauthSettingsController extends Controller
{
    public function __construct(
        private readonly InstanceSettingsUpdater $updater,
    ) {}

    public function index(): JsonResponse
    {
        $settings = InstanceSettings::get();
        $this->authorize('view', $settings);

        return response()->json([
            'data' => OauthSetting::query()
                ->orderBy('provider')
                ->get()
                ->map(fn (OauthSetting $oauthSetting): array => $this->updater->presentOauth($oauthSetting))
                ->values()
                ->all(),
        ]);
    }

    public function update(Request $request, string $provider): JsonResponse
    {
        $settings = InstanceSettings::get();
        $this->authorize('update', $settings);

        $oauth = OauthSetting::query()->where('provider', $provider)->firstOrFail();

        return response()->json([
            'data' => $this->updater->updateOauth($oauth, $request->all()),
        ]);
    }
}
