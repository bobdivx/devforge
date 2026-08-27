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
        ->and(file_get_contents($import))->toBe(file_get_contents($canonical))
        ->and(file_get_contents($import))->not->toContain('10.1.0.58')
        ->and(file_get_contents($import))->not->toContain('jeser.me')
        ->and(file_get_contents($import))->not->toContain('zimacube');
});

it('starts DevForge on ZimaOS with web, proxy, and AppData paths', function (string $relativePath) {
    $path = dirname(base_path()).DIRECTORY_SEPARATOR.$relativePath;
    $compose = zimaosCompose($path);
    $services = $compose['services'];

    expect($services)->toHaveKeys(['proxy', 'web', 'api', 'db', 'redis', 'realtime', 'keeper']);

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
        ->and($services['keeper']['image'])->toBe('docker:27.5.1-cli')
        ->and($services['keeper']['container_name'])->toBe('devforge-keeper')
        ->and(implode("\n", $services['keeper']['command'] ?? []))->toContain('docker start')
        ->and(implode("\n", $services['keeper']['command'] ?? []))->toContain('host.docker.internal')
        ->and($compose['x-casaos']['port_map'])->toBe('8080');

    $env = $services['api']['environment'];

    expect(zimaosEnv($env, 'DB_HOST'))->toBe('db')
        ->and(zimaosEnv($env, 'REDIS_HOST'))->toBe('redis')
        ->and(zimaosEnv($env, 'PUSHER_BACKEND_HOST'))->toBe('realtime')
        ->and(zimaosEnv($env, 'SESSION_SECURE_COOKIE'))->toBe('false')
        ->and(zimaosEnv($env, 'APP_URL'))->toBe('http://localhost:8080')
        ->and(zimaosEnv($env, 'APP_URL'))->not->toContain('10.1.0.58')
        ->and(zimaosEnv($env, 'APP_KEY'))->toStartWith('base64:')
        ->and(zimaosEnv($env, 'APP_KEY'))->not->toContain('${')
        ->and(zimaosEnv($env, 'APP_KEY'))->not->toContain('kgGufqsNEXfgu1P9CreNMKFdyxxizRyDZxkOUVuuZuE=')
        ->and(zimaosEnv($env, 'DB_PASSWORD'))->toBe('devforge')
        ->and(zimaosEnv($env, 'DB_PASSWORD'))->not->toContain('${')
        ->and(zimaosEnv($env, 'DB_PASSWORD'))->not->toStartWith('$')
        ->and(zimaosEnv($env, 'DB_PASSWORD'))->not->toBe('aBVGheEhcY8E8INxMcq063RYhwG6oeM1');

    expect($services)->toHaveKey('agent')
        ->and($services['agent']['image'])->toBe('bobdivx/devforge:agent')
        ->and($services['agent']['container_name'])->toBe('devforge-agent')
        ->and($services['agent']['extra_hosts'] ?? [])->toContain('host.docker.internal:host-gateway')
        ->and($services['agent']['healthcheck'] ?? [])->toHaveKey('test')
        ->and(zimaosEnv($services['agent']['environment'] ?? [], 'AGENT_LISTEN'))->toBe('0.0.0.0:8090')
        ->and(zimaosEnv($services['agent']['environment'] ?? [], 'AGENT_PROVIDER'))->toBeNull()
        ->and(zimaosEnv($services['agent']['environment'] ?? [], 'AGENT_MODEL'))->toBeNull()
        ->and(zimaosEnv($services['agent']['environment'] ?? [], 'AGENT_API_KEY'))->toBeNull()
        ->and(zimaosEnv($services['agent']['environment'] ?? [], 'AGENT_BASE_URL'))->toBeNull()
        ->and(zimaosEnv($env, 'AGENT_URL'))->toBe('http://agent:8090')
        ->and($services['api']['depends_on'])->toHaveKey('agent')
        ->and(implode("\n", $services['keeper']['command'] ?? []))->toContain('devforge-agent');

    $yaml = (string) file_get_contents($path);
    expect($yaml)->not->toContain('AGENT_PROVIDER')
        ->and($yaml)->not->toContain('AGENT_MODEL')
        ->and($yaml)->not->toContain('AGENT_API_KEY')
        ->and($yaml)->not->toContain('AGENT_BASE_URL')
        ->and($yaml)->not->toContain('gpt-4o-mini');
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
        ->and($services)->toHaveKeys(['proxy', 'web', 'api', 'db', 'redis', 'realtime', 'keeper', 'agent'])
        ->and($services['proxy']['image'])->toBe('nginx:1.27.5-alpine')
        ->and($services['web']['image'])->toBe('bobdivx/devforge:web-4.1.3')
        ->and($services['api']['image'])->toBe('bobdivx/devforge:4.1.3')
        ->and($services['realtime']['image'])->toBe('bobdivx/devforge:realtime-4.1.3')
        ->and($services['db']['image'])->toBe('postgres:15.14-alpine')
        ->and($services['redis']['image'])->toBe('redis:7.4.5-alpine')
        ->and($services['keeper']['image'])->toBe('docker:27.5.1-cli')
        ->and($services['agent']['image'])->toBe('bobdivx/devforge:agent')
        ->and(implode("\n", $services['keeper']['command'] ?? []))->toContain('docker start')
        ->and(implode("\n", $services['keeper']['command'] ?? []))->toContain('host.docker.internal')
        ->and(implode("\n", $services['keeper']['command'] ?? []))->toContain('devforge-agent');

    foreach ($services as $service) {
        expect($service['image'])->not->toEndWith(':latest')
            ->and($service['image'])->not->toContain('${')
            ->and($service['deploy']['resources'] ?? [])->not->toHaveKey('limits');
    }

    $env = $services['api']['environment'];
    $agentEnv = $services['agent']['environment'] ?? [];

    expect(zimaosEnv($env, 'APP_URL'))->toBe('http://localhost:8080')
        ->and(zimaosEnv($env, 'APP_URL'))->not->toContain('10.1.0.58')
        ->and(zimaosEnv($env, 'DB_PASSWORD'))->toBe('devforge')
        ->and(zimaosEnv($env, 'DB_PASSWORD'))->not->toBe('aBVGheEhcY8E8INxMcq063RYhwG6oeM1')
        ->and(zimaosEnv($env, 'APP_KEY'))->toStartWith('base64:')
        ->and(strlen((string) base64_decode(substr((string) zimaosEnv($env, 'APP_KEY'), 7), true)))->toBe(32)
        ->and(zimaosEnv($env, 'APP_KEY'))->not->toContain('kgGufqsNEXfgu1P9CreNMKFdyxxizRyDZxkOUVuuZuE=')
        ->and(zimaosEnv($env, 'BASE_CONFIG_PATH'))->toBe('/DATA/AppData/$AppID/data')
        ->and(zimaosEnv($env, 'AGENT_URL'))->toBe('http://agent:8090')
        ->and(zimaosEnv($agentEnv, 'AGENT_LISTEN'))->toBe('0.0.0.0:8090')
        ->and(zimaosEnv($agentEnv, 'AGENT_PROVIDER'))->toBeNull()
        ->and(zimaosEnv($agentEnv, 'AGENT_MODEL'))->toBeNull()
        ->and(zimaosEnv($agentEnv, 'AGENT_API_KEY'))->toBeNull()
        ->and(zimaosEnv($agentEnv, 'AGENT_BASE_URL'))->toBeNull()
        ->and($services['agent']['healthcheck'] ?? [])->toHaveKey('test')
        ->and($services['api']['volumes'][0]['source'])->toBe('/var/run/docker.sock')
        ->and($services['db']['volumes'][0]['source'])->toBe('/DATA/AppData/$AppID/postgres')
        ->and($services['proxy']['command'][0])->toContain('bobdivx/devforge')
        ->and($services['proxy']['command'][0])->toContain('nginx.conf');

    $yaml = (string) file_get_contents($path);
    expect($yaml)->not->toContain('AGENT_PROVIDER')
        ->and($yaml)->not->toContain('AGENT_MODEL=')
        ->and($yaml)->not->toContain('AGENT_API_KEY')
        ->and($yaml)->not->toContain('AGENT_BASE_URL')
        ->and($yaml)->not->toContain('gpt-4o-mini');

    expect($casaos['id'])->toBe('io.github.bobdivx.devforge')
        ->and($casaos['main'])->toBe('proxy')
        ->and($casaos['category'])->toBe('Developer')
        ->and($casaos['architectures'])->toBe(['amd64'])
        ->and($casaos['version'])->toBe('4.1.3')
        ->and($casaos['port_map'])->toBe('8080')
        ->and($casaos['title']['en_US'])->toBe('DevForge')
        ->and($casaos['tagline'])->toHaveKeys(['en_US', 'fr_FR', 'zh_CN'])
        ->and($casaos['tips']['before_install']['en_US'])->toContain('APP_URL')
        ->and($casaos['tips']['before_install']['fr_FR'])->toContain('APP_URL')
        ->and($casaos['icon'])->toContain('Apps/DevForge/icon.svg')
        ->and($casaos['thumbnail'])->toContain('Apps/DevForge/thumbnail.png')
        ->and($casaos['screenshot_link'])->toHaveCount(1)
        ->and($casaos['screenshot_link'][0])->toContain('Apps/DevForge/screenshot-1.png')
        ->and(is_file(dirname($path).DIRECTORY_SEPARATOR.'icon.svg'))->toBeTrue()
        ->and(is_file(dirname($path).DIRECTORY_SEPARATOR.'icon.png'))->toBeTrue()
        ->and(is_file(dirname($path).DIRECTORY_SEPARATOR.'thumbnail.png'))->toBeTrue()
        ->and(is_file(dirname($path).DIRECTORY_SEPARATOR.'screenshot-1.png'))->toBeTrue();
});
