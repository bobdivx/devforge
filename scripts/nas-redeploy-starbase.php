<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Application;
use App\Services\DevForge\Core\CoreResourceAction;

echo 'control_resource_fix='.(str_contains(
    (string) file_get_contents($basePath.'/app/Services/DevForge/Core/CoreResourceAction.php'),
    'resolveTeamId'
) ? 'yes' : 'no').PHP_EOL;

$application = Application::query()
    ->with(['environment.project', 'environment_variables'])
    ->where('uuid', 'julfme7qvjx8tzzypz6qzea0')
    ->firstOrFail();

$puppeteer = $application->environment_variables
    ->firstWhere('key', 'PUPPETEER_SKIP_DOWNLOAD');

echo 'puppeteer_env='.($puppeteer?->value ?? 'MISSING').PHP_EOL;
echo 'horizon=';
passthru('php artisan horizon:status');

$action = app(CoreResourceAction::class);
$result = $action->execute($application, 'applications', 'deploy', ['is_api' => true]);

echo 'deploy_result='.json_encode($result, JSON_UNESCAPED_UNICODE).PHP_EOL;
