<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureDevForgeUserIsVerified
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless(
            ! isCloud() || $request->user()?->hasVerifiedEmail(),
            403,
            'Your email address is not verified.',
        );

        return $next($request);
    }
}
