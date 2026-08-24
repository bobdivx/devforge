<div>
    <x-slot:title>
        Docker | DevForge
    </x-slot>

    <div class="flex flex-col gap-6">
        <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
                <h1 class="text-2xl font-bold tracking-tight dark:text-white">Docker</h1>
                <div class="subtitle">Supervision des conteneurs et gestion des mises à jour automatiques d'images.</div>
            </div>

            <div class="flex flex-wrap items-center gap-3">
                @if ($servers->count() > 1)
                    <div class="w-64">
                        <select wire:model.live="selectedServerUuid" class="w-full select">
                            @foreach ($servers as $server)
                                <option value="{{ $server->uuid }}">{{ $server->name }} ({{ $server->ip }})</option>
                            @endforeach
                        </select>
                    </div>
                @endif

                @if ($activeTab === 'containers')
                    <x-forms.button wire:click="loadContainers">
                        <div class="flex items-center gap-1.5">
                            <svg wire:loading.remove wire:target="loadContainers" class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            <x-loading wire:loading wire:target="loadContainers" />
                            <span>Actualiser</span>
                        </div>
                    </x-forms.button>
                @else
                    <div class="flex items-center gap-2">
                        <x-forms.button wire:click="checkAllUpdates">
                            <div class="flex items-center gap-1.5">
                                <x-loading wire:loading wire:target="checkAllUpdates" />
                                <span>Vérifier toutes les images</span>
                            </div>
                        </x-forms.button>
                        <x-forms.button isHighlighted wire:click="updateAllOutdated">
                            <div class="flex items-center gap-1.5">
                                <x-loading wire:loading wire:target="updateAllOutdated" />
                                <span>Tout mettre à jour</span>
                            </div>
                        </x-forms.button>
                    </div>
                @endif
            </div>
        </div>

        {{-- Statistiques clés --}}
        @php
            $totalCount = count($containers);
            $runningCount = collect($containers)->where('State', 'running')->count();
            $stoppedCount = collect($containers)->where('State', 'exited')->count();
            $autoUpdateAppsCount = $dockerApplications->filter(fn($app) => (bool) $app->settings?->is_image_auto_update_enabled)->count()
                + $dockerServices->filter(fn($svc) => (bool) $svc->is_image_auto_update_enabled)->count();
        @endphp

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div class="p-4 rounded-lg bg-neutral-100 dark:bg-coolgray-100 border border-neutral-300 dark:border-coolgray-200">
                <div class="text-xs font-medium uppercase text-neutral-500 dark:text-neutral-400">Total Conteneurs</div>
                <div class="mt-1 text-2xl font-bold dark:text-white">{{ $totalCount }}</div>
                <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Sur le serveur sélectionné</div>
            </div>
            <div class="p-4 rounded-lg bg-neutral-100 dark:bg-coolgray-100 border border-neutral-300 dark:border-coolgray-200">
                <div class="text-xs font-medium uppercase text-emerald-600 dark:text-emerald-400">En cours d'exécution</div>
                <div class="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">{{ $runningCount }}</div>
                <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Actifs et fonctionnels</div>
            </div>
            <div class="p-4 rounded-lg bg-neutral-100 dark:bg-coolgray-100 border border-neutral-300 dark:border-coolgray-200">
                <div class="text-xs font-medium uppercase text-neutral-500 dark:text-neutral-400">Arrêtés / Exited</div>
                <div class="mt-1 text-2xl font-bold dark:text-neutral-300">{{ $stoppedCount }}</div>
                <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Conteneurs inactifs</div>
            </div>
            <div class="p-4 rounded-lg bg-neutral-100 dark:bg-coolgray-100 border border-neutral-300 dark:border-coolgray-200">
                <div class="text-xs font-medium uppercase text-indigo-600 dark:text-indigo-400">Auto-Update Actif</div>
                <div class="mt-1 text-2xl font-bold text-indigo-600 dark:text-indigo-400">{{ $autoUpdateAppsCount }}</div>
                <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Apps & Services surveillés</div>
            </div>
        </div>

        {{-- Onglets --}}
        <div class="flex border-b border-neutral-300 dark:border-coolgray-200 gap-6">
            <button
                type="button"
                wire:click="$set('activeTab', 'containers')"
                @class([
                    'pb-3 text-sm font-semibold transition-colors border-b-2 -mb-px flex items-center gap-2 cursor-pointer',
                    'border-coollabs text-coollabs dark:border-white dark:text-white' => $activeTab === 'containers',
                    'border-transparent text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200' => $activeTab !== 'containers',
                ])>
                <svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span>Conteneurs Docker ({{ $totalCount }})</span>
            </button>

            <button
                type="button"
                wire:click="$set('activeTab', 'images')"
                @class([
                    'pb-3 text-sm font-semibold transition-colors border-b-2 -mb-px flex items-center gap-2 cursor-pointer',
                    'border-coollabs text-coollabs dark:border-white dark:text-white' => $activeTab === 'images',
                    'border-transparent text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200' => $activeTab !== 'images',
                ])>
                <svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span>Mises à jour des images ({{ $dockerApplications->count() + $dockerServices->count() }})</span>
            </button>
        </div>

        {{-- Onglet Conteneurs --}}
        @if ($activeTab === 'containers')
            <div class="flex flex-col gap-4">
                {{-- Barre de filtres --}}
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div class="relative flex-1 max-w-md">
                        <input
                            type="text"
                            wire:model.live.debounce.300ms="search"
                            placeholder="Rechercher par nom, image ou ID..."
                            class="w-full input pl-9 text-sm"
                        />
                        <svg class="absolute left-2.5 top-2.5 w-4 h-4 text-neutral-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>

                    <div class="flex items-center gap-2">
                        <span class="text-xs text-neutral-500 dark:text-neutral-400 font-medium">État :</span>
                        <div class="flex rounded-md border border-neutral-300 dark:border-coolgray-200 p-0.5 bg-neutral-100 dark:bg-coolgray-100">
                            <button
                                type="button"
                                wire:click="$set('statusFilter', 'all')"
                                @class([
                                    'px-2.5 py-1 text-xs font-medium rounded cursor-pointer transition-colors',
                                    'bg-white dark:bg-coolgray-300 text-black dark:text-white shadow-xs' => $statusFilter === 'all',
                                    'text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white' => $statusFilter !== 'all',
                                ])>
                                Tous
                            </button>
                            <button
                                type="button"
                                wire:click="$set('statusFilter', 'running')"
                                @class([
                                    'px-2.5 py-1 text-xs font-medium rounded cursor-pointer transition-colors',
                                    'bg-white dark:bg-coolgray-300 text-emerald-600 dark:text-emerald-400 shadow-xs' => $statusFilter === 'running',
                                    'text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white' => $statusFilter !== 'running',
                                ])>
                                Actifs
                            </button>
                            <button
                                type="button"
                                wire:click="$set('statusFilter', 'exited')"
                                @class([
                                    'px-2.5 py-1 text-xs font-medium rounded cursor-pointer transition-colors',
                                    'bg-white dark:bg-coolgray-300 text-neutral-700 dark:text-neutral-300 shadow-xs' => $statusFilter === 'exited',
                                    'text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white' => $statusFilter !== 'exited',
                                ])>
                                Arrêtés
                            </button>
                        </div>
                    </div>
                </div>

                {{-- Table des conteneurs --}}
                <div class="overflow-x-auto border border-neutral-300 dark:border-coolgray-200 rounded-lg">
                    <table class="min-w-full divide-y divide-neutral-200 dark:divide-coolgray-200">
                        <thead class="bg-neutral-50 dark:bg-coolgray-100">
                            <tr>
                                <th class="px-4 py-3 text-xs font-semibold text-left uppercase text-neutral-500 dark:text-neutral-400">Nom & ID</th>
                                <th class="px-4 py-3 text-xs font-semibold text-left uppercase text-neutral-500 dark:text-neutral-400">Image</th>
                                <th class="px-4 py-3 text-xs font-semibold text-left uppercase text-neutral-500 dark:text-neutral-400">Statut</th>
                                <th class="px-4 py-3 text-xs font-semibold text-left uppercase text-neutral-500 dark:text-neutral-400">Ports</th>
                                <th class="px-4 py-3 text-xs font-semibold text-left uppercase text-neutral-500 dark:text-neutral-400">Uptime</th>
                                <th class="px-4 py-3 text-xs font-semibold text-right uppercase text-neutral-500 dark:text-neutral-400">Actions</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-neutral-200 dark:divide-coolgray-200 bg-white dark:bg-base">
                            @forelse ($filteredContainers as $container)
                                @php
                                    $cId = (string) data_get($container, 'ID');
                                    $cName = (string) data_get($container, 'Names');
                                    $cImage = (string) data_get($container, 'Image');
                                    $cState = (string) data_get($container, 'State');
                                    $cStatus = (string) data_get($container, 'Status');
                                    $cPorts = (string) data_get($container, 'Ports');
                                    $cRunningFor = (string) data_get($container, 'RunningFor');
                                    $labels = (string) data_get($container, 'Labels');
                                    $isManaged = str($labels)->contains('devforge.managed') || str($labels)->contains('coolify.managed');
                                @endphp
                                <tr wire:key="container-{{ $cId }}" class="hover:bg-neutral-50 dark:hover:bg-coolgray-100/50 transition-colors">
                                    <td class="px-4 py-3 whitespace-nowrap">
                                        <div class="flex items-center gap-2">
                                            <span class="font-medium text-sm dark:text-white">{{ $cName }}</span>
                                            @if ($isManaged)
                                                <span class="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                                                    DevForge
                                                </span>
                                            @endif
                                        </div>
                                        <div class="text-xs text-neutral-400 font-mono">{{ Str::limit($cId, 12, '') }}</div>
                                    </td>
                                    <td class="px-4 py-3 text-xs font-mono whitespace-nowrap dark:text-neutral-300 max-w-xs truncate" title="{{ $cImage }}">
                                        {{ $cImage }}
                                    </td>
                                    <td class="px-4 py-3 whitespace-nowrap">
                                        @if ($cState === 'running')
                                            <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                                En cours
                                            </span>
                                        @elseif ($cState === 'exited')
                                            <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
                                                <span class="w-1.5 h-1.5 rounded-full bg-neutral-400"></span>
                                                Arrêté
                                            </span>
                                        @elseif ($cState === 'restarting')
                                            <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                                <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                                                Redémarrage
                                            </span>
                                        @else
                                            <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                                                {{ ucfirst($cState) }}
                                            </span>
                                        @endif
                                        <div class="text-[11px] text-neutral-400 mt-0.5">{{ $cStatus }}</div>
                                    </td>
                                    <td class="px-4 py-3 text-xs font-mono whitespace-nowrap dark:text-neutral-400 max-w-xs truncate" title="{{ $cPorts }}">
                                        {{ $cPorts ?: '-' }}
                                    </td>
                                    <td class="px-4 py-3 text-xs whitespace-nowrap text-neutral-500 dark:text-neutral-400">
                                        {{ $cRunningFor ?: '-' }}
                                    </td>
                                    <td class="px-4 py-3 whitespace-nowrap text-right text-xs font-medium">
                                        <div class="flex items-center justify-end gap-1.5">
                                            @if ($cState === 'running')
                                                <button
                                                    type="button"
                                                    wire:click="restartContainer('{{ $cId }}')"
                                                    class="btn btn-xs btn-ghost text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-coolgray-200">
                                                    Redémarrer
                                                </button>
                                                <button
                                                    type="button"
                                                    wire:click="stopContainer('{{ $cId }}')"
                                                    class="btn btn-xs btn-ghost text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40">
                                                    Arrêter
                                                </button>
                                            @elseif ($cState === 'exited')
                                                <button
                                                    type="button"
                                                    wire:click="startContainer('{{ $cId }}')"
                                                    class="btn btn-xs btn-ghost text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40">
                                                    Démarrer
                                                </button>
                                            @elseif ($cState === 'restarting')
                                                <button
                                                    type="button"
                                                    wire:click="stopContainer('{{ $cId }}')"
                                                    class="btn btn-xs btn-ghost text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40">
                                                    Forcer Arrêt
                                                </button>
                                            @endif
                                        </div>
                                    </td>
                                </tr>
                            @empty
                                <tr>
                                    <td colspan="6" class="px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                                        @if ($search !== '')
                                            Aucun conteneur ne correspond à votre recherche "{{ $search }}".
                                        @else
                                            Aucun conteneur trouvé sur ce serveur.
                                        @endif
                                    </td>
                                </tr>
                            @endforelse
                        </tbody>
                    </table>
                </div>
            </div>
        @endif

        {{-- Onglet Mises à jour des images --}}
        @if ($activeTab === 'images')
            <div class="flex flex-col gap-6">
                {{-- Boîte explicative auto-update --}}
                <div class="p-4 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/50 flex items-start gap-3">
                    <svg class="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div class="text-xs text-indigo-900 dark:text-indigo-200 leading-relaxed">
                        <span class="font-semibold">Mise à jour automatique en arrière-plan :</span>
                        Les applications et services ayant l'option <span class="font-semibold">Mise à jour auto</span> activée sont automatiquement vérifiés toutes les heures par la tâche planifiée <code class="font-mono text-[11px] bg-indigo-100 dark:bg-indigo-900/60 px-1 py-0.5 rounded">CheckDockerImageUpdatesJob</code>. Lorsqu'un nouveau digest est publié sur le registre Docker, DevForge redéploie la ressource automatiquement.
                    </div>
                </div>

                {{-- Applications Docker --}}
                <div class="flex flex-col gap-3">
                    <div class="flex items-center justify-between">
                        <h3 class="text-base font-semibold dark:text-white">Applications (Images Docker)</h3>
                        <span class="text-xs text-neutral-500 dark:text-neutral-400">{{ $dockerApplications->count() }} application(s)</span>
                    </div>

                    <div class="overflow-x-auto border border-neutral-300 dark:border-coolgray-200 rounded-lg">
                        <table class="min-w-full divide-y divide-neutral-200 dark:divide-coolgray-200">
                            <thead class="bg-neutral-50 dark:bg-coolgray-100">
                                <tr>
                                    <th class="px-4 py-3 text-xs font-semibold text-left uppercase text-neutral-500 dark:text-neutral-400">Application</th>
                                    <th class="px-4 py-3 text-xs font-semibold text-left uppercase text-neutral-500 dark:text-neutral-400">Image configurée</th>
                                    <th class="px-4 py-3 text-xs font-semibold text-center uppercase text-neutral-500 dark:text-neutral-400">Auto-Update</th>
                                    <th class="px-4 py-3 text-xs font-semibold text-left uppercase text-neutral-500 dark:text-neutral-400">Statut de version</th>
                                    <th class="px-4 py-3 text-xs font-semibold text-right uppercase text-neutral-500 dark:text-neutral-400">Actions</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-neutral-200 dark:divide-coolgray-200 bg-white dark:bg-base">
                                @forelse ($dockerApplications as $app)
                                    @php
                                        $imageName = $app->docker_registry_image_name ?: 'non configurée';
                                        $imageTag = $app->docker_registry_image_tag ?: 'latest';
                                        $isAutoEnabled = (bool) ($app->settings?->is_image_auto_update_enabled ?? false);
                                        $checkKey = 'application:'.$app->uuid;
                                        $check = $imageCheckResults[$checkKey] ?? null;
                                        $updateAvailable = $check['update_available'] ?? null;
                                    @endphp
                                    <tr wire:key="app-{{ $app->uuid }}" class="hover:bg-neutral-50 dark:hover:bg-coolgray-100/50 transition-colors">
                                        <td class="px-4 py-3 whitespace-nowrap">
                                            <a href="{{ $app->link() }}" {{ wireNavigate() }} class="font-medium text-sm dark:text-white hover:underline">
                                                {{ $app->name }}
                                            </a>
                                            <div class="text-xs text-neutral-400">
                                                {{ $app->environment?->project?->name }} / {{ $app->environment?->name }}
                                            </div>
                                        </td>
                                        <td class="px-4 py-3 text-xs font-mono whitespace-nowrap dark:text-neutral-300">
                                            {{ $imageName }}:{{ $imageTag }}
                                        </td>
                                        <td class="px-4 py-3 text-center whitespace-nowrap">
                                            <button
                                                type="button"
                                                wire:click="toggleAutoUpdate('application', '{{ $app->uuid }}')"
                                                @class([
                                                    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden',
                                                    'bg-emerald-500' => $isAutoEnabled,
                                                    'bg-neutral-300 dark:bg-coolgray-300' => !$isAutoEnabled,
                                                ])
                                                role="switch"
                                                aria-checked="{{ $isAutoEnabled ? 'true' : 'false' }}">
                                                <span
                                                    @class([
                                                        'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out',
                                                        'translate-x-4' => $isAutoEnabled,
                                                        'translate-x-0' => !$isAutoEnabled,
                                                    ])></span>
                                            </button>
                                        </td>
                                        <td class="px-4 py-3 whitespace-nowrap">
                                            @if ($check === null)
                                                <span class="text-xs text-neutral-400">Non vérifié</span>
                                            @elseif (isset($check['error']))
                                                <span class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300" title="{{ $check['error'] }}">
                                                    Erreur registre
                                                </span>
                                            @elseif ($updateAvailable === true)
                                                <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                                    <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                                                    Mise à jour disponible
                                                </span>
                                            @elseif ($updateAvailable === false)
                                                <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                                    À jour
                                                </span>
                                            @else
                                                <span class="text-xs text-neutral-400">Inconclusif</span>
                                            @endif
                                        </td>
                                        <td class="px-4 py-3 whitespace-nowrap text-right text-xs font-medium">
                                            <div class="flex items-center justify-end gap-2">
                                                <button
                                                    type="button"
                                                    wire:click="checkUpdate('application', '{{ $app->uuid }}')"
                                                    class="btn btn-xs btn-ghost text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-coolgray-200">
                                                    Vérifier
                                                </button>
                                                <button
                                                    type="button"
                                                    wire:click="updateResource('application', '{{ $app->uuid }}')"
                                                    @disabled($updatingUuid === $app->uuid)
                                                    class="btn btn-xs btn-primary">
                                                    <x-loading wire:loading wire:target="updateResource('application', '{{ $app->uuid }}')" />
                                                    <span>Mettre à jour</span>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                @empty
                                    <tr>
                                        <td colspan="5" class="px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                                            Aucune application utilisant le buildpack Image Docker trouvée.
                                        </td>
                                    </tr>
                                @endforelse
                            </tbody>
                        </table>
                    </div>
                </div>

                {{-- Services Docker --}}
                <div class="flex flex-col gap-3">
                    <div class="flex items-center justify-between">
                        <h3 class="text-base font-semibold dark:text-white">Services</h3>
                        <span class="text-xs text-neutral-500 dark:text-neutral-400">{{ $dockerServices->count() }} service(s)</span>
                    </div>

                    <div class="overflow-x-auto border border-neutral-300 dark:border-coolgray-200 rounded-lg">
                        <table class="min-w-full divide-y divide-neutral-200 dark:divide-coolgray-200">
                            <thead class="bg-neutral-50 dark:bg-coolgray-100">
                                <tr>
                                    <th class="px-4 py-3 text-xs font-semibold text-left uppercase text-neutral-500 dark:text-neutral-400">Service</th>
                                    <th class="px-4 py-3 text-xs font-semibold text-center uppercase text-neutral-500 dark:text-neutral-400">Auto-Update</th>
                                    <th class="px-4 py-3 text-xs font-semibold text-left uppercase text-neutral-500 dark:text-neutral-400">Statut de version</th>
                                    <th class="px-4 py-3 text-xs font-semibold text-right uppercase text-neutral-500 dark:text-neutral-400">Actions</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-neutral-200 dark:divide-coolgray-200 bg-white dark:bg-base">
                                @forelse ($dockerServices as $service)
                                    @php
                                        $isAutoEnabled = (bool) $service->is_image_auto_update_enabled;
                                        $checkKey = 'service:'.$service->uuid;
                                        $check = $imageCheckResults[$checkKey] ?? null;
                                        $updateAvailable = $check['update_available'] ?? null;
                                    @endphp
                                    <tr wire:key="svc-{{ $service->uuid }}" class="hover:bg-neutral-50 dark:hover:bg-coolgray-100/50 transition-colors">
                                        <td class="px-4 py-3 whitespace-nowrap">
                                            <a href="{{ $service->link() }}" {{ wireNavigate() }} class="font-medium text-sm dark:text-white hover:underline">
                                                {{ $service->name }}
                                            </a>
                                            <div class="text-xs text-neutral-400">
                                                {{ $service->environment?->project?->name }} / {{ $service->environment?->name }}
                                            </div>
                                        </td>
                                        <td class="px-4 py-3 text-center whitespace-nowrap">
                                            <button
                                                type="button"
                                                wire:click="toggleAutoUpdate('service', '{{ $service->uuid }}')"
                                                @class([
                                                    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden',
                                                    'bg-emerald-500' => $isAutoEnabled,
                                                    'bg-neutral-300 dark:bg-coolgray-300' => !$isAutoEnabled,
                                                ])
                                                role="switch"
                                                aria-checked="{{ $isAutoEnabled ? 'true' : 'false' }}">
                                                <span
                                                    @class([
                                                        'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out',
                                                        'translate-x-4' => $isAutoEnabled,
                                                        'translate-x-0' => !$isAutoEnabled,
                                                    ])></span>
                                            </button>
                                        </td>
                                        <td class="px-4 py-3 whitespace-nowrap">
                                            @if ($check === null)
                                                <span class="text-xs text-neutral-400">Non vérifié</span>
                                            @elseif (isset($check['error']))
                                                <span class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300" title="{{ $check['error'] }}">
                                                    Erreur registre
                                                </span>
                                            @elseif ($updateAvailable === true)
                                                <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                                    <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                                                    Mise à jour disponible
                                                </span>
                                            @elseif ($updateAvailable === false)
                                                <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                                    À jour
                                                </span>
                                            @else
                                                <span class="text-xs text-neutral-400">Inconclusif</span>
                                            @endif
                                        </td>
                                        <td class="px-4 py-3 whitespace-nowrap text-right text-xs font-medium">
                                            <div class="flex items-center justify-end gap-2">
                                                <button
                                                    type="button"
                                                    wire:click="checkUpdate('service', '{{ $service->uuid }}')"
                                                    class="btn btn-xs btn-ghost text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-coolgray-200">
                                                    Vérifier
                                                </button>
                                                <button
                                                    type="button"
                                                    wire:click="updateResource('service', '{{ $service->uuid }}')"
                                                    @disabled($updatingUuid === $service->uuid)
                                                    class="btn btn-xs btn-primary">
                                                    <x-loading wire:loading wire:target="updateResource('service', '{{ $service->uuid }}')" />
                                                    <span>Mettre à jour</span>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                @empty
                                    <tr>
                                        <td colspan="4" class="px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                                            Aucun service trouvé.
                                        </td>
                                    </tr>
                                @endforelse
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        @endif
    </div>
</div>
