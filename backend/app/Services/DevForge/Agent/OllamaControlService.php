<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiProviderConfig;
use App\Models\Server;
use App\Models\Team;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Contrôle Ollama (API HTTP) + inventaire machine/GPU via SSH sur l'hôte DevForge.
 */
class OllamaControlService
{
    public function __construct(
        private readonly OllamaFallbackResolver $fallbackResolver,
    ) {}

    /**
     * @return list<array{
     *     id: int,
     *     name: string,
     *     base_url: string|null,
     *     resolved_base_url: string|null,
     *     is_default: bool,
     *     model: string|null,
     *     reachable: bool
     * }>
     */
    public function listInstances(Team $team): array
    {
        return AiProviderConfig::query()
            ->where('team_id', $team->id)
            ->where('provider', 'ollama')
            ->orderByDesc('is_default')
            ->orderBy('name')
            ->get()
            ->map(function (AiProviderConfig $provider): array {
                $resolved = null;
                try {
                    if (is_string($provider->base_url) && trim($provider->base_url) !== '') {
                        $resolved = LlmEndpointResolver::ollamaBaseUrl($provider->base_url);
                    }
                } catch (Throwable) {
                    $resolved = null;
                }

                return [
                    'id' => $provider->id,
                    'name' => $provider->name,
                    'base_url' => $provider->base_url,
                    'resolved_base_url' => $resolved,
                    'is_default' => (bool) $provider->is_default,
                    'model' => $provider->model,
                    'reachable' => is_string($resolved) && $this->fallbackResolver->isReachable($resolved),
                ];
            })
            ->values()
            ->all();
    }

    /**
     * @return array{
     *     reachable: bool,
     *     base_url: string|null,
     *     provider_id: int|null,
     *     provider_name: string|null,
     *     version: string|null,
     *     models: list<array{name: string, size: int|null, parameter_size: string|null, quantization: string|null, family: string|null, modified_at: string|null}>,
     *     running: list<array{name: string, size: int|null, size_vram: int|null, expires_at: string|null}>,
     *     host: array<string, mixed>,
     *     error: string|null
     * }
     */
    public function status(Team $team, ?string $preferredBaseUrl = null, ?int $providerId = null): array
    {
        $provider = null;
        if ($providerId !== null) {
            $provider = AiProviderConfig::query()
                ->where('team_id', $team->id)
                ->where('provider', 'ollama')
                ->whereKey($providerId)
                ->first();

            if ($provider instanceof AiProviderConfig && is_string($provider->base_url) && trim($provider->base_url) !== '') {
                $preferredBaseUrl = $provider->base_url;
            }
        }

        $baseUrl = $this->resolveBaseUrl($team, $preferredBaseUrl);
        $host = $this->probeHostCapabilities();

        if ($baseUrl === null) {
            return [
                'reachable' => false,
                'base_url' => null,
                'provider_id' => $provider?->id,
                'provider_name' => $provider?->name,
                'version' => null,
                'models' => [],
                'running' => [],
                'host' => $host,
                'error' => 'Aucune URL Ollama joignable. Ajoutez des providers Ollama (un par machine) dans Providers LLM.',
            ];
        }

        try {
            $version = $this->fetchVersion($baseUrl);
            $models = $this->fetchModels($baseUrl);
            $running = $this->fetchRunning($baseUrl);

            return [
                'reachable' => true,
                'base_url' => $baseUrl,
                'provider_id' => $provider?->id,
                'provider_name' => $provider?->name,
                'version' => $version,
                'models' => $models,
                'running' => $running,
                'host' => $host,
                'error' => null,
            ];
        } catch (Throwable $e) {
            return [
                'reachable' => false,
                'base_url' => $baseUrl,
                'provider_id' => $provider?->id,
                'provider_name' => $provider?->name,
                'version' => null,
                'models' => [],
                'running' => [],
                'host' => $host,
                'error' => $e->getMessage(),
            ];
        }
    }

    /**
     * @return array{ok: bool, model: string, status: string|null, error: string|null}
     */
    public function pull(Team $team, string $model, ?string $preferredBaseUrl = null): array
    {
        $baseUrl = $this->resolveBaseUrl($team, $preferredBaseUrl);
        if ($baseUrl === null) {
            return ['ok' => false, 'model' => $model, 'status' => null, 'error' => 'Ollama injoignable.'];
        }

        $model = trim($model);
        if ($model === '' || ! preg_match('/^[A-Za-z0-9][A-Za-z0-9._:\\/-]{0,120}$/', $model)) {
            return ['ok' => false, 'model' => $model, 'status' => null, 'error' => 'Nom de modèle invalide.'];
        }

        try {
            $response = Http::connectTimeout(5)
                ->timeout(900)
                ->post(rtrim($baseUrl, '/').'/api/pull', [
                    'name' => $model,
                    'stream' => false,
                ]);

            if ($response->failed()) {
                return [
                    'ok' => false,
                    'model' => $model,
                    'status' => null,
                    'error' => 'Pull échoué ['.$response->status().']: '.mb_substr($response->body(), 0, 300),
                ];
            }

            $status = (string) ($response->json('status') ?? 'success');

            return ['ok' => true, 'model' => $model, 'status' => $status, 'error' => null];
        } catch (ConnectionException) {
            return ['ok' => false, 'model' => $model, 'status' => null, 'error' => 'Connexion Ollama perdue pendant le pull.'];
        } catch (Throwable $e) {
            return ['ok' => false, 'model' => $model, 'status' => null, 'error' => $e->getMessage()];
        }
    }

