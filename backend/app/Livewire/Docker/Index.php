<?php

namespace App\Livewire\Docker;

use App\Models\Application;
use App\Models\Server;
use App\Models\Service;
use App\Services\DevForge\Docker\DockerImageAutoUpdater;
use App\Services\DevForge\Docker\DockerImageUpdateChecker;
use App\Support\ValidationPatterns;
use Illuminate\Foundation\Auth\Access\AuthorizesRequests;
use Illuminate\Support\Collection;
use Livewire\Component;

class Index extends Component
{
    use AuthorizesRequests;

    public ?string $selectedServerUuid = null;

    public string $activeTab = 'containers';

    public string $search = '';

    public string $statusFilter = 'all';

    public array $containers = [];

    public array $imageCheckResults = [];

    public bool $isLoadingContainers = false;

    public bool $isCheckingUpdates = false;

    public bool $isUpdatingAll = false;

    public ?string $updatingUuid = null;

    public function mount(?string $server_uuid = null): void
    {
        $servers = $this->servers();
        if ($servers->isNotEmpty()) {
            if ($server_uuid && $servers->contains('uuid', $server_uuid)) {
                $this->selectedServerUuid = $server_uuid;
            } else {
                $this->selectedServerUuid = $servers->first()->uuid;
            }
        }

        if ($this->selectedServerUuid) {
            $this->loadContainers();
        }
    }

    public function updatedSelectedServerUuid(): void
    {
        $this->loadContainers();
    }

    public function servers(): Collection
    {
        return Server::ownedByCurrentTeam()->get();
    }

    public function selectedServer(): ?Server
    {
        if (! $this->selectedServerUuid) {
            return null;
        }

        return Server::ownedByCurrentTeam()
            ->where('uuid', $this->selectedServerUuid)
            ->first();
    }

    public function loadContainers(): void
    {
        $this->isLoadingContainers = true;
        try {
            $server = $this->selectedServer();
            if ($server && $server->isFunctional()) {
                $this->containers = $server->loadAllContainers()->toArray();
            } else {
                $this->containers = [];
            }
        } catch (\Throwable $e) {
            $this->containers = [];
            handleError($e, $this);
        } finally {
            $this->isLoadingContainers = false;
        }
    }

    public function startContainer(string $containerId): void
    {
        if (! ValidationPatterns::isValidContainerName($containerId)) {
            $this->dispatch('error', 'Identifiant de conteneur invalide.');

            return;
        }

        $server = $this->selectedServer();
        if (! $server || ! $server->isFunctional()) {
            $this->dispatch('error', 'Serveur non fonctionnel.');

            return;
        }

        try {
            instant_remote_process(["docker start {$containerId}"], $server);
            $this->dispatch('success', "Conteneur {$containerId} démarré.");
            $this->loadContainers();
        } catch (\Throwable $e) {
            handleError($e, $this);
        }
    }

    public function restartContainer(string $containerId): void
    {
        if (! ValidationPatterns::isValidContainerName($containerId)) {
            $this->dispatch('error', 'Identifiant de conteneur invalide.');

            return;
        }

        $server = $this->selectedServer();
        if (! $server || ! $server->isFunctional()) {
            $this->dispatch('error', 'Serveur non fonctionnel.');

            return;
        }

        try {
            instant_remote_process(["docker restart {$containerId}"], $server);
            $this->dispatch('success', "Conteneur {$containerId} redémarré.");
            $this->loadContainers();
        } catch (\Throwable $e) {
            handleError($e, $this);
        }
    }

    public function stopContainer(string $containerId): void
    {
        if (! ValidationPatterns::isValidContainerName($containerId)) {
            $this->dispatch('error', 'Identifiant de conteneur invalide.');

            return;
        }

        $server = $this->selectedServer();
        if (! $server || ! $server->isFunctional()) {
            $this->dispatch('error', 'Serveur non fonctionnel.');

            return;
        }

        try {
            instant_remote_process(["docker stop {$containerId}"], $server);
            $this->dispatch('success', "Conteneur {$containerId} arrêté.");
            $this->loadContainers();
        } catch (\Throwable $e) {
            handleError($e, $this);
        }
    }

    public function toggleAutoUpdate(string $type, string $uuid): void
    {
        $team = currentTeam();
        if (! $team) {
            $this->dispatch('error', 'Équipe introuvable.');

            return;
        }

        if ($type === 'application') {
            $application = Application::query()
                ->where('uuid', $uuid)
                ->whereHas('environment.project.team', fn ($query) => $query->where('teams.id', $team->id))
                ->with('settings')
                ->first();

            if ($application && $application->settings) {
                $current = (bool) $application->settings->is_image_auto_update_enabled;
                $application->settings->is_image_auto_update_enabled = ! $current;
                $application->settings->save();

                $this->dispatch(
                    'success',
                    'Mise à jour automatique '.(! $current ? 'activée' : 'désactivée')." pour {$application->name}."
                );
            }
        } elseif ($type === 'service') {
            $service = Service::query()
                ->where('uuid', $uuid)
                ->whereHas('environment.project.team', fn ($query) => $query->where('teams.id', $team->id))
                ->first();

            if ($service) {
                $current = (bool) $service->is_image_auto_update_enabled;
                $service->is_image_auto_update_enabled = ! $current;
                $service->save();

                $this->dispatch(
                    'success',
                    'Mise à jour automatique '.(! $current ? 'activée' : 'désactivée')." pour {$service->name}."
                );
            }
        }
    }

