<?php

use App\Jobs\DevForge\InstanceHostDiskGuardJob;
use App\Jobs\DockerCleanupJob;
use App\Models\Server;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Queue;

uses(RefreshDatabase::class);

afterEach(function () {
    Mockery::close();
});

it('exposes critical and emergency thresholds', function () {
    expect(InstanceHostDiskGuardJob::CRITICAL_THRESHOLD)->toBe(85)
        ->and(InstanceHostDiskGuardJob::EMERGENCY_THRESHOLD)->toBe(92)
        ->and(InstanceHostDiskGuardJob::EMERGENCY_THRESHOLD)
        ->toBeGreaterThan(InstanceHostDiskGuardJob::CRITICAL_THRESHOLD);
});

it('never runs an unfiltered container prune in emergency mode', function () {
    $source = file_get_contents(app_path('Jobs/DevForge/InstanceHostDiskGuardJob.php'));

    expect($source)
        ->toContain('label=coolify.managed=true')
        ->toContain('label!=coolify.type=database')
        ->not->toContain('docker container prune -f 2>/dev/null || true');
});

it('does nothing when localhost server is missing', function () {
    Queue::fake();

    (new InstanceHostDiskGuardJob)->handle();

    Queue::assertNothingPushed();
});

it('does not dispatch cleanup when disk usage is healthy', function () {
    Queue::fake();
    Cache::flush();

    $user = User::factory()->create();
    $team = $user->teams()->first();
    $server = Server::factory()->create([
        'team_id' => $team->id,
        'ip' => 'host.docker.internal',
    ]);
    \Illuminate\Support\Facades\DB::table('servers')->where('id', $server->id)->update(['id' => 0]);
    $server = Server::find(0);
    $server->settings->update([
        'is_reachable' => true,
        'is_usable' => true,
        'force_disabled' => false,
    ]);

    // Without SSH to the host, getWorkloadDiskUsage returns empty → usage 0.
    (new InstanceHostDiskGuardJob)->handle();

    Queue::assertNotPushed(DockerCleanupJob::class);
});

it('uses workload disk mount for storageCheck instead of root', function () {
    $user = User::factory()->create();
    $team = $user->teams()->first();
    $server = Server::factory()->create(['team_id' => $team->id]);

    $mock = Mockery::mock($server)->makePartial();
    $mock->shouldReceive('getWorkloadDiskUsage')->once()->andReturn('42');

    expect($mock->storageCheck())->toBe('42');
});
