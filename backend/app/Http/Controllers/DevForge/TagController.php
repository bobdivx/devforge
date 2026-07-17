<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Http\Requests\DevForge\TagRequest;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\Tag\TagCatalog;
use App\Services\DevForge\Tag\TagDeployer;
use App\Services\DevForge\Tag\TagWriter;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class TagController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly TagCatalog $tagCatalog,
        private readonly TagWriter $tagWriter,
        private readonly TagDeployer $tagDeployer,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        return response()->json([
            'data' => $this->tagCatalog->tagsForTeam($team),
        ]);
    }

    public function store(TagRequest $request): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());
        $tag = $this->tagWriter->create($team, $request->normalizedName());

        return response()->json([
            'data' => $this->tagCatalog->presentSummary($tag),
        ], 201);
    }

    public function show(Request $request, string $tagName): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $tag = $this->tagCatalog->tagForTeam($team, $tagName);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Tag not found.'], 404);
        }

        return response()->json([
            'data' => $this->tagCatalog->present($tag),
        ]);
    }

    public function destroy(Request $request, string $tagName): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $this->tagWriter->delete($team, $tagName);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Tag not found.'], 404);
        } catch (ValidationException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'errors' => $exception->errors(),
            ], 409);
        }

        return response()->json(status: 204);
    }

    public function redeploy(Request $request, string $tagName): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $tag = $this->tagCatalog->tagForTeam($team, $tagName);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Tag not found.'], 404);
        }

        $force = $request->boolean('force');

        try {
            $result = $this->tagDeployer->redeploy($request->user(), $tag, $force);
        } catch (ValidationException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'errors' => $exception->errors(),
            ], 422);
        } catch (HttpException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
            ], $exception->getStatusCode());
        }

        return response()->json([
            'data' => $result,
        ], 202);
    }
}
