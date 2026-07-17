<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Actions\Database\StartDatabase;
use App\Models\StandaloneLibsql;

$dbUuid = 'btnfrll4ubmua4nvk73y4h6u';
$database = StandaloneLibsql::query()->with('destination.server')->where('uuid', $dbUuid)->firstOrFail();
$server = $database->destination->server;
$configDir = database_configuration_dir().'/'.$dbUuid;

echo "config_dir={$configDir}\n";

$probe = instant_remote_process([
    "ls -la ".escapeshellarg(dirname($configDir))." 2>&1 | head -30",
    "ls -la ".escapeshellarg($configDir)." 2>&1 || true",
    "id; whoami",
], $server, false, no_sudo: true);
echo "probe_before=\n{$probe}\n";

// Fix ownership/permissions for Coolify database config dir
$fix = instant_remote_process([
    "mkdir -p ".escapeshellarg($configDir),
    "chmod 775 ".escapeshellarg(dirname($configDir))." 2>/dev/null || true",
    "chmod -R ug+rwX ".escapeshellarg($configDir)." 2>/dev/null || true",
    // Ensure the SSH user can write README/docker-compose
    "chown -R \$(id -u):\$(id -g) ".escapeshellarg($configDir)." 2>/dev/null || true",
    "touch ".escapeshellarg($configDir.'/write-test')." && rm -f ".escapeshellarg($configDir.'/write-test')." && echo WRITE_OK || echo WRITE_FAIL",
    "ls -la ".escapeshellarg($configDir),
], $server, false, no_sudo: true);
echo "fix_no_sudo=\n{$fix}\n";

// Retry with sudo wrappers if needed
if (! str_contains((string) $fix, 'WRITE_OK')) {
    $fixSudo = instant_remote_process([
        "sudo mkdir -p ".escapeshellarg($configDir),
        "sudo chmod 777 ".escapeshellarg($configDir),
        "sudo chown -R \$(id -u):\$(id -g) ".escapeshellarg($configDir),
        "touch ".escapeshellarg($configDir.'/write-test')." && rm -f ".escapeshellarg($configDir.'/write-test')." && echo WRITE_OK || echo WRITE_FAIL",
        "ls -la ".escapeshellarg($configDir),
    ], $server, false, no_sudo: true);
    echo "fix_sudo=\n{$fixSudo}\n";
}

echo "starting_database...\n";
try {
    $activity = StartDatabase::run($database);
    echo 'start_dispatched=yes activity='.(is_object($activity) ? get_class($activity) : gettype($activity))."\n";
    if (is_object($activity) && method_exists($activity, 'id')) {
        echo 'activity_id='.$activity->id."\n";
    }
} catch (Throwable $e) {
    echo 'start_error='.$e->getMessage()."\n";
}

// Poll container up to ~90s
for ($i = 1; $i <= 18; $i++) {
    sleep(5);
    $ps = trim((string) instant_remote_process(
        ["docker ps -a --filter name={$dbUuid} --format '{{.Names}}|{{.Status}}'"],
        $server,
        false,
        no_sudo: true,
    ));
    $database->refresh();
    echo "t={$i} ps=".($ps !== '' ? $ps : 'NONE').' status='.$database->status.' running='.($database->isRunning() ? 'yes' : 'no')."\n";
    if (str_contains($ps, 'Up')) {
        break;
    }
}

// Dump latest activity output
$activityRow = \DB::table('activity_log')->orderByDesc('id')->first();
echo 'latest_activity_id='.($activityRow->id ?? 'null')."\n";
echo 'latest_activity='.substr((string) ($activityRow->description ?? ''), 0, 2000)."\n";
