<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\TerminalConfiguration;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TerminalController extends Controller
{
    public function __invoke(
        Request $request,
        CurrentTeamContext $teamContext,
        TerminalConfiguration $terminalConfiguration,
    ): JsonResponse {
        abort_unless($request->user()->can('canAccessTerminal'), 403, 'Terminal access is forbidden.');
        $team = $teamContext->resolve($request->user());

        return response()->json([
            'data' => $terminalConfiguration->build($request->user(), $team),
        ]);
    }
}
