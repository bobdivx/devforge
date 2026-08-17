<?php

namespace App\Models;

use App\Traits\ClearsGlobalSearchCache;
use App\Traits\HasDatabaseHealthCheck;
use App\Traits\HasMetrics;
use App\Traits\HasSafeStringAttribute;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\SoftDeletes;
use Spatie\Url\Url;

class StandaloneLibsql extends BaseModel
{
    use ClearsGlobalSearchCache, HasDatabaseHealthCheck, HasFactory, HasMetrics, HasSafeStringAttribute, SoftDeletes;

    protected $table = 'standalone_libsqls';

    protected $fillable = [
        'uuid',
        'name',
        'description',
        'libsql_auth_user',
        'libsql_auth_token',
        'libsql_jwt_secret_key',
        'libsql_jwt_public_key',
        'is_log_drain_enabled',
        'is_include_timestamps',
        'status',
        'image',
        'is_public',
        'public_port',
        'fqdn',
        'ports_mappings',
        'limits_memory',
        'limits_memory_swap',
        'limits_memory_swappiness',
        'limits_memory_reservation',
        'limits_cpus',
        'limits_cpuset',
        'limits_cpu_shares',
        'started_at',
        'restart_count',
        'last_restart_at',
        'last_restart_type',
        'last_online_at',
        'public_port_timeout',
        'enable_ssl',
        'custom_docker_run_options',
        'destination_type',
        'destination_id',
        'environment_id',
        'health_check_enabled',
        'health_check_interval',
        'health_check_timeout',
        'health_check_retries',
        'health_check_start_period',
    ];

    protected $appends = ['internal_db_url', 'external_db_url', 'database_type', 'server_status'];

    protected $casts = [
        'health_check_enabled' => 'boolean',
        'health_check_interval' => 'integer',
        'health_check_timeout' => 'integer',
        'health_check_retries' => 'integer',
        'health_check_start_period' => 'integer',
        'libsql_auth_token' => 'encrypted',
        'libsql_jwt_secret_key' => 'encrypted',
        'public_port_timeout' => 'integer',
        'restart_count' => 'integer',
        'last_restart_at' => 'datetime',
        'last_restart_type' => 'string',
    ];

    protected static function booted()
    {
        static::created(function ($database) {
            LocalPersistentVolume::create([
                'name' => 'libsql-data-'.$database->uuid,
                'mount_path' => '/var/lib/sqld',
                'host_path' => null,
                'resource_id' => $database->id,
                'resource_type' => $database->getMorphClass(),
            ]);
        });
        static::forceDeleting(function ($database) {
            $database->persistentStorages()->delete();
            $database->scheduledBackups()->delete();
            $database->environment_variables()->delete();
            $database->tags()->detach();
        });
        static::saving(function ($database) {
            if ($database->isDirty('status')) {
                $database->last_online_at = now();
            }
            if ($database->isDirty('fqdn') && filled($database->fqdn)) {
                $database->fqdn = normalize_fqdn_list($database->fqdn);
            }
        });
    }

    public static function ownedByCurrentTeam()
    {
        return StandaloneLibsql::whereRelation('environment.project.team', 'id', currentTeam()->id)->orderBy('name');
    }

    public static function ownedByCurrentTeamCached()
    {
        return once(function () {
            return StandaloneLibsql::ownedByCurrentTeam()->get();
        });
    }

    /**
     * @deprecated Legacy sqld basic auth. Prefer JWT via SQLD_AUTH_JWT_KEY + TURSO_AUTH_TOKEN.
     */
    public function httpBasicAuthParam(): string
    {
        $user = $this->libsql_auth_user ?: 'libsql';

        return 'basic:'.base64_encode($user.':'.$this->libsql_auth_token);
    }

    protected function serverStatus(): Attribute
    {
        return Attribute::make(
            get: function () {
                return $this->destination->server->isFunctional();
            }
        );
    }

    public function isConfigurationChanged(bool $save = false)
    {
        $newConfigHash = $this->image.$this->ports_mappings;
        $newConfigHash .= $this->healthCheckConfigurationHash();
        $newConfigHash .= json_encode($this->environment_variables()->get('value')->sort());
        $newConfigHash = md5($newConfigHash);
        $oldConfigHash = data_get($this, 'config_hash');
        if ($oldConfigHash === null) {
            if ($save) {
                $this->config_hash = $newConfigHash;
                $this->save();
            }

            return true;
        }
        if ($oldConfigHash === $newConfigHash) {
            return false;
        }

        if ($save) {
            $this->config_hash = $newConfigHash;
            $this->save();
        }

        return true;
    }

    public function isRunning()
    {
        return (bool) str($this->status)->contains('running');
    }

    public function isExited()
    {
        return (bool) str($this->status)->startsWith('exited');
    }

    public function workdir()
    {
        return database_configuration_dir()."/{$this->uuid}";
    }

    public function deleteConfigurations()
    {
        $server = data_get($this, 'destination.server');
        $workdir = $this->workdir();
        if (str($workdir)->endsWith($this->uuid)) {
            instant_remote_process(['rm -rf '.$this->workdir()], $server, false);
        }
    }

