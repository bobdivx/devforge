<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiAgentSessionPreference extends Model
{
    protected $fillable = [
        'user_id',
        'agent_id',
        'session_id',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function agent(): BelongsTo
    {
        return $this->belongsTo(AiAgent::class, 'agent_id');
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(AiAgentSession::class, 'session_id');
    }
}
