<?php

use App\Services\DevForge\Readiness\ReadinessAgentOutcomeParser;

it('parses a needs_user outcome from summary json', function () {
    $parser = new ReadinessAgentOutcomeParser;

    $parsed = $parser->parse(<<<'TEXT'
Voici le diagnostic.
{"outcome":"needs_user","title":"Configurer ASTRO_DB","summary":"Variables manquantes","steps":["Ajouter ASTRO_DB_REMOTE_URL","Redémarrer"]}
TEXT);

    expect($parsed['outcome'])->toBe('needs_user')
        ->and($parsed['title'])->toBe('Configurer ASTRO_DB')
        ->and($parsed['steps'])->toHaveCount(2)
        ->and($parsed['steps'][0]['text'])->toBe('Ajouter ASTRO_DB_REMOTE_URL')
        ->and($parsed['steps'][0]['done'])->toBeFalse();
});

it('parses auto_fixed from metadata', function () {
    $parser = new ReadinessAgentOutcomeParser;

    $parsed = $parser->parse('done', [
        'readiness_outcome' => [
            'outcome' => 'auto_fixed',
            'title' => 'Env corrigée',
            'steps' => [['rank' => 1, 'text' => 'upsert TOKEN', 'done' => true]],
        ],
    ]);

    expect($parsed['outcome'])->toBe('auto_fixed')
        ->and($parsed['title'])->toBe('Env corrigée')
        ->and($parsed['steps'][0]['done'])->toBeTrue();
});

it('falls back to needs_user when json is missing', function () {
    $parser = new ReadinessAgentOutcomeParser;

    $parsed = $parser->parse('Le domaine renvoie 502, intervention humaine nécessaire.');

    expect($parsed['outcome'])->toBe('needs_user')
        ->and($parsed['title'])->toBe('Intervention requise')
        ->and($parsed['summary'])->toContain('502')
        ->and($parsed['steps'])->not->toBeEmpty();
});
