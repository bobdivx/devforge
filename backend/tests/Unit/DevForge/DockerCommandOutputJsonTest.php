<?php

it('parses a single docker json line without splitting characters', function () {
    $json = '{"ID":"abc123","Names":"github-runner-client","Image":"runner:latest","State":"running","Status":"Up 1 hour","Labels":"com.casaos.app_id=github-runners"}';

    $parsed = format_docker_command_output_to_json($json);

    expect($parsed)->toHaveCount(1)
        ->and($parsed->first()['Names'])->toBe('github-runner-client')
        ->and($parsed->first()['ID'])->toBe('abc123');
});

it('keeps valid docker json lines when another line is garbage', function () {
    $raw = implode("\n", [
        'not-json',
        '{"ID":"abc123","Names":"github-runner-client","Image":"runner:latest","State":"running"}',
        '',
    ]);

    $parsed = format_docker_command_output_to_json($raw);

    expect($parsed)->toHaveCount(1)
        ->and($parsed->first()['Names'])->toBe('github-runner-client');
});
