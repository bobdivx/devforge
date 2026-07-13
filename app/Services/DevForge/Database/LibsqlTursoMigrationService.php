<?php

namespace App\Services\DevForge\Database;

use App\Models\Application;
use App\Models\EnvironmentVariable;
use App\Models\StandaloneLibsql;
use Illuminate\Support\Facades\Http;
use Symfony\Component\HttpKernel\Exception\HttpException;

class LibsqlTursoMigrationService
{
    public function __construct(
        private readonly LibsqlDatabaseTransferService $libsqlDatabaseTransferService,
    ) {}

    /**
     * @return array{available: bool, source_url: string|null, env_keys: array<int, string>}|null
     */
    public function candidate(Application $application): ?array
    {
        $source = $this->resolveRemoteSource($application);

        if ($source === null) {
            return null;
        }

        return [
            'available' => true,
            'source_url' => $this->maskUrl($source['database_url']),
            'env_keys' => $source['env_keys'],
        ];
    }

    /**
     * @return array{performed: bool, message: string}
     */
    public function migrate(Application $application, StandaloneLibsql $database): array
    {
        $source = $this->resolveRemoteSource($application);

        if ($source === null) {
            throw new HttpException(422, 'Aucune base Turso distante détectée dans les variables de l’application.');
        }

        $sql = $this->dumpRemote($source['https_url'], $source['auth_token']);
        $result = $this->libsqlDatabaseTransferService->import($database, $sql);

        return [
            'performed' => true,
            'message' => $result['message'],
        ];
    }

    /**
     * @return array{database_url: string, https_url: string, auth_token: string|null, env_keys: array<int, string>}|null
     */
    public function resolveRemoteSource(Application $application): ?array
    {
        $variables = $application->environment_variables()
            ->where('is_preview', false)
            ->get()
            ->keyBy('key');

        /** @var EnvironmentVariable|null $tursoUrlVariable */
        $tursoUrlVariable = $variables->get('TURSO_DATABASE_URL');
        /** @var EnvironmentVariable|null $tursoTokenVariable */
        $tursoTokenVariable = $variables->get('TURSO_AUTH_TOKEN');
        /** @var EnvironmentVariable|null $libsqlUrlVariable */
        $libsqlUrlVariable = $variables->get('LIBSQL_URL');

        $databaseUrl = $this->plaintextValue($tursoUrlVariable)
            ?? $this->extractUrlFromLibsqlUrl($this->plaintextValue($libsqlUrlVariable));

        if ($databaseUrl === null || $this->isLocalDevForgeLibsqlUrl($databaseUrl)) {
            return null;
        }

        if ($this->isDevForgeLinkedVariable($tursoUrlVariable)
            || $this->isDevForgeLinkedVariable($tursoTokenVariable)
            || $this->isDevForgeLinkedVariable($libsqlUrlVariable)) {
            return null;
        }

        $authToken = $this->plaintextValue($tursoTokenVariable)
            ?? $this->extractTokenFromLibsqlUrl($this->plaintextValue($libsqlUrlVariable));

        $envKeys = [];
        if ($tursoUrlVariable !== null || $tursoTokenVariable !== null) {
            if ($tursoUrlVariable !== null) {
                $envKeys[] = 'TURSO_DATABASE_URL';
            }
            if ($tursoTokenVariable !== null) {
                $envKeys[] = 'TURSO_AUTH_TOKEN';
            }
        } elseif ($libsqlUrlVariable !== null) {
            $envKeys[] = 'LIBSQL_URL';
        }

        return [
            'database_url' => $databaseUrl,
            'https_url' => $this->toHttpsBaseUrl($databaseUrl),
            'auth_token' => $authToken,
            'env_keys' => $envKeys,
        ];
    }

    public function dumpRemote(string $httpsUrl, ?string $authToken): string
    {
        $request = Http::timeout(120)
            ->accept('application/sql, text/plain, */*');

        if (filled($authToken)) {
            $request = $request->withToken($authToken);
        }

        $response = $request->get(rtrim($httpsUrl, '/').'/dump');

        if (! $response->successful()) {
            throw new HttpException(
                422,
                'Impossible d’exporter la base Turso distante. Vérifiez l’URL et le jeton d’authentification.',
            );
        }

        $sql = trim($response->body());

        if ($sql === '') {
            throw new HttpException(422, 'L’export Turso est vide.');
        }

        if (! str($sql)->lower()->contains(['create', 'insert', 'pragma', 'begin'])) {
            throw new HttpException(422, 'La réponse Turso ne ressemble pas à un export SQLite valide.');
        }

        return $sql."\n";
    }

    private function plaintextValue(?EnvironmentVariable $variable): ?string
    {
        if ($variable === null) {
            return null;
        }

        $value = trim((string) $variable->value);

        return $value === '' ? null : $value;
    }

    private function isDevForgeLinkedVariable(?EnvironmentVariable $variable): bool
    {
        return $variable !== null
            && str((string) $variable->comment)->startsWith(LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX);
    }

    private function isLocalDevForgeLibsqlUrl(string $url): bool
    {
        if (! preg_match('#^libsql://([^/:]+):8080/?$#', $url, $matches)) {
            return false;
        }

        $host = $matches[1];

        return strlen($host) === 24 && ctype_alnum($host);
    }

    private function extractUrlFromLibsqlUrl(?string $libsqlUrl): ?string
    {
        if ($libsqlUrl === null) {
            return null;
        }

        $parsed = parse_url($libsqlUrl);
        $host = $parsed['host'] ?? null;

        if ($host === null) {
            return null;
        }

        $port = $parsed['port'] ?? null;
        $path = $parsed['path'] ?? '';

        if ($port !== null) {
            return 'libsql://'.$host.':'.$port.$path;
        }

        return 'libsql://'.$host.$path;
    }

    private function extractTokenFromLibsqlUrl(?string $libsqlUrl): ?string
    {
        if ($libsqlUrl === null) {
            return null;
        }

        $parsed = parse_url($libsqlUrl);
        $password = $parsed['pass'] ?? null;

        return filled($password) ? rawurldecode((string) $password) : null;
    }

    private function toHttpsBaseUrl(string $url): string
    {
        if (str_starts_with($url, 'https://')) {
            return rtrim($url, '/');
        }

        if (str_starts_with($url, 'http://')) {
            return rtrim($url, '/');
        }

        if (! str_starts_with($url, 'libsql://')) {
            throw new HttpException(422, 'URL libSQL non supportée pour la migration.');
        }

        $parsed = parse_url($url);
        $host = $parsed['host'] ?? null;

        if ($host === null) {
            throw new HttpException(422, 'URL libSQL invalide pour la migration.');
        }

        $port = isset($parsed['port']) ? ':'.$parsed['port'] : '';
        $path = rtrim($parsed['path'] ?? '', '/');

        return 'https://'.$host.$port.$path;
    }

    private function maskUrl(string $url): string
    {
        $parsed = parse_url($url);

        if ($parsed === false) {
            return $url;
        }

        $host = $parsed['host'] ?? '';
        $port = isset($parsed['port']) ? ':'.$parsed['port'] : '';
        $path = $parsed['path'] ?? '';

        return 'libsql://'.$host.$port.$path;
    }
}
