<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Services\DevForge\Backup\InstanceBackupService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpException;

class InstanceBackupController extends Controller
{
    public function __construct(
        private readonly InstanceBackupService $instanceBackupService,
    ) {}

    public function show(Request $request): JsonResponse
    {
        abort_unless(isInstanceAdmin(), 403);

        return response()->json([
            'data' => $this->instanceBackupService->show(),
        ]);
    }

    public function init(Request $request): JsonResponse
    {
        abort_unless(isInstanceAdmin(), 403);

        try {
            $preferred = $request->string('container')->toString() ?: null;

            return response()->json([
                'data' => $this->instanceBackupService->init($preferred ?: null),
            ]);
        } catch (HttpException $e) {
            return response()->json(['error' => $e->getMessage()], $e->getStatusCode());
        } catch (\Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    public function updateDatabase(Request $request): JsonResponse
    {
        abort_unless(isInstanceAdmin(), 403);

        return response()->json([
            'data' => $this->instanceBackupService->updateDatabase($request->all()),
        ]);
    }

    public function updateSchedule(Request $request): JsonResponse
    {
        abort_unless(isInstanceAdmin(), 403);

        return response()->json([
            'data' => $this->instanceBackupService->updateSchedule($request->all()),
        ]);
    }

    public function run(Request $request): JsonResponse
    {
        abort_unless(isInstanceAdmin(), 403);

        return response()->json([
            'data' => $this->instanceBackupService->runNow(),
        ]);
    }

    public function export(Request $request): JsonResponse
    {
        abort_unless(isInstanceAdmin(), 403);

        try {
            return response()->json([
                'data' => $this->instanceBackupService->latestExport(),
            ]);
        } catch (HttpException $e) {
            return response()->json(['error' => $e->getMessage()], $e->getStatusCode());
        }
    }

    public function import(Request $request): JsonResponse
    {
        abort_unless(isInstanceAdmin(), 403);

        $request->validate([
            'file' => ['required', 'file', 'max:512000'],
            'from_coolify' => ['sometimes', 'boolean'],
        ]);

        try {
            return response()->json([
                'data' => $this->instanceBackupService->import(
                    $request->file('file'),
                    $request->boolean('from_coolify'),
                ),
            ]);
        } catch (HttpException $e) {
            return response()->json(['error' => $e->getMessage()], $e->getStatusCode());
        }
    }

    public function destroyExecution(Request $request, string $executionUuid): JsonResponse
    {
        abort_unless(isInstanceAdmin(), 403);

        try {
            return response()->json([
                'data' => $this->instanceBackupService->deleteExecution(
                    $executionUuid,
                    $request->boolean('delete_s3'),
                ),
            ]);
        } catch (HttpException $e) {
            return response()->json(['error' => $e->getMessage()], $e->getStatusCode());
        }
    }

    public function destroyFailedExecutions(): JsonResponse
    {
        abort_unless(isInstanceAdmin(), 403);

        try {
            return response()->json([
                'data' => $this->instanceBackupService->deleteFailedExecutions(),
            ]);
        } catch (HttpException $e) {
            return response()->json(['error' => $e->getMessage()], $e->getStatusCode());
        }
    }

    public function migrateFromCoolify(Request $request): JsonResponse
    {
        abort_unless(isInstanceAdmin(), 403);

        try {
            return response()->json([
                'data' => $this->instanceBackupService->migrateFromCoolify(),
            ]);
        } catch (HttpException $e) {
            return response()->json(['error' => $e->getMessage()], $e->getStatusCode());
        } catch (\Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }
}
