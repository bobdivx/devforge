#!/bin/bash
set -e
docker exec -w /var/www/html devforge-api php artisan tinker --execute='
use App\Services\DevForge\Core\CoreResourcePresenter;
use App\Services\DevForge\Github\GithubRunnerInventory;
use App\Models\Team;

$team = Team::query()->orderBy("id")->first();
$user = $team->members()->first() ?? App\Models\User::query()->first();
$apps = App\Models\Application::query()->get();
foreach ($apps->filter(fn ($a) => str_contains(strtolower($a->name), "popcorn")) as $app) {
  $p = new CoreResourcePresenter($app);
  // presenter might need different construction - try reflection on private method via API shape
  echo "raw_git=".$app->git_repository.PHP_EOL;
}

// Simulate frontend normalize
$keys = [];
foreach ($apps as $app) {
  $git = (string) ($app->git_repository ?? "");
  if ($git === "") continue;
  $keys[$app->name] = strtolower(preg_replace("#\\.git$#", "", preg_replace("#^(https?://)?(www\\.)?github\\.com/#i", "", $git)));
}
echo "app_keys:\n";
foreach ($keys as $n=>$k) echo "  $n => $k\n";

$inv = app(GithubRunnerInventory::class);
Illuminate\Support\Facades\Cache::forget("devforge.github.runners.list.".$team->id);
$list = $inv->listForTeam($team);
echo "runner_keys:\n";
foreach ($list as $r) {
  $repo = $r["github_repo"] ?? $r["repo_url"] ?? null;
  echo "  ".($r["name"])." => ".($repo ?: "(null)")." state=".($r["state"]??"?").PHP_EOL;
}
'
