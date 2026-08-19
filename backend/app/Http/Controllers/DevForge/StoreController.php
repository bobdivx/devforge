<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\StoreListing;
use App\Models\User;
use App\Services\DevForge\Core\CoreResourcePresenter;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\CurrentTeamResources;
use App\Services\DevForge\Store\StoreListingCatalog;
use App\Services\DevForge\Store\StoreListingInstaller;
use App\Services\DevForge\Store\StoreListingPublisher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class StoreController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly CurrentTeamResources $currentTeamResources,
        private readonly StoreListingCatalog $catalog,
        private readonly StoreListingPublisher $publisher,
        private readonly StoreListingInstaller $installer,
        private readonly CoreResourcePresenter $presenter,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', StoreListing::class);
        $team = $this->currentTeamContext->resolve($request->user());

        $validated = $request->validate([
            'q' => ['nullable', 'string', 'max:120'],
            'category' => ['nullable', 'string', 'max:40'],
        ]);

        return response()->json([
            'data' => $this->catalog->listings(
                $team,
                $validated['q'] ?? null,
                $validated['category'] ?? null,
            ),
            'meta' => [
                'categories' => $this->catalog->categories(),
            ],
        ]);
    }

    public function show(Request $request, string $slug): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());
        $listing = $this->catalog->findForTeam($team, $slug);
        $this->authorize('view', [$listing, $team]);

        return response()->json([
            'data' => $this->publisher->presentListing($listing, owned: $listing->isOwnedBy($team)),
        ]);
    }

    public function publishPreview(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('update', $application);

        return response()->json([
            'data' => $this->publisher->preview($application),
        ]);
    }

    public function publish(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);
        $this->authorize('create', StoreListing::class);

        $team = $this->currentTeamContext->resolve($user);
        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('update', $application);

        $listing = $this->publisher->publish($team, $application, $request->all());

        auditLog('devforge.store.published', [
            'team_id' => $team->id,
            'listing_uuid' => $listing->uuid,
            'listing_slug' => $listing->slug,
            'application_uuid' => $application->uuid,
            'user_id' => $user->id,
        ]);

        return response()->json([
            'data' => $this->publisher->presentListing($listing, owned: true),
        ], 201);
    }

    public function update(Request $request, string $slug): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $listing = $this->catalog->findForTeam($team, $slug);
        $this->authorize('update', [$listing, $team]);

        $listing = $this->publisher->update($team, $listing, $request->all());

        return response()->json([
            'data' => $this->publisher->presentListing($listing, owned: true),
        ]);
    }

    public function unpublish(Request $request, string $slug): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $listing = $this->catalog->findForTeam($team, $slug);
        $this->authorize('delete', [$listing, $team]);

        $listing = $this->publisher->unpublish($team, $listing);

        auditLog('devforge.store.unpublished', [
            'team_id' => $team->id,
            'listing_uuid' => $listing->uuid,
            'listing_slug' => $listing->slug,
            'user_id' => $user->id,
        ]);

        return response()->json([
            'data' => $this->publisher->presentListing($listing, owned: true),
        ]);
    }

    public function install(Request $request, string $slug): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);
        $this->authorize('create', Application::class);

        $team = $this->currentTeamContext->resolve($user);
        $listing = $this->catalog->findForTeam($team, $slug);
        $this->authorize('install', $listing);

        $result = $this->installer->install($user, $team, $listing, $request->all());

        return response()->json([
            'data' => $this->presenter->present($result['application'], 'applications'),
            'meta' => [
                'listing_slug' => $result['listing']->slug,
                'instant_deploy' => $result['instant_deploy'],
                'env_import' => $result['env_import'],
            ],
        ], 201);
    }
}
