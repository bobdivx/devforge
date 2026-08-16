<?php

it('ensures stop proxy includes wait loop for container removal', function () {
    $commandsString = implode("\n", devforge_proxy_stop_commands());

    expect($commandsString)->toContain('docker stop -t 30 coolify-proxy')
        ->and($commandsString)->toContain('docker rm -f coolify-proxy')
        ->and($commandsString)->toContain('docker stop -t 30 devforge-traefik')
        ->and($commandsString)->toContain('for i in {1..10}; do')
        ->and($commandsString)->toContain('if ! docker ps -a --format "{{.Names}}" | grep -q "^coolify-proxy$"; then')
        ->and($commandsString)->toContain('break')
        ->and($commandsString)->toContain('sleep 1');

    $stopPosition = strpos($commandsString, 'docker stop');
    $removePosition = strpos($commandsString, 'docker rm -f');
    $waitLoopPosition = strpos($commandsString, 'for i in {1..10}');

    expect($stopPosition)->toBeLessThan($removePosition)
        ->and($removePosition)->toBeLessThan($waitLoopPosition);
});

it('includes error suppression in stop proxy commands', function () {
    $commands = collect(devforge_proxy_stop_commands())
        ->filter(fn (string $command): bool => str_contains($command, 'docker stop') || str_contains($command, 'docker rm'));

    foreach ($commands as $command) {
        expect($command)->toContain('2>/dev/null || true');
    }
});

it('uses configurable timeout for docker stop', function () {
    $stopCommand = collect(devforge_proxy_stop_commands(timeout: 30))
        ->first(fn (string $command): bool => str_contains($command, 'docker stop'));

    expect($stopCommand)->toContain('-t 30');
});

it('waits for swarm service container removal correctly', function () {
    $server = Mockery::mock(App\Models\Server::class);
    $server->shouldReceive('isSwarm')->andReturn(true);

    $commandsString = implode("\n", devforge_proxy_stop_commands($server));

    expect($commandsString)->toContain('coolify-proxy_traefik')
        ->and($commandsString)->toContain('devforge-traefik_traefik');
});
