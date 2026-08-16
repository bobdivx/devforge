<?php

namespace App\Http\Middleware;

use App\Providers\RouteServiceProvider;
use Closure;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class DecideWhatToDoWithUser
{
    public function handle(Request $request, Closure $next): Response
    {
        $path = $this->logicalPath($request);

        if (auth()?->user()?->teams?->count() === 0) {
            $currentTeam = auth()->user()?->recreate_personal_team();
            refreshSession($currentTeam);
        }
        if (auth()?->user()?->currentTeam()) {
            refreshSession(auth()->user()->currentTeam());
        } elseif (auth()?->user()?->teams?->count() > 0) {
            // User's session team is invalid (e.g., removed from team), switch to first available team
            refreshSession(auth()->user()->teams->first());
        }
        if ($this->shouldSkipHtmlRedirect($request)) {
            return $next($request);
        }

        if (! auth()->user() || ! isCloud()) {
            if (! isCloud() && showBoarding() && ! in_array($path, allowedPathsForBoardingAccounts())) {
                return $this->relativeRedirect('onboarding');
            }

            return $next($request);
        }
        // Instance admins can access settings and admin routes regardless of subscription
        if (isInstanceAdmin() && ($request->routeIs('settings.*') || Str::startsWith($path, 'settings') || $path === 'admin')) {
            return $next($request);
        }
        if (! auth()->user()->hasVerifiedEmail()) {
            if ($path === 'verify' || in_array($path, allowedPathsForInvalidAccounts()) || $request->routeIs('verify.verify')) {
                return $next($request);
            }

            return $this->relativeRedirect('verify.email');
        }
        if (! isSubscriptionActive() && ! isSubscriptionOnGracePeriod()) {
            if (! in_array($path, allowedPathsForUnsubscribedAccounts())) {
                if (Str::startsWith($path, 'invitations')) {
                    return $next($request);
                }

                return $this->relativeRedirect('subscription.index');
            }
        }
        if (showBoarding() && ! in_array($path, allowedPathsForBoardingAccounts())) {
            if (Str::startsWith($path, 'invitations')) {
                return $next($request);
            }

            return $this->relativeRedirect('onboarding');
        }
        if (auth()->user()->hasVerifiedEmail() && $path === 'verify') {
            return new RedirectResponse(RouteServiceProvider::HOME);
        }
        if (isSubscriptionActive() && ($request->routeIs('subscription.index') || $path === 'subscription/new')) {
            return new RedirectResponse(RouteServiceProvider::HOME);
        }

        return $next($request);
    }

    private function shouldSkipHtmlRedirect(Request $request): bool
    {
        if ($request->expectsJson() || $request->ajax()) {
            return true;
        }

        $path = $this->logicalPath($request);

        return str_starts_with($path, 'api/')
            || str_starts_with($path, 'sanctum/')
            || str_starts_with($path, 'mcp/');
    }

    private function relativeRedirect(string $routeName): RedirectResponse
    {
        return new RedirectResponse(route($routeName, absolute: false));
    }

    private function logicalPath(Request $request): string
    {
        $path = $request->path();

        return Str::startsWith($path, 'devforge/')
            ? Str::after($path, 'devforge/')
            : $path;
    }
}
