<?php

use App\Models\InstanceSettings;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;

require '/var/www/html/vendor/autoload.php';

$app = require '/var/www/html/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

Artisan::call('config:clear');

$versions = File::get('/tmp/versions.json');
File::put(base_path('versions.json'), $versions);
Cache::forget('coolify:versions:all');

InstanceSettings::query()->whereKey(0)->update(['new_version_available' => false]);

$latest = get_latest_version_of_coolify();
$current = (string) config('constants.coolify.version');
$url = (string) config('constants.coolify.versions_url');

echo "current={$current}\n";
echo "latest={$latest}\n";
echo "url={$url}\n";
echo 'flag='.(InstanceSettings::query()->whereKey(0)->value('new_version_available') ? '1' : '0')."\n";
