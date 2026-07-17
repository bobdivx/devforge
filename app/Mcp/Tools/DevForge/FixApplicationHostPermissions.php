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

#[Name('fix_application_host_permissions')]
#[Description('Fix host directory permissions for an application (chown/chmod) and optionally redeploy.')]
class FixApplicationHostPermissions extends Tool
{
    use BuildsResponse;
    use ResolvesRepairActions;
    use ResolvesTeam;

    public function handle(Request $request): Response
    {
        if ($error = $this->ensureAbility($request, 'write')) {
            return $error;
        }

        $teamId = $this->resolveTeamId($request);
        if (is_null($teamId)) {
            return Response::error('Invalid token.');
        }

        $applicationUuid = $request->get('application_uuid');
        if (! is_string($applicationUuid) || $applicationUuid === '') {
            return Response::error('application_uuid argument is required.');
        }

        $pathHint = $request->get('path_hint');
        $redeploy = $request->get('redeploy');
        $reason = $request->get('reason');

        $result = $this->repairActions($teamId)->fixApplicationHostPermissions(
            $applicationUuid,
            is_string($pathHint) ? $pathHint : null,
            $redeploy === null ? true : (bool) $redeploy,
            is_string($reason) ? $reason : 'MCP DevForge: Permission denied host',
        );

        if (isset($result['error'])) {
            return Response::error((string) $result['error']);
        }

        return $this->respond($result, [
            ['tool' => 'get_deployment_logs', 'args' => ['application_uuid' => $applicationUuid], 'hint' => 'Check deploy status'],
        ]);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'application_uuid' => $schema->string()->description('Application UUID.')->required(),
            'path_hint' => $schema->string()->description('Optional host path hint from logs.'),
            'redeploy' => $schema->boolean()->description('Redeploy after fix (default true).'),
            'reason' => $schema->string()->description('Audit reason.'),
        ];
    }
}
