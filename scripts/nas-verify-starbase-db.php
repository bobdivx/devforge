<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\StandaloneLibsql;
use App\Services\DevForge\Database\LibsqlDatabaseTransferService;

$appUuid = 'julfme7qvjx8tzzypz6qzea0';
$dbUuid = 'btnfrll4ubmua4nvk73y4h6u';

$database = StandaloneLibsql::query()->with('destination.server')->where('uuid', $dbUuid)->firstOrFail();
$application = Application::query()->with(['environment_variables', 'destination.server'])->where('uuid', $appUuid)->firstOrFail();
$transfer = app(LibsqlDatabaseTransferService::class);

$server = $database->destination->server;
$dockerPs = trim((string) instant_remote_process(
    ["docker ps -a --filter name={$dbUuid} --format '{{.Names}}|{{.Status}}|{{.Ports}}'"],
    $server,
    false,
    no_sudo: true,
));

$health = trim((string) instant_remote_process(
    ["docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}no-health{{end}}|{{.State.ExitCode}}' {$dbUuid} 2>/dev/null || echo missing"],
    $server,
    false,
    no_sudo: true,
));

$appContainer = trim((string) instant_remote_process(
    ["docker ps --filter name={$appUuid} --format '{{.Names}}|{{.Status}}'"],
    $application->destination->server,
    false,
    no_sudo: true,
));

$appContainerName = explode('|', $appContainer)[0] ?? '';
$runtimeEnv = '';
$dnsProbe = '';
$httpProbe = '';

if ($appContainerName !== '') {
    $runtimeEnv = trim((string) instant_remote_process(
        ["docker exec {$appContainerName} sh -c 'printenv LIBSQL_URL; printenv TURSO_DATABASE_URL; printenv TURSO_AUTH_TOKEN | wc -c'"],
        $application->destination->server,
        false,
        no_sudo: true,
    ));
    // redact token in LIBSQL_URL for report
    $runtimeEnv = preg_replace('/:[^:@]+@/', ':***@', $runtimeEnv) ?? $runtimeEnv;

    $dnsProbe = trim((string) instant_remote_process(
        ["docker exec {$appContainerName} sh -c 'getent hosts {$dbUuid} || nslookup {$dbUuid} 2>&1 | head -5'"],
        $application->destination->server,
        false,
        no_sudo: true,
    ));

    $httpProbe = trim((string) instant_remote_process(
        ["docker exec {$appContainerName} sh -c 'wget -qO- --timeout=5 http://{$dbUuid}:8080/ 2>&1 | head -c 200; echo; wget -qO- --timeout=5 http://{$dbUuid}:8080/health 2>&1 | head -c 200; echo'"],
        $application->destination->server,
        false,
        no_sudo: true,
    ));
}

$rowCounts = [];
try {
    $rowCounts = $transfer->queryJson(
        $database,
        "SELECT 'users' AS name, COUNT(*) AS c FROM users UNION ALL SELECT 'prototypes', COUNT(*) FROM prototypes UNION ALL SELECT 'videos', COUNT(*) FROM videos;",
    );
} catch (Throwable $e) {
    $rowCounts = [['error' => $e->getMessage()]];
}

$latestDeploy = ApplicationDeploymentQueue::query()
    ->where('application_id', $application->id)
    ->latest('id')
    ->first(['deployment_uuid', 'status', 'created_at', 'finished_at']);

$envOk = $application->environment_variables
    ->where('is_preview', false)
    ->filter(fn ($v) => in_array($v->key, ['LIBSQL_URL', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'], true))
    ->every(function ($v) use ($dbUuid) {
        if ($v->key === 'TURSO_AUTH_TOKEN') {
            return str_contains((string) $v->comment, $dbUuid) && strlen((string) $v->value) > 10;
        }

        return str_contains((string) $v->value, $dbUuid);
    });

$orphanPresent = $application->environment_variables
    ->where('is_preview', false)
    ->contains(fn ($v) => str_contains((string) $v->value, 'w5gu3c9d5ezohux0wv63s5m4')
        || str_contains((string) $v->comment, 'w5gu3c9d5ezohux0wv63s5m4'));

echo json_encode([
    'db' => [
        'status' => $database->status,
        'is_running' => $database->isRunning(),
        'data_db_exists' => $transfer->databaseFileExists($database),
        'docker_ps' => $dockerPs,
        'health' => $health,
    ],
    'app' => [
        'status' => $application->status,
        'container' => $appContainer,
        'runtime_env' => $runtimeEnv,
        'dns_probe' => $dnsProbe,
        'http_probe' => $httpProbe,
        'env_points_to_live_db' => $envOk,
        'orphan_turso_present' => $orphanPresent,
    ],
    'row_counts' => $rowCounts,
    'latest_deployment' => $latestDeploy ? [
        'uuid' => $latestDeploy->deployment_uuid,
        'status' => $latestDeploy->status,
        'created_at' => (string) $latestDeploy->created_at,
        'finished_at' => (string) ($latestDeploy->finished_at ?? ''),
    ] : null,
    'checks' => [
        'db_container_up' => str_contains($dockerPs, 'Up'),
        'db_running_flag' => $database->isRunning(),
        'env_clean' => $envOk && ! $orphanPresent,
        'dns_resolves' => $dnsProbe !== '' && ! str_contains(strtolower($dnsProbe), 'not found'),
    ],
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n";
