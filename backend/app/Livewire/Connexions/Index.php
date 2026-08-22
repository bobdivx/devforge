<?php

namespace App\Livewire\Connexions;

use App\Models\GithubApp;
use App\Models\InstanceSettings;
use Illuminate\Foundation\Auth\Access\AuthorizesRequests;
use Laravel\Sanctum\PersonalAccessToken;
use Livewire\Attributes\Locked;
use Livewire\Component;

class Index extends Component
{
    use AuthorizesRequests;

    public ?string $tokenDescription = null;

    public ?int $expiresInDays = 30;

    public $devforgeTokens = [];

    public array $permissions = ['read'];

    public array $expirationOptions = [
        7 => '7 jours',
        30 => '30 jours',
        60 => '60 jours',
        90 => '90 jours',
        365 => '1 an',
    ];

    public $isApiEnabled;

    #[Locked]
    public bool $canUseRootPermissions = false;

    #[Locked]
    public bool $canUseWritePermissions = false;

    public $githubApps = [];

    public bool $showTokenModal = false;

    public function render()
    {
        return view('livewire.connexions.index');
    }

    public function mount()
    {
        $this->isApiEnabled = InstanceSettings::get()->is_api_enabled;
        $this->canUseRootPermissions = auth()->user()->can('useRootPermissions', PersonalAccessToken::class);
        $this->canUseWritePermissions = auth()->user()->can('useWritePermissions', PersonalAccessToken::class);
        $this->getDevForgeTokens();
        $this->getGithubApps();
    }

    private function getDevForgeTokens()
    {
        $this->devforgeTokens = auth()->user()->tokens->sortByDesc('created_at');
    }

    private function getGithubApps()
    {
        $this->githubApps = currentTeam()->sources()->filter(function ($source) {
            return $source instanceof GithubApp;
        });
    }

    public function updatedPermissions($permissionToUpdate)
    {
        if ($permissionToUpdate == 'root' && ! auth()->user()->can('useRootPermissions', PersonalAccessToken::class)) {
            $this->dispatch('error', 'Vous n\'avez pas la permission d\'utiliser les permissions root.');
            $this->permissions = array_diff($this->permissions, ['root']);

            return;
        }

        if (in_array($permissionToUpdate, ['write', 'write:sensitive'], true) && ! auth()->user()->can('useWritePermissions', PersonalAccessToken::class)) {
            $this->dispatch('error', 'Vous n\'avez pas la permission d\'utiliser les permissions d\'écriture.');
            $this->permissions = array_diff($this->permissions, ['write', 'write:sensitive']);

            return;
        }

        if ($permissionToUpdate == 'root') {
            $this->permissions = ['root'];
        } elseif ($permissionToUpdate == 'read:sensitive' && ! in_array('read', $this->permissions, true)) {
            $this->permissions[] = 'read';
        } elseif ($permissionToUpdate == 'deploy') {
            $this->permissions = ['deploy'];
        } else {
            if (count($this->permissions) == 0) {
                $this->permissions = ['read'];
            }
        }
        sort($this->permissions);
    }

    public function createDevForgeToken()
    {
        try {
            $this->authorize('create', PersonalAccessToken::class);

            if (in_array('root', $this->permissions, true) && ! auth()->user()->can('useRootPermissions', PersonalAccessToken::class)) {
                throw new \Exception('Vous n\'avez pas la permission de créer des tokens avec permissions root.');
            }

            if (array_intersect(['write', 'write:sensitive'], $this->permissions) && ! auth()->user()->can('useWritePermissions', PersonalAccessToken::class)) {
                throw new \Exception('Vous n\'avez pas la permission de créer des tokens avec permissions d\'écriture.');
            }

            $this->validate([
                'tokenDescription' => 'required|min:3|max:255',
                'expiresInDays' => 'nullable|integer|in:7,30,60,90,365',
            ]);
            $expiresAt = $this->expiresInDays ? now()->addDays($this->expiresInDays) : null;
            $token = auth()->user()->createToken($this->tokenDescription, array_values($this->permissions), $expiresAt);
            $this->getDevForgeTokens();
            session()->flash('devforge-token', $token->plainTextToken);
            $this->showTokenModal = false;
            $this->tokenDescription = null;
        } catch (\Exception $e) {
            return handleError($e, $this);
        }
    }

    public function revokeDevForgeToken(int $id)
    {
        try {
            $token = auth()->user()->tokens()->where('id', $id)->firstOrFail();
            $this->authorize('delete', $token);
            $token->delete();
            $this->getDevForgeTokens();
            $this->dispatch('success', 'Token révoqué avec succès.');
        } catch (\Exception $e) {
            return handleError($e, $this);
        }
    }

    public function openTokenModal()
    {
        $this->showTokenModal = true;
    }

    public function closeTokenModal()
    {
        $this->showTokenModal = false;
        $this->tokenDescription = null;
    }
}
