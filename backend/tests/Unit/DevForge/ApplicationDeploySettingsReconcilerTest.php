<?php

use App\Models\Application;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\User;
use App\Services\DevForge\Application\ApplicationDeploySettingsReconciler;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();

    $server = Server::factory()->create(['team_id' => $this->team->id]);
    $destination = $server->standaloneDockers()->firstOrFail();
    $project = Project::factory()->create(['team_id' => $this->team->id]);
    $environment = Environment::factory()->create(['project_id' => $project->id]);

    $this->application = Application::factory()->create([
        'environment_id' => $environment->id,
        'destination_id' => $destination->id,
        'destination_type' => StandaloneDocker::class,
        'build_pack' => 'nixpacks',
        'ports_exposes' => '3000',
        'publish_directory' => '/',
        'detected_framework' => null,
        'start_command' => null,
        'build_command' => null,
        'install_command' => null,
    ]);

    $this->application->settings()->update(['is_static' => false]);
});

function astroStaticDetection(): array
{
    return [
        'available' => true,
        'reason' => null,
        'sources' => ['package.json', 'astro.config.mjs'],
        'suggestions' => [
            'is_static' => true,
            'ports_exposes' => '80',
            'publish_directory' => '/dist',
            'base_directory' => '/',
            'start_command' => null,
            'build_command' => 'astro build',
            'install_command' => 'npm ci',
            'health_check_port' => '80',
            'framework' => 'astro-static',
            'framework_label' => 'Astro static',
        ],
        'reasons' => ['Astro static détecté → nginx + publish_directory=/dist.'],
    ];
}

it('applies Astro static defaults when publish is unset', function () {
    $reconciler = app(ApplicationDeploySettingsReconciler::class);

    $result = $reconciler->applyDetection($this->application, astroStaticDetection());

    $this->application->refresh();
    $this->application->load('settings');

    expect($result['applied'])->toBeTrue()
        ->and($result['framework'])->toBe('astro-static')
        ->and($this->application->detected_framework)->toBe('astro-static')
        ->and($this->application->settings->is_static)->toBeTrue()
        ->and($this->application->publish_directory)->toBe('/dist')
        ->and((string) $this->application->ports_exposes)->toBe('80')
        ->and($this->application->build_command)->toBe('astro build');
});

it('does not overwrite a custom publish directory', function () {
    $this->application->update([
        'publish_directory' => '/custom-out',
        'ports_exposes' => '80',
    ]);
    $this->application->settings()->update(['is_static' => true]);

    $reconciler = app(ApplicationDeploySettingsReconciler::class);
    $result = $reconciler->applyDetection($this->application->fresh(['settings']), astroStaticDetection());

    $this->application->refresh();

    expect($this->application->publish_directory)->toBe('/custom-out')
        ->and($this->application->detected_framework)->toBe('astro-static')
        ->and($result['changes'])->not->toContain('publish_directory=/dist');
});

it('applies Astro SSR listen port when still on Coolify default 3000', function () {
    $detection = [
        'available' => true,
        'reason' => null,
        'sources' => ['package.json', 'astro.config.mjs'],
        'suggestions' => [
            'is_static' => false,
            'ports_exposes' => '4321',
            'publish_directory' => '/dist',
            'base_directory' => '/',
            'start_command' => 'node ./dist/server/entry.mjs',
            'build_command' => 'astro build',
            'install_command' => 'npm ci',
            'health_check_enabled' => true,
            'health_check_path' => '/',
            'health_check_port' => '4321',
            'framework' => 'astro-ssr',
            'framework_label' => 'Astro SSR',
        ],
        'reasons' => ['Astro SSR détecté'],
    ];

    $reconciler = app(ApplicationDeploySettingsReconciler::class);
    $result = $reconciler->applyDetection($this->application, $detection);

    $this->application->refresh();

    expect($result['applied'])->toBeTrue()
        ->and($result['framework'])->toBe('astro-ssr')
        ->and((string) $this->application->ports_exposes)->toBe('4321')
        ->and($this->application->publish_directory)->toBe('/dist')
        ->and($this->application->start_command)->toBe('node ./dist/server/entry.mjs')
        ->and($this->application->build_command)->toBe('astro build')
        ->and($this->application->install_command)->toBe('npm ci')
        ->and((string) $this->application->health_check_port)->toBe('4321')
        ->and($this->application->settings->is_static)->toBeFalse();
});

it('corrects wrongly-enabled static mode for Astro SSR', function () {
    $this->application->update([
        'ports_exposes' => '80',
        'publish_directory' => '/dist',
        'health_check_port' => '80',
        'start_command' => null,
    ]);
    $this->application->settings()->update(['is_static' => true]);

    $detection = [
        'available' => true,
        'reason' => null,
        'sources' => ['package.json'],
        'suggestions' => [
            'is_static' => false,
            'ports_exposes' => '4321',
            'publish_directory' => '/dist',
            'base_directory' => '/',
            'start_command' => 'node ./dist/server/entry.mjs',
            'build_command' => 'astro build',
            'install_command' => 'npm ci',
            'health_check_enabled' => true,
            'health_check_path' => '/',
            'health_check_port' => '4321',
            'framework' => 'astro-ssr',
            'framework_label' => 'Astro SSR',
        ],
        'reasons' => ['Astro SSR détecté'],
    ];

    $reconciler = app(ApplicationDeploySettingsReconciler::class);
    $result = $reconciler->applyDetection($this->application->fresh(['settings']), $detection);

    $this->application->refresh();
    $this->application->load('settings');

    expect($result['applied'])->toBeTrue()
        ->and($this->application->settings->is_static)->toBeFalse()
        ->and((string) $this->application->ports_exposes)->toBe('4321')
        ->and($this->application->start_command)->toBe('node ./dist/server/entry.mjs')
        ->and((string) $this->application->health_check_port)->toBe('4321')
        ->and($result['changes'])->toContain('is_static=false');
});
