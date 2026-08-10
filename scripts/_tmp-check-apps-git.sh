#!/bin/bash
set -e
docker exec -w /var/www/html devforge-api php artisan tinker --execute='
$apps = App\Models\Application::query()->with("environment.project")->get();
echo "apps_count=".$apps->count().PHP_EOL;
foreach ($apps as $app) {
  $name = $app->name;
  $git = $app->git_repository ?? null;
  $branch = $app->git_branch ?? null;
  $uuid = $app->uuid;
  echo "APP name={$name} uuid={$uuid} git=".($git ?: "(null)")." branch=".($branch ?: "(null)").PHP_EOL;
}
echo "--- services ---".PHP_EOL;
if (class_exists(App\Models\Service::class)) {
  foreach (App\Models\Service::query()->limit(30)->get() as $svc) {
    echo "SVC name={$svc->name} uuid={$svc->uuid}".PHP_EOL;
  }
}
'
