<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Models\Team;
use App\Models\TeamInvitation;
use App\Models\User;
use App\Services\DevForge\Sso\SsoProtection;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;

class OauthController extends Controller
{
    public function redirect(string $provider)
    {
        $socialite_provider = get_socialite_provider($provider);

        return $socialite_provider->redirect();
    }

    public function callback(string $provider)
    {
        try {
            $oauthUser = get_socialite_provider($provider)->user();
            $email = strtolower(trim((string) $oauthUser->email));
            if ($email === '') {
                return $this->loginFailed('auth.failed.callback');
            }

            $user = User::whereEmail($email)->first();
            $provisioned = false;
            if (! $user) {
                if (! $this->canProvisionOauthUser($provider)) {
                    return $this->loginFailed('auth.registration_disabled');
                }

                $user = User::create([
                    'name' => filled($oauthUser->name) ? (string) $oauthUser->name : str($email)->before('@')->value(),
                    'email' => $email,
                    'password' => Hash::make(Str::password()),
                ]);
                $user->markEmailAsVerified();
                $provisioned = true;
            }

            Auth::login($user);
            $this->establishTeamSession($user, $provider, $provisioned);

            return redirect('/');
        } catch (\Throwable $e) {
            Log::warning('OAuth callback failed.', [
                'provider' => $provider,
                'error' => $e->getMessage(),
            ]);
            $errorCode = $e instanceof HttpException ? 'auth.failed' : 'auth.failed.callback';

            return $this->loginFailed($errorCode);
        }
    }

    private function canProvisionOauthUser(string $provider): bool
    {
        $settings = instanceSettings();
        if ($settings->is_registration_enabled) {
            return true;
        }

        return $provider === 'pocketid' && SsoProtection::pocketIdLoginEnabled();
    }

    private function establishTeamSession(User $user, string $provider, bool $provisioned): void
    {
        $invitation = TeamInvitation::query()->where('email', $user->email)->first();
        if ($invitation && $invitation->isValid()) {
            if (! $user->teams()->where('team_id', $invitation->team->id)->exists()) {
                $user->teams()->attach($invitation->team->id, ['role' => $invitation->role]);
            }
            refreshSession($invitation->team);
            $invitation->delete();

            return;
        }

        if ($provider === 'pocketid' && $provisioned) {
            $rootTeam = Team::query()->find(0);
            if ($rootTeam !== null) {
                if (! $user->teams()->whereKey(0)->exists()) {
                    $user->teams()->attach($rootTeam, ['role' => Role::MEMBER->value]);
                }
                refreshSession($rootTeam);

                return;
            }
        }

        $user->load('teams');
        $team = $user->teams->firstWhere('personal_team', true) ?? $user->teams->first();
        if ($team) {
            refreshSession($team);
        }
    }

    private function loginFailed(string $errorCode)
    {
        return redirect()->route('login')->withErrors(['email' => __($errorCode)]);
    }
}
