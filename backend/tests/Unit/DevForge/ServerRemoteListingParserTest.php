<?php

use App\Services\DevForge\Server\ServerRemoteListingParser;

it('parse ls output into structured entries', function () {
    $output = <<<'LS'
total 24
drwxr-xr-x  5 root root 4096 Jan  1 12:00 .
drwxr-xr-x 18 root root 4096 Jan  1 11:00 ..
-rw-r--r--  1 root root  220 Jan  1 10:00 .bashrc
drwxr-xr-x  2 root root 4096 Jan  1 10:00 applications
lrwxrwxrwx  1 root root   12 Jan  1 09:00 current -> /data/coolify
-rw-r--r--  1 root root 1234 Jan  1 08:00 docker-compose.yml
LS;

    $entries = ServerRemoteListingParser::parse($output);

    expect($entries)->toHaveCount(4)
        ->and($entries[0]['name'])->toBe('applications')
        ->and($entries[0]['type'])->toBe('directory')
        ->and($entries[1]['name'])->toBe('current')
        ->and($entries[1]['type'])->toBe('symlink')
        ->and($entries[1]['symlink_target'])->toBe('/data/coolify')
        ->and($entries[2]['name'])->toBe('.bashrc')
        ->and($entries[2]['type'])->toBe('file')
        ->and($entries[2]['size'])->toBe(220);
});

it('sorts directories before files', function () {
    $output = <<<'LS'
-rw-r--r-- 1 root root 10 Jan 1 10:00 z.txt
drwxr-xr-x 2 root root 4096 Jan 1 10:00 a-dir
LS;

    $entries = ServerRemoteListingParser::parse($output);

    expect($entries[0]['name'])->toBe('a-dir')
        ->and($entries[1]['name'])->toBe('z.txt');
});
