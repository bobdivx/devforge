<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\ResourceStatusData;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ResourceStatusController extends Controller
{
    public function __invoke(
        Request $request,
        CurrentTeamContext $teamContext,
        ResourceStatusData $resourceStatusData,
    ): JsonResponse {
        $team = $teamContext->resolve($request->user());

        return response()->json([
            'data' => $resourceStatusData->build($team),
        ]);
    }
}
