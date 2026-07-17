<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Services\DevForge\BootstrapData;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BootstrapController extends Controller
{
    public function __invoke(Request $request, BootstrapData $bootstrapData): JsonResponse
    {
        return response()->json([
            'data' => $bootstrapData->build($request->user()),
        ]);
    }
}
