<?php

namespace App\Services\DevForge\Team;

use App\Enums\Role;
use App\Models\Team;
use App\Models\TeamInvitation;
use App\Models\User;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Visus\Cuid2\Cuid2;

class TeamInvitationManager
{
    /**
     * @return array<string, mixed>
     */
    public function create(User $actor, Team $team, string $email, string $role, string $via): array
    {
        Gate::forUser($actor)->authorize('manageInvitations', $team);

        $normalizedEmail = strtolower(trim($email));
        $normalizedRole = Role::from($role);
        $this->assertCanInviteRole($actor, $normalizedRole);

        if ($team->members()->where('email', $normalizedEmail)->exists()) {
            throw ValidationException::withMessages([
                'email' => ["{$normalizedEmail} is already a member of {$team->name}."],
            ]);
        }

        $existingInvitation = TeamInvitation::query()
            ->where('team_id', $team->id)
            ->where('email', $normalizedEmail)
            ->first();

        if ($existingInvitation && $existingInvitation->isValid()) {
            throw ValidationException::withMessages([
                'email' => ["Pending invitation already exists for {$normalizedEmail}."],
            ]);
        }

        if ($existingInvitation) {
            $existingInvitation->delete();
        }

        $uuid = (string) new Cuid2(32);
        $link = url('/').config('constants.invitation.link.base_url').$uuid;
        $user = User::query()->where('email', $normalizedEmail)->first();

        if ($user === null) {
            $password = Str::password();
            $user = User::create([
                'name' => str($normalizedEmail)->before('@'),
                'email' => $normalizedEmail,
                'password' => Hash::make($password),
                'force_password_reset' => true,
            ]);
            $token = Crypt::encryptString("{$user->email}@@@{$uuid}@@@{$password}");
            $link = route('auth.link', ['token' => $token]);
        }

        $sendEmail = $via === 'email';
        $invitation = TeamInvitation::query()->create([
            'team_id' => $team->id,
            'uuid' => $uuid,
            'email' => $normalizedEmail,
            'role' => $normalizedRole->value,
            'link' => $link,
            'via' => $sendEmail ? 'email' : 'link',
        ]);

        if ($sendEmail) {
            $mail = new MailMessage;
            $mail->view('emails.invitation-link', [
                'team' => $team->name,
                'invitation_link' => $link,
            ]);
            $mail->subject('You have been invited to '.$team->name.' on '.config('app.name').'.');
            send_user_an_email($mail, $normalizedEmail);
        }

        return $this->present($invitation);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function listForTeam(Team $team): array
    {
        return TeamInvitation::query()
            ->where('team_id', $team->id)
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (TeamInvitation $invitation): array => $this->present($invitation))
            ->all();
    }

    public function revoke(User $actor, Team $team, int $invitationId): void
    {
        Gate::forUser($actor)->authorize('manageInvitations', $team);

        $invitation = TeamInvitation::query()
            ->where('team_id', $team->id)
            ->whereKey($invitationId)
            ->firstOrFail();

        $user = User::query()->where('email', $invitation->email)->first();
        if ($user) {
            $user->deleteIfNotVerifiedAndForcePasswordReset();
        }

        $invitation->delete();
    }

    /**
     * @return array<string, mixed>
     */
    public function present(TeamInvitation $invitation): array
    {
        return [
            'id' => $invitation->id,
            'email' => $invitation->email,
            'role' => $invitation->role,
            'via' => $invitation->via,
            'link' => $invitation->via === 'link' ? $invitation->link : null,
            'created_at' => $invitation->created_at?->toIso8601String(),
        ];
    }

    private function assertCanInviteRole(User $actor, Role $role): void
    {
        $actorRole = Role::from((string) $actor->role());

        if ($actorRole === Role::MEMBER && in_array($role, [Role::ADMIN, Role::OWNER], true)) {
            throw ValidationException::withMessages([
                'role' => ['Members cannot invite admins or owners.'],
            ]);
        }

        if ($actorRole === Role::ADMIN && $role === Role::OWNER) {
            throw ValidationException::withMessages([
                'role' => ['Admins cannot invite owners.'],
            ]);
        }
    }
}
