<?php

namespace App\Services\DevForge\Tag;

use App\Models\Application;
use App\Models\Service;
use App\Models\Tag;
use App\Models\Team;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Collection;

class TagCatalog
{
    /**
     * @return array<int, array<string, mixed>>
     */
    public function tagsForTeam(Team $team): array
    {
        return Tag::query()
            ->where('team_id', $team->id)
            ->orderBy('name')
            ->get()
            ->unique('name')
            ->map(fn (Tag $tag): array => $this->presentSummary($tag))
            ->sortBy('name')
            ->values()
            ->all();
    }

    public function tagForTeam(Team $team, string $tagName): Tag
    {
        $tag = Tag::query()
            ->where('team_id', $team->id)
            ->where('name', strtolower($tagName))
            ->first();

        if (! $tag) {
            throw (new ModelNotFoundException)->setModel(Tag::class, [$tagName]);
        }

        return $tag;
    }

    /**
     * @return array<string, mixed>
     */
    public function present(Tag $tag): array
    {
        $applications = $tag->applications()->orderBy('name')->get();
        $services = $tag->services()->orderBy('name')->get();

        return [
            'name' => $tag->name,
            'webhook_url' => generateTagDeployWebhook($tag->name),
            'applications' => $applications
                ->map(fn (Application $application): array => $this->presentApplication($application))
                ->values()
                ->all(),
            'services' => $services
                ->map(fn (Service $service): array => $this->presentService($service))
                ->values()
                ->all(),
            'applications_count' => $applications->count(),
            'services_count' => $services->count(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function presentSummary(Tag $tag): array
    {
        return [
            'name' => $tag->name,
            'applications_count' => $tag->applications()->count(),
            'services_count' => $tag->services()->count(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function presentApplication(Application $application): array
    {
        return [
            'uuid' => $application->uuid,
            'name' => $application->name,
            'fqdn' => $application->fqdn,
            'status' => $application->status,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function presentService(Service $service): array
    {
        return [
            'uuid' => $service->uuid,
            'name' => $service->name,
            'status' => $service->status,
        ];
    }
}
