<?php

use App\Services\DevForge\Server\ServerPathValidator;
use Illuminate\Validation\ValidationException;

it('normalizes default coolify root', function () {
    expect(ServerPathValidator::normalize(null))
        ->toBe('/data/coolify');
});

it('rejects path traversal', function () {
    expect(fn () => ServerPathValidator::normalize('/data/../etc/passwd'))
        ->toThrow(ValidationException::class);
});

it('joins directory and file name safely', function () {
    expect(ServerPathValidator::join('/data/coolify', 'docker-compose.yml'))
        ->toBe('/data/coolify/docker-compose.yml');
});

it('rejects unsafe file names when joining paths', function () {
    expect(fn () => ServerPathValidator::join('/data/coolify', '../secret'))
        ->toThrow(ValidationException::class);
});
