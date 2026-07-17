<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Actions\Database\StartDatabase;
use App\Models\Application;
use App\Models\EnvironmentVariable;
use App\Models\StandaloneLibsql;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Database\LibsqlConnectionEnvSync;
use App\Services\DevForge\Database\LibsqlDatabaseTransferService;

$appUuid = 'julfme7qvjx8tzzypz6qzea0';
$dbUuid = 'btnfrll4ubmua4nvk73y4h6u';
$orphanUuid = 'w5gu3c9d5ezohux0wv63s5m4';

$report = ['steps' => []];

$database = StandaloneLibsql::query()
    ->with('destination.server')
    ->where('uuid', $dbUuid)
    ->firstOrFail();

$application = Application::query()
    ->with(['environment_variables', 'destination.server', 'environment.project'])
    ->where('uuid', $appUuid)
    ->firstOrFail();

$envSync = app(LibsqlConnectionEnvSync::class);
$transfer = app(LibsqlDatabaseTransferService::class);

$report['before'] = [
    'db_status' => $database->status,
    'db_running' => $database->isRunning(),
    'data_db_exists' => $transfer->databaseFileExists($database),
];

// 1) Start DB
$report['steps'][] = 'start_database';
try {
    StartDatabase::run($database);
    $report['start'] = ['ok' => true];
} catch (Throwable $e) {
    $report['start'] = [
        'ok' => false,
        'error' => $e->getMessage(),
        'file' => $e->getFile().':'.$e->getLine(),
    ];
}

sleep(5);
$database->refresh();
$report['after_start'] = [
    'db_status' => $database->status,
    'db_running' => $database->isRunning(),
];

// 2) Remove orphan TURSO env vars
$report['steps'][] = 'cleanup_orphan_turso_env';
$orphanComment = LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX.$orphanUuid;
$orphans = EnvironmentVariable::query()
    ->where('resourceable_type', Application::class)
    ->where('resourceable_id', $application->id)
    ->where('is_preview', false)
    ->where(function ($q) use ($orphanComment, $orphanUuid) {
        $q->where('comment', $orphanComment)
            ->orWhere(function ($q2) use ($orphanUuid) {
                $q2->whereIn('key', ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'LIBSQL_URL'])
                    ->where(function ($q3) use ($orphanUuid) {
                        $q3->where('value', 'like', '%'.$orphanUuid.'%')
                            ->orWhere('comment', 'like', '%'.$orphanUuid.'%');
                    });
            });
    })
    ->get();

$deletedKeys = [];
foreach ($orphans as $variable) {
    $deletedKeys[] = $variable->key;
    $variable->delete();
}
$report['orphan_env_deleted'] = $deletedKeys;

// 3) Point LIBSQL_URL + TURSO_* to the live DB
$report['steps'][] = 'resync_connection_env';
$values = $envSync->valuesFor($database);
$comment = LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX.$database->uuid;

foreach (['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'LIBSQL_URL'] as $key) {
    $value = $envSync->valueForEnvKey($key, $values);
    if ($value === null) {
        continue;
    }

    $application->environment_variables()->updateOrCreate(
        ['key' => $key, 'is_preview' => false],
        [
            'value' => $value,
            'is_runtime' => true,
            'is_buildtime' => true,
            'is_literal' => false,
            'is_multiline' => false,
            'is_shown_once' => false,
            'comment' => $comment,
            'resourceable_type' => $application->getMorphClass(),
            'resourceable_id' => $application->id,
        ],
    );
}

$application->refresh();
$application->load('environment_variables');
$report['env_after'] = $application->environment_variables
    ->where('is_preview', false)
    ->filter(fn ($v) => in_array($v->key, ['LIBSQL_URL', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'], true))
    ->map(fn ($v) => [
        'key' => $v->key,
        'comment' => $v->comment,
        'value_preview' => preg_replace('/:[^:@]+@/', ':***@', (string) $v->value),
        'points_to_live_db' => str_contains((string) $v->value, $dbUuid)
            || ($v->key === 'TURSO_AUTH_TOKEN' && (string) $v->comment === $comment),
        'token_len' => $v->key === 'TURSO_AUTH_TOKEN' ? strlen((string) $v->value) : null,
    ])
    ->values()
    ->all();

// 4) Restart application
$report['steps'][] = 'restart_application';
$action = app(CoreResourceAction::class);
$report['restart'] = $action->execute($application, 'applications', 'restart', [
    'is_api' => true,
    'instant_deploy' => true,
]);

echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n";
