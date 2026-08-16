<?php

use App\Services\DevForge\Agent\AgentWebSearchService;
use Illuminate\Support\Facades\Http;

it('searches via duckduckgo when no brave key', function () {
    config()->set('devforge.agents_web_search_brave_key', '');

    Http::fake([
        'api.duckduckgo.com/*' => Http::response([
            'Heading' => 'DevForge',
            'AbstractText' => 'Self-hostable PaaS',
            'AbstractURL' => 'https://github.com/bobdivx/devforge',
            'RelatedTopics' => [
                ['Text' => 'DevForge repo', 'FirstURL' => 'https://github.com/bobdivx/devforge'],
            ],
        ], 200),
    ]);

    $result = (new AgentWebSearchService)->search('devforge', 5);

    expect($result['ok'])->toBeTrue()
        ->and($result['provider'])->toBe('duckduckgo')
        ->and($result['results'])->not->toBeEmpty()
        ->and($result['results'][0]['url'])->toContain('devforge');
});

it('rejects empty query', function () {
    $result = (new AgentWebSearchService)->search('  ');

    expect($result['ok'])->toBeFalse()
        ->and($result['error'])->toContain('vide');
});
