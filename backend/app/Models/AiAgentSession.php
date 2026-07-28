<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AiAgentSession extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'agent_id',
        'user_id',
        'title',
        'chat_mode',
        'last_message_at',
    ];

    protected function casts(): array
    {
        return [
            'last_message_at' => 'datetime',
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

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function messages(): HasMany
    {
        return $this->hasMany(AiAgentMessage::class, 'session_id');
    }

    public function runs(): HasMany
    {
        return $this->hasMany(AiAgentRun::class, 'session_id');
    }

    public function touchLastMessage(): void
    {
        $this->update(['last_message_at' => now()]);
    }

    public function isLegacyShared(): bool
    {
        return $this->user_id === null;
    }
}
