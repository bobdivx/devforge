<?php

namespace App\Services\DevForge\Agent;

use Illuminate\Support\Facades\Http;

/**
 * Client HTTP mince vers le sidecar Rig (devforge-agent).
 * Non branché sur AgentChatService / AgentRunner : AGENT_URL vide = no-op.
 */
class RigAgentClient
{
    public function enabled(): bool
    {
        return filled(config('devforge.agent_url'));
    }

    /**
     * @return array<string, mixed>
     */
    public function health(): array
    {
        $response = Http::timeout(5)->get($this->baseUrl().'/health');

        $json = $response->json();

        return is_array($json) ? $json : [];
    }

    public function chat(string $prompt, ?string $preamble = null, ?string $model = null): string
    {
        $payload = ['prompt' => $prompt];

        if ($preamble !== null) {
            $payload['preamble'] = $preamble;
        }

        if ($model !== null) {
            $payload['model'] = $model;
        }

        $response = Http::timeout(120)->post($this->baseUrl().'/v1/chat', $payload);

        if ($response->failed()) {
            throw new \RuntimeException(
                'Rig agent chat '.$response->status().': '.mb_substr($response->body(), 0, 300),
            );
        }

        $text = $response->json('text');

        if (! is_string($text)) {
            throw new \RuntimeException('Rig agent chat: missing text in response.');
        }

        return $text;
    }

    private function baseUrl(): string
    {
        return rtrim((string) config('devforge.agent_url'), '/');
    }
}
