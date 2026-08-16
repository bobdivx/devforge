<?php

it('names the managed proxy container devforge-traefik', function () {
    expect(devforge_proxy_container_name())->toBe('devforge-traefik')
        ->and(devforge_proxy_stack_name())->toBe('devforge-traefik')
        ->and(devforge_proxy_legacy_container_names())->toContain('coolify-proxy')
        ->and(devforge_proxy_container_names())->toContain('devforge-traefik')
        ->and(devforge_proxy_container_names())->toContain('coolify-proxy');
});

it('treats only the new container as the managed proxy', function () {
    expect(is_managed_devforge_proxy_container_name('devforge-traefik'))->toBeTrue()
        ->and(is_managed_devforge_proxy_container_name('/devforge-traefik'))->toBeTrue()
        ->and(is_managed_devforge_proxy_container_name('coolify-proxy'))->toBeFalse()
        ->and(is_devforge_proxy_container_name('coolify-proxy'))->toBeTrue()
        ->and(is_devforge_proxy_container_name('devforge-proxy'))->toBeFalse();
});

it('detects a stored compose that still uses the Coolify proxy name', function () {
    $legacy = <<<'YAML'
name: coolify-proxy
services:
  traefik:
    container_name: coolify-proxy
    ports:
      - '80:80'
      - '8080:8080'
YAML;

    $current = <<<'YAML'
name: devforge-traefik
services:
  traefik:
    container_name: devforge-traefik
    ports:
      - '80:80'
YAML;

    expect(proxy_configuration_uses_legacy_container($legacy))->toBeTrue()
        ->and(proxy_configuration_uses_legacy_container($current))->toBeFalse()
        ->and(proxy_configuration_uses_legacy_container(null))->toBeFalse();
});

it('stops both the managed and leftover Coolify proxy containers', function () {
    $commands = implode("\n", devforge_proxy_stop_commands());

    expect($commands)->toContain('docker stop -t 30 devforge-traefik')
        ->and($commands)->toContain('docker rm -f devforge-traefik')
        ->and($commands)->toContain('docker stop -t 30 coolify-proxy')
        ->and($commands)->toContain('docker rm -f coolify-proxy')
        ->and($commands)->toContain('2>/dev/null || true');

    expect(strpos($commands, 'docker stop -t 30 devforge-traefik'))
        ->toBeLessThan(strpos($commands, 'docker stop -t 30 coolify-proxy'));
});
