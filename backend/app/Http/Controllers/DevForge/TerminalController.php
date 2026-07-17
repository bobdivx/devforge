<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\TerminalConfiguration;
use App\Services\DevForge\TerminalSessionCommand;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

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

    public function createSession(
        Request $request,
        CurrentTeamContext $teamContext,
        TerminalSessionCommand $terminalSessionCommand,
    ): JsonResponse {
        abort_unless($request->user()->can('canAccessTerminal'), 403, 'Terminal access is forbidden.');

        $validated = $request->validate([
            'server_uuid' => ['required', 'string', 'max:255'],
        ]);

        $team = $teamContext->resolve($request->user());

        try {
            $session = $terminalSessionCommand->forServer(
                $request->user(),
                $team,
                $validated['server_uuid'],
            );
        } catch (InvalidArgumentException $exception) {
            throw ValidationException::withMessages([
                'server_uuid' => $exception->getMessage(),
            ]);
        }

        return response()->json([
            'data' => $session,
        ]);
    }
}
