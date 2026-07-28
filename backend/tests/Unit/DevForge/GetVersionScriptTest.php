<?php

it('outputs a clean coolify version for docker image tags', function () {
    $script = dirname(__DIR__, 2).DIRECTORY_SEPARATOR.'bootstrap'.DIRECTORY_SEPARATOR.'getVersion.php';
    expect(is_file($script))->toBeTrue();

    $command = [
        PHP_BINARY,
        '-d',
        'display_errors=0',
        '-d',
        'display_startup_errors=0',
        $script,
    ];

    $descriptorSpec = [
        0 => ['pipe', 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w'],
    ];

    $process = proc_open($command, $descriptorSpec, $pipes, dirname($script, 2));
    expect($process)->toBeResource();

    fclose($pipes[0]);
    $stdout = trim(stream_get_contents($pipes[1]) ?: '');
    $stderr = trim(stream_get_contents($pipes[2]) ?: '');
    fclose($pipes[1]);
    fclose($pipes[2]);
    $exitCode = proc_close($process);

    expect($exitCode)->toBe(0)
        ->and($stderr)->toBe('')
        ->and($stdout)->not->toContain("\n")
        ->and($stdout)->toMatch('/^[A-Za-z0-9._-]+$/');
});
