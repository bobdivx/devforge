<?php

test('application compose start recreates containers so .env changes apply', function () {
    $source = file_get_contents(app_path('Jobs/ApplicationDeploymentJob.php'));

    expect($source)->toContain('up -d --force-recreate --remove-orphans')
        ->and(substr_count($source, 'up -d --force-recreate --remove-orphans'))->toBeGreaterThanOrEqual(3);
});
