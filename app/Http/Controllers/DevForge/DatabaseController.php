<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Jobs\DeleteResourceJob;
use App\Models\StandaloneLibsql;
use App\Models\StandalonePostgresql;
use App\Models\User;
use App\Services\DevForge\Application\ApplicationDatabaseConnector;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\Core\CoreResourcePresenter;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\Database\LibsqlDatabaseAccessService;
use App\Services\DevForge\Database\LibsqlDatabaseExplorerService;
use App\Services\DevForge\Database\LibsqlDatabaseTransferService;
use App\Services\DevForge\Database\StandaloneDatabaseCreator;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

class DatabaseController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly CoreResourceCatalog $coreResourceCatalog,
        private readonly StandaloneDatabaseCreator $standaloneDatabaseCreator,
        private readonly ApplicationDatabaseConnector $applicationDatabaseConnector,
        private readonly LibsqlDatabaseTransferService $libsqlDatabaseTransferService,
        private readonly LibsqlDatabaseAccessService $libsqlDatabaseAccessService,
        private readonly LibsqlDatabaseExplorerService $libsqlDatabaseExplorerService,
        private readonly CoreResourcePresenter $presenter,
    ) {}

    public function store(Request $request): JsonResponse
    {
        $this->authorize('create', StandalonePostgresql::class);

        $team = $this->currentTeamContext->resolve($request->user());
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $result = $this->standaloneDatabaseCreator->create($user, $team, $request->all());

        return response()->json([
            'data' => $this->presenter->present($result['database'], 'databases'),
            'meta' => array_filter([
                'instant_deploy' => $result['instant_deploy'],
                'connection' => $result['connection'],
            ], fn (mixed $value): bool => $value !== null),
        ], 201);
    }

    public function credentials(Request $request, string $databaseUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $database = $this->resolveLibsql($user, $databaseUuid);
        $this->authorize('view', $database);

        return response()->json([
            'data' => $this->libsqlDatabaseAccessService->credentials($database),
        ]);
    }

    public function regenerateToken(Request $request, string $databaseUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $database = $this->resolveLibsql($user, $databaseUuid);
        $this->authorize('update', $database);

        $validated = validator($request->all(), [
            'redeploy_applications' => ['nullable', 'boolean'],
        ])->validate();

        return response()->json([
            'data' => $this->libsqlDatabaseAccessService->regenerateToken(
                $user,
                $database,
                (bool) ($validated['redeploy_applications'] ?? true),
            ),
        ]);
    }

    public function updatePublicAccess(Request $request, string $databaseUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $database = $this->resolveLibsql($user, $databaseUuid);
        $this->authorize('update', $database);

        return response()->json([
            'data' => $this->libsqlDatabaseAccessService->updatePublicAccess($user, $database, $request->all()),
        ]);
    }

    public function connections(Request $request, string $databaseUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $database = $this->resolveDatabase($user, $databaseUuid);
        $this->authorize('view', $database);

        return response()->json([
            'data' => $this->applicationDatabaseConnector->connectedApplications($database),
        ]);
    }

    public function exportSql(Request $request, string $databaseUuid): StreamedResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $database = $this->resolveLibsql($user, $databaseUuid);
        $this->authorize('view', $database);

        $sql = $this->libsqlDatabaseTransferService->export($database);
        $filename = Str::slug($database->name).'-'.now()->format('Y-m-d-His').'.sql';

        auditLog('devforge.database.exported', [
            'team_id' => $this->currentTeamContext->resolve($user)->id,
            'database_uuid' => $database->uuid,
            'user_id' => $user->id,
        ]);

        return response()->streamDownload(
            static function () use ($sql): void {
                echo $sql;
            },
            $filename,
            ['Content-Type' => 'application/sql; charset=utf-8'],
        );
    }

    public function importSql(Request $request, string $databaseUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $database = $this->resolveLibsql($user, $databaseUuid);
        $this->authorize('update', $database);

        $validated = validator($request->all(), [
            'file' => [
                'required',
                'file',
                'max:524288',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if (! $value instanceof \Illuminate\Http\UploadedFile) {
                        $fail('Fichier invalide.');

                        return;
                    }

                    $extension = strtolower($value->getClientOriginalExtension());

                    if (! in_array($extension, ['sql', 'txt', 'db', 'sqlite'], true)) {
                        $fail('Le fichier doit être au format .sql ou .db (export Turso).');
                    }
                },
            ],
        ])->validate();

        $payload = (string) file_get_contents($validated['file']->getRealPath());
        $result = $this->libsqlDatabaseTransferService->importPayload($database, $payload);

        auditLog('devforge.database.imported', [
            'team_id' => $this->currentTeamContext->resolve($user)->id,
            'database_uuid' => $database->uuid,
            'user_id' => $user->id,
        ]);

        return response()->json([
            'data' => $result,
        ]);
    }

    public function explorer(Request $request, string $databaseUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $database = $this->resolveLibsql($user, $databaseUuid);
        $this->authorize('view', $database);

        return response()->json([
            'data' => $this->libsqlDatabaseExplorerService->overview($database),
        ]);
    }

    public function explorerTable(Request $request, string $databaseUuid, string $table): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $database = $this->resolveLibsql($user, $databaseUuid);
        $this->authorize('view', $database);

        $validated = validator($request->all(), [
            'limit' => ['nullable', 'integer', 'min:1', 'max:200'],
        ])->validate();

        return response()->json([
            'data' => $this->libsqlDatabaseExplorerService->previewTable(
                $database,
                $table,
                (int) ($validated['limit'] ?? 50),
            ),
        ]);
    }

    public function destroy(Request $request, string $databaseUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $database = $this->resolveDatabase($user, $databaseUuid);
        $this->authorize('delete', $database);

        $validated = validator($request->all(), [
            'delete_volumes' => ['nullable', 'boolean'],
            'delete_connected_networks' => ['nullable', 'boolean'],
            'delete_configurations' => ['nullable', 'boolean'],
            'docker_cleanup' => ['nullable', 'boolean'],
        ])->validate();

        DeleteResourceJob::dispatch(
            resource: $database,
            deleteVolumes: (bool) ($validated['delete_volumes'] ?? true),
            deleteConnectedNetworks: (bool) ($validated['delete_connected_networks'] ?? true),
            deleteConfigurations: (bool) ($validated['delete_configurations'] ?? true),
            dockerCleanup: (bool) ($validated['docker_cleanup'] ?? true),
        );

        auditLog('devforge.database.deleted', [
            'team_id' => $this->currentTeamContext->resolve($user)->id,
            'database_uuid' => $database->uuid,
            'database_name' => $database->name,
            'user_id' => $user->id,
        ]);

        return response()->json([
            'data' => [
                'queued' => true,
                'message' => 'Suppression de la base planifiée.',
            ],
        ]);
    }

    private function resolveDatabase(User $user, string $databaseUuid): Model
    {
        $team = $this->currentTeamContext->resolve($user);
        $database = $this->coreResourceCatalog->find($team, 'databases', $databaseUuid);

        abort_unless($database instanceof Model, 404, 'Base de données introuvable.');

        return $database;
    }

    private function resolveLibsql(User $user, string $databaseUuid): StandaloneLibsql
    {
        $database = $this->resolveDatabase($user, $databaseUuid);
        abort_unless($database instanceof StandaloneLibsql, 422, 'L’import/export SQL est disponible uniquement pour libSQL.');

        return $database;
    }
}
