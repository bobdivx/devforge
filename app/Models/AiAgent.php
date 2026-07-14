<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AiAgent extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'team_id',
        'parent_agent_id',
        'provider_config_id',
        'fallback_provider_config_id',
        'resource_uuid',
        'type',
        'name',
        'description',
        'avatar_color',
        'system_prompt',
        'schedule_minutes',
        'is_active',
        'status',
        'last_run_at',
        'metadata',
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'metadata' => 'array',
            'last_run_at' => 'datetime',
            'schedule_minutes' => 'integer',
        ];
    }

    /** @return string[] */
    public function uniqueIds(): array
    {
        return ['uuid'];
    }

    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(AiAgent::class, 'parent_agent_id');
    }

    public function subAgents(): HasMany
    {
        return $this->hasMany(AiAgent::class, 'parent_agent_id');
    }

    public function providerConfig(): BelongsTo
    {
        return $this->belongsTo(AiProviderConfig::class, 'provider_config_id');
    }

    public function fallbackProviderConfig(): BelongsTo
    {
        return $this->belongsTo(AiProviderConfig::class, 'fallback_provider_config_id');
    }

    public function runs(): HasMany
    {
        return $this->hasMany(AiAgentRun::class, 'agent_id');
    }

    public function messages(): HasMany
    {
        return $this->hasMany(AiAgentMessage::class, 'agent_id');
    }

    public function latestRun(): HasMany
    {
        return $this->hasMany(AiAgentRun::class, 'agent_id')->latest()->limit(1);
    }

    public function recoverFromErrorState(): bool
    {
        if ($this->status !== 'error') {
            return false;
        }

        $this->recoverIfInterrupted(maxAgeSeconds: 90);

        if ($this->runs()
            ->whereIn('status', ['pending', 'running'])
            ->exists()) {
            return false;
        }

        $this->update(['status' => 'idle']);

        return true;
    }

    public function recoverIfInterrupted(int $maxAgeSeconds = 330): bool
    {
        if ($this->status !== 'running') {
            return false;
        }

        $activeRun = $this->runs()
            ->whereIn('status', ['pending', 'running'])
            ->latest()
            ->first();

        if ($activeRun === null) {
            $this->releaseRunningState('Exécution interrompue sans run actif.');

            return true;
        }

        $referenceAt = $activeRun->started_at ?? $activeRun->created_at;

        if ($referenceAt !== null && $referenceAt->copy()->addSeconds($maxAgeSeconds)->isPast()) {
            $this->releaseRunningState('Exécution expirée ou interrompue.', $activeRun);

            return true;
        }

        return false;
    }

    public function prepareForManualRun(): void
    {
        if ($this->status !== 'running') {
            return;
        }

        if ($this->recoverIfInterrupted(maxAgeSeconds: 90)) {
            return;
        }

        $activeRun = $this->runs()
            ->whereIn('status', ['pending', 'running'])
            ->latest()
            ->first();

        $this->releaseRunningState('Interrompu pour un nouveau lancement manuel.', $activeRun);
    }

    private function releaseRunningState(string $summary, ?AiAgentRun $activeRun = null): void
    {
        if ($activeRun) {
            $activeRun->update([
                'status' => 'failed',
                'summary' => $summary,
                'finished_at' => now(),
            ]);
        }

        $this->update([
            'status' => 'idle',
            'last_run_at' => now(),
        ]);
    }

    public function isDueForScheduledRun(): bool
    {
        if ($this->isEventOnly()) {
            return false;
        }

        if (! $this->is_active || $this->schedule_minutes === 0 || $this->status === 'running') {
            return false;
        }

        if (! $this->last_run_at) {
            return true;
        }

        return $this->last_run_at->addMinutes($this->schedule_minutes)->isPast();
    }

    public function isEventOnly(): bool
    {
        return $this->type === 'devforge';
    }

    public function triggerMode(): string
    {
        if ($this->isEventOnly()) {
            return 'webhook';
        }

        return $this->schedule_minutes > 0 ? 'schedule' : 'manual';
    }

    public function effectiveProviderConfig(): ?AiProviderConfig
    {
        if ($this->providerConfig) {
            return $this->providerConfig;
        }

        return AiProviderConfig::query()
            ->where('team_id', $this->team_id)
            ->orderByDesc('is_default')
            ->orderBy('id')
            ->first();
    }

    public function hasLlmProvider(): bool
    {
        return $this->effectiveProviderConfig() !== null;
    }
}
