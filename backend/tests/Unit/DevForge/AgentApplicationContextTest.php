<?php

use App\Models\AiAgent;
use App\Models\Application;
use App\Models\User;
use App\Services\DevForge\Agent\AgentApplicationContext;
use App\Services\DevForge\CurrentTeamResources;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Symfony\Component\HttpKernel\Exception\HttpException;

it('autorise un agent d’équipe à chat avec n’importe quelle application du team', function () {
    $user = new User;
    $application = new Application(['uuid' => 'app-current']);
    $application->uuid = 'app-current';

    $agent = new AiAgent([
        'parent_agent_id' => null,
        'resource_uuid' => 'app-other',
    ]);

    $resources = Mockery::mock(CurrentTeamResources::class);
    $resources->shouldReceive('application')->once()->with($user, 'app-current')->andReturn($application);

    $ctx = new AgentApplicationContext($resources);
    $resolved = $ctx->resolve($user, $agent, 'app-current');

    expect($resolved)->toBe($application);
});

it('refuse un sous-agent lié à une autre application', function () {
    $user = new User;
    $application = new Application;
    $application->uuid = 'app-current';

    $agent = new AiAgent([
        'parent_agent_id' => 42,
        'resource_uuid' => 'app-other',
    ]);

    $resources = Mockery::mock(CurrentTeamResources::class);
    $resources->shouldReceive('application')->once()->with($user, 'app-current')->andReturn($application);

    $ctx = new AgentApplicationContext($resources);

    try {
        $ctx->resolve($user, $agent, 'app-current');
        expect(false)->toBeTrue();
    } catch (HttpException $e) {
        expect($e->getStatusCode())->toBe(422);
        expect($e->getMessage())->toContain('liée à une autre application');
    }
});

it('autorise un sous-agent scopé à l’application courante', function () {
    $user = new User;
    $application = new Application;
    $application->uuid = 'app-current';

    $agent = new AiAgent([
        'parent_agent_id' => 7,
        'resource_uuid' => 'app-current',
    ]);

    $resources = Mockery::mock(CurrentTeamResources::class);
    $resources->shouldReceive('application')->once()->andReturn($application);

    $ctx = new AgentApplicationContext($resources);

    expect($ctx->resolve($user, $agent, 'app-current'))->toBe($application);
});

it('retourne null sans application_uuid', function () {
    $resources = Mockery::mock(CurrentTeamResources::class);
    $resources->shouldNotReceive('application');

    $ctx = new AgentApplicationContext($resources);
    $agent = new AiAgent(['parent_agent_id' => null]);

    expect($ctx->resolve(new User, $agent, null))->toBeNull();
});

it('abort 404 si application introuvable', function () {
    $resources = Mockery::mock(CurrentTeamResources::class);
    $resources->shouldReceive('application')->once()->andThrow(new ModelNotFoundException);

    $ctx = new AgentApplicationContext($resources);
    $agent = new AiAgent(['parent_agent_id' => null]);

    try {
        $ctx->resolve(new User, $agent, 'missing');
        expect(false)->toBeTrue();
    } catch (HttpException $e) {
        expect($e->getStatusCode())->toBe(404);
    }
});
