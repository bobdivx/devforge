<?php

namespace App\Services\DevForge;

use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Onboarding\OnboardingStatus;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Gate;

class BootstrapData
{
    public function __construct(private readonly OnboardingStatus $onboardingStatus) {}

    /**
     * @return array<string, mixed>
     */
    public function build(User $user): array
    {
        $teams = $this->teamsFor($user);
        $currentTeam = $this->currentTeam($teams);
        $role = (string) $currentTeam->pivot->role;

        return [
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'email_verified' => $user->hasVerifiedEmail(),
                'force_password_reset' => (bool) $user->force_password_reset,
                'two_factor_enabled' => ! is_null($user->two_factor_confirmed_at),
            ],
            'current_team' => $this->team($currentTeam, $role, true),
            'teams' => $teams
                ->map(fn (Team $team): array => $this->team(
                    $team,
                    (string) $team->pivot->role,
                    $team->is($currentTeam),
                ))
                ->values()
                ->all(),
            'permissions' => [
                'role' => $role,
                'create_resources' => Gate::forUser($user)->allows('createAnyResource'),
                'manage_team' => Gate::forUser($user)->allows('update', $currentTeam),
                'manage_members' => Gate::forUser($user)->allows('manageMembers', $currentTeam),
                'access_terminal' => Gate::forUser($user)->allows('canAccessTerminal'),
                'instance_admin' => $user->isInstanceAdmin(),
            ],
            'realtime' => [
                'enabled' => true,
                'key' => config('constants.pusher.app_key') ?: 'coolify',
                'host' => config('constants.pusher.host') ?: request()->getHost(),
                'port' => getRealtime(),
                'scheme' => request()->isSecure() ? 'wss' : 'ws',
                'auth_endpoint' => '/broadcasting/auth',
                'channels' => [
                    'team' => 'team.'.$currentTeam->id,
                    'user' => 'user.'.$user->id,
                ],
            ],
            'onboarding' => [
                'required' => showBoarding(),
                'user_enabled' => (bool) $user->show_boarding,
                'team_enabled' => (bool) $currentTeam->show_boarding,
                'steps' => $this->onboardingStatus->steps($currentTeam),
            ],
            'cloud' => [
                'enabled' => isCloud(),
                'subscription_active' => (bool) isSubscriptionActive(),
                'subscription_grace_period' => (bool) isSubscriptionOnGracePeriod(),
            ],
            'migration' => [
                'enabled' => (bool) config('devforge.enabled'),
                'legacy_base_url' => request()->getSchemeAndHttpHost(),
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
            ->select(['teams.id', 'teams.name', 'teams.personal_team', 'teams.show_boarding'])
            ->orderBy('teams.id')
            ->get();
    }

    /**
     * @param  Collection<int, Team>  $teams
     */
    private function currentTeam(Collection $teams): Team
    {
        abort_if($teams->isEmpty(), 409, 'No team is available.');

        $sessionTeamId = data_get(session('currentTeam'), 'id');
        $currentTeam = $teams->first(
            fn (Team $team): bool => ! is_null($sessionTeamId) && $team->id === (int) $sessionTeamId
        );

        if (! $currentTeam) {
            $currentTeam = $teams->firstOrFail();
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
            'personal_team' => (bool) $team->personal_team,
            'role' => $role,
            'is_current' => $isCurrent,
        ];
    }
}