    public function deleteVolumes()
    {
        $persistentStorages = $this->persistentStorages()->get() ?? collect();
        if ($persistentStorages->count() === 0) {
            return;
        }
        $server = data_get($this, 'destination.server');
        foreach ($persistentStorages as $storage) {
            instant_remote_process(['docker volume rm -f '.escapeshellarg($storage->name)], $server, false);
        }
    }

    public function realStatus()
    {
        return $this->getRawOriginal('status');
    }

    public function status(): Attribute
    {
        return Attribute::make(
            set: function ($value) {
                if (str($value)->contains('(')) {
                    $status = str($value)->before('(')->trim()->value();
                    $health = str($value)->after('(')->before(')')->trim()->value() ?? 'unhealthy';
                } elseif (str($value)->contains(':')) {
                    $status = str($value)->before(':')->trim()->value();
                    $health = str($value)->after(':')->trim()->value() ?? 'unhealthy';
                } else {
                    $status = $value;
                    $health = 'unhealthy';
                }

                return "$status:$health";
            },
            get: function ($value) {
                if (str($value)->contains('(')) {
                    $status = str($value)->before('(')->trim()->value();
                    $health = str($value)->after('(')->before(')')->trim()->value() ?? 'unhealthy';
                } elseif (str($value)->contains(':')) {
                    $status = str($value)->before(':')->trim()->value();
                    $health = str($value)->after(':')->trim()->value() ?? 'unhealthy';
                } else {
                    $status = $value;
                    $health = 'unhealthy';
                }

                return "$status:$health";
            },
        );
    }

    public function tags()
    {
        return $this->morphToMany(Tag::class, 'taggable');
    }

    public function project()
    {
        return data_get($this, 'environment.project');
    }

    public function team()
    {
        return data_get($this, 'environment.project.team');
    }

    public function sslCertificates()
    {
        return $this->morphMany(SslCertificate::class, 'resource');
    }

    public function link()
    {
        if (data_get($this, 'environment.project.uuid')) {
            return route('project.database.configuration', [
                'project_uuid' => data_get($this, 'environment.project.uuid'),
                'environment_uuid' => data_get($this, 'environment.uuid'),
                'database_uuid' => data_get($this, 'uuid'),
            ]);
        }

        return null;
    }

    public function isLogDrainEnabled()
    {
        return data_get($this, 'is_log_drain_enabled', false);
    }

    public function portsMappings(): Attribute
    {
        return Attribute::make(
            set: fn ($value) => $value === '' ? null : $value,
        );
    }

    public function portsMappingsArray(): Attribute
    {
        return Attribute::make(
            get: fn () => is_null($this->ports_mappings)
                ? []
                : explode(',', $this->ports_mappings),
        );
    }

    public function databaseType(): Attribute
    {
        return new Attribute(
            get: fn () => $this->type(),
        );
    }

    public function type(): string
    {
        return 'standalone-libsql';
    }

    protected function internalDbUrl(): Attribute
    {
        return new Attribute(
            // Self-hosted sqld speaks plain HTTP on the Docker network.
            // libsql:// would force TLS and break with ERR_SSL_PACKET_LENGTH_TOO_LONG.
            // Pass TURSO_AUTH_TOKEN separately as a Bearer JWT.
            get: fn () => "http://{$this->uuid}:8080",
        );
    }

    protected function externalDbUrl(): Attribute
    {
        return new Attribute(
            get: function () {
                if (! $this->is_public) {
                    return null;
                }

                $domainHost = $this->publicDomainHost();
                if ($domainHost) {
                    return "libsql://{$domainHost}";
                }

                if ($this->public_port) {
                    $serverIp = $this->destination->server->getIp;
                    if (empty($serverIp)) {
                        return null;
                    }

                    // TCP proxy has no TLS — clients must use http:// not libsql://.
                    return "http://{$serverIp}:{$this->public_port}";
                }

                return null;
            }
        );
    }

    public function publicDomainHost(): ?string
    {
        if (! $this->is_public || blank($this->fqdn)) {
            return null;
        }

        try {
            $host = Url::fromString((string) $this->fqdn)->getHost();

            return filled($host) ? $host : null;
        } catch (\Throwable) {
            return null;
        }
    }

    public function environment()
    {
        return $this->belongsTo(Environment::class);
    }

    public function fileStorages()
    {
        return $this->morphMany(LocalFileVolume::class, 'resource');
    }

    public function destination()
    {
        return $this->morphTo();
    }

    public function runtime_environment_variables()
    {
        return $this->morphMany(EnvironmentVariable::class, 'resourceable');
    }

    public function persistentStorages()
    {
        return $this->morphMany(LocalPersistentVolume::class, 'resource');
    }

    public function scheduledBackups()
    {
        return $this->morphMany(ScheduledDatabaseBackup::class, 'database');
    }

    public function isBackupSolutionAvailable()
    {
        return false;
    }

    public function environment_variables()
    {
        return $this->morphMany(EnvironmentVariable::class, 'resourceable');
    }
}
