<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\DeploymentTopologyData;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DeploymentTopologyController extends Controller
{
    public function __invoke(
        Request $request,
        CurrentTeamContext $currentTeamContext,
        DeploymentTopologyData $topologyData,
    ): JsonResponse {
        $team = $currentTeamContext->resolve($request->user());

        return response()->json([
            'data' => $topologyData->build($team),
        ]);
    }
}
