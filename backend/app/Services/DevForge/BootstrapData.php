<?php

namespace App\Services\DevForge;

use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Onboarding\DefaultWorkspace;
use App\Services\DevForge\Onboarding\OnboardingStatus;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Gate;

class BootstrapData
{
    public function __construct(
        private readonly OnboardingStatus $onboardingStatus,
        private readonly DefaultWorkspace $defaultWorkspace,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function build(User $user): array
    {
        $teams = $this->teamsFor($user);
        $currentTeam = $this->currentTeam($teams);
        $role = (string) ($currentTeam->pivot?->role ?? ($user->isInstanceAdmin() ? 'owner' : 'admin'));

        if ((bool) ($currentTeam->show_boarding ?? false) && ! $user->isMember()) {
            try {
                $this->defaultWorkspace->ensure($currentTeam);
            } catch (\Throwable) {
                // Ignore workspace creation errors during bootstrap
            }
        }

        $canCreate = false;
        $canManageTeam = false;
        $canManageMembers = false;
        $canAccessTerminal = false;

        try {
            $canCreate = Gate::forUser($user)->allows('createAnyResource');
        } catch (\Throwable) {
            $canCreate = $role === 'admin' || $role === 'owner';
        }

        try {
            $canManageTeam = Gate::forUser($user)->allows('update', $currentTeam);
        } catch (\Throwable) {
            $canManageTeam = $role === 'admin' || $role === 'owner';
        }

        try {
            $canManageMembers = Gate::forUser($user)->allows('manageMembers', $currentTeam);
        } catch (\Throwable) {
            $canManageMembers = $role === 'admin' || $role === 'owner';
        }

        try {
            $canAccessTerminal = Gate::forUser($user)->allows('canAccessTerminal');
        } catch (\Throwable) {
            $canAccessTerminal = $role === 'admin' || $role === 'owner';
        }

        $realtimePort = '6001';
        try {
            if (function_exists('getRealtime')) {
                $realtimePort = getRealtime();
            }
        } catch (\Throwable) {
            $realtimePort = '6001';
        }

        $onboardingSteps = [
            'account' => true,
            'domain' => false,
            'sso' => false,
            'github' => false,
            's3' => false,
            'server' => false,
        ];
        try {
            $onboardingSteps = $this->onboardingStatus->steps($currentTeam);
        } catch (\Throwable) {
            // fallback defaults
        }

        $subscriptionActive = false;
        $subscriptionGracePeriod = false;
        try {
            $subscriptionActive = function_exists('isSubscriptionActive') ? (bool) isSubscriptionActive() : false;
            $subscriptionGracePeriod = function_exists('isSubscriptionOnGracePeriod') ? (bool) isSubscriptionOnGracePeriod() : false;
        } catch (\Throwable) {
            // fallback defaults
        }

        return [
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'email_verified' => $user->hasVerifiedEmail(),
                'force_password_reset' => (bool) ($user->force_password_reset ?? false),
                'two_factor_enabled' => ! is_null($user->two_factor_confirmed_at ?? null),
            ],
            'current_team' => $this->team($currentTeam, $role, true),
            'teams' => $teams
                ->map(fn (Team $team): array => $this->team(
                    $team,
                    (string) ($team->pivot?->role ?? 'member'),
                    $team->is($currentTeam),
                ))
                ->values()
                ->all(),
            'permissions' => [
                'role' => $role,
                'create_resources' => $canCreate,
                'manage_team' => $canManageTeam,
                'manage_members' => $canManageMembers,
                'access_terminal' => $canAccessTerminal,
                'instance_admin' => $user->isInstanceAdmin(),
            ],
            'realtime' => [
                'enabled' => true,
                'key' => config('constants.pusher.app_key') ?: 'coolify',
                'host' => config('constants.pusher.host') ?: (request()?->getHost() ?: 'localhost'),
                'port' => $realtimePort,
                'scheme' => request()?->isSecure() ? 'wss' : 'ws',
                'auth_endpoint' => '/broadcasting/auth',
                'channels' => [
                    'team' => 'team.'.$currentTeam->id,
                    'user' => 'user.'.$user->id,
                ],
            ],
            'onboarding' => [
                'required' => (bool) ($currentTeam->show_boarding ?? false) && ! $user->isMember(),
                'user_enabled' => (bool) ($user->show_boarding ?? false),
                'team_enabled' => (bool) ($currentTeam->show_boarding ?? false),
                'steps' => $onboardingSteps,
            ],
            'cloud' => [
                'enabled' => function_exists('isCloud') ? isCloud() : false,
                'subscription_active' => $subscriptionActive,
                'subscription_grace_period' => $subscriptionGracePeriod,
            ],
            'migration' => [
                'enabled' => (bool) config('devforge.enabled'),
                'legacy_base_url' => request()?->getSchemeAndHttpHost() ?: '',
                'domains' => collect(config('devforge.domains', []))
                    ->mapWithKeys(fn (array $domain, string $name): array => [
                        $name => (bool) ($domain['enabled'] ?? false),
                    ])
                    ->all(),
            ],
            'features' => [
                'agents_enabled' => (bool) config('devforge.agents_enabled', false),
            ],
        ];
    }

    /**
     * @return Collection<int, Team>
     */
    private function teamsFor(User $user): Collection
    {
        return $user->teams()
            ->withPivot('role')
            ->orderBy('teams.id')
            ->get();
    }

    /**
     * @param  Collection<int, Team>  $teams
     */
    private function currentTeam(Collection $teams): Team
    {
        if ($teams->isEmpty()) {
            $personalTeam = Team::query()->create([
                'name' => 'Personal Team',
                'personal_team' => true,
                'show_boarding' => false,
            ]);
            $teams->push($personalTeam);
        }

        $sessionTeamId = data_get(session('currentTeam'), 'id');
        $currentTeam = $teams->first(
            fn (Team $team): bool => ! is_null($sessionTeamId) && $team->id === (int) $sessionTeamId
        );

        if (! $currentTeam) {
            $currentTeam = $teams->first();
            refreshSession($currentTeam);
        }

        return $currentTeam;
    }

    /**
     * @return array<string, bool|int|string>
     */
    private function team(Team $team, string $role, bool $isCurrent): array
    {
        return [
            'id' => $team->id,
            'name' => $team->name,
            'personal_team' => (bool) ($team->personal_team ?? false),
            'role' => $role,
            'is_current' => $isCurrent,
        ];
    }
}
