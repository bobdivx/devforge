<?php

it('ships a ZimaOS keeper that starts Created containers and reloads nginx', function () {
    $script = dirname(base_path()).DIRECTORY_SEPARATOR.'docker'.DIRECTORY_SEPARATOR.'zimaos'.DIRECTORY_SEPARATOR.'keeper.sh';

    expect(is_file($script))->toBeTrue();

    $contents = (string) file_get_contents($script);

    expect($contents)->toContain('docker start')
        ->and($contents)->toContain('created')
        ->and($contents)->toContain('exited')
        ->and($contents)->toContain('nginx -s reload')
        ->and($contents)->toContain('devforge-api')
        ->and($contents)->toContain('devforge-web')
        ->and($contents)->toContain('devforge-proxy')
        ->and($contents)->toContain('host.docker.internal');
});
