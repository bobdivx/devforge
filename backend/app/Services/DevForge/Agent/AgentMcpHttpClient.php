<?php

namespace App\Services\DevForge\Agent;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * Client MCP HTTP minimal (JSON-RPC tools/list + tools/call) — P6.
 */
class AgentMcpHttpClient
{
    private int $nextId = 1;

    private bool $initialized = false;

    /**
     * @param  array<string, string>  $headers
     */
    public function __construct(
        private readonly string $url,
        private readonly array $headers = [],
        private readonly int $timeout = 30,
    ) {}

    /**
     * @return list<array{name: string, description?: string, inputSchema?: array<string, mixed>}>
     */
    public function listTools(): array
    {
        $this->ensureInitialized();

        $result = $this->request('tools/list', new \stdClass);
        $tools = $result['tools'] ?? [];

        if (! is_array($tools)) {
            return [];
        }

        return array_values(array_filter($tools, fn ($tool): bool => is_array($tool) && isset($tool['name'])));
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    public function callTool(string $name, array $arguments = []): array
    {
        $this->ensureInitialized();

        $result = $this->request('tools/call', [
            'name' => $name,
            'arguments' => $arguments === [] ? new \stdClass : $arguments,
        ]);

        return is_array($result) ? $result : ['raw' => $result];
    }

    /**
     * @param  array<string, mixed>|object  $params
     * @return array<string, mixed>
     */
    public function request(string $method, array|object $params = []): array
    {
        $id = $this->nextId++;
        $payload = [
            'jsonrpc' => '2.0',
            'id' => $id,
            'method' => $method,
            'params' => $params,
        ];

        $response = Http::withHeaders(array_merge([
            'Accept' => 'application/json, text/event-stream',
            'Content-Type' => 'application/json',
        ], $this->headers))
            ->timeout($this->timeout)
            ->post($this->url, $payload);

        if (! $response->successful()) {
            throw new \RuntimeException(
                'MCP HTTP '.$response->status().': '.mb_substr($response->body(), 0, 300),
            );
        }

        $decoded = $this->decodeResponse($response);
        if (isset($decoded['error'])) {
            $message = is_array($decoded['error'])
                ? (string) ($decoded['error']['message'] ?? json_encode($decoded['error']))
                : (string) $decoded['error'];

            throw new \RuntimeException('MCP error: '.$message);
        }

        $result = $decoded['result'] ?? [];

        return is_array($result) ? $result : [];
    }

    private function ensureInitialized(): void
    {
        if ($this->initialized) {
            return;
        }

        try {
            $this->request('initialize', [
                'protocolVersion' => '2024-11-05',
                'capabilities' => new \stdClass,
                'clientInfo' => [
                    'name' => 'devforge-agent',
                    'version' => '1.0.0',
                ],
            ]);

            // Notification (pas de réponse attendue) — best effort
            try {
                Http::withHeaders(array_merge([
                    'Accept' => 'application/json, text/event-stream',
                    'Content-Type' => 'application/json',
                ], $this->headers))
                    ->timeout(min(10, $this->timeout))
                    ->post($this->url, [
                        'jsonrpc' => '2.0',
                        'method' => 'notifications/initialized',
                        'params' => new \stdClass,
                    ]);
            } catch (\Throwable) {
                // ignore
            }
        } catch (\Throwable) {
            // Certains serveurs n’exigent pas initialize — tools/list suffira.
        }

        $this->initialized = true;
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeResponse(Response $response): array
    {
        $contentType = strtolower((string) $response->header('Content-Type'));

        if (str_contains($contentType, 'text/event-stream')) {
            return $this->decodeSse((string) $response->body());
        }

        $json = $response->json();

        return is_array($json) ? $json : [];
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeSse(string $body): array
    {
        $last = [];
        foreach (preg_split("/\r\n|\n|\r/", $body) ?: [] as $line) {
            $line = trim($line);
            if (! str_starts_with($line, 'data:')) {
                continue;
            }
            $data = trim(substr($line, 5));
            if ($data === '' || $data === '[DONE]') {
                continue;
            }
            $decoded = json_decode($data, true);
            if (is_array($decoded)) {
                $last = $decoded;
            }
        }

        return $last;
    }
}
