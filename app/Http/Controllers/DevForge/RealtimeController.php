<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\RealtimeMetadata;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RealtimeController extends Controller
{
    public function __invoke(
        Request $request,
        CurrentTeamContext $teamContext,
        RealtimeMetadata $metadata,
    ): JsonResponse {
        $team = $teamContext->resolve($request->user());

        return response()->json([
            'data' => $metadata->build($request->user(), $team),
        ]);
    }
}
