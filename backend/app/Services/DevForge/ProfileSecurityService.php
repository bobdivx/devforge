<?php

namespace App\Services\DevForge;

use App\Actions\Fortify\UpdateUserPassword;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use Laravel\Fortify\Actions\ConfirmTwoFactorAuthentication;
use Laravel\Fortify\Actions\DisableTwoFactorAuthentication;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;
use Laravel\Fortify\Actions\GenerateNewRecoveryCodes;

class ProfileSecurityService
{
    public function __construct(
        private readonly UpdateUserPassword $updateUserPassword,
        private readonly EnableTwoFactorAuthentication $enableTwoFactorAuthentication,
        private readonly DisableTwoFactorAuthentication $disableTwoFactorAuthentication,
        private readonly ConfirmTwoFactorAuthentication $confirmTwoFactorAuthentication,
        private readonly GenerateNewRecoveryCodes $generateNewRecoveryCodes,
    ) {}

    /**
     * @param  array<string, mixed>  $input
     * @return array{message: string, force_password_reset: bool}
     */
    public function updatePassword(User $user, array $input): array
    {
        $this->updateUserPassword->update($user, $input);

        if ($user->force_password_reset) {
            $user->forceFill(['force_password_reset' => false])->save();
        }

        return [
            'message' => 'Mot de passe mis à jour.',
            'force_password_reset' => false,
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     two_factor_enabled: bool,
     *     two_factor_confirmed: bool,
     *     qr_code_svg: string|null,
     *     setup_key: string|null,
     *     recovery_codes: list<string>,
     *     message: string
     * }
     */
    public function enableTwoFactor(User $user, array $input): array
    {
        $this->assertCurrentPassword($user, $input);

        ($this->enableTwoFactorAuthentication)($user);

        $user->refresh();

        return [
            ...$this->presentTwoFactor($user, includeSensitive: true),
            'message' => '2FA activée. Scannez le QR code puis confirmez avec un code TOTP.',
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     two_factor_enabled: bool,
     *     two_factor_confirmed: bool,
     *     qr_code_svg: string|null,
     *     setup_key: string|null,
     *     recovery_codes: list<string>,
     *     message: string
     * }
     */
    public function confirmTwoFactor(User $user, array $input): array
    {
        $code = (string) ($input['code'] ?? '');

        if ($code === '') {
            throw ValidationException::withMessages([
                'code' => 'Le code TOTP est requis.',
            ]);
        }

        ($this->confirmTwoFactorAuthentication)($user, $code);

        $user->refresh();

        return [
            ...$this->presentTwoFactor($user, includeSensitive: true),
            'message' => '2FA confirmée. Conservez vos codes de récupération.',
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     two_factor_enabled: bool,
     *     two_factor_confirmed: bool,
     *     qr_code_svg: string|null,
     *     setup_key: string|null,
     *     recovery_codes: list<string>,
     *     message: string
     * }
     */
    public function disableTwoFactor(User $user, array $input): array
    {
        $this->assertCurrentPassword($user, $input);

        ($this->disableTwoFactorAuthentication)($user);

        $user->refresh();

        return [
            ...$this->presentTwoFactor($user),
            'message' => '2FA désactivée.',
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     two_factor_enabled: bool,
     *     two_factor_confirmed: bool,
     *     qr_code_svg: string|null,
     *     setup_key: string|null,
     *     recovery_codes: list<string>,
     *     message: string
     * }
     */
    public function regenerateRecoveryCodes(User $user, array $input): array
    {
        $this->assertCurrentPassword($user, $input);

        if (is_null($user->two_factor_secret)) {
            throw ValidationException::withMessages([
                'two_factor' => 'La 2FA n’est pas activée.',
            ]);
        }

        ($this->generateNewRecoveryCodes)($user);

        $user->refresh();

        return [
            ...$this->presentTwoFactor($user, includeSensitive: true),
            'message' => 'Codes de récupération régénérés.',
        ];
    }

    /**
     * @return array{
     *     two_factor_enabled: bool,
     *     two_factor_confirmed: bool,
     *     qr_code_svg: string|null,
     *     setup_key: string|null,
     *     recovery_codes: list<string>
     * }
     */
    public function status(User $user): array
    {
        return $this->presentTwoFactor($user, includeSensitive: filled($user->two_factor_secret) && is_null($user->two_factor_confirmed_at));
    }

    /**
     * @param  array<string, mixed>  $input
     */
    private function assertCurrentPassword(User $user, array $input): void
    {
        $password = (string) ($input['current_password'] ?? $input['password'] ?? '');

        if ($password === '' || ! Hash::check($password, $user->password)) {
            throw ValidationException::withMessages([
                'current_password' => 'Le mot de passe actuel est incorrect.',
            ]);
        }
    }

    /**
     * @return array{
     *     two_factor_enabled: bool,
     *     two_factor_confirmed: bool,
     *     qr_code_svg: string|null,
     *     setup_key: string|null,
     *     recovery_codes: list<string>
     * }
     */
    private function presentTwoFactor(User $user, bool $includeSensitive = false): array
    {
        $hasSecret = filled($user->two_factor_secret);
        $confirmed = ! is_null($user->two_factor_confirmed_at);
        $pendingConfirmation = $hasSecret && ! $confirmed;

        return [
            'two_factor_enabled' => $hasSecret && $confirmed,
            'two_factor_confirmed' => $confirmed,
            'qr_code_svg' => ($includeSensitive && $pendingConfirmation) ? $user->twoFactorQrCodeSvg() : null,
            'setup_key' => ($includeSensitive && $pendingConfirmation) ? (string) $user->two_factor_secret : null,
            'recovery_codes' => ($includeSensitive && $hasSecret) ? $user->recoveryCodes() : [],
        ];
    }
}