    public function checkUpdate(string $type, string $uuid): void
    {
        $team = currentTeam();
        if (! $team) {
            $this->dispatch('error', 'Équipe introuvable.');

            return;
        }

        $checker = app(DockerImageUpdateChecker::class);

        try {
            if ($type === 'application') {
                $result = $checker->check($team, applicationUuid: $uuid, inspectRunning: true);
                $this->imageCheckResults['application:'.$uuid] = $result;
            } elseif ($type === 'service') {
                $result = $checker->checkService($team, serviceUuid: $uuid, inspectRunning: true);
                $this->imageCheckResults['service:'.$uuid] = $result;
            }

            $updateAvailable = $result['update_available'] ?? false;
            if ($updateAvailable) {
                $this->dispatch('info', 'Une mise à jour d\'image est disponible !');
            } else {
                $this->dispatch('success', 'L\'image est déjà à jour.');
            }
        } catch (\Throwable $e) {
            handleError($e, $this);
        }
    }

    public function checkAllUpdates(): void
    {
        $this->isCheckingUpdates = true;
        $team = currentTeam();
        if (! $team) {
            $this->isCheckingUpdates = false;

            return;
        }

        $checker = app(DockerImageUpdateChecker::class);

        try {
            $apps = $this->dockerApplications();
            foreach ($apps as $app) {
                $result = $checker->check($team, applicationUuid: $app->uuid, inspectRunning: true);
                $this->imageCheckResults['application:'.$app->uuid] = $result;
            }

            $services = $this->dockerServices();
            foreach ($services as $service) {
                $result = $checker->checkService($team, serviceUuid: $service->uuid, inspectRunning: true);
                $this->imageCheckResults['service:'.$service->uuid] = $result;
            }

            $this->dispatch('success', 'Vérification de toutes les images terminée.');
        } catch (\Throwable $e) {
            handleError($e, $this);
        } finally {
            $this->isCheckingUpdates = false;
        }
    }

    public function updateResource(string $type, string $uuid): void
    {
        $this->updatingUuid = $uuid;
        $team = currentTeam();
        if (! $team) {
            $this->updatingUuid = null;

            return;
        }

        $updater = app(DockerImageAutoUpdater::class);

        try {
            if ($type === 'application') {
                $application = Application::query()
                    ->where('uuid', $uuid)
                    ->whereHas('environment.project.team', fn ($query) => $query->where('teams.id', $team->id))
                    ->with(['settings', 'environment.project.team', 'destination.server'])
                    ->first();

                if ($application) {
                    $res = $updater->applyForApplication($application, force: true);
                    if (($res['status'] ?? null) === 'updated') {
                        $this->dispatch('success', "Mise à jour lancée pour {$application->name}.");
                    } else {
                        $this->dispatch('warning', $res['reason'] ?? $res['error'] ?? 'Mise à jour ignorée.');
                    }
                }
            } elseif ($type === 'service') {
                $service = Service::query()
                    ->where('uuid', $uuid)
                    ->whereHas('environment.project.team', fn ($query) => $query->where('teams.id', $team->id))
                    ->with(['applications', 'environment.project.team', 'server'])
                    ->first();

                if ($service) {
                    $res = $updater->applyForService($service, force: true);
                    if (($res['status'] ?? null) === 'updated') {
                        $this->dispatch('success', "Mise à jour lancée pour {$service->name}.");
                    } else {
                        $this->dispatch('warning', $res['reason'] ?? $res['error'] ?? 'Mise à jour ignorée.');
                    }
                }
            }
        } catch (\Throwable $e) {
            handleError($e, $this);
        } finally {
            $this->updatingUuid = null;
        }
    }

    public function updateAllOutdated(): void
    {
        $this->isUpdatingAll = true;
        try {
            $updater = app(DockerImageAutoUpdater::class);
            $summary = $updater->run();

            $updated = $summary['updated'] ?? 0;
            $this->dispatch('success', "Mises à jour déclenchées : {$updated} ressource(s).");
        } catch (\Throwable $e) {
            handleError($e, $this);
        } finally {
            $this->isUpdatingAll = false;
        }
    }

    public function dockerApplications(): Collection
    {
        $team = currentTeam();
        if (! $team) {
            return collect();
        }

        return Application::query()
            ->where('build_pack', 'dockerimage')
            ->whereHas('environment.project.team', fn ($query) => $query->where('teams.id', $team->id))
            ->with(['settings', 'environment.project', 'destination.server'])
            ->get();
    }

    public function dockerServices(): Collection
    {
        $team = currentTeam();
        if (! $team) {
            return collect();
        }

        return Service::query()
            ->whereHas('environment.project.team', fn ($query) => $query->where('teams.id', $team->id))
            ->with(['environment.project', 'server', 'applications'])
            ->get();
    }

    public function getFilteredContainersProperty(): Collection
    {
        return collect($this->containers)
            ->filter(function ($container) {
                if ($this->statusFilter === 'running' && data_get($container, 'State') !== 'running') {
                    return false;
                }
                if ($this->statusFilter === 'exited' && data_get($container, 'State') !== 'exited') {
                    return false;
                }

                if ($this->search !== '') {
                    $search = strtolower($this->search);
                    $name = strtolower((string) data_get($container, 'Names'));
                    $image = strtolower((string) data_get($container, 'Image'));
                    $id = strtolower((string) data_get($container, 'ID'));

                    return str_contains($name, $search) || str_contains($image, $search) || str_contains($id, $search);
                }

                return true;
            })
            ->sortBy('Names', SORT_NATURAL)
            ->values();
    }

    public function render()
    {
        return view('livewire.docker.index', [
            'servers' => $this->servers(),
            'filteredContainers' => $this->filteredContainers,
            'dockerApplications' => $this->dockerApplications(),
            'dockerServices' => $this->dockerServices(),
        ]);
    }
}
