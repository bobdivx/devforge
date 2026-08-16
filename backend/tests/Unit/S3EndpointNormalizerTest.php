<?php

use App\Services\DevForge\S3\S3EndpointNormalizer;
use Tests\TestCase;

uses(TestCase::class);

it('converts a Scaleway virtual-hosted URL to path-style', function () {
    $normalized = S3EndpointNormalizer::normalize(
        'https://devforge.s3.fr-par.scw.cloud',
        null,
        'us-east-1',
    );

    expect($normalized['endpoint'])->toBe('https://s3.fr-par.scw.cloud')
        ->and($normalized['bucket'])->toBe('devforge')
        ->and($normalized['region'])->toBe('fr-par');
});

it('keeps a Scaleway path-style endpoint and infers the region', function () {
    $normalized = S3EndpointNormalizer::normalize(
        'https://s3.fr-par.scw.cloud',
        'devforge',
        'us-east-1',
    );

    expect($normalized['endpoint'])->toBe('https://s3.fr-par.scw.cloud')
        ->and($normalized['bucket'])->toBe('devforge')
        ->and($normalized['region'])->toBe('fr-par');
});

it('strips DigitalOcean Spaces bucket from the hostname', function () {
    $normalized = S3EndpointNormalizer::normalize(
        'https://coolify.nyc3.digitaloceanspaces.com',
        null,
        'nyc3',
    );

    expect($normalized['endpoint'])->toBe('https://nyc3.digitaloceanspaces.com')
        ->and($normalized['bucket'])->toBe('coolify')
        ->and($normalized['region'])->toBe('nyc3');
});

it('adds https when the scheme is missing', function () {
    $normalized = S3EndpointNormalizer::normalize('s3.fr-par.scw.cloud', 'devforge', 'fr-par');

    expect($normalized['endpoint'])->toBe('https://s3.fr-par.scw.cloud');
});
