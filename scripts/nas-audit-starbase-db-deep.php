<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Application;
use App\Models\StandaloneLibsql;
use App\Services\DevForge\Database\LibsqlDatabaseTransferService;
use App\Actions\Database\StartDatabase;

$appUuid = 'julfme7qvjx8tzzypz6qzea0';
$dbUuid = 'btnfrll4ubmua4nvk73y4h6u';
$orphanUuid = 'w5gu3c9d5ezohux0wv63s5m4';

$application = Application::query()->with('environment_variables')->where('uuid', $appUuid)->firstOrFail();
$database = StandaloneLibsql::query()->with('destination.server')->where('uuid', $dbUuid)->firstOrFail();
$transfer = app(LibsqlDatabaseTransferService::class);

$orphanExists = StandaloneLibsql::query()->where('uuid', $orphanUuid)->exists();
$orphanAny = \DB::table('standalone_libsqls')->where('uuid', $orphanUuid)->first();

$countsSql = <<<'SQL'
SELECT 'users' AS name, COUNT(*) AS c FROM users
UNION ALL SELECT 'launches', COUNT(*) FROM launches
UNION ALL SELECT 'launch_sites', COUNT(*) FROM launch_sites
UNION ALL SELECT 'prototypes', COUNT(*) FROM prototypes
UNION ALL SELECT 'videos', COUNT(*) FROM videos
UNION ALL SELECT 'newsletter_subscribers', COUNT(*) FROM newsletter_subscribers
UNION ALL SELECT 'x_posts', COUNT(*) FROM x_posts
UNION ALL SELECT 'schema_migrations', COUNT(*) FROM schema_migrations
UNION ALL SELECT 'activity_logs', COUNT(*) FROM activity_logs
UNION ALL SELECT 'site_settings', COUNT(*) FROM site_settings;
SQL;

$rowCounts = [];
try {
    $rowCounts = $transfer->queryJson($database, $countsSql);
} catch (Throwable $e) {
    $rowCounts = [['error' => $e->getMessage()]];
}

$schemaSample = [];
try {
    $schemaSample = $transfer->queryJson($database, 'SELECT id, name FROM schema_migrations ORDER BY id DESC LIMIT 10;');
} catch (Throwable $e) {
    $schemaSample = [['error' => $e->getMessage()]];
}

$settingsSample = [];
try {
    $settingsSample = $transfer->queryJson($database, 'SELECT key, substr(cast(value as text),1,80) AS value FROM site_settings LIMIT 15;');
} catch (Throwable $e) {
    try {
        $settingsSample = $transfer->queryJson($database, 'PRAGMA table_info(site_settings);');
    } catch (Throwable $e2) {
        $settingsSample = [['error' => $e->getMessage(), 'pragma_error' => $e2->getMessage()]];
    }
}

// Docker inspection via SSH helper on Coolify host
$server = $database->destination->server;
$containerName = $database->uuid; // Coolify uses uuid as container name typically
$dockerPs = instant_remote_process(
    ["docker ps -a --filter name={$database->uuid} --format '{{.Names}}|{{.Status}}|{{.Image}}|{{.Ports}}'"],
    $server,
    false,
    no_sudo: true,
);
$dockerInspectHealth = instant_remote_process(
    ["docker inspect --format '{{.State.Status}}|{{.State.ExitCode}}|{{.State.Error}}|{{.State.Health.Status}}' {$database->uuid} 2>/dev/null || true"],
    $server,
    false,
    no_sudo: true,
);
$dockerLogs = instant_remote_process(
    ["docker logs --tail 40 {$database->uuid} 2>&1 || true"],
    $server,
    false,
    no_sudo: true,
);

// App container env peek for LIBSQL/TURSO
$appContainer = instant_remote_process(
    ["docker ps -a --filter name={$application->uuid} --format '{{.Names}}|{{.Status}}'"],
    $application->destination->server,
    false,
    no_sudo: true,
);
$appEnvPeek = instant_remote_process(
    ["docker exec {$application->uuid} sh -c 'printenv LIBSQL_URL; printenv TURSO_DATABASE_URL; printenv TURSO_AUTH_TOKEN | wc -c' 2>/dev/null || true"],
    $application->destination->server,
    false,
    no_sudo: true,
);

// Volume size
$volumeInfo = instant_remote_process(
    ["docker volume inspect libsql-data-{$database->uuid} --format '{{.Name}}|{{.Mountpoint}}' 2>/dev/null; docker run --rm -v libsql-data-{$database->uuid}:/var/lib/sqld:ro alpine:3.20 sh -c 'ls -lah /var/lib/sqld/ 2>/dev/null || true'"],
    $server,
    false,
    no_sudo: true,
);

$allLibsql = StandaloneLibsql::query()
    ->select(['uuid', 'name', 'status', 'created_at', 'updated_at'])
    ->orderByDesc('updated_at')
    ->limit(20)
    ->get()
    ->map(fn ($d) => [
        'uuid' => $d->uuid,
        'name' => $d->name,
        'status' => $d->status,
        'updated_at' => (string) $d->updated_at,
    ])
    ->all();

echo json_encode([
    'database_status' => $database->status,
    'is_running' => $database->isRunning(),
    'orphan_turso_uuid_exists' => $orphanExists,
    'orphan_row' => $orphanAny,
    'row_counts' => $rowCounts,
    'schema_migrations_sample' => $schemaSample,
    'site_settings_sample' => $settingsSample,
    'docker_ps' => trim((string) $dockerPs),
    'docker_inspect' => trim((string) $dockerInspectHealth),
    'docker_logs_tail' => trim((string) $dockerLogs),
    'app_container' => trim((string) $appContainer),
    'app_runtime_env' => trim((string) $appEnvPeek),
    'volume_info' => trim((string) $volumeInfo),
    'recent_libsql_dbs' => $allLibsql,
    'app_env_preference_note' => 'App has both LIBSQL_URL (btnfr...) and TURSO_* (orphan w5gu...). Runtime client choice depends on app code.',
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n";
