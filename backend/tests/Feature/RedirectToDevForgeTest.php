<?php

use App\Http\Middleware\CheckForcePasswordReset;
use App\Http\Middleware\DecideWhatToDoWithUser;
use App\Http\Middleware\RedirectToDevForge;
use App\Models\InstanceSettings;
use App\Models\Project;
use App\Models\User;
use App\Support\DevForge\LegacyInterfacePreference;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;

uses(RefreshDatabase::class);

function devForgeRequest(string $uri, bool $authenticated = true): Request
{
    $request = Request::create($uri);
    $request->setRouteResolver(function (): Route {
        return (new Route('GET', '/projects', fn () => null))->name('project.index');
    });

    if ($authenticated) {
        $request->setUserResolver(fn (): User => new User(['email' => 'devforge@example.com']));
    }

    return $request;
}

beforeEach(function () {
    config()->set('devforge.enabled', true);
    config()->set('devforge.domains.projects.enabled', true);

    if (! InstanceSettings::query()->whereKey(0)->exists()) {
        $settings = new InstanceSettings;
        $settings->id = 0;
        $settings->save();
    }
});

test('enabled domains redirect authenticated legacy requests to DevForge', function () {
    $response = app(RedirectToDevForge::class)->handle(
        devForgeRequest('/projects?tag=api'),
        fn () => response('legacy'),
    );

    expect($response->getStatusCode())->toBe(302)
        ->and($response->headers->get('Location'))->toEndWith('/devforge/projects?tag=api');
});

test('redirects use the explicit DevForge path from the migration matrix', function () {
    $domains = config('devforge.domains');
    $domains['projects']['routes']['project.index']['devforge'] = '/workspaces';
    config()->set('devforge.domains', $domains);

    $response = app(RedirectToDevForge::class)->handle(
        devForgeRequest('/projects'),
        fn () => response('legacy'),
    );

    expect($response->getStatusCode())->toBe(302)
        ->and($response->headers->get('Location'))->toEndWith('/devforge/workspaces');
});

test('legacy query parameter bypasses the DevForge redirect', function () {
    $response = app(RedirectToDevForge::class)->handle(
        devForgeRequest('/projects?legacy=1&tag=api'),
        fn () => response('legacy'),
    );

    expect($response->getContent())->toBe('legacy');
});

test('guests and disabled domains continue to the legacy application', function () {
    $guestResponse = app(RedirectToDevForge::class)->handle(
        devForgeRequest('/projects', authenticated: false),
        fn () => response('legacy'),
    );

    config()->set('devforge.domains.projects.enabled', false);

    $disabledResponse = app(RedirectToDevForge::class)->handle(
        devForgeRequest('/projects'),
        fn () => response('legacy'),
    );

    expect($guestResponse->getContent())->toBe('legacy')
        ->and($disabledResponse->getContent())->toBe('legacy');
});

test('guests cannot load the DevForge shell', function () {
    $this->get('/devforge/')
        ->assertRedirect(route('login'));
});

test('authenticated users load the real DevForge shell route', function () {
    $user = User::factory()->create();
    $team = $user->teams()->firstOrFail();

    $this->withoutMiddleware(DecideWhatToDoWithUser::class)
        ->actingAs($user)
        ->withSession(['currentTeam' => $team])
        ->get('/devforge/projects/')
        ->assertSuccessful();
});

test('real legacy routes support migration and explicit rollback', function () {
    $user = User::factory()->create();
    $team = $user->teams()->firstOrFail();

    $this->withoutMiddleware(DecideWhatToDoWithUser::class)
        ->actingAs($user)
        ->withSession(['currentTeam' => $team])
        ->get('/projects?tag=api')
        ->assertRedirect('/devforge/projects?tag=api');

    $this->actingAs($user)
        ->withSession(['currentTeam' => $team])
        ->get('/projects?legacy=1')
        ->assertSuccessful()
        ->assertSessionHas(LegacyInterfacePreference::SESSION_KEY, true);

    $this->actingAs($user)
        ->withSession(['currentTeam' => $team, LegacyInterfacePreference::SESSION_KEY => true])
        ->get('/projects')
        ->assertSuccessful();
});

test('visiting DevForge clears the persisted legacy interface preference', function () {
    $user = User::factory()->create();
    $team = $user->teams()->firstOrFail();

    $this->withoutMiddleware(DecideWhatToDoWithUser::class)
        ->actingAs($user)
        ->withSession([
            'currentTeam' => $team,
            LegacyInterfacePreference::SESSION_KEY => true,
        ])
        ->get('/devforge/')
        ->assertSuccessful()
        ->assertSessionMissing(LegacyInterfacePreference::SESSION_KEY);

    $this->actingAs($user)
        ->withSession(['currentTeam' => $team])
        ->get('/projects')
        ->assertRedirect('/devforge/projects');
});

test('real dynamic legacy routes preserve parameters when migrating', function () {
    $user = User::factory()->create();
    $team = $user->teams()->firstOrFail();
    $project = Project::factory()->create(['team_id' => $team->id]);
    $environment = $project->environments()->firstOrFail();

    $this->withoutMiddleware(DecideWhatToDoWithUser::class)
        ->actingAs($user)
        ->withSession(['currentTeam' => $team])
        ->get("/project/{$project->uuid}/environment/{$environment->uuid}")
        ->assertRedirect("/devforge/project/{$project->uuid}/environment/{$environment->uuid}");
});

test('JSON requests never redirect to the frontend shell', function () {
    $request = devForgeRequest('/projects');
    $request->headers->set('Accept', 'application/json');

    $response = app(RedirectToDevForge::class)->handle(
        $request,
        fn () => response()->json(['source' => 'legacy']),
    );

    expect($response->getData(true))->toBe(['source' => 'legacy']);
});

test('legacy navigation exposes the DevForge switch only when enabled', function () {
    $navbar = file_get_contents(resource_path('views/components/navbar.blade.php'));

    expect($navbar)
        ->toContain("@if (config('devforge.enabled'))")
        ->toContain('href="{{ route(\'devforge\') }}"')
        ->toContain('DevForge');
});

test('the DevForge shell is unavailable while its global feature flag is disabled', function () {
    config()->set('devforge.enabled', false);
    $user = User::factory()->create();
    $team = $user->teams()->firstOrFail();

    $this->withoutMiddleware(DecideWhatToDoWithUser::class)
        ->actingAs($user)
        ->withSession(['currentTeam' => $team])
        ->get('/devforge/')
        ->assertNotFound();
});

test('the password reset guard recognizes its DevForge equivalent path', function () {
    $user = User::factory()->create(['force_password_reset' => true]);
    $request = Request::create('/devforge/force-password-reset');
    $request->setRouteResolver(fn (): Route => (new Route(
        'GET',
        '/devforge/{path?}',
        fn () => null,
    ))->name('devforge'));

    $this->actingAs($user);
    $response = app(CheckForcePasswordReset::class)->handle(
        $request,
        fn () => response('devforge-shell'),
    );

    expect($response->getContent())->toBe('devforge-shell');
});
