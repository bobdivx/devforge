#!/usr/bin/env bash
set -euo pipefail

docker exec -i devforge-api php -r '
require "/var/www/html/vendor/autoload.php";
$app = require "/var/www/html/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Actions\Database\StartDatabase;
use App\Models\Application;
use App\Models\StandaloneLibsql;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Database\LibsqlConnectionEnvSync;
use App\Services\DevForge\Database\LibsqlJwtCredentials;
use App\Services\DevForge\Database\LibsqlDatabaseTransferService;

$targets = [
  ["app" => "haoqu0cfogpsssh4j62v3gk1", "db" => "ozgwcnbd4lhwrbrhqm2scnfx", "keys" => ["TURSO_DATABASE_URL","TURSO_AUTH_TOKEN"]],
  ["app" => "wyo3a2eut7kknr0tii0uvfur", "db" => "rc354w7po4au4hh32k93x8rf", "keys" => ["LIBSQL_URL","TURSO_AUTH_TOKEN"]],
  ["app" => "nlkkhfe0ubnw11w9ad0qmy5v", "db" => "wjaea5uh116xokoit7ryfphi", "keys" => ["LIBSQL_URL","TURSO_AUTH_TOKEN"]],
];

$envSync = app(LibsqlConnectionEnvSync::class);
$jwt = app(LibsqlJwtCredentials::class);
$transfer = app(LibsqlDatabaseTransferService::class);
$action = app(CoreResourceAction::class);
$report = [];

foreach ($targets as $t) {
  $item = ["app" => $t["app"], "db" => $t["db"], "steps" => []];
  try {
    $database = StandaloneLibsql::with("destination.server")->where("uuid", $t["db"])->firstOrFail();
    $application = Application::with("environment_variables")->where("uuid", $t["app"])->firstOrFail();

    $item["name"] = $application->name;
    $item["db_name"] = $database->name;
    $item["before"] = [
      "status" => $database->status,
      "data_exists" => $transfer->databaseFileExists($database),
    ];

    $jwt->ensure($database->fresh());
    $database->refresh();
    if (substr_count((string) $database->libsql_auth_token, '.') !== 2) {
      $jwt->regenerateToken($database);
      $database->refresh();
    }

    StartDatabase::run($database);
    sleep(8);
    $database->refresh();

    $ps = trim((string) instant_remote_process(
      ["docker inspect --format \"{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}no{{end}}\" {$database->uuid} 2>/dev/null || echo missing"],
      $database->destination->server,
      false,
      no_sudo: true,
    ));
    $item["docker_after_start"] = $ps;
    if (str_starts_with($ps, "running")) {
      $health = explode("|", $ps)[1] ?? "unknown";
      $database->status = "running:".(in_array($health, ["healthy","starting"], true) ? "healthy" : "unhealthy");
      $database->save();
    }

    $values = $envSync->valuesFor($database->fresh());
    $comment = LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX.$database->uuid;
    foreach ($t["keys"] as $key) {
      $value = $envSync->valueForEnvKey($key, $values);
      if ($value === null) continue;
      $application->environment_variables()->updateOrCreate(
        ["key" => $key, "is_preview" => false],
        [
          "value" => $value,
          "is_runtime" => true,
          "is_buildtime" => true,
          "is_literal" => false,
          "is_multiline" => false,
          "is_shown_once" => false,
          "comment" => $comment,
          "resourceable_type" => $application->getMorphClass(),
          "resourceable_id" => $application->id,
        ],
      );
    }

    // Also normalize TURSO_* if LIBSQL preferred, keep both consistent for JWT apps
    foreach (["TURSO_DATABASE_URL","TURSO_AUTH_TOKEN","LIBSQL_URL"] as $key) {
      $existing = $application->environment_variables()->where("key", $key)->where("is_preview", false)->first();
      if (! $existing) continue;
      $value = $envSync->valueForEnvKey($key, $values);
      if ($value === null) continue;
      $existing->value = $value;
      $existing->comment = $comment;
      $existing->is_runtime = true;
      $existing->save();
    }

    $item["env"] = $application->fresh()->environment_variables
      ->where("is_preview", false)
      ->filter(fn ($v) => in_array($v->key, ["LIBSQL_URL","TURSO_DATABASE_URL","TURSO_AUTH_TOKEN"], true))
      ->map(fn ($v) => [
        "key" => $v->key,
        "value" => $v->key === "TURSO_AUTH_TOKEN"
          ? ("len=".strlen((string)$v->value)." jwt=".(substr_count((string)$v->value,".")===2?"yes":"no"))
          : (string)$v->value,
      ])->values()->all();

    // Hotfix recreate app container with new env (avoid full rebuild)
    $server = $application->destination->server;
    $old = trim((string) instant_remote_process(
      ["docker ps --filter name={$application->uuid} --format \"{{.Names}}\" | head -1"],
      $server, false, no_sudo: true,
    ));
    $item["old_container"] = $old;
    if ($old !== "") {
      $url = $values["turso_url"];
      $token = $values["token"];
      // write env + recreate via python on host through remote process is heavy;
      // queue restart_only deploy instead
      $item["restart"] = $action->execute($application, "applications", "restart", [
        "is_api" => true,
        "instant_deploy" => true,
      ]);
    }

    $item["ok"] = true;
  } catch (Throwable $e) {
    $item["ok"] = false;
    $item["error"] = $e->getMessage();
    $item["at"] = $e->getFile().":".$e->getLine();
  }
  $report[] = $item;
}

echo json_encode($report, JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES),"\n";
'
