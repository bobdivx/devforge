<?php

namespace App\Mcp\Tools\DevForge;

use App\Mcp\Concerns\BuildsResponse;
use App\Mcp\Concerns\ResolvesTeam;
use App\Models\Team;
use App\Services\DevForge\Agent\Tool\AgentToolClassification;
use App\Services\DevForge\Mcp\DevForgeMcpToolkitFactory;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tool;

/**
 * Expose un outil AgentToolkit via MCP (instances créées par DevForgeMcpToolRegistrar).
 */
class ToolkitProxyTool extends Tool
{
    use BuildsResponse;
    use ResolvesTeam;

    /** @var array{type?: string, properties?: array<string, array<string, mixed>>, required?: array<int, string>} */
    private array $parameters;

    /**
     * @param  array{type?: string, properties?: array<string, array<string, mixed>>, required?: array<int, string>}  $parameters
     */
    public function __construct(
        string $name,
        string $description,
        array $parameters,
        string $title = '',
    ) {
        $this->name = $name;
        $this->description = $description;
        $this->parameters = $parameters;
        $this->title = $title !== ''
            ? $title
            : str($name)->replace('_', ' ')->title()->toString();
    }

    public function handle(Request $request): Response
    {
        $ability = $this->requiredAbility();
        if ($error = $this->ensureAbility($request, $ability)) {
            return $error;
        }

        $teamId = $this->resolveTeamId($request);
        if (is_null($teamId)) {
            return Response::error('Invalid token.');
        }

        $arguments = $this->extractArguments($request);
        $toolkit = app(DevForgeMcpToolkitFactory::class)->make(Team::query()->findOrFail($teamId));
        $result = $toolkit->execute($this->name, $arguments);

        if (isset($result['error'])) {
            return Response::error((string) $result['error']);
        }

        return $this->respond($this->scrubSensitive($result));
    }

    public function schema(JsonSchema $schema): array
    {
        $properties = is_array($this->parameters['properties'] ?? null)
            ? $this->parameters['properties']
            : [];
        $required = is_array($this->parameters['required'] ?? null)
            ? $this->parameters['required']
            : [];

        $fields = [];
        foreach ($properties as $key => $definition) {
            if (! is_string($key) || ! is_array($definition)) {
                continue;
            }

            $fields[$key] = $this->buildField($schema, $definition, in_array($key, $required, true));
        }

        return $fields;
    }

    protected function requiredAbility(): string
    {
        $classification = AgentToolClassification::forTool($this->name);

        return $classification->isReadOnly ? 'read' : 'write';
    }

    /**
     * @return array<string, mixed>
     */
    private function extractArguments(Request $request): array
    {
        $properties = is_array($this->parameters['properties'] ?? null)
            ? $this->parameters['properties']
            : [];
        $arguments = [];

        foreach (array_keys($properties) as $key) {
            if (! is_string($key)) {
                continue;
            }

            $value = $request->get($key);
            if ($value !== null) {
                $arguments[$key] = $value;
            }
        }

        return $arguments;
    }

    /**
     * @param  array<string, mixed>  $definition
     */
    private function buildField(JsonSchema $schema, array $definition, bool $required): mixed
    {
        $type = $definition['type'] ?? 'string';
        $field = match ($type) {
            'integer' => $schema->integer(),
            'number' => $schema->number(),
            'boolean' => $schema->boolean(),
            'array' => $schema->array(),
            'object' => $schema->object(),
            default => $schema->string(),
        };

        if (is_string($definition['description'] ?? null) && $definition['description'] !== '') {
            $field = $field->description($definition['description']);
        }

        if (is_array($definition['enum'] ?? null) && $definition['enum'] !== [] && method_exists($field, 'enum')) {
            $field = $field->enum(array_values($definition['enum']));
        }

        if ($required) {
            $field = $field->required();
        }

        return $field;
    }
}
