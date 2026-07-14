<?php

use App\Services\DevForge\ResourceStatusClassifier;

it('treats running:unknown as healthy', function () {
    $classifier = new ResourceStatusClassifier;

    expect($classifier->tone('running:unknown'))->toBe(ResourceStatusClassifier::TONE_SUCCESS);
});

it('treats degraded:unhealthy as warning', function () {
    $classifier = new ResourceStatusClassifier;

    expect($classifier->tone('degraded:unhealthy'))->toBe(ResourceStatusClassifier::TONE_WARNING);
});

it('treats running:unhealthy as warning', function () {
    $classifier = new ResourceStatusClassifier;

    expect($classifier->tone('running:unhealthy'))->toBe(ResourceStatusClassifier::TONE_WARNING);
});

it('treats exited as error', function () {
    $classifier = new ResourceStatusClassifier;

    expect($classifier->tone('exited'))->toBe(ResourceStatusClassifier::TONE_ERROR);
});

it('summarizes mixed application statuses', function () {
    $classifier = new ResourceStatusClassifier;

    $summary = $classifier->summarize([
        ['status' => 'running:healthy'],
        ['status' => 'running:unknown'],
        ['status' => 'degraded:unhealthy'],
        ['status' => 'exited'],
    ]);

    expect($summary)->toBe([
        'score' => 50,
        'total_resources' => 4,
        'running' => 2,
        'degraded' => 1,
        'stopped' => 1,
    ]);
});
