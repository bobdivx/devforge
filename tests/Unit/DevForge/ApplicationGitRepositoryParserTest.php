<?php

use App\Services\DevForge\Application\ApplicationGitRepositoryParser;

it('parse owner/repo from short github slug', function () {
    expect(ApplicationGitRepositoryParser::parseOwnerRepo('coollabsio/coolify'))
        ->toBe(['owner' => 'coollabsio', 'repo' => 'coolify']);
});

it('parse owner/repo from https github url', function () {
    expect(ApplicationGitRepositoryParser::parseOwnerRepo('https://github.com/acme/my-app.git'))
        ->toBe(['owner' => 'acme', 'repo' => 'my-app']);
});

it('parse owner/repo from ssh github url', function () {
    expect(ApplicationGitRepositoryParser::parseOwnerRepo('git@github.com:acme/my-app.git'))
        ->toBe(['owner' => 'acme', 'repo' => 'my-app']);
});

it('returns null for invalid repository strings', function () {
    expect(ApplicationGitRepositoryParser::parseOwnerRepo('not-a-repo'))->toBeNull();
});

it('joins source paths safely', function () {
    expect(ApplicationGitRepositoryParser::joinSourcePath('apps/web', 'index.ts'))
        ->toBe('apps/web/index.ts');
});
