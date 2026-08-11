<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiAgentSkill extends Model
{
    protected $fillable = [
        'team_id',
        'agent_id',
        'slug',
        'name',
        'description',
        'body',
        'tags',
        'is_active',
        'is_builtin',
        'priority',
    ];

    protected function casts(): array
    {
        return [
            'tags' => 'array',
            'is_active' => 'boolean',
            'is_builtin' => 'boolean',
            'priority' => 'integer',
        ];
    }

    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    public function agent(): BelongsTo
    {
        return $this->belongsTo(AiAgent::class, 'agent_id');
    }
}
