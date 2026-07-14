<?php

it('uses BASE_CONFIG_PATH for base_configuration_dir', function () {
    config(['constants.coolify.base_config_path' => '/media/Docker/AppData/coolify/data']);

    expect(base_configuration_dir())->toBe('/media/Docker/AppData/coolify/data')
        ->and(application_configuration_dir())->toBe('/media/Docker/AppData/coolify/data/applications');
});

it('falls back to /data/coolify when BASE_CONFIG_PATH is not configured', function () {
    config(['constants.coolify.base_config_path' => '/data/coolify']);

    expect(base_configuration_dir())->toBe('/data/coolify');
});
