<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Http\Requests\DevForge\ProjectRequest;
use App\Models\Project;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\CurrentTeamResources;
use App\Services\DevForge\ResourceData;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Visus\Cuid2\Cuid2;

class ProjectController extends Controller
{
    public function index(
        Request $request,
        CurrentTeamContext $currentTeamContext,
        ResourceData $resourceData,
    ): JsonResponse {
        $team = $currentTeamContext->resolve($request->user());
        $this->authorize('viewAny', Project::class);

        return response()->json([
            'data' => Project::query()
                ->where('team_id', $team->id)
                ->with('environments')
                ->orderByRaw('LOWER(name)')
                ->get()
                ->map(fn (Project $project): array => $resourceData->project($project, true))
                ->all(),
        ]);
    }

    public function store(
        ProjectRequest $request,
        CurrentTeamContext $currentTeamContext,
        ResourceData $resourceData,
    ): JsonResponse {
        $team = $currentTeamContext->resolve($request->user());
        $this->authorize('create', Project::class);

        $project = Project::query()->create([
            ...$request->validated(),
            'team_id' => $team->id,
            'uuid' => (string) new Cuid2,
        ])->load('environments');

        return response()->json([
            'data' => $resourceData->project($project, true),
        ], 201);
    }

    public function show(
        Request $request,
        string $projectUuid,
        CurrentTeamResources $currentTeamResources,
        ResourceData $resourceData,
    ): JsonResponse {
        $project = $currentTeamResources
            ->project($request->user(), $projectUuid)
            ->load('environments');
        $this->authorize('view', $project);

        return response()->json(['data' => $resourceData->project($project, true)]);
    }

    public function update(
        ProjectRequest $request,
        string $projectUuid,
        CurrentTeamResources $currentTeamResources,
        ResourceData $resourceData,
    ): JsonResponse {
        $project = $currentTeamResources->project($request->user(), $projectUuid);
        $this->authorize('update', $project);
        $project->update($request->validated());

        return response()->json(['data' => $resourceData->project($project->refresh())]);
    }

    public function destroy(
        Request $request,
        string $projectUuid,
        CurrentTeamResources $currentTeamResources,
    ): JsonResponse {
        $project = $currentTeamResources->project($request->user(), $projectUuid);
        $this->authorize('delete', $project);

        abort_unless($project->isEmpty(), 409, 'The project still contains resources.');

        $project->delete();

        return response()->json(status: 204);
    }
}
