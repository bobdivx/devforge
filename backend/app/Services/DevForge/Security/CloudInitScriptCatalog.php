<?php

namespace App\Services\DevForge\Security;

use App\Models\CloudInitScript;
use App\Models\Team;
use App\Rules\ValidCloudInitYaml;
use App\Support\ValidationPatterns;

class CloudInitScriptCatalog
{
    /**
     * @return list<array{
     *     id: int,
     *     name: string,
     *     script: string,
     *     created_at: mixed,
     *     updated_at: mixed
     * }>
     */
    public function list(Team $team): array
    {
        return CloudInitScript::query()
            ->where('team_id', $team->id)
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (CloudInitScript $script): array => $this->present($script))
            ->all();
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     id: int,
     *     name: string,
     *     script: string,
     *     created_at: mixed,
     *     updated_at: mixed,
     *     message: string
     * }
     */
    public function store(Team $team, array $input): array
    {
        $validated = validator($input, [
            'name' => ValidationPatterns::nameRules(required: true),
            'script' => ['required', 'string', new ValidCloudInitYaml],
        ], ValidationPatterns::combinedMessages())->validate();

        $script = CloudInitScript::create([
            'team_id' => $team->id,
            'name' => (string) $validated['name'],
            'script' => (string) $validated['script'],
        ]);

        return [
            ...$this->present($script),
            'message' => 'Script cloud-init créé.',
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     id: int,
     *     name: string,
     *     script: string,
     *     created_at: mixed,
     *     updated_at: mixed,
     *     message: string
     * }
     */
    public function update(CloudInitScript $script, array $input): array
    {
        $validated = validator($input, [
            'name' => ValidationPatterns::nameRules(required: true),
            'script' => ['required', 'string', new ValidCloudInitYaml],
        ], ValidationPatterns::combinedMessages())->validate();

        $script->update([
            'name' => (string) $validated['name'],
            'script' => (string) $validated['script'],
        ]);

        return [
            ...$this->present($script->fresh()),
            'message' => 'Script cloud-init mis à jour.',
        ];
    }

    public function destroy(CloudInitScript $script): void
    {
        $script->delete();
    }

    /**
     * @return array{
     *     id: int,
     *     name: string,
     *     script: string,
     *     created_at: mixed,
     *     updated_at: mixed
     * }
     */
    private function present(CloudInitScript $script): array
    {
        return [
            'id' => $script->id,
            'name' => $script->name,
            'script' => (string) $script->script,
            'created_at' => $script->created_at,
            'updated_at' => $script->updated_at,
        ];
    }
}
