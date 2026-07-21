<?php

namespace App\Services\DevForge\Agent\Tool;

use App\Models\AiAgent;
use App\Models\Application;
use App\Models\Team;
use App\Services\DevForge\Application\ApplicationSourceService;

class ApplicationSourceWritePreview
{
    public function __construct(
        private readonly ApplicationSourceService $sourceService,
    ) {}

    /**
     * @return array{
     *     path: string,
     *     is_new_file: bool,
     *     lines_added: int,
     *     lines_removed: int,
     *     diff: string,
     *     read_error?: string
     * }|null
     */
    public function build(
        Team $team,
        ?AiAgent $agent,
        ?string $applicationUuid,
        ?string $assignedResourceUuid,
        string $path,
        string $newContent,
    ): ?array {
        $path = trim($path);
        if ($path === '') {
            return null;
        }

        $application = $this->resolveApplication($team, $agent, $applicationUuid, $assignedResourceUuid);
        if ($application === null) {
            return [
                ...TextUnifiedDiff::preview($path, null, $newContent),
                'read_error' => 'Application introuvable pour prévisualiser le diff.',
            ];
        }

        try {
            $current = $this->sourceService->readFile($team, $application, $path);

            return TextUnifiedDiff::preview(
                $path,
                (string) ($current['content'] ?? ''),
                $newContent,
            );
        } catch (\Throwable $exception) {
            return [
                ...TextUnifiedDiff::preview($path, null, $newContent),
                'read_error' => mb_substr($exception->getMessage(), 0, 240),
            ];
        }
    }

    private function resolveApplication(
        Team $team,
        ?AiAgent $agent,
        ?string $applicationUuid,
        ?string $assignedResourceUuid,
    ): ?Application {
        $uuid = trim((string) ($applicationUuid ?? ''));
        if ($uuid === '' && is_string($assignedResourceUuid) && $assignedResourceUuid !== '') {
            $uuid = $assignedResourceUuid;
        }
        if ($uuid === '' && $agent !== null && is_string($agent->resource_uuid) && $agent->resource_uuid !== '') {
            $uuid = $agent->resource_uuid;
        }

        if ($uuid === '') {
            return null;
        }

        try {
            return $this->sourceService->applicationForTeam($team, $uuid);
        } catch (\Throwable) {
            return null;
        }
    }
}
