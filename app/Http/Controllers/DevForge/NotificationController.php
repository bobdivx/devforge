<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\NotificationData;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    public function __invoke(
        Request $request,
        CurrentTeamContext $currentTeamContext,
        NotificationData $notificationData,
    ): JsonResponse {
        $team = $currentTeamContext->resolve($request->user());

        return response()->json([
            'data' => $notificationData->forTeam($team),
        ]);
    }
}
