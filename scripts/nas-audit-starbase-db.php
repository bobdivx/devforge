<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\EnvironmentVariable;
use App\Models\StandaloneLibsql;
use App\Services\DevForge\Database\LibsqlConnectionEnvSync;
use App\Services\DevForge\Database\LibsqlDatabaseExplorerService;
use App\Services\DevForge\Database\LibsqlDatabaseTransferService;

$appUuid = $argv[1] ?? 'julfme7qvjx8tzzypz6qzea0';

$application = Application::query()
    ->with([
        'environment.project',
        'environment_variables',
        'destination.server',
    ])
    ->where('uuid', $appUuid)
    ->first();

if (! $application) {
    $application = Application::query()
        ->with([
            'environment.project',
            'environment_variables',
            'destination.server',
        ])
        ->where('name', 'like', '%starbase%')
        ->first();
}

if (! $application) {
    echo json_encode(['error' => 'application_not_found', 'uuid' => $appUuid], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)."\n";
    exit(1);
}

$envVars = $application->environment_variables
    ->where('is_preview', false)
    ->values();

$dbLinkComments = $envVars
    ->pluck('comment')
    ->filter(fn ($c) => is_string($c) && str_starts_with($c, LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX))
    ->unique()
    ->values();

$linkedDbUuids = $dbLinkComments
    ->map(fn (string $c) => substr($c, strlen(LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX)))
    ->filter()
    ->values();

$tursoKeys = ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'LIBSQL_URL', 'DATABASE_URL'];
$connectionEnvs = $envVars
    ->filter(fn ($v) => in_array($v->key, $tursoKeys, true) || (is_string($v->comment) && str_starts_with($v->comment, LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX)))
    ->map(fn ($v) => [
        'key' => $v->key,
        'value_preview' => match (true) {
            str_contains(strtolower($v->key), 'token') => (strlen((string) $v->value) > 8
                ? substr((string) $v->value, 0, 4).'…'.substr((string) $v->value, -4).' (len='.strlen((string) $v->value).')'
                : '(short/empty)'),
            default => preg_replace('/:[^:@]+@/', ':***@', (string) $v->value),
        },
        'comment' => $v->comment,
        'is_runtime' => (bool) $v->is_runtime,
        'is_buildtime' => (bool) $v->is_buildtime,
    ])
    ->values()
    ->all();

$databases = [];
$explorer = app(LibsqlDatabaseExplorerService::class);
$transfer = app(LibsqlDatabaseTransferService::class);
$envSync = app(LibsqlConnectionEnvSync::class);

foreach ($linkedDbUuids as $dbUuid) {
    $database = StandaloneLibsql::query()
        ->with(['destination.server'])
        ->where('uuid', $dbUuid)
        ->first();

    if (! $database) {
        $databases[] = [
            'uuid' => $dbUuid,
            'found' => false,
        ];

        continue;
    }

    $server = $database->destination?->server;
    $fileExists = false;
    $overview = null;
    $integrity = null;
    $expectedValues = $envSync->valuesFor($database);
    $envMismatch = [];

    try {
        $fileExists = $transfer->databaseFileExists($database);
    } catch (Throwable $e) {
        $fileExists = false;
    }

    if ($fileExists) {
        try {
            $overview = $explorer->overview($database);
        } catch (Throwable $e) {
            $overview = ['available' => false, 'message' => $e->getMessage(), 'table_count' => 0, 'tables' => []];
        }

        try {
            $integrityRows = $transfer->queryJson($database, 'PRAGMA integrity_check;');
            $integrity = $integrityRows[0]['integrity_check'] ?? ($integrityRows[0] ?? $integrityRows);
        } catch (Throwable $e) {
            $integrity = 'error: '.$e->getMessage();
        }
    }

    foreach ($envVars as $variable) {
        if (! in_array($variable->key, $tursoKeys, true)) {
            continue;
        }
        if ($variable->comment !== LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX.$database->uuid) {
            continue;
        }
        $expected = $envSync->valueForEnvKey($variable->key, $expectedValues);
        if ($expected !== null && (string) $variable->value !== (string) $expected) {
            $envMismatch[] = [
                'key' => $variable->key,
                'status' => 'mismatch',
                'expected_preview' => preg_replace('/:[^:@]+@/', ':***@', (string) $expected),
                'actual_preview' => preg_replace('/:[^:@]+@/', ':***@', (string) $variable->value),
            ];
        } else {
            $envMismatch[] = [
                'key' => $variable->key,
                'status' => 'ok',
            ];
        }
    }

    $linkedAppsViaComment = EnvironmentVariable::query()
        ->where('is_preview', false)
        ->where('comment', LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX.$database->uuid)
        ->where('resourceable_type', Application::class)
        ->with('resourceable:id,uuid,name,status')
        ->get()
        ->groupBy(fn ($v) => $v->resourceable?->uuid)
        ->map(function ($vars, $uuid) {
            $app = $vars->first()->resourceable;

            return [
                'uuid' => $uuid,
                'name' => $app?->name,
                'status' => $app?->status,
                'env_keys' => $vars->pluck('key')->values()->all(),
            ];
        })
        ->values()
        ->all();

    $databases[] = [
        'found' => true,
        'uuid' => $database->uuid,
        'name' => $database->name,
        'status' => $database->status,
        'is_running' => method_exists($database, 'isRunning') ? $database->isRunning() : null,
        'is_public' => (bool) $database->is_public,
        'public_port' => $database->public_port,
        'server' => [
            'name' => $server?->name,
            'ip' => $server?->ip,
            'functional' => $server?->isFunctional(),
        ],
        'data_db_exists' => $fileExists,
        'integrity' => $integrity,
        'overview' => $overview,
        'expected_connection' => [
            'turso_url' => $expectedValues['turso_url'],
            'turso_url_external' => $expectedValues['turso_url_external'],
            'auth_user' => $expectedValues['auth_user'],
            'token_len' => strlen((string) $expectedValues['token']),
        ],
        'env_sync_check' => $envMismatch,
        'linked_applications' => $linkedAppsViaComment,
    ];
}

