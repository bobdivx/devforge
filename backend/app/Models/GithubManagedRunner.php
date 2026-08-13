<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class GithubManagedRunner extends BaseModel
{
    protected $fillable = [
        'team_id',
        'server_uuid',
        'container_name',
        'runner_name',
        'owner',
        'repo',
        'repo_url',
        'image',
        'labels',
        'network_mode',
        'timezone',
        'replace_existing',
        'pull_image',
        'volumes',
        'extra_env',
        'auth_mode',
        'github_app_id',
        'enabled',
        'last_reconciled_at',
        'last_reconcile_error',
    ];

    protected function casts(): array
    {
        return [
            'replace_existing' => 'boolean',
            'pull_image' => 'boolean',
            'enabled' => 'boolean',
            'volumes' => 'array',
            'extra_env' => 'array',
            'last_reconciled_at' => 'datetime',
        ];
    }

    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    public function githubApp(): BelongsTo
    {
        return $this->belongsTo(GithubApp::class, 'github_app_id');
    }

    public function runnerKey(): string
    {
        return $this->server_uuid.':'.$this->container_name;
    }
}
