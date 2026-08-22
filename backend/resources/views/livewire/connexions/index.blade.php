<div>
    <x-slot:title>
        Connexions | DevForge
    </x-slot>
    
    <h1>Connexions</h1>
    <div class="subtitle">Gérez vos intégrations et tokens d'API pour connecter DevForge à vos outils.</div>
    
    <div class="grid gap-6 lg:grid-cols-2 mt-6">
        {{-- GitHub Apps Card --}}
        <div class="coolbox">
            <div class="flex items-start justify-between mb-4">
                <div class="flex items-center gap-3">
                    <svg class="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                    </svg>
                    <div>
                        <h3 class="text-lg font-semibold mb-1">GitHub</h3>
                        <p class="text-sm text-neutral-400">Connexions GitHub pour vos applications</p>
                    </div>
                </div>
            </div>
            
            @if ($githubApps->count() > 0)
                <div class="space-y-2 mb-4">
                    @foreach ($githubApps as $app)
                        <a href="{{ route('source.github.show', ['github_app_uuid' => $app->uuid]) }}" 
                           class="block p-3 rounded-lg bg-coolgray-100 dark:bg-coolgray-800 hover:bg-coolgray-200 dark:hover:bg-coolgray-700 transition-colors"
                           {{ wireNavigate() }}>
                            <div class="font-medium">{{ $app->name }}</div>
                            @if ($app->organization)
                                <div class="text-sm text-neutral-400">Organisation: {{ $app->organization }}</div>
                            @endif
                        </a>
                    @endforeach
                </div>
            @else
                <p class="text-sm text-neutral-400 mb-4">Aucune connexion GitHub configurée.</p>
            @endif
            
            @can('createAnyResource')
                <x-modal-input buttonTitle="+ Ajouter GitHub App" title="Nouvelle GitHub App" :closeOutside="false">
                    <livewire:source.github.create />
                </x-modal-input>
            @endcan
        </div>

        {{-- DevForge MCP/API Token Card --}}
        <div class="coolbox">
            <div class="flex items-start justify-between mb-4">
                <div class="flex items-center gap-3">
                    <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                    <div>
                        <h3 class="text-lg font-semibold mb-1">Token DevForge</h3>
                        <p class="text-sm text-neutral-400">Tokens d'API pour MCP et intégrations</p>
                    </div>
                </div>
            </div>
            
            @if (!$isApiEnabled)
                <div class="mb-4 p-3 bg-warning/10 border border-warning rounded-lg">
                    <p class="text-sm">L'API est désactivée. Activez-la dans les 
                        <a href="{{ route('settings.advanced') }}" class="underline font-medium" {{ wireNavigate() }}>Paramètres</a>.
                    </p>
                </div>
            @else
                @if (session()->has('devforge-token'))
                    <div class="mb-4 p-4 bg-success/10 border border-success rounded-lg">
                        <p class="text-sm font-semibold mb-2 text-success">Token créé avec succès !</p>
                        <p class="text-xs mb-2">Copiez ce token maintenant. Pour votre sécurité, il ne sera plus affiché.</p>
                        <div class="flex items-center gap-2">
                            <code class="flex-1 p-2 bg-coolgray-100 dark:bg-coolgray-800 rounded text-xs break-all font-mono">{{ session('devforge-token') }}</code>
                            <button onclick="navigator.clipboard.writeText('{{ session('devforge-token') }}')" 
                                    class="px-3 py-2 bg-coolgray-200 dark:bg-coolgray-700 hover:bg-coolgray-300 dark:hover:bg-coolgray-600 rounded text-xs font-medium transition-colors">
                                Copier
                            </button>
                        </div>
                        <p class="text-xs mt-2 text-neutral-400">Endpoint MCP: <code class="font-mono">https://web.briseteia.me/mcp/devforge</code></p>
                    </div>
                @endif
                
                @if ($devforgeTokens->count() > 0)
                    <div class="mb-4">
                        <h4 class="text-sm font-semibold mb-2">Tokens actifs ({{ $devforgeTokens->count() }})</h4>
                        <div class="space-y-2 max-h-48 overflow-y-auto">
                            @foreach ($devforgeTokens->take(5) as $token)
                                <div class="flex items-center justify-between p-2 rounded bg-coolgray-100 dark:bg-coolgray-800 text-sm">
                                    <div class="flex-1 min-w-0">
                                        <div class="font-medium truncate">{{ $token->name }}</div>
                                        <div class="text-xs text-neutral-400">
                                            Créé {{ $token->created_at->diffForHumans() }}
                                            @if ($token->expires_at)
                                                • Expire {{ $token->expires_at->diffForHumans() }}
                                            @endif
                                        </div>
                                    </div>
                                    <button wire:click="revokeDevForgeToken({{ $token->id }})" 
                                            wire:confirm="Êtes-vous sûr de vouloir révoquer ce token ?"
                                            class="ml-2 px-2 py-1 text-xs text-error hover:bg-error/10 rounded transition-colors">
                                        Révoquer
                                    </button>
                                </div>
                            @endforeach
                        </div>
                        @if ($devforgeTokens->count() > 5)
                            <a href="{{ route('security.api-tokens') }}" class="text-xs text-neutral-400 hover:underline mt-2 inline-block" {{ wireNavigate() }}>
                                Voir tous les tokens ({{ $devforgeTokens->count() }})
                            </a>
                        @endif
                    </div>
                @else
                    <p class="text-sm text-neutral-400 mb-4">Aucun token créé.</p>
                @endif
                
                @can('create', App\Models\PersonalAccessToken::class)
                    <x-modal-input buttonTitle="+ Créer un token" title="Nouveau Token DevForge" :closeOutside="false">
                        <form class="flex flex-col gap-4" wire:submit='createDevForgeToken'>
                            <x-forms.input required id="tokenDescription" label="Description du token" 
                                          helper="Ex: MCP Client, CI/CD Pipeline, etc." />
                            
                            <x-forms.select id="expiresInDays" label="Expire dans" wire:model="expiresInDays">
                                @foreach ($expirationOptions as $days => $label)
                                    <option value="{{ $days }}">{{ $label }}</option>
                                @endforeach
                                <option value="">Jamais</option>
                            </x-forms.select>
                            
                            <div>
                                <label class="block text-sm font-medium mb-2">Permissions</label>
                                <div class="space-y-2">
                                    @if ($canUseRootPermissions)
                                        <x-forms.checkbox label="root" wire:model.live="permissions" domValue="root"
                                            helper="Accès complet (attention !)" :checked="in_array('root', $permissions)"></x-forms.checkbox>
                                    @endif
                                    
                                    @if (!in_array('root', $permissions))
                                        @if ($canUseWritePermissions)
                                            <x-forms.checkbox label="write" wire:model.live="permissions" domValue="write"
                                                helper="Écriture sur toutes les ressources" :checked="in_array('write', $permissions)"></x-forms.checkbox>
                                        @endif
                                        
                                        <x-forms.checkbox label="deploy" wire:model.live="permissions" domValue="deploy"
                                            helper="Déclencher des déploiements" :checked="in_array('deploy', $permissions)"></x-forms.checkbox>
                                        
                                        <x-forms.checkbox label="read" wire:model.live="permissions" domValue="read"
                                            helper="Lecture des ressources" :checked="in_array('read', $permissions)"></x-forms.checkbox>
                                        
                                        <x-forms.checkbox label="read:sensitive" wire:model.live="permissions" domValue="read:sensitive"
                                            helper="Lecture incluant secrets et logs" :checked="in_array('read:sensitive', $permissions)"></x-forms.checkbox>
                                    @endif
                                </div>
                                <div class="mt-2 text-xs text-neutral-400">
                                    Permissions sélectionnées: 
                                    <span class="font-semibold">{{ implode(', ', $permissions) }}</span>
                                </div>
                            </div>
                            
                            <x-forms.button type="submit">Créer le token</x-forms.button>
                        </form>
                    </x-modal-input>
                @endcan
            @endif
        </div>

        {{-- Turso/Libsql Card (informational) --}}
        <div class="coolbox">
            <div class="flex items-start justify-between mb-4">
                <div class="flex items-center gap-3">
                    <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"/>
                        <path d="M4 12c0 2.21 3.582 4 8 4s8-1.79 8-4"/>
                    </svg>
                    <div>
                        <h3 class="text-lg font-semibold mb-1">Turso / Libsql</h3>
                        <p class="text-sm text-neutral-400">Bases de données Turso/Libsql</p>
                    </div>
                </div>
            </div>
            
            <p class="text-sm text-neutral-400 mb-4">
                Les bases de données Turso/Libsql sont configurées automatiquement lors de la création d'une base de données.
                Utilisez les tokens générés dans les variables d'environnement de vos applications.
            </p>
            
            <a href="{{ route('project.resource.create') }}" class="inline-block text-sm font-medium hover:underline" {{ wireNavigate() }}>
                Créer une base de données →
            </a>
        </div>
    </div>
</div>
