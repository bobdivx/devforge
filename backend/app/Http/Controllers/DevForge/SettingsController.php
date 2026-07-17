<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\InstanceSettings;
use App\Services\DevForge\InstanceSettingsPresenter;
use Illuminate\Http\JsonResponse;

class SettingsController extends Controller
{
    public function __invoke(): JsonResponse
    {
        $settings = InstanceSettings::get();
        $this->authorize('view', $settings);

        return response()->json([
            'data' => InstanceSettingsPresenter::from($settings)->toArray(),
        ]);
    }
}
