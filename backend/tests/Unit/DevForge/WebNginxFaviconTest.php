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
        ->and($web)->toContain('absolute_redirect off')
        ->and($web)->toContain('try_files $uri $uri/index.html /index.html')
        ->and($proxy)->toContain('location = /favicon.ico')
        ->and($proxy)->toContain('proxy_pass http://devforge_web/brand/logo.png')
        ->and($proxy)->toContain('absolute_redirect off')
        ->and($proxy)->toContain('proxy_redirect ~^https?://[^/]+(/.*)$ $1');
});

it('proxies GitHub App webhook callbacks to Laravel instead of the SPA', function () {
    $proxyNginx = dirname(base_path()).DIRECTORY_SEPARATOR.'docker'.DIRECTORY_SEPARATOR.'devforge-proxy'.DIRECTORY_SEPARATOR.'nginx.conf';

    expect(is_file($proxyNginx))->toBeTrue();

    $proxy = file_get_contents($proxyNginx);

    expect($proxy)->toContain('|mcp|webhooks)(/|$)')
        ->and($proxy)->toContain('proxy_pass http://devforge_api')
        ->and($proxy)->toContain('map $http_x_forwarded_proto $devforge_forwarded_proto')
        ->and($proxy)->toContain('proxy_set_header X-Forwarded-Proto $devforge_forwarded_proto')
        ->and($proxy)->not->toContain('proxy_set_header X-Forwarded-Proto $scheme');
});
