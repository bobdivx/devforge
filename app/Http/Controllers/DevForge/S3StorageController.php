<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\S3Storage;
use App\Models\User;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\S3\S3StorageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class S3StorageController extends Controller
{
    public function __construct(
        private readonly S3StorageService $s3StorageService,
        private readonly CurrentTeamContext $currentTeamContext,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);
        $this->authorize('viewAny', S3Storage::class);

        return response()->json([
            'data' => $this->s3StorageService->list($user),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);
        $this->authorize('create', S3Storage::class);

        return response()->json([
            'data' => $this->s3StorageService->create($user, $request->all()),
        ], 201);
    }

    public function update(Request $request, string $storageUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $storage = $this->s3StorageService->findForTeam($team, $storageUuid);
        $this->authorize('update', $storage);

        return response()->json([
            'data' => $this->s3StorageService->update($user, $storageUuid, $request->all()),
        ]);
    }

    public function destroy(Request $request, string $storageUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $storage = $this->s3StorageService->findForTeam($team, $storageUuid);
        $this->authorize('delete', $storage);

        $this->s3StorageService->delete($user, $storageUuid);

        return response()->json(null, 204);
    }

    public function test(Request $request, string $storageUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $storage = $this->s3StorageService->findForTeam($team, $storageUuid);
        $this->authorize('validateConnection', $storage);

        try {
            return response()->json([
                'data' => $this->s3StorageService->test($user, $storageUuid),
            ]);
        } catch (\Throwable $exception) {
            return response()->json([
                'message' => 'Échec du test de connexion S3.',
                'error' => $exception->getMessage(),
            ], 422);
        }
    }

}
