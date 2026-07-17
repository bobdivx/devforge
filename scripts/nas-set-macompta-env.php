<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Application;
use App\Models\EnvironmentVariable;
use App\Services\DevForge\Core\CoreResourceAction;
use Visus\Cuid2\Cuid2;

$envFile = $argv[1] ?? '/tmp/macompta.env.json';
$payload = json_decode((string) file_get_contents($envFile), true);
if (! is_array($payload)) {
    fwrite(STDERR, "invalid env payload\n");
    exit(1);
}

$a = Application::query()->where('uuid', 'wyo3a2eut7kknr0tii0uvfur')->firstOrFail();
$set = [];

foreach ($payload as $key => $value) {
    if (! is_string($key) || ! is_string($value) || $value === '') {
        continue;
    }
    EnvironmentVariable::query()->updateOrCreate(
        [
            'key' => $key,
            'is_preview' => false,
            'resourceable_type' => Application::class,
            'resourceable_id' => $a->id,
        ],
        [
            'value' => $value,
            'is_runtime' => true,
            'is_buildtime' => false,
            'is_literal' => false,
            'is_multiline' => false,
            'is_shown_once' => false,
        ],
    );
    $set[] = $key;
}

$deploymentUuid = (string) new Cuid2;
$result = queue_application_deployment(
    application: $a->fresh(),
    deployment_uuid: $deploymentUuid,
    force_rebuild: false,
    restart_only: false,
    is_api: true,
    no_questions_asked: true,
);

echo json_encode([
    'keys_set' => $set,
    'deployment_uuid' => $deploymentUuid,
    'result' => $result,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n";
