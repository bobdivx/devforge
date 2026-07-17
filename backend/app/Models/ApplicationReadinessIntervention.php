<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ApplicationReadinessIntervention extends BaseModel
{
    public const STATUS_OPEN = 'open';

    public const STATUS_ACKNOWLEDGED = 'acknowledged';

    public const STATUS_RESOLVED = 'resolved';

    public const STATUS_CANCELLED = 'cancelled';

    protected $fillable = [
        'application_id',
        'deployment_uuid',
        'agent_run_uuid',
        'title',
        'summary',
        'steps',
        'status',
        'user_acknowledged_at',
        'resolved_at',
    ];

    protected function casts(): array
    {
        return [
            'steps' => 'array',
            'user_acknowledged_at' => 'datetime',
            'resolved_at' => 'datetime',
        ];
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(Application::class);
    }
}
