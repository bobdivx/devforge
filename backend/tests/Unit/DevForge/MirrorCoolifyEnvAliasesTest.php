<?php

use Illuminate\Support\Collection;

it('mirrors COOLIFY_* keys to DEVFORGE_* aliases on associative collections', function () {
    $vars = collect([
        'COOLIFY_APP_NAME' => '"demo"',
        'COOLIFY_SERVER_IP' => '"10.0.0.1"',
        'OTHER' => 'x',
    ]);

    mirror_coolify_env_aliases_to_devforge($vars);

    expect($vars->get('DEVFORGE_APP_NAME'))->toBe('"demo"')
        ->and($vars->get('DEVFORGE_SERVER_IP'))->toBe('"10.0.0.1"')
        ->and($vars->get('COOLIFY_APP_NAME'))->toBe('"demo"')
        ->and($vars->has('DEVFORGE_PROJECT_NAME'))->toBeFalse();
});

it('does not overwrite existing DEVFORGE_* values', function () {
    $vars = collect([
        'COOLIFY_APP_NAME' => '"old"',
        'DEVFORGE_APP_NAME' => '"kept"',
    ]);

    mirror_coolify_env_aliases_to_devforge($vars);

    expect($vars->get('DEVFORGE_APP_NAME'))->toBe('"kept"');
});

it('mirrors list-style env entries', function () {
    /** @var Collection<int, string> $vars */
    $vars = collect([
        'COOLIFY_APP_NAME="demo"',
        'FOO=bar',
    ]);

    mirror_coolify_env_aliases_to_devforge($vars);

    expect($vars->contains('DEVFORGE_APP_NAME="demo"'))->toBeTrue()
        ->and($vars->contains('COOLIFY_APP_NAME="demo"'))->toBeTrue();
});
