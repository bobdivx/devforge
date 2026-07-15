<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\Server\ServerFilesystemService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ServerFilesystemController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $teamContext,
        private readonly ServerFilesystemService $filesystemService,
    ) {}

    public function meta(): JsonResponse
    {
        return response()->json([
            'meta' => $this->filesystemService->meta(),
        ]);
    }

    public function list(Request $request, string $serverUuid): JsonResponse
    {
        $validated = $request->validate([
            'path' => ['nullable', 'string', 'max:4096'],
        ]);

        $team = $this->teamContext->resolve($request->user());
        $server = $this->filesystemService->findForTeam($team, $serverUuid);
        $this->authorize('view', $server);

        $result = $this->filesystemService->listDirectory($team, $server, $validated['path'] ?? null);

        return $this->respond($result);
    }

    public function read(Request $request, string $serverUuid): JsonResponse
    {
        $validated = $request->validate([
            'path' => ['required', 'string', 'max:4096'],
        ]);

        $team = $this->teamContext->resolve($request->user());
        $server = $this->filesystemService->findForTeam($team, $serverUuid);
        $this->authorize('view', $server);

        $result = $this->filesystemService->readFile($team, $server, $validated['path']);

        return $this->respond($result);
    }

    public function write(Request $request, string $serverUuid): JsonResponse
    {
        $validated = $request->validate([
            'path' => ['required', 'string', 'max:4096'],
            'content' => ['required', 'string'],
        ]);

        $team = $this->teamContext->resolve($request->user());
        $server = $this->filesystemService->findForTeam($team, $serverUuid);
        $this->authorize('update', $server);

        $result = $this->filesystemService->writeFile(
            $team,
            $server,
            $validated['path'],
            $validated['content'],
        );

        return $this->respond($result);
    }

    public function search(Request $request, string $serverUuid): JsonResponse
    {
        $validated = $request->validate([
            'pattern' => ['required', 'string', 'max:512'],
            'mode' => ['nullable', 'string', Rule::in(['name', 'content'])],
            'path' => ['nullable', 'string', 'max:4096'],
        ]);

        $team = $this->teamContext->resolve($request->user());
        $server = $this->filesystemService->findForTeam($team, $serverUuid);
        $this->authorize('view', $server);

        $result = $this->filesystemService->search(
            $team,
            $server,
            $validated['pattern'],
            $validated['mode'] ?? 'name',
            $validated['path'] ?? null,
        );

        return $this->respond($result);
    }

    /**
     * @param  array<string, mixed>  $result
     */
    private function respond(array $result): JsonResponse
    {
        if (($result['success'] ?? true) === false) {
            throw ValidationException::withMessages([
                'filesystem' => $result['error'] ?? 'Opération distante échouée.',
            ]);
        }

        unset($result['success']);

        return response()->json([
            'data' => $result,
            'meta' => $this->filesystemService->meta(),
        ]);
    }
}
