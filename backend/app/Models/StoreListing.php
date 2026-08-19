<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StoreListing extends BaseModel
{
    use HasFactory;

    public const STATUS_PUBLISHED = 'published';

    public const STATUS_UNPUBLISHED = 'unpublished';

    /**
     * @var list<string>
     */
    public const CATEGORIES = ['web', 'api', 'cms', 'ecommerce', 'ai', 'devops', 'other'];

    /**
     * @var array<string, mixed>
     */
    protected $attributes = [
        'status' => self::STATUS_PUBLISHED,
        'install_count' => 0,
    ];

    protected $fillable = [
        'slug',
        'name',
        'description',
        'category',
        'icon_url',
        'website_url',
        'team_id',
        'source_application_id',
        'git_repository',
        'git_branch',
        'git_commit_sha',
        'runtime_defaults',
        'env_schema',
        'status',
        'install_count',
    ];

    protected function casts(): array
    {
        return [
            'runtime_defaults' => 'array',
            'env_schema' => 'array',
            'install_count' => 'integer',
        ];
    }

    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    public function sourceApplication(): BelongsTo
    {
        return $this->belongsTo(Application::class, 'source_application_id');
    }

    public function installs(): HasMany
    {
        return $this->hasMany(StoreListingInstall::class);
    }

    public function isPublished(): bool
    {
        return $this->status === self::STATUS_PUBLISHED;
    }

    public function isOwnedBy(Team $team): bool
    {
        return (int) $this->team_id === (int) $team->id;
    }
}
