<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\ScheduledDatabaseBackup;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\StandalonePostgresql;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class InstanceBackupController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        abort_unless(isInstanceAdmin(), 403);

        $database = StandalonePostgresql::where('name', 'coolify-db')->first();
        $backup = null;

        if ($database) {
            $backup = $database->scheduledBackups()->first();
        }

        $server = Server::find(0);
        $isServerFunctional = $server ? $server->isFunctional() : false;

        return response()->json([
            'data' => [
                'database' => $database ? [
                    'uuid' => $database->uuid,
                    'name' => $database->name,
                    'description' => $database->description,
                    'postgres_user' => $database->postgres_user,
                    'postgres_password' => $database->postgres_password,
                    'status' => $database->status,
                ] : null,
                'backup' => $backup ? [
                    'uuid' => $backup->uuid,
                    'enabled' => $backup->enabled,
                    'frequency' => $backup->frequency,
                ] : null,
                'is_server_functional' => $isServerFunctional,
            ],
        ]);
    }

    public function init(Request $request): JsonResponse
    {
        abort_unless(isInstanceAdmin(), 403);

        try {
            $server = Server::findOrFail(0);
            $out = instant_remote_process(['docker inspect coolify-db'], $server);
            $envs = format_docker_envs_to_json($out);
            $postgres_password = $envs['POSTGRES_PASSWORD'];
            $postgres_user = $envs['POSTGRES_USER'];
            $postgres_db = $envs['POSTGRES_DB'];

            $database = new StandalonePostgresql;
            $database->forceFill([
                'id' => 0,
                'uuid' => Str::uuid(),
                'name' => 'coolify-db',
                'description' => 'Coolify database',
                'postgres_user' => $postgres_user,
                'postgres_password' => $postgres_password,
                'postgres_db' => $postgres_db,
                'status' => 'running',
                'destination_type' => StandaloneDocker::class,
                'destination_id' => 0,
            ]);
            $database->save();

            $backup = ScheduledDatabaseBackup::create([
                'id' => 0,
                'enabled' => true,
                'save_s3' => false,
                'frequency' => '0 0 * * *',
                'database_id' => $database->id,
                'database_type' => StandalonePostgresql::class,
                'team_id' => currentTeam()->id ?? 0,
            ]);

            return response()->json([
                'data' => [
                    'database' => [
                        'uuid' => $database->uuid,
                        'name' => $database->name,
                        'description' => $database->description,
                        'postgres_user' => $database->postgres_user,
                        'postgres_password' => $database->postgres_password,
                        'status' => $database->status,
                    ],
                    'backup' => [
                        'uuid' => $backup->uuid,
                        'enabled' => $backup->enabled,
                        'frequency' => $backup->frequency,
                    ],
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    public function updateDatabase(Request $request): JsonResponse
    {
        abort_unless(isInstanceAdmin(), 403);

        $request->validate([
            'name' => 'required|string',
            'description' => 'nullable|string',
            'postgres_user' => 'required|string',
            'postgres_password' => 'required|string',
        ]);

        $database = StandalonePostgresql::where('name', 'coolify-db')->firstOrFail();

        $database->update([
            'name' => $request->input('name'),
            'description' => $request->input('description'),
            'postgres_user' => $request->input('postgres_user'),
            'postgres_password' => $request->input('postgres_password'),
        ]);

        return response()->json([
            'data' => [
                'database' => [
                    'uuid' => $database->uuid,
                    'name' => $database->name,
                    'description' => $database->description,
                    'postgres_user' => $database->postgres_user,
                    'postgres_password' => $database->postgres_password,
                    'status' => $database->status,
                ],
            ]
        ]);
    }
}
