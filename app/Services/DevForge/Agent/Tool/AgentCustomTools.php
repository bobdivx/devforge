<?php

namespace App\Services\DevForge\Agent\Tool;

/**
 * Outils custom créés par les agents via request_tool (porté depuis Forge).
 */
class AgentCustomTools
{
    public function __construct(
        private readonly AgentServerExecutor $serverExecutor,
    ) {}

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function register(array $input): array
    {
        $name = strtolower(trim((string) ($input['name'] ?? '')));
        $name = (string) preg_replace('/[^a-z0-9_]/', '_', $name);
        $commandTemplate = trim((string) ($input['command_template'] ?? $input['commandTemplate'] ?? ''));

        if ($name === '' || $commandTemplate === '') {
            return ['error' => 'name et command_template sont requis.'];
        }

        if (in_array($name, AgentToolPackage::META_TOOLS, true)) {
            return ['error' => 'Ce nom est réservé.'];
        }

        $parameters = $this->normalizeParameters($input['parameters'] ?? null);

        return [
            'registered' => true,
            'tool' => [
                'name' => $name,
                'description' => trim((string) ($input['description'] ?? "Outil custom {$name}")),
                'command_template' => $commandTemplate,
                'server_uuid' => is_string($input['server_uuid'] ?? null) ? $input['server_uuid'] : null,
                'parameters' => $parameters,
                'created_at' => now()->toISOString(),
            ],
        ];
    }

    /**
     * @param  array<string, mixed>  $tool
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    public function execute(array $tool, array $arguments): array
    {
        $serverUuid = (string) ($arguments['server_uuid'] ?? $tool['server_uuid'] ?? '');
        $commandTemplate = (string) ($tool['command_template'] ?? '');

        if ($serverUuid === '') {
            return ['error' => 'server_uuid requis pour cet outil custom.'];
        }

        $command = $this->renderTemplate($commandTemplate, $arguments);

        return $this->serverExecutor->execOnServer($serverUuid, $command, 120);
    }

    /**
     * @return array<string, mixed>
     */
    public function definitionFromTool(array $tool): array
    {
        $parameters = is_array($tool['parameters'] ?? null) ? $tool['parameters'] : [
            'type' => 'object',
            'properties' => [
                'server_uuid' => ['type' => 'string', 'description' => 'UUID du serveur cible'],
            ],
            'required' => ['server_uuid'],
        ];

        return [
            'name' => (string) ($tool['name'] ?? 'custom_tool'),
            'description' => (string) ($tool['description'] ?? 'Outil custom installé par l\'agent'),
            'parameters' => $parameters,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function normalizeParameters(mixed $raw): array
    {
        if (is_string($raw) && trim($raw) !== '') {
            $decoded = json_decode($raw, true);

            return is_array($decoded) ? $decoded : ['type' => 'object', 'properties' => []];
        }

        if (is_array($raw)) {
            return $raw;
        }

        return ['type' => 'object', 'properties' => []];
    }

    /**
     * @param  array<string, mixed>  $arguments
     */
    private function renderTemplate(string $template, array $arguments): string
    {
        return (string) preg_replace_callback(
            '/\{\{(\w+)(?:\|([^}]*))?\}\}/',
            function (array $matches) use ($arguments): string {
                $key = $matches[1];
                $default = $matches[2] ?? '';
                $value = $arguments[$key] ?? $default;

                return is_scalar($value) ? (string) $value : $default;
            },
            $template,
        );
    }
}
