<?php

use App\Models\PrivateKey;
use App\Models\Server;
use App\Models\ServerSetting;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\TerminalSessionCommand;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('builds an ssh session command for a reachable team server', function () {
    $user = User::factory()->create();
    $team = Team::factory()->create();
    $team->members()->attach($user, ['role' => 'owner']);
    $user->forceFill(['current_team_id' => $team->id])->save();

    $privateKey = PrivateKey::factory()->create(['team_id' => $team->id]);
    $server = Server::factory()->create([
        'team_id' => $team->id,
        'private_key_id' => $privateKey->id,
    ]);
    ServerSetting::factory()->create([
        'server_id' => $server->id,
        'is_terminal_enabled' => true,
        'is_reachable' => true,
    ]);

    $session = app(TerminalSessionCommand::class)->forServer($user, $team, $server->uuid);

    expect($session['server_uuid'])->toBe($server->uuid)
        ->and($session['command'])->toBeString()
        ->and($session['command'])->not->toBe('');
});
