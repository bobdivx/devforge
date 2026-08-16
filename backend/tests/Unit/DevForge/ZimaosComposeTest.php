<?php

use Symfony\Component\Yaml\Yaml;

/**
 * @return array<string, mixed>
 */
function zimaosCompose(string $path): array
{
    expect(is_file($path))->toBeTrue();

    return Yaml::parseFile($path);
}

/**
 * @param  array<int, string>  $environment
 */
function zimaosEnv(array $environment, string $key): ?string
{
    foreach ($environment as $line) {
        if (str_starts_with($line, $key.'=')) {
            return substr($line, strlen($key) + 1);
        }
    }

    return null;
}

it('keeps the ZimaOS compose copies identical', function () {
    $root = dirname(base_path());
    $import = $root.DIRECTORY_SEPARATOR.'devforge.zimaos.yaml';
    $canonical = $root.DIRECTORY_SEPARATOR.'docker'.DIRECTORY_SEPARATOR.'zimaos'.DIRECTORY_SEPARATOR.'devforge.yaml';

    expect(is_file($import))->toBeTrue()
        ->and(is_file($canonical))->toBeTrue()
        ->and(file_get_contents($import))->toBe(file_get_contents($canonical));
});

it('starts DevForge on ZimaOS with web, proxy, and AppData paths', function (string $relativePath) {
    $path = dirname(base_path()).DIRECTORY_SEPARATOR.$relativePath;
    $compose = zimaosCompose($path);
    $services = $compose['services'];

    expect($services)->toHaveKeys(['proxy', 'web', 'api', 'db', 'redis', 'realtime']);

    foreach ($services as $service) {
        expect($service)->not->toHaveKey('network_mode');
        expect($service['deploy']['resources'] ?? [])->not->toHaveKey('limits');
        expect($service['image'])->not->toContain('${');
    }

    expect($services['proxy']['ports'][0]['published'])->toBe('8080')
        ->and($services['proxy']['volumes'][0]['source'])->toBe('/media/Docker/AppData/devforge/nginx/default.conf')
        ->and($services['web']['image'])->toBe('bobdivx/devforge:web')
        ->and($services['api']['image'])->toBe('bobdivx/devforge:latest')
        ->and($services['realtime']['image'])->toBe('bobdivx/devforge:realtime')
        ->and($services['db']['volumes'][0]['source'])->toBe('/media/Docker/AppData/devforge/postgres')
        ->and($services['redis']['volumes'][0]['source'])->toBe('/media/Docker/AppData/devforge/redis')
        ->and($services['api']['depends_on'])->toHaveKeys(['db', 'redis', 'realtime'])
        ->and($compose['x-casaos']['port_map'])->toBe('8080');

    $env = $services['api']['environment'];

    expect(zimaosEnv($env, 'DB_HOST'))->toBe('db')
        ->and(zimaosEnv($env, 'REDIS_HOST'))->toBe('redis')
        ->and(zimaosEnv($env, 'PUSHER_BACKEND_HOST'))->toBe('realtime')
        ->and(zimaosEnv($env, 'SESSION_SECURE_COOKIE'))->toBe('false')
        ->and(zimaosEnv($env, 'APP_URL'))->toBe('http://10.1.0.58:8080')
        ->and(zimaosEnv($env, 'APP_KEY'))->toStartWith('base64:')
        ->and(zimaosEnv($env, 'APP_KEY'))->not->toContain('${')
        ->and(zimaosEnv($env, 'DB_PASSWORD'))->not->toBeEmpty()
        ->and(zimaosEnv($env, 'DB_PASSWORD'))->not->toContain('${')
        ->and(zimaosEnv($env, 'DB_PASSWORD'))->not->toStartWith('$');
})->with([
    'import yaml' => 'devforge.zimaos.yaml',
    'canonical yaml' => 'docker'.DIRECTORY_SEPARATOR.'zimaos'.DIRECTORY_SEPARATOR.'devforge.yaml',
]);
