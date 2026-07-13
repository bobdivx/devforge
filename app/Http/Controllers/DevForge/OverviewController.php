<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\OverviewData;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OverviewController extends Controller
{
    public function __invoke(
        Request $request,
        CurrentTeamContext $currentTeamContext,
        OverviewData $overviewData,
    ): JsonResponse {
        $team = $currentTeamContext->resolve($request->user());

        return response()->json([
            'data' => $overviewData->build($team),
        ]);
    }
}
