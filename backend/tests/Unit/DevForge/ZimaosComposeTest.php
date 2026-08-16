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

    expect($services['api']['extra_hosts'] ?? [])->toContain('host.docker.internal:host-gateway');

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

it('ships a ZimaOS App Store compose with pinned tags and /DATA/AppData volumes', function () {
    $path = dirname(base_path()).DIRECTORY_SEPARATOR.'docker'.DIRECTORY_SEPARATOR.'zimaos'.DIRECTORY_SEPARATOR.'appstore'.DIRECTORY_SEPARATOR.'DevForge'.DIRECTORY_SEPARATOR.'docker-compose.yml';
    $compose = zimaosCompose($path);
    $services = $compose['services'];
    $casaos = $compose['x-casaos'];

    expect($compose['name'])->toBe('devforge')
        ->and($services)->toHaveKeys(['proxy', 'web', 'api', 'db', 'redis', 'realtime'])
        ->and($services['proxy']['image'])->toBe('nginx:1.27.5-alpine')
        ->and($services['web']['image'])->toBe('bobdivx/devforge:web-4.1.2')
        ->and($services['api']['image'])->toBe('bobdivx/devforge:4.1.2')
        ->and($services['realtime']['image'])->toBe('bobdivx/devforge:realtime-4.1.2')
        ->and($services['db']['image'])->toBe('postgres:15.14-alpine')
        ->and($services['redis']['image'])->toBe('redis:7.4.5-alpine');

    foreach ($services as $service) {
        expect($service['image'])->not->toEndWith(':latest')
            ->and($service['image'])->not->toContain('${')
            ->and($service['deploy']['resources'] ?? [])->not->toHaveKey('limits');
    }

    $env = $services['api']['environment'];

    expect(zimaosEnv($env, 'APP_URL'))->toBe('http://localhost:8080')
        ->and(zimaosEnv($env, 'APP_URL'))->not->toContain('10.1.0.58')
        ->and(zimaosEnv($env, 'DB_PASSWORD'))->toBe('devforge')
        ->and(zimaosEnv($env, 'DB_PASSWORD'))->not->toBe('aBVGheEhcY8E8INxMcq063RYhwG6oeM1')
        ->and(zimaosEnv($env, 'APP_KEY'))->toStartWith('base64:')
        ->and(strlen((string) base64_decode(substr((string) zimaosEnv($env, 'APP_KEY'), 7), true)))->toBe(32)
        ->and(zimaosEnv($env, 'APP_KEY'))->not->toContain('kgGufqsNEXfgu1P9CreNMKFdyxxizRyDZxkOUVuuZuE=')
        ->and(zimaosEnv($env, 'BASE_CONFIG_PATH'))->toBe('/DATA/AppData/$AppID/data')
        ->and($services['api']['volumes'][0]['source'])->toBe('/var/run/docker.sock')
        ->and($services['db']['volumes'][0]['source'])->toBe('/DATA/AppData/$AppID/postgres')
        ->and($services['proxy']['command'][0])->toContain('bobdivx/devforge')
        ->and($services['proxy']['command'][0])->toContain('nginx.conf');

    expect($casaos['id'])->toBe('io.github.bobdivx.devforge')
        ->and($casaos['main'])->toBe('proxy')
        ->and($casaos['category'])->toBe('Developer')
        ->and($casaos['architectures'])->toBe(['amd64'])
        ->and($casaos['version'])->toBe('4.1.2')
        ->and($casaos['port_map'])->toBe('8080')
        ->and($casaos['title']['en_US'])->toBe('DevForge')
        ->and($casaos['tagline'])->toHaveKeys(['en_US', 'fr_FR', 'zh_CN'])
        ->and($casaos['tips']['before_install']['en_US'])->toContain('APP_URL')
        ->and($casaos['tips']['before_install']['fr_FR'])->toContain('APP_URL')
        ->and($casaos['icon'])->toContain('frontend/public/brand/logo.png');
});
