<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiAgentRun extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'agent_id',
        'session_id',
        'status',
        'trigger',
        'summary',
        'actions_taken',
        'metadata',
        'logs',
        'tokens_used',
        'iterations',
        'started_at',
        'finished_at',
    ];

    protected function casts(): array
    {
        return [
            'actions_taken' => 'array',
            'metadata' => 'array',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
            'tokens_used' => 'integer',
            'iterations' => 'integer',
        ];
    }

    /** @return string[] */
    public function uniqueIds(): array
    {
        return ['uuid'];
    }

    public function agent(): BelongsTo
    {
        return $this->belongsTo(AiAgent::class, 'agent_id');
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(AiAgentSession::class, 'session_id');
    }

    public function getDurationInSecondsAttribute(): ?int
    {
        if (! $this->started_at || ! $this->finished_at) {
            return null;
        }

        return (int) $this->started_at->diffInSeconds($this->finished_at);
    }

    public function appendLog(string $line): void
    {
        $timestamp = now()->format('H:i:s');
        $this->logs = ($this->logs ?? '')."[{$timestamp}] {$line}\n";
        $this->saveQuietly();
    }

    /** @param  array<string, mixed>  $data */
    public function mergeMetadata(array $data): void
    {
        $this->metadata = array_merge($this->metadata ?? [], $data);
        $this->saveQuietly();
    }
}
