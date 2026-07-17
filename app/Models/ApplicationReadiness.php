<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ApplicationReadiness extends BaseModel
{
    public const STATUS_IDLE = 'idle';

    public const STATUS_PROBING = 'probing';

    public const STATUS_HEALTHY = 'healthy';

    public const STATUS_RECOVERING = 'recovering';

    public const STATUS_AWAITING_USER = 'awaiting_user';

    public const STATUS_FAILED = 'failed';

    protected $table = 'application_readiness';

    protected $fillable = [
        'application_id',
        'status',
        'autonomous_enabled',
        'last_probe_at',
        'last_probe_ok',
        'last_probe_error',
        'last_http_status',
        'round',
        'max_rounds',
        'last_deployment_uuid',
        'active_intervention_id',
    ];

    protected function casts(): array
    {
        return [
            'autonomous_enabled' => 'boolean',
            'last_probe_at' => 'datetime',
            'last_probe_ok' => 'boolean',
            'last_http_status' => 'integer',
            'round' => 'integer',
            'max_rounds' => 'integer',
        ];
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(Application::class);
    }

    public function activeIntervention(): BelongsTo
    {
        return $this->belongsTo(ApplicationReadinessIntervention::class, 'active_intervention_id');
    }

    public function interventions(): HasMany
    {
        return $this->hasMany(ApplicationReadinessIntervention::class, 'application_id', 'application_id');
    }

    public function isWatchable(): bool
    {
        return $this->autonomous_enabled
            && in_array($this->status, [self::STATUS_HEALTHY, self::STATUS_RECOVERING, self::STATUS_PROBING], true);
    }
}
