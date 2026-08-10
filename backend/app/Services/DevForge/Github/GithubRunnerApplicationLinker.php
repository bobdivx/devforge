<?php

namespace App\Services\DevForge\Github;

use App\Models\Application;
use App\Models\GithubRunnerApplicationLink;
use App\Models\Team;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

class GithubRunnerApplicationLinker
{
    /**
     * @return array<int, array{uuid: string, name: string, role: string|null, link_source: string}>
     */
    public function linksForRunner(Team $team, string $serverUuid, string $containerName): array
    {
        return $this->queryForTeam($team)
            ->where('server_uuid', $serverUuid)
            ->where('container_name', $containerName)
            ->with('application:id,uuid,name')
            ->get()
            ->map(fn (GithubRunnerApplicationLink $link): array => $this->presentLink($link))
            ->values()
            ->all();
    }

    /**
     * @param  Collection<int, array<string, mixed>>  $runners
     * @return Collection<int, array<string, mixed>>
     */
    public function enrichRunners(Team $team, Collection $runners): Collection
    {
        $links = $this->queryForTeam($team)
            ->with('application:id,uuid,name')
            ->get()
            ->groupBy(fn (GithubRunnerApplicationLink $link): string => $link->runnerKey());

        return $runners->map(function (array $runner) use ($links): array {
            $key = (string) ($runner['server_uuid'] ?? '').':'.(string) ($runner['name'] ?? '');
            $manual = collect($links->get($key, []))
                ->map(fn (GithubRunnerApplicationLink $link): array => $this->presentLink($link))
                ->values()
                ->all();

            return [
                ...$runner,
                'linked_applications' => $manual,
            ];
        });
    }

    /**
     * @return array{uuid: string, name: string, role: string|null, link_source: string}
     */
    public function attach(
        Team $team,
        string $serverUuid,
        string $containerName,
        string $applicationUuid,
        ?string $role = null,
    ): array {
        $application = $this->applicationForTeam($team, $applicationUuid);
        $normalizedRole = $this->normalizeRole($role);

        $link = GithubRunnerApplicationLink::query()->updateOrCreate(
            [
                'team_id' => $team->id,
                'server_uuid' => $serverUuid,
                'container_name' => $containerName,
                'application_id' => $application->id,
            ],
            [
                'role' => $normalizedRole,
            ],
        );

        $link->setRelation('application', $application);

        return $this->presentLink($link);
    }

    public function detach(Team $team, string $serverUuid, string $containerName, string $applicationUuid): void
    {
        $application = $this->applicationForTeam($team, $applicationUuid);

        GithubRunnerApplicationLink::query()
            ->where('team_id', $team->id)
            ->where('server_uuid', $serverUuid)
            ->where('container_name', $containerName)
            ->where('application_id', $application->id)
            ->delete();
    }

    public function detachAllForRunner(Team $team, string $serverUuid, string $containerName): void
    {
        GithubRunnerApplicationLink::query()
            ->where('team_id', $team->id)
            ->where('server_uuid', $serverUuid)
            ->where('container_name', $containerName)
            ->delete();
    }

    /**
     * @return \Illuminate\Database\Eloquent\Builder<GithubRunnerApplicationLink>
     */
    private function queryForTeam(Team $team)
    {
        return GithubRunnerApplicationLink::query()->where('team_id', $team->id);
    }

    private function applicationForTeam(Team $team, string $applicationUuid): Application
    {
        $application = Application::query()
            ->where('uuid', $applicationUuid)
            ->whereRelation('environment.project', 'team_id', $team->id)
            ->first();

        if (! $application) {
            throw ValidationException::withMessages([
                'application_uuid' => ['Application introuvable pour cette équipe.'],
            ]);
        }

        return $application;
    }

    private function normalizeRole(?string $role): ?string
    {
        if ($role === null || trim($role) === '') {
            return null;
        }

        $normalized = strtolower(trim($role));
        if (! in_array($normalized, ['frontend', 'backend', 'desktop', 'ci', 'other'], true)) {
            throw ValidationException::withMessages([
                'role' => ['Rôle invalide. Utilisez frontend, backend, desktop, ci ou other.'],
            ]);
        }

        return $normalized;
    }

    /**
     * @return array{uuid: string, name: string, role: string|null, link_source: string}
     */
    private function presentLink(GithubRunnerApplicationLink $link): array
    {
        return [
            'uuid' => (string) ($link->application?->uuid ?? ''),
            'name' => (string) ($link->application?->name ?? 'Application'),
            'role' => $link->role,
            'link_source' => 'manual',
        ];
    }
}
