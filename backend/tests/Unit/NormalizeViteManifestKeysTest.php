<?php

it('strips backend prefix from vite manifest keys', function () {
    $fixture = [
        'backend/resources/js/app.js' => [
            'file' => 'assets/app.js',
            'src' => 'backend/resources/js/app.js',
            'isEntry' => true,
        ],
        'backend/resources/css/app.css' => [
            'file' => 'assets/app.css',
            'src' => 'backend/resources/css/app.css',
            'isEntry' => true,
        ],
        'backend/resources/fonts/geist.woff2' => [
            'file' => 'assets/geist.woff2',
            'src' => 'backend/resources/fonts/geist.woff2',
        ],
    ];

    $normalized = [];
    foreach ($fixture as $key => $value) {
        $nextKey = str_starts_with($key, 'backend/') ? substr($key, 8) : $key;
        if (isset($value['src']) && is_string($value['src']) && str_starts_with($value['src'], 'backend/')) {
            $value['src'] = substr($value['src'], 8);
        }
        $normalized[$nextKey] = $value;
    }

    expect($normalized)->toHaveKeys([
        'resources/js/app.js',
        'resources/css/app.css',
        'resources/fonts/geist.woff2',
    ])
        ->and($normalized['resources/js/app.js']['src'])->toBe('resources/js/app.js')
        ->and($normalized['resources/css/app.css']['src'])->toBe('resources/css/app.css');
});
