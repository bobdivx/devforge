<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class GithubRunnerApplicationLink extends Model
{
    protected $fillable = [
        'team_id',
        'application_id',
        'server_uuid',
        'container_name',
        'role',
    ];

    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(Application::class);
    }

    public function runnerKey(): string
    {
        return $this->server_uuid.':'.$this->container_name;
    }
}
