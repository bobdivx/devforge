<?php

namespace App\Services\DevForge\Store;

use App\Models\StoreListing;
use App\Models\Team;
use Illuminate\Database\Eloquent\Builder;

class StoreListingCatalog
{
    public function __construct(
        private readonly StoreListingPublisher $publisher,
    ) {}

    /**
     * @return array<int, array<string, mixed>>
     */
    public function listings(Team $team, ?string $query = null, ?string $category = null): array
    {
        $listings = StoreListing::query()
            ->with('team')
            ->where(function (Builder $builder) use ($team): void {
                $builder->where('status', StoreListing::STATUS_PUBLISHED)
                    ->orWhere('team_id', $team->id);
            })
            ->when(filled($query), function (Builder $builder) use ($query): void {
                $term = '%'.addcslashes((string) $query, '%_\\').'%';
                $builder->where(function (Builder $inner) use ($term): void {
                    $inner->where('name', 'like', $term)
                        ->orWhere('description', 'like', $term)
                        ->orWhere('slug', 'like', $term);
                });
            })
            ->when(filled($category), fn (Builder $builder) => $builder->where('category', $category))
            ->orderByDesc('install_count')
            ->orderByDesc('updated_at')
            ->get();

        return $listings
            ->map(fn (StoreListing $listing): array => $this->publisher->presentListing(
                $listing,
                owned: $listing->isOwnedBy($team),
            ))
            ->values()
            ->all();
    }

    public function findForTeam(Team $team, string $slug): StoreListing
    {
        $listing = StoreListing::query()
            ->with('team')
            ->where('slug', $slug)
            ->firstOrFail();

        abort_unless(
            $listing->isPublished() || $listing->isOwnedBy($team),
            404,
            'Fiche Store introuvable.',
        );

        return $listing;
    }

    /**
     * @return array<string, mixed>
     */
    public function show(Team $team, string $slug): array
    {
        $listing = $this->findForTeam($team, $slug);

        return $this->publisher->presentListing($listing, owned: $listing->isOwnedBy($team));
    }

    /**
     * @return list<string>
     */
    public function categories(): array
    {
        return StoreListing::CATEGORIES;
    }
}
