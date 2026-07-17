<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\DevForge\Backup\DatabaseBackupService;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\CurrentTeamContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DatabaseBackupController extends Controller
{
    public function __construct(
        private readonly DatabaseBackupService $databaseBackupService,
        private readonly CoreResourceCatalog $catalog,
        private readonly CurrentTeamContext $currentTeamContext,
    ) {}

    public function index(Request $request, string $databaseUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $database = $this->resolveAuthorizedDatabase($user, $databaseUuid, 'view');

        return response()->json([
            'data' => $this->databaseBackupService->list($user, $database->uuid),
            'meta' => [
                'supports_backups' => $this->databaseBackupService->supportsBackups($database),
            ],
        ]);
    }

    public function store(Request $request, string $databaseUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $database = $this->resolveAuthorizedDatabase($user, $databaseUuid, 'manageBackups');

        return response()->json([
            'data' => $this->databaseBackupService->create($user, $database->uuid, $request->all()),
        ], 201);
    }

    public function update(Request $request, string $databaseUuid, string $backupUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $this->resolveAuthorizedDatabase($user, $databaseUuid, 'manageBackups');

        return response()->json([
            'data' => $this->databaseBackupService->update($user, $databaseUuid, $backupUuid, $request->all()),
        ]);
    }

    public function destroy(Request $request, string $databaseUuid, string $backupUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $this->resolveAuthorizedDatabase($user, $databaseUuid, 'manageBackups');

        $this->databaseBackupService->delete(
            $user,
            $databaseUuid,
            $backupUuid,
            $request->boolean('delete_s3'),
        );

        return response()->json(null, 204);
    }

    public function run(Request $request, string $databaseUuid, string $backupUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $this->resolveAuthorizedDatabase($user, $databaseUuid, 'manageBackups');

        return response()->json([
            'data' => $this->databaseBackupService->run($user, $databaseUuid, $backupUuid),
        ]);
    }

    public function executions(Request $request, string $databaseUuid, string $backupUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $this->resolveAuthorizedDatabase($user, $databaseUuid, 'view');

        return response()->json([
            'data' => $this->databaseBackupService->executions($user, $databaseUuid, $backupUuid),
        ]);
    }

    public function destroyExecution(
        Request $request,
        string $databaseUuid,
        string $backupUuid,
        string $executionUuid,
    ): JsonResponse {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $this->resolveAuthorizedDatabase($user, $databaseUuid, 'manageBackups');

        $this->databaseBackupService->deleteExecution(
            $user,
            $databaseUuid,
            $backupUuid,
            $executionUuid,
            $request->boolean('delete_s3'),
        );

        return response()->json(null, 204);
    }

    private function resolveAuthorizedDatabase(User $user, string $databaseUuid, string $ability): Model
    {
        $team = $this->currentTeamContext->resolve($user);
        $database = $this->catalog->find($team, 'databases', $databaseUuid);

        if (! $database) {
            abort(404, 'Base de données introuvable.');
        }

        $this->authorize($ability, $database);

        return $database;
    }

}
