<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiAgentKeyRequest extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'team_id',
        'agent_id',
        'run_id',
        'key_name',
        'kind',
        'reason',
        'status',
        'resource_uuid',
        'mission_uuid',
        'resolved_at',
    ];

    protected function casts(): array
    {
        return [
            'resolved_at' => 'datetime',
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

    public function agent(): BelongsTo
    {
        return $this->belongsTo(AiAgent::class);
    }

    public function run(): BelongsTo
    {
        return $this->belongsTo(AiAgentRun::class, 'run_id');
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(Application::class, 'resource_uuid', 'uuid');
    }
}