    /**
     * @return array{ok: bool, model: string, error: string|null}
     */
    public function delete(Team $team, string $model, ?string $preferredBaseUrl = null): array
    {
        $baseUrl = $this->resolveBaseUrl($team, $preferredBaseUrl);
        if ($baseUrl === null) {
            return ['ok' => false, 'model' => $model, 'error' => 'Ollama injoignable.'];
        }

        $model = trim($model);
        if ($model === '') {
            return ['ok' => false, 'model' => $model, 'error' => 'Nom de modèle requis.'];
        }

        try {
            // Prefer POST: reverse proxies often block DELETE, and newer Ollama clients use POST.
            $response = Http::connectTimeout(5)
                ->timeout(60)
                ->asJson()
                ->post(rtrim($baseUrl, '/').'/api/delete', [
                    'model' => $model,
                ]);

            if ($response->status() === 405) {
                $response = Http::connectTimeout(5)
                    ->timeout(60)
                    ->withBody(json_encode(['model' => $model], JSON_THROW_ON_ERROR), 'application/json')
                    ->delete(rtrim($baseUrl, '/').'/api/delete');
            }

            if ($response->failed()) {
                return [
                    'ok' => false,
                    'model' => $model,
                    'error' => 'Suppression échouée ['.$response->status().']: '.mb_substr($response->body(), 0, 300),
                ];
            }

            return ['ok' => true, 'model' => $model, 'error' => null];
        } catch (Throwable $e) {
            return ['ok' => false, 'model' => $model, 'error' => $e->getMessage()];
        }
    }

    public function resolveBaseUrl(Team $team, ?string $preferredBaseUrl = null): ?string
    {
        $preferred = trim((string) $preferredBaseUrl);
        if ($preferred !== '') {
            try {
                return LlmEndpointResolver::ollamaBaseUrl($preferred);
            } catch (Throwable) {
                return rtrim($preferred, '/');
            }
        }

        $providerUrl = AiProviderConfig::query()
            ->where('team_id', $team->id)
            ->where('provider', 'ollama')
            ->orderByDesc('is_default')
            ->orderBy('id')
            ->value('base_url');

        if (is_string($providerUrl) && trim($providerUrl) !== '') {
            try {
                return LlmEndpointResolver::ollamaBaseUrl($providerUrl);
            } catch (Throwable) {
                return rtrim($providerUrl, '/');
            }
        }

        $discovered = $this->fallbackResolver->discover();

        return $discovered['base_url'] ?? null;
    }

    /**
     * @return list<array{name: string, size: int|null, parameter_size: string|null, quantization: string|null, family: string|null, modified_at: string|null}>
     */
    private function fetchModels(string $baseUrl): array
    {
        $response = Http::connectTimeout(3)->timeout(10)->get(rtrim($baseUrl, '/').'/api/tags');
        if ($response->failed()) {
            throw new \RuntimeException('Impossible de lister les modèles Ollama ['.$response->status().'].');
        }

        return collect($response->json('models', []))
            ->filter(fn ($row): bool => is_array($row))
            ->map(function (array $row): array {
                $details = is_array($row['details'] ?? null) ? $row['details'] : [];

                return [
                    'name' => (string) ($row['name'] ?? $row['model'] ?? ''),
                    'size' => isset($row['size']) && is_numeric($row['size']) ? (int) $row['size'] : null,
                    'parameter_size' => isset($details['parameter_size']) ? (string) $details['parameter_size'] : null,
                    'quantization' => isset($details['quantization_level']) ? (string) $details['quantization_level'] : null,
                    'family' => isset($details['family']) ? (string) $details['family'] : null,
                    'modified_at' => isset($row['modified_at']) ? (string) $row['modified_at'] : null,
                ];
            })
            ->filter(fn (array $row): bool => $row['name'] !== '')
            ->sortBy('name', SORT_NATURAL | SORT_FLAG_CASE)
            ->values()
            ->all();
    }

    /**
     * @return list<array{name: string, size: int|null, size_vram: int|null, expires_at: string|null}>
     */
    private function fetchRunning(string $baseUrl): array
    {
        try {
            $response = Http::connectTimeout(2)->timeout(5)->get(rtrim($baseUrl, '/').'/api/ps');
        } catch (ConnectionException) {
            return [];
        }

        if ($response->failed()) {
            return [];
        }

        return collect($response->json('models', []))
            ->filter(fn ($row): bool => is_array($row))
            ->map(fn (array $row): array => [
                'name' => (string) ($row['name'] ?? $row['model'] ?? ''),
                'size' => isset($row['size']) && is_numeric($row['size']) ? (int) $row['size'] : null,
                'size_vram' => isset($row['size_vram']) && is_numeric($row['size_vram']) ? (int) $row['size_vram'] : null,
                'expires_at' => isset($row['expires_at']) ? (string) $row['expires_at'] : null,
            ])
            ->filter(fn (array $row): bool => $row['name'] !== '')
            ->values()
            ->all();
    }

