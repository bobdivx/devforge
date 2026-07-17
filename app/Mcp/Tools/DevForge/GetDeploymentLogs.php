<?php

namespace App\Mcp\Tools\DevForge;

use App\Mcp\Concerns\BuildsResponse;
use App\Mcp\Concerns\ResolvesRepairActions;
use App\Mcp\Concerns\ResolvesTeam;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tool;

#[Name('get_deployment_logs')]
#[Description('List recent deployments and optional log lines for a Coolify application.')]
class GetDeploymentLogs extends Tool
{
    use BuildsResponse;
    use ResolvesRepairActions;
    use ResolvesTeam;

    public function handle(Request $request): Response
    {
        if ($error = $this->ensureAbility($request, 'read')) {
            return $error;
        }

        $teamId = $this->resolveTeamId($request);
        if (is_null($teamId)) {
            return Response::error('Invalid token.');
        }

        $applicationUuid = $request->get('application_uuid');
        $deploymentUuid = $request->get('deployment_uuid');
        $limit = max(1, min(20, (int) ($request->get('limit') ?? 3)));
        $logLines = max(1, min(120, (int) ($request->get('log_lines') ?? 80)));

        $result = $this->repairActions($teamId)->getDeploymentLogs(
            is_string($applicationUuid) ? $applicationUuid : null,
            $limit,
            is_string($deploymentUuid) ? $deploymentUuid : null,
            $logLines,
        );

        if (isset($result['error'])) {
            return Response::error((string) $result['error']);
        }

        return $this->respond($result);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'application_uuid' => $schema->string()->description('Application UUID (optional if deployment_uuid is set).'),
            'deployment_uuid' => $schema->string()->description('Deployment UUID to attach log lines for.'),
            'limit' => $schema->integer()->description('Max deployments to list (1-20).'),
            'log_lines' => $schema->integer()->description('Log lines to include when deployment_uuid is set (1-120).'),
        ];
    }
}
