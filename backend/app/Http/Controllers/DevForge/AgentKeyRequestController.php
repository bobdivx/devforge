<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\AiAgentKeyRequest;
use App\Models\SharedEnvironmentVariable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use App\Jobs\Agent\RunAgentJob;

class AgentKeyRequestController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $teamId = currentTeam()->id;
        $requests = AiAgentKeyRequest::with('agent')
            ->where('team_id', $teamId)
            ->where('status', 'pending')
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json($requests);
    }

    public function fulfill(Request $request, string $uuid): JsonResponse
    {
        $validated = $request->validate([
            'value' => 'required|string',
        ]);

        $teamId = currentTeam()->id;
        $keyRequest = AiAgentKeyRequest::where('uuid', $uuid)
            ->where('team_id', $teamId)
            ->firstOrFail();

        if ($keyRequest->status !== 'pending') {
            return response()->json(['error' => 'Cette demande a déjà été traitée.'], 400);
        }

        // Create the shared environment variable for the team
        SharedEnvironmentVariable::create([
            'key' => $keyRequest->key_name,
            'value' => $validated['value'],
            'team_id' => $teamId,
            'is_shown_once' => false,
        ]);

        $keyRequest->update(['status' => 'fulfilled']);

        // Resume the agent run
        if ($keyRequest->agent_id) {
            $agent = $keyRequest->agent;
            if ($agent->status === 'idle') {
                $agent->update(['status' => 'busy']);
                if ($keyRequest->run) {
                    $keyRequest->run->appendLog("L'utilisateur a fourni la clé {$keyRequest->key_name}. Reprise.");
                }
                RunAgentJob::dispatch($agent->id);
            }
        }

        return response()->json(['message' => 'Clé enregistrée avec succès.']);
    }
}
