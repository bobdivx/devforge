<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiAgentMessage extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'agent_id',
        'session_id',
        'run_id',
        'role',
        'content',
        'metadata',
    ];

    protected function casts(): array
    {
        return [
            'metadata' => 'array',
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

    public function run(): BelongsTo
    {
        return $this->belongsTo(AiAgentRun::class, 'run_id');
    }
}
