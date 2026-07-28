<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Agent\AgentLayeredInstructions;
use App\Services\DevForge\Core\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AgentInstructionsController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly AgentLayeredInstructions $instructions,
    ) {}

    public function show(Request $request): JsonResponse
    {
        $user = $this->user($request);
        $team = $this->team($request, $user);
        $resourceUuid = is_string($request->query('resource_uuid')) ? $request->query('resource_uuid') : null;

        $layers = $this->instructions->load($team, $user->email, $resourceUuid);

        return response()->json([
            'data' => $layers,
            'meta' => [
                'resource_uuid' => $resourceUuid,
                'user_email' => $user->email,
            ],
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $user = $this->user($request);
        $team = $this->team($request, $user);

        $validated = $request->validate([
            'org' => ['nullable', 'string', 'max:20000'],
            'personal' => ['nullable', 'string', 'max:20000'],
            'project' => ['nullable', 'string', 'max:20000'],
            'resource_uuid' => ['nullable', 'string', 'max:64'],
        ]);

        if (array_key_exists('org', $validated) && $validated['org'] !== null) {
            $this->authorizeTeamAdmin($user, $team);
            $this->instructions->setOrg($team, $validated['org']);
        }

        if (array_key_exists('personal', $validated) && $validated['personal'] !== null) {
            $this->instructions->setPersonal($team, (string) $user->email, $validated['personal']);
        }

        if (array_key_exists('project', $validated) && $validated['project'] !== null) {
            $resourceUuid = trim((string) ($validated['resource_uuid'] ?? ''));
            abort_unless($resourceUuid !== '', 422, 'resource_uuid requis pour les instructions projet.');
            $this->instructions->setProject($team, $resourceUuid, $validated['project']);
        }

        $layers = $this->instructions->load(
            $team,
            $user->email,
            $validated['resource_uuid'] ?? null,
        );

        return response()->json(['data' => $layers]);
    }

    private function authorizeTeamAdmin(User $user, Team $team): void
    {
        abort_unless(
            $user->isAdminOfTeam((int) $team->id),
            403,
            'Seuls les admins peuvent modifier les instructions organisation.',
        );
    }

    private function user(Request $request): User
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return $user;
    }

    private function team(Request $request, User $user): Team
    {
        return $this->currentTeamContext->resolve($user);
    }
}
