<?php

it('ensures container cleanup includes wait loop in command sequence', function () {
    $commands = collect([
        'mkdir -p /data/coolify/proxy/dynamic',
        'cd /data/coolify/proxy',
        "echo 'Creating required Docker Compose file.'",
        "echo 'Pulling docker image.'",
        'docker compose pull',
    ])
        ->merge(devforge_proxy_stop_commands())
        ->merge([
            "echo 'Starting proxy.'",
            'docker compose up -d --wait --remove-orphans',
            "echo 'Successfully started proxy.'",
        ]);

    $commandsString = $commands->implode("\n");

    expect($commandsString)->toContain('docker stop -t 30 coolify-proxy 2>/dev/null || true')
        ->and($commandsString)->toContain('docker rm -f coolify-proxy 2>/dev/null || true')
        ->and($commandsString)->toContain('docker stop -t 30 devforge-traefik 2>/dev/null || true')
        ->and($commandsString)->toContain('for i in {1..10}; do')
        ->and($commandsString)->toContain('if ! docker ps -a --format "{{.Names}}" | grep -q "^coolify-proxy$"; then')
        ->and($commandsString)->toContain('break')
        ->and($commandsString)->toContain('sleep 1')
        ->and($commandsString)->toContain('docker compose up -d --wait --remove-orphans');

    $stopPosition = strpos($commandsString, 'docker stop -t 30 coolify-proxy');
    $waitLoopPosition = strpos($commandsString, 'for i in {1..10}');
    $composeUpPosition = strpos($commandsString, 'docker compose up -d');

    expect($stopPosition)->toBeLessThan($waitLoopPosition)
        ->and($waitLoopPosition)->toBeLessThan($composeUpPosition);
});

it('includes error suppression in container cleanup commands', function () {
    $cleanupCommands = collect(devforge_proxy_stop_commands())
        ->filter(fn (string $command): bool => str_contains($command, 'docker stop') || str_contains($command, 'docker rm'));

    expect($cleanupCommands)->not->toBeEmpty();

    foreach ($cleanupCommands as $command) {
        expect($command)->toContain('2>/dev/null || true');
    }
});

it('waits up to 10 seconds for container removal', function () {
    $loopString = implode("\n", devforge_proxy_stop_commands());

    expect($loopString)->toContain('{1..10}')
        ->and($loopString)->toContain('sleep 1')
        ->and($loopString)->toContain('break');
});
