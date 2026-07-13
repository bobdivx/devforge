<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Http\Requests\DevForge\EnvironmentRequest;
use App\Models\Environment;
use App\Models\Project;
use App\Services\DevForge\CurrentTeamResources;
use App\Services\DevForge\ResourceData;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Visus\Cuid2\Cuid2;

class EnvironmentController extends Controller
{
    public function index(
        Request $request,
        string $projectUuid,
        CurrentTeamResources $currentTeamResources,
        ResourceData $resourceData,
    ): JsonResponse {
        $project = $currentTeamResources->project($request->user(), $projectUuid);
        $this->authorize('view', $project);

        return response()->json([
            'data' => $project->environments()
                ->orderBy('name')
                ->get()
                ->map(fn (Environment $environment): array => $resourceData->environment($environment))
                ->all(),
        ]);
    }

    public function store(
        EnvironmentRequest $request,
        string $projectUuid,
        CurrentTeamResources $currentTeamResources,
        ResourceData $resourceData,
    ): JsonResponse {
        $project = $currentTeamResources->project($request->user(), $projectUuid);
        $this->authorize('create', Environment::class);
        $this->ensureUniqueName($project, $request->string('name')->toString());

        $environment = $project->environments()->create([
            ...$request->validated(),
            'uuid' => (string) new Cuid2,
        ]);

        return response()->json(['data' => $resourceData->environment($environment)], 201);
    }

    public function show(
        Request $request,
        string $projectUuid,
        string $environmentUuid,
        CurrentTeamResources $currentTeamResources,
        ResourceData $resourceData,
    ): JsonResponse {
        $environment = $currentTeamResources->environment(
            $request->user(),
            $projectUuid,
            $environmentUuid,
        );
        $this->authorize('view', $environment);

        return response()->json(['data' => $resourceData->environment($environment)]);
    }

    public function update(
        EnvironmentRequest $request,
        string $projectUuid,
        string $environmentUuid,
        CurrentTeamResources $currentTeamResources,
        ResourceData $resourceData,
    ): JsonResponse {
        $environment = $currentTeamResources->environment(
            $request->user(),
            $projectUuid,
            $environmentUuid,
        );
        $this->authorize('update', $environment);
        $this->ensureUniqueName($environment->project, $request->string('name')->toString(), $environment);
        $environment->update($request->validated());

        return response()->json(['data' => $resourceData->environment($environment->refresh())]);
    }

    public function destroy(
        Request $request,
        string $projectUuid,
        string $environmentUuid,
        CurrentTeamResources $currentTeamResources,
    ): JsonResponse {
        $environment = $currentTeamResources->environment(
            $request->user(),
            $projectUuid,
            $environmentUuid,
        );
        $this->authorize('delete', $environment);

        abort_unless($environment->isEmpty(), 409, 'The environment still contains resources.');

        $environment->delete();

        return response()->json(status: 204);
    }

    private function ensureUniqueName(
        Project $project,
        string $name,
        ?Environment $except = null,
    ): void {
        $exists = $project->environments()
            ->where('name', $name)
            ->when($except, fn ($query) => $query->whereKeyNot($except->id))
            ->exists();

        if ($exists) {
            throw ValidationException::withMessages([
                'name' => ['An environment with this name already exists in the project.'],
            ]);
        }
    }
}
