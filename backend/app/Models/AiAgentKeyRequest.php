<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
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

    /** @var list<string> */
    public const DATABASE_URL_ALIASES = [
        'DATABASE_URL',
        'DATABASE_URL_MACOMPTA',
        'DATABASE_URL_VALIDATED',
        'DATABASE_URL_CORRECT',
        'CORRECT_DB_URL',
        'NEW_DB_REMOTE_URL',
        'ASTRO_DB_REMOTE_URL',
        'TURSO_DATABASE_URL',
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

    public static function normalizeKeyName(string $key): string
    {
        return strtoupper(trim($key));
    }

    public static function canonicalKeyName(string $key): string
    {
        $key = self::normalizeKeyName($key);
        if (in_array($key, self::DATABASE_URL_ALIASES, true)) {
            return 'DATABASE_URL';
        }

        return $key;
    }

    /** @return list<string> */
    public static function aliasKeyNames(string $key): array
    {
        $canonical = self::canonicalKeyName($key);
        if ($canonical === 'DATABASE_URL') {
            return self::DATABASE_URL_ALIASES;
        }

        return [$canonical];
    }

    public static function sameResource(?string $left, ?string $right): bool
    {
        return trim((string) $left) === trim((string) $right);
    }

    /**
     * @return Builder<self>
     */
    public static function pendingLogicalQuery(int $teamId, string $key, ?string $resourceUuid): Builder
    {
        $aliases = self::aliasKeyNames($key);
        $resource = trim((string) $resourceUuid);

        $query = self::query()
            ->where('team_id', $teamId)
            ->where('status', 'pending')
            ->whereIn('key_name', $aliases);

        if ($resource !== '') {
            $query->where('resource_uuid', $resource);
        } else {
            $query->where(function (Builder $inner): void {
                $inner->whereNull('resource_uuid')->orWhere('resource_uuid', '');
            });
        }

        return $query->orderBy('id');
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
