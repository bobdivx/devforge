<?php

use App\Services\DevForge\Agent\AgentChatMode;
use App\Services\DevForge\Agent\AgentChatAttachments;
use App\Services\DevForge\Agent\AgentContextCompactor;

it('parses chat modes and defaults to build', function () {
    expect(AgentChatMode::parse('plan'))->toBe('plan')
        ->and(AgentChatMode::parse('DEBUG'))->toBe('debug')
        ->and(AgentChatMode::parse('nope'))->toBe('build');
});

it('blocks destructive tools in plan mode', function () {
    expect(AgentChatMode::isToolAllowed('read_github_file', 'plan'))->toBeTrue()
        ->and(AgentChatMode::isToolAllowed('write_github_file', 'plan'))->toBeFalse()
        ->and(AgentChatMode::isToolAllowed('control_resource', 'plan'))->toBeFalse()
        ->and(AgentChatMode::isToolAllowed('write_github_file', 'build'))->toBeTrue();
});

it('filters tool name lists in plan mode', function () {
    $filtered = AgentChatMode::filterToolNames([
        'read_github_file',
        'write_github_file',
        'list_resources',
    ], 'plan');

    expect($filtered)->toBe(['read_github_file', 'list_resources']);
});

it('formats capture attachments for prompt injection', function () {
    $block = (new AgentChatAttachments)->formatPromptBlock([
        ['type' => 'screenshot', 'label' => 'Erreur 500', 'url' => 'https://example.test/a.png', 'text' => 'nginx'],
    ]);

    expect($block)->toContain('CAPTURES')
        ->and($block)->toContain('Erreur 500')
        ->and($block)->toContain('nginx');
});

it('compacts oversized message history', function () {
    $messages = [
        ['role' => 'system', 'content' => 'sys'],
        ['role' => 'user', 'content' => str_repeat('u', 2000)],
        ['role' => 'assistant', 'content' => str_repeat('a', 2000)],
        ['role' => 'user', 'content' => str_repeat('b', 2000)],
        ['role' => 'assistant', 'content' => str_repeat('c', 2000)],
        ['role' => 'user', 'content' => str_repeat('d', 2000)],
        ['role' => 'assistant', 'content' => str_repeat('e', 2000)],
        ['role' => 'user', 'content' => 'latest'],
    ];

    $compacted = (new AgentContextCompactor)->compact($messages, 5000);

    expect($compacted[0]['role'])->toBe('system')
        ->and(collect($compacted)->pluck('content')->implode(''))->toContain('Contexte compacté')
        ->and(collect($compacted)->last()['content'])->toBe('latest');
});

it('enriches assistant content with tool step summaries', function () {
    $text = (new AgentContextCompactor)->enrichAssistantContent('OK', [
        'steps' => [
            ['name' => 'get_resource_status', 'status' => 'done', 'result_summary' => 'healthy'],
        ],
    ]);

    expect($text)->toContain('OK')
        ->and($text)->toContain('get_resource_status')
        ->and($text)->toContain('healthy');
});
