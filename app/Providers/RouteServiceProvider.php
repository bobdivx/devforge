<?php

namespace App\Providers;

use App\Http\Controllers\DevForgeController;
use App\Http\Middleware\CheckForcePasswordReset;
use App\Http\Middleware\DecideWhatToDoWithUser;
use App\Http\Middleware\EnsureDevForgeCurrentTeam;
use App\Http\Middleware\EnsureDevForgeEnabled;
use App\Http\Middleware\EnsureDevForgeUserIsVerified;
use App\Http\Middleware\EnsureJsonResponse;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Support\Providers\RouteServiceProvider as ServiceProvider;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

class RouteServiceProvider extends ServiceProvider
{
    /**
     * The path to the "home" route for your application.
     *
     * Typically, users are redirected here after authentication.
     *
     * @var string
     */
    public const HOME = '/';

    /**
     * Define your route model bindings, pattern filters, and other route configuration.
     */
    public function boot(): void
    {
        $this->configureRateLimiting();

        $this->routes(function () {
            Route::middleware([EnsureJsonResponse::class, EnsureDevForgeEnabled::class, 'web', 'auth', EnsureDevForgeUserIsVerified::class, 'verified', EnsureDevForgeCurrentTeam::class])
                ->withoutMiddleware([CheckForcePasswordReset::class, DecideWhatToDoWithUser::class])
                ->prefix('api/devforge/v1')
                ->as('devforge.api.')
                ->group(base_path('routes/devforge-api.php'));

            Route::middleware('api')
                ->prefix('api')
                ->group(base_path('routes/api.php'));

            Route::prefix('webhooks')
                ->group(base_path('routes/webhooks.php'));

            Route::middleware('web')
                ->group(function () {
                    Route::get('/devforge/{path?}', DevForgeController::class)
                        ->where('path', '.*')
                        ->middleware('auth')
                        ->name('devforge');
                });

            Route::middleware('web')
                ->group(base_path('routes/web.php'));
        });
    }

    /**
     * Configure the rate limiters for the application.
     */
    protected function configureRateLimiting(): void
    {
        RateLimiter::for('api', function (Request $request) {
            if ($request->path() === 'api/health') {
                return Limit::perMinute(1000)->by($request->user()?->id ?: $request->ip());
            }

            return Limit::perMinute((int) config('api.rate_limit'))->by($request->user()?->id ?: $request->ip());
        });
        RateLimiter::for('5', function (Request $request) {
            return Limit::perMinute(5)->by($request->user()?->id ?: $request->ip());
        });

        RateLimiter::for('feedback', function (Request $request) {
            return Limit::perMinute(3)->by($request->user()?->id ?: $request->ip());
        });

        RateLimiter::for('devforge-agent-run', function (Request $request) {
            return Limit::perMinute(10)->by($request->user()?->id ?: $request->ip());
        });
    }
}