    private function fetchVersion(string $baseUrl): ?string
    {
        try {
            $response = Http::connectTimeout(2)->timeout(5)->get(rtrim($baseUrl, '/').'/api/version');
            if ($response->successful()) {
                $version = $response->json('version');

                return is_string($version) ? $version : null;
            }
        } catch (Throwable) {
            // optional
        }

        return null;
    }

    /**
     * @return array{
     *     server_id: int|null,
     *     server_name: string|null,
     *     probed: bool,
     *     cpu_cores: int|null,
     *     memory_total_bytes: int|null,
     *     memory_available_bytes: int|null,
     *     gpus: list<array{index: int, name: string, memory_total_mib: int|null, memory_used_mib: int|null, memory_free_mib: int|null, utilization_percent: int|null, temperature_c: int|null}>,
     *     error: string|null
     * }
     */
    public function probeHostCapabilities(): array
    {
        $server = Server::find(0) ?? Server::query()->where('ip', 'host.docker.internal')->first();

        if (! $server instanceof Server) {
            return [
                'server_id' => null,
                'server_name' => null,
                'probed' => false,
                'cpu_cores' => null,
                'memory_total_bytes' => null,
                'memory_available_bytes' => null,
                'gpus' => [],
                'error' => 'Serveur hôte DevForge introuvable.',
            ];
        }

        try {
            $raw = instant_remote_process([
                'nproc 2>/dev/null || echo 0',
                'echo ---',
                'awk \'/MemTotal:/{t=$2} /MemAvailable:/{a=$2} END{print (t+0)*1024" "(a+0)*1024}\' /proc/meminfo 2>/dev/null || echo \'0 0\'',
                'echo ---',
                'nvidia-smi --query-gpu=index,name,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu --format=csv,noheader,nounits 2>/dev/null || true',
            ], $server, false, false, 12);

            $parts = preg_split('/\n---\n/', trim((string) $raw)) ?: [];
            $cpuCores = isset($parts[0]) ? (int) trim($parts[0]) : null;
            $memParts = isset($parts[1]) ? preg_split('/\s+/', trim($parts[1])) : [];
            $memTotal = isset($memParts[0]) && is_numeric($memParts[0]) ? (int) $memParts[0] : null;
            $memAvail = isset($memParts[1]) && is_numeric($memParts[1]) ? (int) $memParts[1] : null;
            $gpus = $this->parseNvidiaSmi(isset($parts[2]) ? trim($parts[2]) : '');

            return [
                'server_id' => $server->id,
                'server_name' => $server->name,
                'probed' => true,
                'cpu_cores' => $cpuCores > 0 ? $cpuCores : null,
                'memory_total_bytes' => $memTotal > 0 ? $memTotal : null,
                'memory_available_bytes' => $memAvail > 0 ? $memAvail : null,
                'gpus' => $gpus,
                'error' => null,
            ];
        } catch (Throwable $e) {
            return [
                'server_id' => $server->id,
                'server_name' => $server->name,
                'probed' => false,
                'cpu_cores' => null,
                'memory_total_bytes' => null,
                'memory_available_bytes' => null,
                'gpus' => [],
                'error' => $e->getMessage(),
            ];
        }
    }

    /**
     * @return list<array{index: int, name: string, memory_total_mib: int|null, memory_used_mib: int|null, memory_free_mib: int|null, utilization_percent: int|null, temperature_c: int|null}>
     */
    private function parseNvidiaSmi(string $csv): array
    {
        if ($csv === '') {
            return [];
        }

        $gpus = [];
        foreach (preg_split('/\r?\n/', $csv) ?: [] as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }

            $cols = array_map('trim', explode(',', $line));
            if (count($cols) < 2) {
                continue;
            }

            $gpus[] = [
                'index' => (int) ($cols[0] ?? 0),
                'name' => (string) ($cols[1] ?? 'GPU'),
                'memory_total_mib' => isset($cols[2]) && is_numeric($cols[2]) ? (int) $cols[2] : null,
                'memory_used_mib' => isset($cols[3]) && is_numeric($cols[3]) ? (int) $cols[3] : null,
                'memory_free_mib' => isset($cols[4]) && is_numeric($cols[4]) ? (int) $cols[4] : null,
                'utilization_percent' => isset($cols[5]) && is_numeric($cols[5]) ? (int) $cols[5] : null,
                'temperature_c' => isset($cols[6]) && is_numeric($cols[6]) ? (int) $cols[6] : null,
            ];
        }

        return $gpus;
    }
}
