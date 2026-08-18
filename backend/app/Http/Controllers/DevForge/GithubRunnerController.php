<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\Server;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\Github\GithubRunnerInventory;
use App\Services\DevForge\Github\GithubRunnerJobMonitor;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

class GithubRunnerController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly GithubRunnerInventory $githubRunnerInventory,
        private readonly GithubRunnerJobMonitor $githubRunnerJobMonitor,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());
        $this->authorize('viewAny', Server::class);

        try {
            return response()->json([
                'data' => $this->githubRunnerInventory->listForTeam($team),
            ]);
        } catch (\Throwable $e) {
            Log::error('github_runner.list_failed', [
                'team_id' => $team->id,
                'message' => $e->getMessage(),
            ]);

            // Keep the page usable: prefer an empty list over a hard 500.
            return response()->json([
                'data' => [],
                'message' => 'Impossible de lister les runners GitHub pour le moment.',
            ]);
        }
    }

    public function store(Request $request): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());
        $this->authorize('create', Server::class);

        $serverUuid = (string) $request->input('server_uuid', '');
        if ($serverUuid !== '') {
            $server = Server::query()
                ->where('team_id', $team->id)
                ->where('uuid', $serverUuid)
                ->first();

            if ($server) {
                $this->authorize('update', $server);
            }
        }

        try {
            $result = $this->githubRunnerInventory->create($team, $request->all());
        } catch (ValidationException $e) {
            throw $e;
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Ressource introuvable.'], 404);
        } catch (HttpExceptionInterface $e) {
            $status = $e->getStatusCode();
            $message = trim($e->getMessage());

            return response()->json([
                'message' => $message !== ''
                    ? $message
                    : 'Impossible de créer le runner.',
            ], $status >= 400 ? $status : 500);
        } catch (\Throwable $e) {
            Log::error('github_runner.create_failed', [
                'message' => $e->getMessage(),
            ]);

            $detail = trim($e->getMessage());

            return response()->json([
                'message' => $detail !== ''
                    ? 'Impossible de créer le runner : '.$detail
                    : 'Impossible de créer le runner.',
            ], 500);
        }

        return response()->json([
            'data' => $result['runner'],
            'message' => $result['message'],
        ], 201);
    }

    public function show(Request $request, string $serverUuid, string $containerName): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $server = Server::query()
                ->where('team_id', $team->id)
                ->where('uuid', $serverUuid)
                ->firstOrFail();
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Serveur introuvable.'], 404);
        }

        $this->authorize('view', $server);

        try {
            return response()->json([
                'data' => $this->githubRunnerInventory->show($team, $serverUuid, $containerName),
            ]);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Runner introuvable.'], 404);
        } catch (ValidationException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('github_runner.show_failed', [
                'server_uuid' => $serverUuid,
                'container' => $containerName,
                'message' => $e->getMessage(),
            ]);

            return response()->json(['message' => 'Impossible de charger le détail du runner.'], 500);
        }
    }

    public function logs(Request $request, string $serverUuid, string $containerName): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $server = Server::query()
                ->where('team_id', $team->id)
                ->where('uuid', $serverUuid)
                ->firstOrFail();
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Serveur introuvable.'], 404);
        }

        $this->authorize('view', $server);

        $validated = $request->validate([
            'lines' => ['nullable', 'integer', 'min:10', 'max:1000'],
        ]);

        try {
            return response()->json([
                'data' => $this->githubRunnerInventory->logs(
                    $team,
                    $serverUuid,
                    $containerName,
                    (int) ($validated['lines'] ?? 200),
                ),
            ]);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Runner introuvable.'], 404);
        } catch (ValidationException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('github_runner.logs_failed', [
                'server_uuid' => $serverUuid,
                'container' => $containerName,
                'message' => $e->getMessage(),
            ]);

            return response()->json(['message' => 'Impossible de lire les logs du runner.'], 500);
        }
    }

    public function jobs(Request $request, string $serverUuid, string $containerName): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $server = Server::query()
                ->where('team_id', $team->id)
                ->where('uuid', $serverUuid)
                ->firstOrFail();
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Serveur introuvable.'], 404);
        }

        $this->authorize('view', $server);

        try {
            return response()->json([
                'data' => $this->githubRunnerJobMonitor->listForRunner($team, $serverUuid, $containerName),
            ]);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Runner introuvable.'], 404);
        } catch (ValidationException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('github_runner.jobs_failed', [
                'server_uuid' => $serverUuid,
                'container' => $containerName,
                'message' => $e->getMessage(),
            ]);

            return response()->json(['message' => 'Impossible de lire les GitHub Actions du runner.'], 500);
        }
    }

    public function action(Request $request, string $serverUuid, string $containerName, string $action): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $server = Server::query()
                ->where('team_id', $team->id)
                ->where('uuid', $serverUuid)
                ->firstOrFail();
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Serveur introuvable.'], 404);
        }

        $this->authorize('update', $server);

        try {
            $result = $this->githubRunnerInventory->action($team, $serverUuid, $containerName, $action);

            return response()->json([
                'data' => $result,
                'message' => $result['message'],
            ]);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Runner introuvable.'], 404);
        } catch (ValidationException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('github_runner.action_failed', [
                'server_uuid' => $serverUuid,
                'container' => $containerName,
                'action' => $action,
                'message' => $e->getMessage(),
            ]);

            return response()->json(['message' => 'Action runner impossible.'], 500);
        }
    }

    public function destroy(Request $request, string $serverUuid, string $containerName): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $server = Server::query()
                ->where('team_id', $team->id)
                ->where('uuid', $serverUuid)
                ->firstOrFail();
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Serveur introuvable.'], 404);
        }

        $this->authorize('update', $server);

        try {
            $result = $this->githubRunnerInventory->destroy($team, $serverUuid, $containerName);

            return response()->json([
                'data' => $result,
                'message' => $result['message'],
            ]);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Runner introuvable.'], 404);
        } catch (ValidationException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('github_runner.destroy_failed', [
                'server_uuid' => $serverUuid,
                'container' => $containerName,
                'message' => $e->getMessage(),
            ]);

            return response()->json(['message' => 'Impossible de supprimer le runner.'], 500);
        }
    }

    public function attachApplication(Request $request, string $serverUuid, string $containerName): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $server = Server::query()
                ->where('team_id', $team->id)
                ->where('uuid', $serverUuid)
                ->firstOrFail();
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Serveur introuvable.'], 404);
        }

        $this->authorize('update', $server);

        $validated = $request->validate([
            'application_uuid' => ['required', 'string', 'max:64'],
            'role' => ['nullable', 'string', 'max:32'],
        ]);

        try {
            $link = $this->githubRunnerInventory->attachApplication(
                $team,
                $serverUuid,
                $containerName,
                $validated['application_uuid'],
                $validated['role'] ?? null,
            );

            return response()->json([
                'data' => $link,
                'message' => 'Runner lié à l’application.',
            ], 201);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Runner introuvable.'], 404);
        } catch (ValidationException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('github_runner.attach_failed', [
                'server_uuid' => $serverUuid,
                'container' => $containerName,
                'message' => $e->getMessage(),
            ]);

            return response()->json(['message' => 'Impossible de lier le runner à l’application.'], 500);
        }
    }

    public function detachApplication(Request $request, string $serverUuid, string $containerName, string $applicationUuid): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $server = Server::query()
                ->where('team_id', $team->id)
                ->where('uuid', $serverUuid)
                ->firstOrFail();
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Serveur introuvable.'], 404);
        }

        $this->authorize('update', $server);

        try {
            $result = $this->githubRunnerInventory->detachApplication(
                $team,
                $serverUuid,
                $containerName,
                $applicationUuid,
            );

            return response()->json([
                'data' => $result,
                'message' => $result['message'],
            ]);
        } catch (ValidationException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('github_runner.detach_failed', [
                'server_uuid' => $serverUuid,
                'container' => $containerName,
                'application_uuid' => $applicationUuid,
                'message' => $e->getMessage(),
            ]);

            return response()->json(['message' => 'Impossible de supprimer le lien.'], 500);
        }
    }
}
