<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Http\Requests\DevForge\TeamInvitationRequest;
use App\Http\Requests\DevForge\UpdateCurrentTeamRequest;
use App\Http\Requests\DevForge\UpdateTeamMemberRequest;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\ResourceData;
use App\Services\DevForge\Team\TeamInvitationManager;
use App\Services\DevForge\Team\TeamMemberManager;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class TeamReadController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly TeamMemberManager $teamMemberManager,
        private readonly TeamInvitationManager $teamInvitationManager,
    ) {}

    public function index(Request $request, ResourceData $resourceData): JsonResponse
    {
        $this->authorize('viewAny', Team::class);

        return response()->json([
            'data' => $request->user()
                ->teams()
                ->orderBy('teams.name')
                ->get()
                ->map(fn (Team $team): array => $resourceData->team($team))
                ->all(),
        ]);
    }

    public function current(Request $request, ResourceData $resourceData): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());
        $this->authorize('view', $team);

        return response()->json([
            'data' => $resourceData->team(
                $request->user()->teams()->whereKey($team->id)->firstOrFail(),
            ),
        ]);
    }

    public function update(UpdateCurrentTeamRequest $request, ResourceData $resourceData): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());
        $this->authorize('update', $team);

        $payload = $request->payload();
        abort_if($payload === [], 422, 'At least one of name or description must be provided.');

        $team->fill($payload);
        $team->save();
        refreshSession();

        return response()->json([
            'data' => $resourceData->team(
                $request->user()->teams()->whereKey($team->id)->firstOrFail(),
            ),
        ]);
    }

    public function members(Request $request): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());
        $this->authorize('view', $team);

        return response()->json([
            'data' => $team->members()
                ->select(['users.id', 'users.name', 'users.email'])
                ->orderBy('users.name')
                ->get()
                ->map(fn (User $member): array => [
                    'id' => $member->id,
                    'name' => $member->name,
                    'email' => $member->email,
                    'role' => (string) $member->pivot->role,
                ])
                ->all(),
        ]);
    }

    public function updateMember(
        UpdateTeamMemberRequest $request,
        int $userId,
    ): JsonResponse {
        $team = $this->currentTeamContext->resolve($request->user());
        $member = $team->members()->whereKey($userId)->firstOrFail();

        try {
            $this->teamMemberManager->updateRole(
                $request->user(),
                $team,
                $member,
                $request->validated('role'),
            );
        } catch (AuthorizationException) {
            return response()->json(['message' => 'Unauthorized to manage this member.'], 403);
        } catch (ValidationException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'errors' => $exception->errors(),
            ], 422);
        }

        return response()->json([
            'data' => [
                'id' => $member->id,
                'name' => $member->name,
                'email' => $member->email,
                'role' => $request->validated('role'),
            ],
        ]);
    }

    public function removeMember(Request $request, int $userId): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());
        $member = $team->members()->whereKey($userId)->firstOrFail();

        try {
            $this->teamMemberManager->remove($request->user(), $team, $member);
        } catch (AuthorizationException) {
            return response()->json(['message' => 'Unauthorized to manage this member.'], 403);
        } catch (ValidationException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'errors' => $exception->errors(),
            ], 422);
        }

        return response()->json(status: 204);
    }

    public function invitations(Request $request): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());
        $this->authorize('manageInvitations', $team);

        return response()->json([
            'data' => $this->teamInvitationManager->listForTeam($team),
        ]);
    }

    public function storeInvitation(TeamInvitationRequest $request): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $invitation = $this->teamInvitationManager->create(
                $request->user(),
                $team,
                $request->validated('email'),
                $request->validated('role'),
                $request->validated('via'),
            );
        } catch (ValidationException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'errors' => $exception->errors(),
            ], 422);
        }

        return response()->json([
            'data' => $invitation,
        ], 201);
    }

    public function destroyInvitation(Request $request, int $invitationId): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $this->teamInvitationManager->revoke($request->user(), $team, $invitationId);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Invitation not found.'], 404);
        }

        return response()->json(status: 204);
    }
}
