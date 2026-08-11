<?php

namespace App\Services\DevForge\Docker;

use App\Models\Application;
use App\Models\Service;
use App\Models\ServiceApplication;
use App\Models\Team;
use App\Services\DevForge\Agent\Tool\AgentServerExecutor;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DockerImageParser;
use Illuminate\Support\Facades\Http;

/**
 * Compare une image Docker configurée / en cours avec le registry (Docker Hub, Quay…).
 */
class DockerImageUpdateChecker
{
    public function __construct(
        private readonly CoreResourceCatalog $catalog,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function check(
        Team $team,
        ?string $applicationUuid = null,
        ?string $image = null,
        bool $inspectRunning = true,
        ?string $serviceUuid = null,
    ): array {
        if (is_string($serviceUuid) && $serviceUuid !== '') {
            return $this->checkService($team, $serviceUuid, $inspectRunning);
        }

        $application = null;
        if (is_string($applicationUuid) && $applicationUuid !== '') {
            $resource = $this->catalog->find($team, 'applications', $applicationUuid);
            if (! $resource instanceof Application) {
                return ['error' => "Application {$applicationUuid} introuvable."];
            }
            $application = $resource;
        }

        $resolved = $this->resolveConfiguredImage($application, $image);
        if (isset($resolved['error'])) {
            return $resolved;
        }

        /** @var string $configuredImage */
        $configuredImage = $resolved['configured_image'];
        /** @var string $repository */
        $repository = $resolved['repository'];
        /** @var string $configuredTag */
        $configuredTag = $resolved['configured_tag'];
        /** @var string $registry */
        $registry = $resolved['registry'];

        $remote = $this->fetchRemoteTags($repository, $registry);
        if (isset($remote['error'])) {
            return [
                'ok' => false,
                'application_uuid' => $application?->uuid,
                'build_pack' => $application?->build_pack,
                'configured_image' => $configuredImage,
                'configured_tag' => $configuredTag,
                'registry' => $registry,
                'error' => $remote['error'],
                'hint' => $remote['hint'] ?? null,
            ];
        }

        /** @var list<array{name: string, digest?: string|null}> $tags */
        $tags = $remote['tags'];
        $configuredDigest = $this->digestForTag($tags, $configuredTag);
        $latestSemver = $this->latestSemanticTag($tags);
        $latestDigest = $this->digestForTag($tags, 'latest')
            ?? ($latestSemver !== null ? $this->digestForTag($tags, $latestSemver) : null);
        $targetDigest = $configuredDigest ?? $latestDigest;

        $running = null;
        if ($inspectRunning && $application !== null) {
            $running = $this->inspectRunningImage($team, $application);
        }

        $comparison = $this->compare(
            configuredTag: $configuredTag,
            configuredDigest: $configuredDigest,
            latestSemver: $latestSemver,
            latestDigest: $latestDigest,
            targetDigest: $targetDigest,
            runningDigest: is_string($running['digest'] ?? null) ? $running['digest'] : null,
        );

        return [
            'ok' => true,
            'application_uuid' => $application?->uuid,
            'application_name' => $application?->name,
            'build_pack' => $application?->build_pack,
            'configured_image' => $configuredImage,
            'configured_tag' => $configuredTag,
            'configured_digest' => $configuredDigest,
            'target_digest' => $targetDigest,
            'latest_tag' => $latestSemver,
            'latest_image' => $latestSemver !== null ? $repository.':'.$latestSemver : null,
            'latest_digest' => $latestDigest,
            'registry' => $registry,
            'up_to_date' => $comparison['up_to_date'],
            'comparison' => $comparison['mode'],
            'update_available' => $comparison['update_available'],
            'notes' => $comparison['notes'],
            'running' => $running,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function checkService(Team $team, string $serviceUuid, bool $inspectRunning = true): array
    {
        $resource = $this->catalog->find($team, 'services', $serviceUuid);
        if (! $resource instanceof Service) {
            return ['error' => "Service {$serviceUuid} introuvable."];
        }

        $service = $resource->loadMissing('applications');
        $images = [];
        $anyUpdate = false;
        $anyOk = false;

        foreach ($service->applications as $serviceApplication) {
            if (! $serviceApplication instanceof ServiceApplication) {
                continue;
            }

            $imageRef = trim((string) ($serviceApplication->image ?? ''));
            if ($imageRef === '') {
                continue;
            }

            $resolved = $this->resolveConfiguredImage(null, $imageRef);
            if (isset($resolved['error'])) {
                $images[] = [
                    'service_application_uuid' => $serviceApplication->uuid,
                    'service_application_name' => $serviceApplication->name,
                    'ok' => false,
                    'error' => $resolved['error'],
                ];

                continue;
            }

            /** @var string $configuredImage */
            $configuredImage = $resolved['configured_image'];
            /** @var string $repository */
            $repository = $resolved['repository'];
            /** @var string $configuredTag */
            $configuredTag = $resolved['configured_tag'];
            /** @var string $registry */
            $registry = $resolved['registry'];

            $remote = $this->fetchRemoteTags($repository, $registry);
            if (isset($remote['error'])) {
                $images[] = [
                    'service_application_uuid' => $serviceApplication->uuid,
                    'service_application_name' => $serviceApplication->name,
                    'ok' => false,
                    'configured_image' => $configuredImage,
                    'configured_tag' => $configuredTag,
                    'registry' => $registry,
                    'error' => $remote['error'],
                    'hint' => $remote['hint'] ?? null,
                ];

                continue;
            }

            /** @var list<array{name: string, digest?: string|null}> $tags */
            $tags = $remote['tags'];
            $configuredDigest = $this->digestForTag($tags, $configuredTag);
            $latestSemver = $this->latestSemanticTag($tags);
            $latestDigest = $this->digestForTag($tags, 'latest')
                ?? ($latestSemver !== null ? $this->digestForTag($tags, $latestSemver) : null);
            $targetDigest = $configuredDigest ?? $latestDigest;

            $running = null;
            if ($inspectRunning) {
                $running = $this->inspectRunningServiceApplication($team, $service, $serviceApplication);
            }

            $comparison = $this->compare(
                configuredTag: $configuredTag,
                configuredDigest: $configuredDigest,
                latestSemver: $latestSemver,
                latestDigest: $latestDigest,
                targetDigest: $targetDigest,
                runningDigest: is_string($running['digest'] ?? null) ? $running['digest'] : null,
            );

            $entry = [
                'service_application_uuid' => $serviceApplication->uuid,
                'service_application_name' => $serviceApplication->name,
                'ok' => true,
                'configured_image' => $configuredImage,
                'configured_tag' => $configuredTag,
                'configured_digest' => $configuredDigest,
                'target_digest' => $targetDigest,
                'latest_tag' => $latestSemver,
                'latest_digest' => $latestDigest,
                'registry' => $registry,
                'up_to_date' => $comparison['up_to_date'],
                'comparison' => $comparison['mode'],
                'update_available' => $comparison['update_available'],
                'notes' => $comparison['notes'],
                'running' => $running,
            ];
            $images[] = $entry;
            $anyOk = true;
            if ($comparison['update_available'] === true && $comparison['mode'] === 'running_digest') {
                $anyUpdate = true;
            }
        }

        if ($images === []) {
            return [
                'ok' => false,
                'service_uuid' => $service->uuid,
                'service_name' => $service->name,
                'error' => 'Aucune image ServiceApplication à vérifier.',
            ];
        }

        return [
            'ok' => $anyOk,
            'service_uuid' => $service->uuid,
            'service_name' => $service->name,
            'images' => $images,
            'update_available' => $anyUpdate,
            'comparison' => $anyUpdate ? 'running_digest' : null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function resolveConfiguredImage(?Application $application, ?string $image): array
    {
        $raw = is_string($image) && trim($image) !== '' ? trim($image) : null;

        if ($raw === null && $application !== null) {
            $name = trim((string) ($application->docker_registry_image_name ?? ''));
            $tag = trim((string) ($application->docker_registry_image_tag ?? ''));
            if ($name !== '') {
                $raw = $tag !== '' ? "{$name}:{$tag}" : $name;
            }
        }

        if ($raw === null || $raw === '') {
            $buildPack = (string) ($application?->build_pack ?? '');
            if (in_array($buildPack, ['dockerfile', 'nixpacks', 'railpack', 'dockercompose', 'static'], true)) {
                return [
                    'error' => 'Cette application est construite depuis le code (pas une image registry). '
                        .'Passe image=repo:tag pour d’autres images, ou utilise une app build_pack=dockerimage.',
                ];
            }

            return ['error' => 'Paramètre image, application_uuid (dockerimage) ou service_uuid requis.'];
        }

        $parser = (new DockerImageParser)->parse($raw);
        $repository = $parser->getFullImageNameWithoutTag();
        $tag = $parser->getTag() ?: 'latest';

        return [
            'configured_image' => $repository.':'.$tag,
            'repository' => $repository,
            'configured_tag' => $tag,
            'registry' => $this->detectRegistry($repository),
        ];
    }

    private function detectRegistry(string $repository): string
    {
        if (str_starts_with($repository, 'ghcr.io/')) {
            return 'ghcr';
        }
        if (str_starts_with($repository, 'quay.io/')) {
            return 'quay';
        }
        if (str_starts_with($repository, 'lscr.io/')) {
            return 'lscr';
        }
        if (str_contains(explode('/', $repository)[0] ?? '', '.')) {
            return 'custom';
        }

        return 'dockerhub';
    }

    /**
     * @return array{tags?: list<array{name: string, digest?: string|null}>, error?: string, hint?: string}
     */
    private function fetchRemoteTags(string $repository, string $registry): array
    {
        return match ($registry) {
            'dockerhub', 'lscr' => $this->fetchDockerHubTags($repository),
            'quay' => $this->fetchQuayTags($repository),
            'ghcr' => [
                'error' => 'GHCR nécessite une authentification pour lister les tags.',
                'hint' => 'Passe une image Docker Hub, ou inspecte le digest running via docker.',
            ],
            default => [
                'error' => "Registry non supporté pour la comparaison automatique ({$registry}).",
                'hint' => 'Docker Hub et Quay sont supportés pour l’instant.',
            ],
        };
    }

    /**
     * @return array{tags?: list<array{name: string, digest?: string|null}>, error?: string}
     */
    private function fetchDockerHubTags(string $repository): array
    {
        $cleanRepo = str_replace(['index.docker.io/', 'docker.io/', 'lscr.io/'], '', $repository);
        if (! str_contains($cleanRepo, '/')) {
            $cleanRepo = "library/{$cleanRepo}";
        }

        try {
            $response = Http::timeout(12)->get("https://hub.docker.com/v2/repositories/{$cleanRepo}/tags", [
                'page_size' => 100,
                'ordering' => 'last_updated',
            ]);
        } catch (\Throwable $e) {
            return ['error' => 'Docker Hub inaccessible: '.$e->getMessage()];
        }

        if (! $response->successful()) {
            return ['error' => "Docker Hub a renvoyé HTTP {$response->status()} pour {$cleanRepo}."];
        }

        $results = $response->json('results') ?? [];
        if (! is_array($results) || $results === []) {
            return ['error' => "Aucun tag trouvé pour {$cleanRepo}."];
        }

        $tags = [];
        foreach ($results as $row) {
            if (! is_array($row) || ! is_string($row['name'] ?? null)) {
                continue;
            }
            $digest = $row['digest'] ?? null;
            if (! is_string($digest) && is_array($row['images'][0] ?? null)) {
                $digest = $row['images'][0]['digest'] ?? null;
            }
            $tags[] = [
                'name' => $row['name'],
                'digest' => is_string($digest) ? $digest : null,
            ];
        }

        return ['tags' => $tags];
    }

    /**
     * @return array{tags?: list<array{name: string, digest?: string|null}>, error?: string}
     */
    private function fetchQuayTags(string $repository): array
    {
        $cleanRepo = str_replace('quay.io/', '', $repository);

        try {
            $response = Http::timeout(12)->get("https://quay.io/api/v1/repository/{$cleanRepo}/tag/", [
                'limit' => 100,
            ]);
        } catch (\Throwable $e) {
            return ['error' => 'Quay inaccessible: '.$e->getMessage()];
        }

        if (! $response->successful()) {
            return ['error' => "Quay a renvoyé HTTP {$response->status()}."];
        }

        $rows = $response->json('tags') ?? [];
        if (! is_array($rows) || $rows === []) {
            return ['error' => 'Aucun tag Quay trouvé.'];
        }

        $tags = [];
        foreach ($rows as $row) {
            if (! is_array($row) || ! is_string($row['name'] ?? null)) {
                continue;
            }
            $tags[] = [
                'name' => $row['name'],
                'digest' => is_string($row['manifest_digest'] ?? null) ? $row['manifest_digest'] : null,
            ];
        }

        return ['tags' => $tags];
    }

    /**
     * @param  list<array{name: string, digest?: string|null}>  $tags
     */
    private function digestForTag(array $tags, string $tag): ?string
    {
        foreach ($tags as $entry) {
            if (($entry['name'] ?? null) === $tag && is_string($entry['digest'] ?? null) && $entry['digest'] !== '') {
                return $entry['digest'];
            }
        }

        return null;
    }

    /**
     * @param  list<array{name: string, digest?: string|null}>  $tags
     */
    private function latestSemanticTag(array $tags): ?string
    {
        $versions = [];
        foreach ($tags as $entry) {
            $name = (string) ($entry['name'] ?? '');
            if (preg_match('/^v?\d+\.\d+(\.\d+)?$/', $name) !== 1) {
                continue;
            }
            if (preg_match('/-(rc|beta|alpha|dev|pre)/i', $name) === 1) {
                continue;
            }
            $versions[] = ltrim($name, 'v');
        }

        if ($versions === []) {
            return null;
        }

        usort($versions, fn (string $a, string $b): int => version_compare($b, $a));

        return $versions[0];
    }

    /**
     * @return array{up_to_date: bool|null, update_available: bool|null, mode: string, notes: list<string>}
     */
    private function compare(
        string $configuredTag,
        ?string $configuredDigest,
        ?string $latestSemver,
        ?string $latestDigest,
        ?string $targetDigest,
        ?string $runningDigest,
    ): array {
        $notes = [];

        if ($runningDigest !== null && $targetDigest !== null) {
            $match = hash_equals($runningDigest, $targetDigest);
            $notes[] = $match
                ? "Le digest du conteneur running correspond au digest registry du tag « {$configuredTag} »."
                : "Le digest running diffère du digest registry du tag « {$configuredTag} » — mise à jour disponible.";

            return [
                'up_to_date' => $match,
                'update_available' => ! $match,
                'mode' => 'running_digest',
                'notes' => $notes,
            ];
        }

        if ($configuredTag === 'latest' || $configuredTag === 'stable' || $configuredTag === 'lts') {
            if ($configuredDigest !== null && $latestDigest !== null && $configuredTag === 'latest') {
                $notes[] = 'Tag flottant « latest » : la comparaison digest registry est limitée sans inspect running.';
            }
            if ($latestSemver !== null) {
                $notes[] = "Tag flottant « {$configuredTag} » — dernière version semver vue sur le registry : {$latestSemver}.";
            } else {
                $notes[] = "Tag flottant « {$configuredTag} » — impossible de prouver up-to-date sans digest running.";
            }

            return [
                'up_to_date' => null,
                'update_available' => null,
                'mode' => 'floating_tag',
                'notes' => $notes,
            ];
        }

        if ($latestSemver !== null && preg_match('/^\d+\.\d+(\.\d+)?$/', $configuredTag) === 1) {
            $upToDate = version_compare($configuredTag, $latestSemver, '>=');
            if (! $upToDate) {
                $notes[] = "Une version plus récente est disponible : {$latestSemver} (configurée : {$configuredTag}).";
            } else {
                $notes[] = "Tag configuré {$configuredTag} ≥ dernière semver registry {$latestSemver}.";
            }

            return [
                'up_to_date' => $upToDate,
                'update_available' => ! $upToDate,
                'mode' => 'semver',
                'notes' => $notes,
            ];
        }

        if ($configuredDigest !== null && $latestDigest !== null) {
            $match = hash_equals($configuredDigest, $latestDigest);
            $notes[] = $match
                ? 'Digest du tag configuré = digest latest.'
                : 'Digest du tag configuré ≠ digest latest.';

            return [
                'up_to_date' => $match,
                'update_available' => ! $match,
                'mode' => 'configured_digest',
                'notes' => $notes,
            ];
        }

        $notes[] = 'Comparaison inconclusive (pas de semver / digest utilisable).';

        return [
            'up_to_date' => null,
            'update_available' => null,
            'mode' => 'unknown',
            'notes' => $notes,
        ];
    }

    /**
     * @return array{image?: string|null, digest?: string|null, error?: string, raw?: string}|null
     */
    private function inspectRunningImage(Team $team, Application $application): ?array
    {
        $executor = new AgentServerExecutor($team, $this->catalog);
        $serverResolution = $executor->resolveServerForApplication($application->uuid);
        if (! ($serverResolution['success'] ?? false)) {
            return ['error' => (string) ($serverResolution['error'] ?? 'Serveur introuvable.')];
        }

        $serverUuid = (string) $serverResolution['server_uuid'];
        $container = escapeshellarg($application->uuid);
        $format = '{{.Config.Image}}|{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}|{{.Image}}';
        $command = 'docker inspect --format '.escapeshellarg($format).' '.$container.' 2>/dev/null'
            .' || docker ps -a --filter '.escapeshellarg('name='.$application->uuid)
            .' --format '.escapeshellarg('{{.Image}}|{{.ID}}').' | head -1';

        $result = $executor->execOnServer($serverUuid, $command, 45);
        if (! ($result['success'] ?? false)) {
            return ['error' => (string) ($result['error'] ?? 'docker inspect a échoué.')];
        }

        return $this->parseInspectOutput(trim((string) ($result['output'] ?? '')));
    }

    /**
     * @return array{image?: string|null, digest?: string|null, error?: string, raw?: string}|null
     */
    private function inspectRunningServiceApplication(
        Team $team,
        Service $service,
        ServiceApplication $serviceApplication,
    ): ?array {
        $server = $service->server;
        if ($server === null) {
            return ['error' => 'Aucun serveur associé à ce service.'];
        }

        $containerName = $serviceApplication->name.'-'.$service->uuid;
        $format = '{{.Config.Image}}|{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}|{{.Image}}';
        $command = 'docker inspect --format '.escapeshellarg($format).' '.escapeshellarg($containerName).' 2>/dev/null'
            .' || docker ps -a --filter '.escapeshellarg('name='.$containerName)
            .' --format '.escapeshellarg('{{.Image}}|{{.ID}}').' | head -1';

        $executor = new AgentServerExecutor($team, $this->catalog);
        $result = $executor->execOnServer($server->uuid, $command, 45);
        if (! ($result['success'] ?? false)) {
            return ['error' => (string) ($result['error'] ?? 'docker inspect a échoué.')];
        }

        return $this->parseInspectOutput(trim((string) ($result['output'] ?? '')));
    }

    /**
     * @return array{image?: string|null, digest?: string|null, error?: string, raw?: string}
     */
    private function parseInspectOutput(string $output): array
    {
        if ($output === '') {
            return ['error' => 'Conteneur introuvable.'];
        }

        $parts = explode('|', $output);
        $imageRef = trim($parts[0] ?? '');
        $repoDigest = trim($parts[1] ?? '');
        $digest = null;
        if (str_contains($repoDigest, '@')) {
            $digest = substr($repoDigest, strrpos($repoDigest, '@') + 1) ?: null;
        }

        return [
            'image' => $imageRef !== '' ? $imageRef : null,
            'digest' => $digest,
            'raw' => mb_substr($output, 0, 300),
        ];
    }
}
