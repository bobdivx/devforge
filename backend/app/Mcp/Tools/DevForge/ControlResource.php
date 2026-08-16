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

#[Name('control_resource')]
#[Description('Control a DevForge application. DevForge MCP v1 only allows action=deploy on type=applications.')]
class ControlResource extends Tool
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

        $uuid = $request->get('uuid');
        $type = $request->get('type') ?? 'applications';
        $action = $request->get('action');
        $reason = $request->get('reason');

        if (! is_string($uuid) || $uuid === '') {
            return Response::error('uuid argument is required.');
        }
        if (! is_string($action) || $action === '') {
            return Response::error('action argument is required.');
        }

        if ($type !== 'applications' || $action !== 'deploy') {
            return Response::error('DevForge MCP v1 only supports type=applications and action=deploy.');
        }

        $result = $this->repairActions($teamId)->deployApplication(
            $uuid,
            is_string($reason) && $reason !== '' ? $reason : 'MCP DevForge redeploy',
        );

        if (isset($result['error'])) {
            return Response::error((string) $result['error']);
        }

        return $this->respond($result, [
            ['tool' => 'get_deployment_logs', 'args' => ['application_uuid' => $uuid], 'hint' => 'Follow deployment'],
        ]);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'uuid' => $schema->string()->description('Application UUID.')->required(),
            'type' => $schema->string()->description('Must be applications.'),
            'action' => $schema->string()->description('Must be deploy.')->required(),
            'reason' => $schema->string()->description('Audit reason.'),
        ];
    }
}
