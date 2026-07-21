<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Http\Requests\DevForge\UpdateNotificationChannelRequest;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\Notification\NotificationChannelUpdater;
use App\Services\DevForge\NotificationData;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    public function index(
        Request $request,
        CurrentTeamContext $currentTeamContext,
        NotificationData $notificationData,
    ): JsonResponse {
        $team = $currentTeamContext->resolve($request->user());

        return response()->json([
            'data' => $notificationData->forTeam($team),
        ]);
    }

    public function update(
        UpdateNotificationChannelRequest $request,
        string $channel,
        CurrentTeamContext $currentTeamContext,
        NotificationChannelUpdater $notificationChannelUpdater,
    ): JsonResponse {
        $team = $currentTeamContext->resolve($request->user());
        $payload = $request->payload();

        abort_if($payload === [], 422, 'At least one of events, enabled, or credentials must be provided.');

        return response()->json([
            'data' => $notificationChannelUpdater->update($team, $channel, $payload),
        ]);
    }
}
