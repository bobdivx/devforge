<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgentRun;
use App\Models\Team;
use App\Services\DevForge\Agent\Tool\AgentGithubTools;
use App\Services\DevForge\Agent\Tool\AgentServerExecutor;
use App\Services\DevForge\Application\ApplicationSourceService;
use App\Services\DevForge\Core\CoreResourceCatalog;
use Illuminate\Support\Str;

/**
 * Snapshots avant mutations fichiers (inspiration Hermes checkpoints /rollback).
 * Stockés dans metadata.run.checkpoints — pas de table dédiée.
 */
class AgentCheckpointService
{
    public const MAX_PER_RUN = 40;

    public const MAX_CONTENT_CHARS = 200_000;

    /**
     * @param  array<string, mixed>  $target
     * @return array{id: string, created_at: string, kind: string, target: array<string, mixed>, content: string|null, existed: bool}
     */
    public function capture(
        AiAgentRun $run,
        string $kind,
        array $target,
        ?string $previousContent,
        bool $existed = true,
    ): array {
        $id = 'cp_'.Str::lower(Str::random(10));
        $content = $previousContent;
        if (is_string($content) && mb_strlen($content) > self::MAX_CONTENT_CHARS) {
            $content = mb_substr($content, 0, self::MAX_CONTENT_CHARS);
        }

        $entry = [
            'id' => $id,
            'created_at' => now()->toISOString(),
            'kind' => $kind,
            'target' => $target,
            'content' => $content,
            'existed' => $existed,
        ];

        $meta = is_array($run->metadata) ? $run->metadata : [];
        $list = is_array($meta['checkpoints'] ?? null) ? $meta['checkpoints'] : [];
        $list[] = $entry;
        if (count($list) > self::MAX_PER_RUN) {
            $list = array_slice($list, -self::MAX_PER_RUN);
        }
        $meta['checkpoints'] = $list;
        $run->metadata = $meta;
        $run->save();

        return $entry;
    }

    /**
     * @return array<string, mixed>
     */
    public function listForRun(AiAgentRun $run): array
    {
        $meta = is_array($run->metadata) ? $run->metadata : [];
        $list = is_array($meta['checkpoints'] ?? null) ? $meta['checkpoints'] : [];

        $summaries = array_map(static function (array $row): array {
            return [
                'id' => $row['id'] ?? null,
                'created_at' => $row['created_at'] ?? null,
                'kind' => $row['kind'] ?? null,
                'target' => $row['target'] ?? [],
                'existed' => (bool) ($row['existed'] ?? true),
                'content_chars' => is_string($row['content'] ?? null) ? mb_strlen($row['content']) : 0,
            ];
        }, $list);

        return [
            'count' => count($summaries),
            'checkpoints' => array_values($summaries),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function rollback(
        AiAgentRun $run,
        Team $team,
        string $checkpointId,
        CoreResourceCatalog $catalog,
        AgentGithubTools $githubTools,
        AgentServerExecutor $serverExecutor,
    ): array {
        $meta = is_array($run->metadata) ? $run->metadata : [];
        $list = is_array($meta['checkpoints'] ?? null) ? $meta['checkpoints'] : [];
        $entry = null;
        foreach ($list as $row) {
            if (($row['id'] ?? null) === $checkpointId) {
                $entry = $row;
                break;
            }
        }

        if ($entry === null) {
            return ['error' => "Checkpoint « {$checkpointId} » introuvable."];
        }

        $kind = (string) ($entry['kind'] ?? '');
        $target = is_array($entry['target'] ?? null) ? $entry['target'] : [];
        $content = $entry['content'] ?? null;
        $existed = (bool) ($entry['existed'] ?? true);

        if (! $existed || ! is_string($content)) {
            return [
                'error' => 'Impossible de restaurer : le fichier n’existait pas ou le contenu n’a pas été capturé.',
                'checkpoint_id' => $checkpointId,
                'hint' => 'Rollback manuel requis (fichier nouveau).',
            ];
        }

        return match ($kind) {
            'application_source' => $this->rollbackApplicationSource($team, $target, $content),
            'github_file' => $this->rollbackGithubFile($githubTools, $target, $content),
            'remote_file' => $this->rollbackRemoteFile($serverExecutor, $target, $content),
            default => ['error' => "Kind de checkpoint inconnu: {$kind}"],
        };
    }

    /**
     * @param  array<string, mixed>  $target
     * @return array<string, mixed>
     */
    private function rollbackApplicationSource(Team $team, array $target, string $content): array
    {
        $uuid = (string) ($target['application_uuid'] ?? '');
        $path = (string) ($target['path'] ?? '');
        if ($uuid === '' || $path === '') {
            return ['error' => 'target application_uuid/path manquant'];
        }

        try {
            $service = app(ApplicationSourceService::class);
            $application = $service->applicationForTeam($team, $uuid);
            $result = $service->writeFile(
                $team,
                $application,
                $path,
                $content,
                'chore(devforge): rollback checkpoint '.$path,
                isset($target['sha']) ? (string) $target['sha'] : null,
                ['mode' => 'direct', 'redeploy' => false],
            );

            return [
                'ok' => true,
                'kind' => 'application_source',
                'path' => $path,
                'result' => $result,
            ];
        } catch (\Throwable $e) {
            return ['error' => mb_substr($e->getMessage(), 0, 500)];
        }
    }

    /**
     * @param  array<string, mixed>  $target
     * @return array<string, mixed>
     */
    private function rollbackGithubFile(AgentGithubTools $githubTools, array $target, string $content): array
    {
        $appUuid = (string) ($target['github_app_uuid'] ?? '');
        $owner = (string) ($target['owner'] ?? '');
        $repo = (string) ($target['repo'] ?? '');
        $path = (string) ($target['path'] ?? '');
        $branch = isset($target['branch']) ? (string) $target['branch'] : null;

        if ($appUuid === '' || $owner === '' || $repo === '' || $path === '') {
            return ['error' => 'target github incomplet'];
        }

        try {
            $result = $githubTools->writeFile(
                $appUuid,
                $owner,
                $repo,
                $path,
                $content,
                'chore(devforge): rollback checkpoint '.$path,
                isset($target['sha']) ? (string) $target['sha'] : null,
                $branch,
            );

            return [
                'ok' => true,
                'kind' => 'github_file',
                'path' => $path,
                'result' => $result,
            ];
        } catch (\Throwable $e) {
            return ['error' => mb_substr($e->getMessage(), 0, 500)];
        }
    }

    /**
     * @param  array<string, mixed>  $target
     * @return array<string, mixed>
     */
    private function rollbackRemoteFile(AgentServerExecutor $serverExecutor, array $target, string $content): array
    {
        $serverUuid = (string) ($target['server_uuid'] ?? '');
        $path = (string) ($target['path'] ?? '');
        if ($serverUuid === '' || $path === '') {
            return ['error' => 'target server_uuid/path manquant'];
        }

        try {
            $result = $serverExecutor->writeRemoteFile($serverUuid, $path, $content);

            return [
                'ok' => true,
                'kind' => 'remote_file',
                'path' => $path,
                'result' => $result,
            ];
        } catch (\Throwable $e) {
            return ['error' => mb_substr($e->getMessage(), 0, 500)];
        }
    }
}
