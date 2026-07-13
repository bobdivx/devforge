<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use LogicException;
use Symfony\Component\HttpFoundation\Response;

class RedirectToDevForge
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->shouldRedirect($request)) {
            return $next($request);
        }

        $query = collect($request->query())
            ->except('legacy')
            ->all();
        $migrationRoute = $this->migrationRoute($request);
        $target = '/devforge'.$this->resolvePath(
            (string) $migrationRoute['devforge'],
            $this->routeParameters($request),
        );

        if ($query !== []) {
            $target .= '?'.http_build_query($query);
        }

        return redirect($target);
    }

    private function shouldRedirect(Request $request): bool
    {
        if (! $request->user() || ! config('devforge.enabled') || ! $request->isMethod('GET') || $request->expectsJson()) {
            return false;
        }

        if ($request->boolean('legacy') || $request->is('devforge', 'devforge/*')) {
            return false;
        }

        $routeName = $request->route()?->getName();
        if (! is_string($routeName)) {
            return false;
        }

        return $this->migrationRoute($request) !== null;
    }

    /**
     * @return array{legacy: string, devforge: string}|null
     */
    private function migrationRoute(Request $request): ?array
    {
        $routeName = $request->route()?->getName();
        if (! is_string($routeName)) {
            return null;
        }

        foreach (config('devforge.domains', []) as $domain) {
            $route = $domain['routes'][$routeName] ?? null;

            if (($domain['enabled'] ?? false) && is_array($route)) {
                return $route;
            }
        }

        return null;
    }

    /**
     * @return array<string, mixed>
     */
    private function routeParameters(Request $request): array
    {
        try {
            return $request->route()?->parameters() ?? [];
        } catch (LogicException) {
            return [];
        }
    }

    /**
     * @param  array<string, mixed>  $parameters
     */
    private function resolvePath(string $path, array $parameters): string
    {
        foreach ($parameters as $name => $value) {
            $encodedValue = rawurlencode((string) $value);
            $path = str_replace(["{{$name}}", "{{$name}?}"], $encodedValue, $path);
        }

        return preg_replace('#/\{[^}]+\?\}#', '', $path) ?? $path;
    }
}
