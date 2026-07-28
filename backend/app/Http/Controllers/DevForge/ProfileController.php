<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Http\Requests\DevForge\UpdateProfileRequest;
use App\Models\User;
use App\Services\DevForge\ProfileSecurityService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProfileController extends Controller
{
    public function __construct(
        private readonly ProfileSecurityService $profileSecurity,
    ) {}

    public function show(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->data($request->user())]);
    }

    public function update(UpdateProfileRequest $request): JsonResponse
    {
        $user = $request->user();
        $user->update($request->validated());

        return response()->json(['data' => $this->data($user->refresh())]);
    }

    public function updatePassword(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return response()->json([
            'data' => $this->profileSecurity->updatePassword($user, $request->all()),
        ]);
    }

    public function twoFactorStatus(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return response()->json([
            'data' => $this->profileSecurity->status($user),
        ]);
    }

    public function enableTwoFactor(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return response()->json([
            'data' => $this->profileSecurity->enableTwoFactor($user, $request->all()),
        ]);
    }

    public function confirmTwoFactor(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return response()->json([
            'data' => $this->profileSecurity->confirmTwoFactor($user, $request->all()),
        ]);
    }

    public function disableTwoFactor(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return response()->json([
            'data' => $this->profileSecurity->disableTwoFactor($user, $request->all()),
        ]);
    }

    public function regenerateRecoveryCodes(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return response()->json([
            'data' => $this->profileSecurity->regenerateRecoveryCodes($user, $request->all()),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function data(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'email_verified' => $user->hasVerifiedEmail(),
            'two_factor_enabled' => ! is_null($user->two_factor_confirmed_at),
            'force_password_reset' => (bool) $user->force_password_reset,
        ];
    }
}
