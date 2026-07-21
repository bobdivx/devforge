<?php

use App\Services\DevForge\Agent\Tool\TextUnifiedDiff;

it('builds a unified diff for modified lines', function () {
    $preview = TextUnifiedDiff::preview(
        'Dockerfile',
        "FROM node:20\nRUN npm install\nWORKDIR /app\n",
        "FROM node:20\nRUN npm ci\nWORKDIR /app\n",
    );

    expect($preview['path'])->toBe('Dockerfile')
        ->and($preview['is_new_file'])->toBeFalse()
        ->and($preview['lines_added'])->toBeGreaterThan(0)
        ->and($preview['lines_removed'])->toBeGreaterThan(0)
        ->and($preview['diff'])->toContain('--- a/Dockerfile')
        ->and($preview['diff'])->toContain('+RUN npm ci')
        ->and($preview['diff'])->toContain('-RUN npm install');
});

it('marks new files in diff preview', function () {
    $preview = TextUnifiedDiff::preview('README.md', null, "# Hello\n");

    expect($preview['is_new_file'])->toBeTrue()
        ->and($preview['lines_added'])->toBe(1)
        ->and($preview['diff'])->toContain('+Hello');
});

it('reports no content changes when files are identical', function () {
    $preview = TextUnifiedDiff::preview('same.txt', "a\nb\n", "a\nb\n");

    expect($preview['lines_added'])->toBe(0)
        ->and($preview['lines_removed'])->toBe(0)
        ->and($preview['diff'])->toContain('aucun changement');
});
