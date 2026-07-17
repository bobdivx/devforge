<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class CheckForcePasswordReset
{
    /**
     * Handle an incoming request.
     *
     * @param  \Closure(\Illuminate\Http\Request): (\Symfony\Component\HttpFoundation\Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $path = $this->logicalPath($request);

        if (auth()->user()) {
            if ($path === 'auth/link') {
                auth()->logout();
                request()->session()->invalidate();
                request()->session()->regenerateToken();

                return $next($request);
            }
            $force_password_reset = auth()->user()->force_password_reset;
            if ($force_password_reset) {
                if ($request->routeIs('auth.force-password-reset') || in_array($path, ['force-password-reset', 'two-factor-challenge', 'livewire/update', 'logout'], true)) {
                    return $next($request);
                }

                return redirect()->route('auth.force-password-reset');
            }
        }

        return $next($request);
    }

    private function logicalPath(Request $request): string
    {
        $path = $request->path();

        return Str::startsWith($path, 'devforge/')
            ? Str::after($path, 'devforge/')
            : $path;
    }
}
