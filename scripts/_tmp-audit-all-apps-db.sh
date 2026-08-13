#!/usr/bin/env bash
set -euo pipefail

docker exec -i devforge-api php -r '
require "/var/www/html/vendor/autoload.php";
$app = require "/var/www/html/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Application;
use App\Models\EnvironmentVariable;
use App\Models\StandaloneLibsql;
use App\Services\DevForge\Database\LibsqlConnectionEnvSync;

$prefix = LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX;
$report = [];

$apps = Application::query()
    ->with(["environment_variables", "destination.server", "environment.project"])
    ->orderBy("name")
    ->get();

foreach ($apps as $application) {
    $envVars = $application->environment_variables->where("is_preview", false);
    $dbComments = $envVars
        ->pluck("comment")
        ->filter(fn ($c) => is_string($c) && str_starts_with($c, $prefix))
        ->unique()
        ->values();

    $linked = [];
    foreach ($dbComments as $comment) {
        $uuid = substr($comment, strlen($prefix));
        $db = StandaloneLibsql::query()->where("uuid", $uuid)->first();
        $docker = null;
        if ($db?->destination?->server) {
            $docker = trim((string) instant_remote_process(
                ["docker inspect --format \"{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}no{{end}}\" {$uuid} 2>/dev/null || echo missing"],
                $db->destination->server,
                false,
                no_sudo: true,
            ));
        }
        $linked[] = [
            "uuid" => $uuid,
            "name" => $db?->name,
            "status" => $db?->status,
            "docker" => $docker,
            "found" => (bool) $db,
        ];
    }

    $turso = $envVars->filter(fn ($v) => in_array($v->key, ["TURSO_DATABASE_URL","TURSO_AUTH_TOKEN","LIBSQL_URL","DATABASE_URL"], true))
        ->map(fn ($v) => [
            "key" => $v->key,
            "comment" => $v->comment,
            "value_preview" => str_contains(strtolower($v->key), "token")
                ? ("len=".strlen((string)$v->value)." jwt=".(substr_count((string)$v->value,".")===2?"yes":"no"))
                : preg_replace("/:[^:@]+@/", ":***@", (string)$v->value),
            "looks_basic_embedded" => (bool) preg_match("#^(libsql|https?)://[^/@]+:[^/@]+@#", (string)$v->value),
            "uses_libsql_scheme" => str_starts_with((string)$v->value, "libsql://"),
            "uses_http" => str_starts_with((string)$v->value, "http://"),
        ])->values()->all();

    if ($linked === [] && $turso === []) {
        continue;
    }

    $appDocker = "";
    if ($application->destination?->server) {
        $appDocker = trim((string) instant_remote_process(
            ["docker ps --filter name={$application->uuid} --format \"{{.Names}}|{{.Status}}\" | head -1"],
            $application->destination->server,
            false,
            no_sudo: true,
        ));
    }

    $issues = [];
    foreach ($linked as $l) {
        if (!($l["found"] ?? false)) $issues[] = "db_missing_".$l["uuid"];
        elseif (str_starts_with((string)$l["status"], "exited") || ($l["docker"] ?? "") === "missing" || str_starts_with((string)($l["docker"] ?? ""), "exited")) {
            $issues[] = "db_down_".$l["uuid"];
        } elseif (!str_contains((string)($l["docker"] ?? ""), "healthy") && str_starts_with((string)($l["docker"] ?? ""), "running")) {
            $issues[] = "db_unhealthy_".$l["uuid"];
        }
    }
    foreach ($turso as $t) {
        if ($t["looks_basic_embedded"]) $issues[] = "basic_embedded_".$t["key"];
        if ($t["key"] === "TURSO_AUTH_TOKEN" && str_ends_with($t["value_preview"], "jwt=no")) $issues[] = "token_not_jwt";
        if (in_array($t["key"], ["TURSO_DATABASE_URL","LIBSQL_URL"], true) && $t["uses_libsql_scheme"] && !str_contains($t["value_preview"], "turso.io")) {
            $issues[] = "libsql_scheme_selfhosted_".$t["key"];
        }
    }

    $report[] = [
        "uuid" => $application->uuid,
        "name" => $application->name,
        "status" => $application->status,
        "project" => $application->environment?->project?->name,
        "app_docker" => $appDocker,
        "linked_dbs" => $linked,
        "env" => $turso,
        "issues" => $issues,
    ];
}

// Also list exited libsql DBs even if not linked
$orphanDbs = StandaloneLibsql::query()->orderBy("name")->get()->map(function ($db) {
    $docker = "n/a";
    if ($db->destination?->server) {
        $docker = trim((string) instant_remote_process(
            ["docker inspect --format \"{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}no{{end}}\" {$db->uuid} 2>/dev/null || echo missing"],
            $db->destination->server,
            false,
            no_sudo: true,
        ));
    }
    return [
        "uuid" => $db->uuid,
        "name" => $db->name,
        "status" => $db->status,
        "docker" => $docker,
    ];
})->all();

echo json_encode([
    "apps_with_db_env" => $report,
    "all_libsql" => $orphanDbs,
    "apps_with_issues" => array_values(array_filter($report, fn ($r) => $r["issues"] !== [])),
], JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES),"\n";
'
