<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiAgentSubagentRun extends Model
{
    public const STATUS_PENDING = 'pending';

    public const STATUS_QUEUED = 'queued';

    public const STATUS_RUNNING = 'running';

    public const STATUS_COMPLETED = 'completed';

    public const STATUS_FAILED = 'failed';

    public const STATUS_CANCELLED = 'cancelled';

    protected $fillable = [
        'parent_agent_id',
        'child_agent_id',
        'parent_run_id',
        'child_run_id',
        'status',
        'reason',
        'output',
        'error',
        'started_at',
        'finished_at',
    ];

    protected function casts(): array
    {
        return [
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
        ];
    }

    public function parentAgent(): BelongsTo
    {
        return $this->belongsTo(AiAgent::class, 'parent_agent_id');
    }

    public function childAgent(): BelongsTo
    {
        return $this->belongsTo(AiAgent::class, 'child_agent_id');
    }

    public function parentRun(): BelongsTo
    {
        return $this->belongsTo(AiAgentRun::class, 'parent_run_id');
    }

    public function childRun(): BelongsTo
    {
        return $this->belongsTo(AiAgentRun::class, 'child_run_id');
    }
}
