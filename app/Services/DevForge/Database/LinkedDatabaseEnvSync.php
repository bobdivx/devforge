<?php

namespace App\Services\DevForge\Database;

use App\Models\Application;
use App\Models\EnvironmentVariable;
use App\Models\StandaloneLibsql;
use Illuminate\Database\Eloquent\Model;
use Visus\Cuid2\Cuid2;

class LinkedDatabaseEnvSync
{
    public function __construct(
        private readonly LibsqlConnectionEnvSync $libsqlConnectionEnvSync,
    ) {}

    /**
     * @return array{updated_variables: int, applications: array<int, array{uuid: string, name: string}>, redeployments_queued: int}
     */
    public function syncLinkedApplications(Model $database, bool $redeployApplications = false): array
    {
        if ($database instanceof StandaloneLibsql) {
            return $this->libsqlConnectionEnvSync->syncLinkedApplications($database, $redeployApplications);
        }

        return $this->syncGenericLinkedApplications($database, $redeployApplications);
    }

    /**
     * @return array{updated_variables: int, applications: array<int, array{uuid: string, name: string}>, redeployments_queued: int}
     */
    private function syncGenericLinkedApplications(Model $database, bool $redeployApplications): array
    {
        $connectionUrl = (string) ($database->internal_db_url ?? '');
        if (blank($connectionUrl)) {
            return [
                'updated_variables' => 0,
                'applications' => [],
                'redeployments_queued' => 0,
            ];
        }

        $comment = LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX.$database->uuid;

        $variables = EnvironmentVariable::query()
            ->where('is_preview', false)
            ->where('comment', $comment)
            ->where('resourceable_type', Application::class)
            ->with('resourceable')
            ->get();

        $applications = [];
        $updated = 0;
        $redeployments = 0;

        foreach ($variables as $variable) {
            $variable->update(['value' => $connectionUrl]);
            $updated++;

            if ($variable->resourceable instanceof Application) {
                $applications[$variable->resourceable->uuid] = $variable->resourceable->name;

                if ($redeployApplications) {
                    $deploymentUuid = new Cuid2;
                    $result = queue_application_deployment(
                        application: $variable->resourceable,
                        deployment_uuid: $deploymentUuid,
                        force_rebuild: false,
                        restart_only: false,
                        is_api: true,
                        no_questions_asked: true,
                    );

                    if ($result['status'] !== 'skipped' && $result['status'] !== 'queue_full') {
                        $redeployments++;
                    }
                }
            }
        }

        return [
            'updated_variables' => $updated,
            'applications' => array_values(array_map(
                fn (string $uuid, string $name): array => ['uuid' => $uuid, 'name' => $name],
                array_keys($applications),
                array_values($applications),
            )),
            'redeployments_queued' => $redeployments,
        ];
    }
}
