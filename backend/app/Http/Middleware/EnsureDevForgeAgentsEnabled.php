<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureDevForgeAgentsEnabled
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless(
            config('devforge.agents_enabled', false),
            404,
            'DevForge agents are disabled.',
        );

        return $next($request);
    }
}
