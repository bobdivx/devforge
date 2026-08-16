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

#[Name('update_application_git_branch')]
#[Description('Update the DevForge application git branch and optionally redeploy.')]
class UpdateApplicationGitBranch extends Tool
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
        $gitBranch = $request->get('git_branch');
        if (! is_string($applicationUuid) || $applicationUuid === '') {
            return Response::error('application_uuid argument is required.');
        }
        if (! is_string($gitBranch) || trim($gitBranch) === '') {
            return Response::error('git_branch argument is required.');
        }

        $redeploy = $request->get('redeploy');
        $reason = $request->get('reason');

        $result = $this->repairActions($teamId)->updateApplicationGitBranch(
            $applicationUuid,
            $gitBranch,
            $redeploy === null ? true : (bool) $redeploy,
            is_string($reason) ? $reason : 'MCP DevForge: update git branch',
        );

        if (isset($result['error'])) {
            return Response::error((string) $result['error']);
        }

        return $this->respond($result);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'application_uuid' => $schema->string()->description('Application UUID.')->required(),
            'git_branch' => $schema->string()->description('Exact remote branch name.')->required(),
            'redeploy' => $schema->boolean()->description('Redeploy after update (default true).'),
            'reason' => $schema->string()->description('Audit reason.'),
        ];
    }
}
