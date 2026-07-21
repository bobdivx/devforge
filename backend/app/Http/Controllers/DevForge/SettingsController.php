<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\InstanceSettings;
use App\Services\DevForge\InstanceSettingsPresenter;
use App\Services\DevForge\InstanceSettingsUpdater;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SettingsController extends Controller
{
    public function __construct(
        private readonly InstanceSettingsUpdater $updater,
    ) {}

    public function show(): JsonResponse
    {
        $settings = InstanceSettings::get();
        $this->authorize('view', $settings);

        return response()->json([
            'data' => InstanceSettingsPresenter::from($settings)->toArray(),
        ]);
    }

    public function updateInstance(Request $request): JsonResponse
    {
        $settings = InstanceSettings::get();
        $this->authorize('update', $settings);

        return response()->json([
            'data' => $this->updater->updateInstance($settings, $request->all()),
        ]);
    }

    public function updateAdvanced(Request $request): JsonResponse
    {
        $settings = InstanceSettings::get();
        $this->authorize('update', $settings);

        return response()->json([
            'data' => $this->updater->updateAdvanced($settings, $request->all()),
        ]);
    }

    public function updateEmail(Request $request): JsonResponse
    {
        $settings = InstanceSettings::get();
        $this->authorize('update', $settings);

        return response()->json([
            'data' => $this->updater->updateEmail($settings, $request->all()),
        ]);
    }

    public function updateUpdates(Request $request): JsonResponse
    {
        $settings = InstanceSettings::get();
        $this->authorize('update', $settings);

        return response()->json([
            'data' => $this->updater->updateUpdates($settings, $request->all()),
        ]);
    }

    public function checkUpdates(): JsonResponse
    {
        $settings = InstanceSettings::get();
        $this->authorize('update', $settings);

        return response()->json([
            'data' => $this->updater->checkForUpdates($settings),
        ]);
    }
}
