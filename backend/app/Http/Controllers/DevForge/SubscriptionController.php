<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\DevForge\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SubscriptionController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
    ) {}

    public function show(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $subscription = $team->subscription;
        $cloudEnabled = isCloud();

        return response()->json([
            'data' => [
                'cloud_enabled' => $cloudEnabled,
                'subscription_active' => $cloudEnabled ? (bool) isSubscriptionActive() : false,
                'subscription_grace_period' => $cloudEnabled ? (bool) isSubscriptionOnGracePeriod() : false,
                'already_subscribed' => $cloudEnabled && $subscription !== null,
                'stripe_customer_id_set' => filled($subscription?->stripe_customer_id),
                'can_manage' => $cloudEnabled && ! $user->isMember(),
                'is_member' => $user->isMember(),
            ],
        ]);
    }

    public function portal(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);
        abort_unless(isCloud(), 404);
        abort_if($user->isMember(), 403, 'Seuls les administrateurs et propriétaires peuvent gérer l’abonnement.');

        $team = $this->currentTeamContext->resolve($user);
        $session = getStripeCustomerPortalSession($team);

        abort_unless($session && filled(data_get($session, 'url')), 422, 'Impossible d’ouvrir le portail Stripe.');

        return response()->json([
            'data' => [
                'url' => (string) data_get($session, 'url'),
            ],
        ]);
    }
}
