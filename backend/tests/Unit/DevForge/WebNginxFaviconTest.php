<?php

it('falls back /favicon.ico to the brand logo in the SPA nginx config', function () {
    $webNginx = dirname(base_path()).DIRECTORY_SEPARATOR.'docker'.DIRECTORY_SEPARATOR.'devforge-web'.DIRECTORY_SEPARATOR.'nginx.conf';
    $proxyNginx = dirname(base_path()).DIRECTORY_SEPARATOR.'docker'.DIRECTORY_SEPARATOR.'devforge-proxy'.DIRECTORY_SEPARATOR.'nginx.conf';

    expect(is_file($webNginx))->toBeTrue()
        ->and(is_file($proxyNginx))->toBeTrue();

    $web = file_get_contents($webNginx);
    $proxy = file_get_contents($proxyNginx);

    expect($web)->toContain('location = /favicon.ico')
        ->and($web)->toContain('try_files /favicon.ico /brand/logo.png =404')
        ->and($proxy)->toContain('location = /favicon.ico')
        ->and($proxy)->toContain('proxy_pass http://devforge_web/brand/logo.png');
});
