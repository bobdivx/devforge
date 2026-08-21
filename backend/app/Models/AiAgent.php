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
        'avatar_shape',
        'system_prompt',
        'schedule_minutes',
        'schedule_cron',
        'heartbeat_enabled',
        'last_heartbeat_at',
        'is_active',
        'status',
        'last_run_at',
        'metadata',
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'heartbeat_enabled' => 'boolean',
            'metadata' => 'array',
            'last_run_at' => 'datetime',
            'last_heartbeat_at' => 'datetime',
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

    public function sessions(): HasMany
    {
        return $this->hasMany(AiAgentSession::class, 'agent_id');
    }

    public function latestRun(): HasMany
    {
        return $this->hasMany(AiAgentRun::class, 'agent_id')->latest()->limit(1);
    }

    public function syncOperationalStatus(): bool
    {
        $this->recoverIfInterrupted(maxAgeSeconds: 90);

        if ($this->runs()->whereIn('status', ['pending', 'running'])->exists()) {
            if ($this->status !== 'running') {
                $this->update(['status' => 'running']);
            }

            return $this->wasChanged();
        }

        if (! $this->is_active) {
            if ($this->status !== 'paused') {
                $this->update(['status' => 'paused']);

                return true;
            }

            return false;
        }

        $targetStatus = $this->resolveOperationalStatusFromLatestRun(
            $this->runs()->latest()->first(),
        );

        if ($this->status !== $targetStatus) {
            $this->update(['status' => $targetStatus]);

            return true;
        }

        return false;
    }

    /**
     * @deprecated Use syncOperationalStatus() instead.
     */
    public function recoverFromErrorState(): bool
    {
        return $this->syncOperationalStatus();
    }

    private function resolveOperationalStatusFromLatestRun(?AiAgentRun $latestRun): string
    {
        if ($latestRun === null) {
            return 'idle';
        }

        if ($latestRun->status === 'failed' && ! $this->isStaleFailure($latestRun)) {
            return 'error';
        }

        return 'idle';
    }

    private function isStaleFailure(AiAgentRun $run): bool
    {
        $retentionHours = (int) config('devforge.agents_error_retention_hours', 24);

        if ($retentionHours <= 0) {
            return false;
        }

        $referenceAt = $run->finished_at ?? $run->created_at;

        if ($referenceAt === null) {
            return false;
        }

        return $referenceAt->copy()->addHours($retentionHours)->isPast();
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

    public function prepareForEventDispatch(?int $maxStaleSeconds = null): void
    {
        $maxStaleSeconds ??= (int) config('devforge.agents_event_stale_seconds', 90);

        if ($this->status !== 'running') {
            $this->syncOperationalStatus();

            return;
        }

        if ($this->recoverIfInterrupted($maxStaleSeconds)) {
            return;
        }

        $activeRun = $this->runs()
            ->whereIn('status', ['pending', 'running'])
            ->latest()
            ->first();

        if ($activeRun === null) {
            $this->releaseRunningState('Exécution interrompue sans run actif.');

            return;
        }

        if ($activeRun->status === 'pending' && $activeRun->started_at === null) {
            $pendingGrace = (int) config('devforge.agents_pending_stale_seconds', 45);
            $referenceAt = $activeRun->created_at;

            if ($referenceAt !== null && $referenceAt->copy()->addSeconds($pendingGrace)->isPast()) {
                $this->releaseRunningState('Run en attente expiré (file d\'attente ou worker indisponible).', $activeRun);
            }
        }
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

        if (! $this->is_active || $this->status === 'running') {
            return false;
        }

        $cron = is_string($this->schedule_cron ?? null) ? trim((string) $this->schedule_cron) : '';
        if ($cron !== '' && function_exists('validate_cron_expression') && validate_cron_expression($cron)) {
            $timezone = config('app.timezone', 'UTC');

            return shouldRunCronNow(
                $cron,
                $timezone,
                'devforge-agent-cron:'.$this->id,
            );
        }

        if ($this->schedule_minutes === 0 || $this->schedule_minutes === null) {
            return false;
        }

        if (! $this->last_run_at) {
            return true;
        }

        return $this->last_run_at->addMinutes($this->schedule_minutes)->isPast();
    }

    public function isDueForHeartbeat(): bool
    {
        if (! $this->is_active || ! ($this->heartbeat_enabled ?? false) || $this->status === 'running') {
            return false;
        }

        $interval = max(5, (int) config('devforge.agents_heartbeat_minutes', 30));
        if ($interval <= 0) {
            return false;
        }

        if (! $this->last_heartbeat_at) {
            return true;
        }

        return $this->last_heartbeat_at->addMinutes($interval)->isPast();
    }

    public function isEventOnly(): bool
    {
        return in_array($this->type, ['devforge', 'github-actions'], true);
    }

    /**
     * Libellé du déclencheur événementiel (null si minuteur / manuel).
     */
    public function eventTriggerLabel(): ?string
    {
        return match ($this->type) {
            'devforge' => 'À chaque build webhook',
            'github-actions' => 'Sur échec GitHub Actions (workflow_run)',
            default => null,
        };
    }

    public function triggerMode(): string
    {
        if ($this->isEventOnly()) {
            return 'webhook';
        }

        $cron = is_string($this->schedule_cron ?? null) ? trim((string) $this->schedule_cron) : '';
        if ($cron !== '') {
            return 'cron';
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

    /**
     * Modèle préféré pour cet agent (override du modèle du provider). Null = hériter du provider / Auto.
     */
    public function preferredLlmModel(): ?string
    {
        $model = $this->metadata['llm_model'] ?? null;
        if (! is_string($model)) {
            return null;
        }

        $model = trim($model);

        return $model === '' ? null : $model;
    }

    public function setPreferredLlmModel(?string $model): void
    {
        $metadata = is_array($this->metadata) ? $this->metadata : [];
        $normalized = is_string($model) ? trim($model) : '';

        if ($normalized === '' || strtolower($normalized) === 'auto') {
            unset($metadata['llm_model']);
        } else {
            $metadata['llm_model'] = $normalized;
        }

        $this->metadata = $metadata === [] ? null : $metadata;
    }
}
