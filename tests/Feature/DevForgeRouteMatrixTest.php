<?php

use App\Http\Middleware\CanAccessTerminal;
use Illuminate\Auth\Middleware\Authenticate;
use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Route;

/**
 * @return Collection<string, array{enabled: bool, routes: array<string, array{legacy: string, devforge: string}>}>
 */
function devForgeDomains(): Collection
{
    return collect(config('devforge.domains'));
}

/**
 * @return Collection<string, array{domain: string, legacy: string, devforge: string}>
 */
function devForgeRoutes(): Collection
{
    return devForgeDomains()->flatMap(
        fn (array $domain, string $domainName): array => collect($domain['routes'])
            ->map(
                fn (array $paths): array => [
                    'domain' => $domainName,
                    'legacy' => $paths['legacy'],
                    'devforge' => $paths['devforge'],
                ]
            )
            ->all()
    );
}

test('DevForge is the default interface when the global flag is on', function () {
    config()->set('devforge.enabled', true);

    foreach (array_keys(config('devforge.domains')) as $domainName) {
        config()->set("devforge.domains.{$domainName}.enabled", true);
    }

    expect(config('devforge.enabled'))->toBeTrue()
        ->and(devForgeDomains())->not->toBeEmpty();

    devForgeDomains()->each(function (array $domain, string $domainName): void {
        expect($domain)
            ->toHaveKeys(['enabled', 'routes'])
            ->and($domain['enabled'])->toBeTrue("DevForge domain [{$domainName}] must follow the global default")
            ->and($domain['routes'])->toBeArray()->not->toBeEmpty();
    });
});

test('DevForge matrix covers every named Livewire GET route exactly once', function () {
    $livewireRouteNames = collect(Route::getRoutes()->getRoutes())
        ->filter(
            fn (LaravelRoute $route): bool => in_array('GET', $route->methods(), true)
                && str_starts_with($route->getActionName(), 'App\\Livewire\\')
                && is_string($route->getName())
        )
        ->map(fn (LaravelRoute $route): string => $route->getName())
        ->sort()
        ->values();

    $mappedRouteNames = devForgeDomains()
        ->flatMap(fn (array $domain): array => array_keys($domain['routes']))
        ->sort()
        ->values();

    expect($mappedRouteNames)->toHaveCount($mappedRouteNames->unique()->count())
        ->and($livewireRouteNames->diff($mappedRouteNames))->toBeEmpty();
});

test('DevForge mappings match existing legacy routes and equivalent paths', function () {
    devForgeRoutes()->each(function (array $mapping, string $routeName): void {
        $route = Route::getRoutes()->getByName($routeName);

        expect($route)->not->toBeNull("Mapped legacy route [{$routeName}] does not exist")
            ->and($route->methods())->toContain('GET');

        $registeredPath = '/'.ltrim($route->uri(), '/');

        expect($mapping['legacy'])->toBe($registeredPath, "Legacy path drift for [{$routeName}]")
            ->and($mapping['devforge'])->toBe($mapping['legacy'], "DevForge path must remain equivalent for [{$routeName}]");
    });
});

test('DevForge mappings preserve basic route security constraints', function () {
    devForgeRoutes()->each(function (array $mapping, string $routeName): void {
        $route = Route::getRoutes()->getByName($routeName);
        $middleware = $route->gatherMiddleware();

        expect(collect($middleware)->contains(
            fn (string $entry): bool => in_array($entry, ['auth', Authenticate::class], true),
        ))->toBeTrue("Mapped route [{$routeName}] must require authentication");

        foreach (['legacy', 'devforge'] as $pathType) {
            $path = $mapping[$pathType];

            expect($path)
                ->toStartWith('/')
                ->not->toStartWith('//')
                ->not->toContain('\\')
                ->and(parse_url($path, PHP_URL_SCHEME))->toBeNull()
                ->and(preg_match('#(^|/)\.\.?(/|$)#', $path))->toBe(0);
        }
    });

    collect([
        'terminal',
        'project.application.command',
        'project.database.command',
        'project.service.command',
        'server.command',
    ])->each(function (string $routeName): void {
        $route = Route::getRoutes()->getByName($routeName);

        expect(collect($route->gatherMiddleware())->contains(
            fn (string $entry): bool => in_array($entry, ['can.access.terminal', CanAccessTerminal::class], true),
        ))->toBeTrue("Terminal route [{$routeName}] must retain its authorization middleware");
    });
});
