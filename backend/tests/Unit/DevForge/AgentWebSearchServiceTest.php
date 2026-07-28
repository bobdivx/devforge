<?php

use App\Services\DevForge\Agent\AgentWebSearchService;
use Illuminate\Support\Facades\Http;

it('searches via duckduckgo when no brave key', function () {
    config()->set('devforge.agents_web_search_brave_key', '');

    Http::fake([
        'api.duckduckgo.com/*' => Http::response([
            'Heading' => 'Coolify',
            'AbstractText' => 'Self-hostable PaaS',
            'AbstractURL' => 'https://coolify.io',
            'RelatedTopics' => [
                ['Text' => 'Coolify docs', 'FirstURL' => 'https://coolify.io/docs'],
            ],
        ], 200),
    ]);

    $result = (new AgentWebSearchService)->search('coolify', 5);

    expect($result['ok'])->toBeTrue()
        ->and($result['provider'])->toBe('duckduckgo')
        ->and($result['results'])->not->toBeEmpty()
        ->and($result['results'][0]['url'])->toContain('coolify');
});

it('rejects empty query', function () {
    $result = (new AgentWebSearchService)->search('  ');

    expect($result['ok'])->toBeFalse()
        ->and($result['error'])->toContain('vide');
});