// Also search standalone libsql named starbase if no link found
if ($databases === []) {
    $candidates = StandaloneLibsql::query()
        ->with(['destination.server'])
        ->where('name', 'like', '%starbase%')
        ->orWhere('uuid', 'like', '%starbase%')
        ->get();

    foreach ($candidates as $database) {
        $fileExists = $transfer->databaseFileExists($database);
        $overview = $fileExists ? $explorer->overview($database) : null;
        $databases[] = [
            'found' => true,
            'uuid' => $database->uuid,
            'name' => $database->name,
            'status' => $database->status,
            'is_running' => method_exists($database, 'isRunning') ? $database->isRunning() : null,
            'data_db_exists' => $fileExists,
            'overview' => $overview,
            'note' => 'found_by_name_not_env_link',
        ];
    }
}

$recentDeployments = ApplicationDeploymentQueue::query()
    ->where('application_id', $application->id)
    ->latest('id')
    ->limit(5)
    ->get(['deployment_uuid', 'status', 'created_at', 'finished_at'])
    ->map(fn ($d) => [
        'uuid' => $d->deployment_uuid,
        'status' => $d->status,
        'created_at' => (string) $d->created_at,
        'finished_at' => (string) ($d->finished_at ?? ''),
    ])
    ->all();

$report = [
    'audited_at' => now()->toIso8601String(),
    'application' => [
        'uuid' => $application->uuid,
        'name' => $application->name,
        'status' => $application->status,
        'fqdn' => $application->fqdn,
        'project' => $application->environment?->project?->name,
        'environment' => $application->environment?->name,
        'server' => [
            'name' => $application->destination?->server?->name,
            'ip' => $application->destination?->server?->ip,
            'functional' => $application->destination?->server?->isFunctional(),
        ],
    ],
    'connection_env_variables' => $connectionEnvs,
    'linked_database_uuids' => $linkedDbUuids->all(),
    'databases' => $databases,
    'recent_deployments' => $recentDeployments,
    'checks' => [
        'has_db_link' => $linkedDbUuids->isNotEmpty(),
        'has_turso_or_libsql_env' => collect($connectionEnvs)->isNotEmpty(),
        'all_linked_dbs_running' => collect($databases)->every(fn ($d) => ($d['is_running'] ?? false) === true),
        'all_data_db_exist' => collect($databases)->every(fn ($d) => ($d['data_db_exists'] ?? false) === true),
        'all_integrity_ok' => collect($databases)->every(function ($d) {
            if (! ($d['data_db_exists'] ?? false)) {
                return false;
            }
            $integrity = $d['integrity'] ?? null;

            return $integrity === 'ok' || (is_array($integrity) && ($integrity['integrity_check'] ?? null) === 'ok');
        }),
        'env_sync_all_ok' => collect($databases)->every(function ($d) {
            $checks = $d['env_sync_check'] ?? [];
            if ($checks === []) {
                return false;
            }

            return collect($checks)->every(fn ($c) => ($c['status'] ?? '') === 'ok');
        }),
    ],
];

echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n";
