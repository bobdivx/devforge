<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AiProviderConfig extends Model
{
    use HasFactory;

    protected $fillable = [
        'team_id',
        'provider',
        'name',
        'api_key',
        'base_url',
        'model',
        'is_default',
    ];

    protected function casts(): array
    {
        return [
            'api_key' => 'encrypted',
            'is_default' => 'boolean',
        ];
    }

    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    public function agents(): HasMany
    {
        return $this->hasMany(AiAgent::class, 'provider_config_id');
    }
}
