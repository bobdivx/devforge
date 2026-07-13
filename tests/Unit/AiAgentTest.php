<?php

use App\Models\AiAgent;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('is due for a scheduled run when never run before', function () {
    $agent = AiAgent::factory()->create([
        'is_active' => true,
        'schedule_minutes' => 30,
        'status' => 'idle',
        'last_run_at' => null,
    ]);

    expect($agent->isDueForScheduledRun())->toBeTrue();
});

it('is not due when schedule interval has not elapsed', function () {
    $agent = AiAgent::factory()->create([
        'is_active' => true,
        'schedule_minutes' => 60,
        'status' => 'idle',
        'last_run_at' => now()->subMinutes(30),
    ]);

    expect($agent->isDueForScheduledRun())->toBeFalse();
});

it('is due when schedule interval has elapsed', function () {
    $agent = AiAgent::factory()->create([
        'is_active' => true,
        'schedule_minutes' => 15,
        'status' => 'idle',
        'last_run_at' => now()->subMinutes(20),
    ]);

    expect($agent->isDueForScheduledRun())->toBeTrue();
});

it('is never due when schedule_minutes is 0 (manual only)', function () {
    $agent = AiAgent::factory()->create([
        'is_active' => true,
        'schedule_minutes' => 0,
        'status' => 'idle',
        'last_run_at' => null,
    ]);

    expect($agent->isDueForScheduledRun())->toBeFalse();
});

it('is never due when agent is inactive', function () {
    $agent = AiAgent::factory()->paused()->create([
        'schedule_minutes' => 15,
        'last_run_at' => null,
    ]);

    expect($agent->isDueForScheduledRun())->toBeFalse();
});

it('is never due when agent is already running', function () {
    $agent = AiAgent::factory()->running()->create([
        'is_active' => true,
        'schedule_minutes' => 15,
        'last_run_at' => null,
    ]);

    expect($agent->isDueForScheduledRun())->toBeFalse();
});

it('is never due for devforge agents because they are webhook triggered', function () {
    $agent = AiAgent::factory()->create([
        'type' => 'devforge',
        'is_active' => true,
        'schedule_minutes' => 15,
        'status' => 'idle',
        'last_run_at' => null,
    ]);

    expect($agent->isDueForScheduledRun())->toBeFalse()
        ->and($agent->triggerMode())->toBe('webhook');
});

it('has parent and sub-agent relationships', function () {
    $parent = AiAgent::factory()->create();
    $child = AiAgent::factory()->create([
        'team_id' => $parent->team_id,
        'parent_agent_id' => $parent->id,
    ]);

    expect($child->parent->id)->toBe($parent->id);
    expect($parent->subAgents->first()->id)->toBe($child->id);
});
