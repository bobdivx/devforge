<?php

namespace App\Http\Requests\DevForge;

use App\Support\ValidationPatterns;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SharedVariableRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'key' => ValidationPatterns::environmentVariableKeyRules(),
            'value' => ['nullable', 'string'],
            'scope' => ['required', 'string', Rule::in(['team', 'project', 'environment', 'server'])],
            'comment' => ['nullable', 'string', 'max:256'],
            'is_multiline' => ['sometimes', 'boolean'],
            'is_literal' => ['sometimes', 'boolean'],
            'is_shown_once' => ['sometimes', 'boolean'],
            'project_uuid' => ['nullable', 'string'],
            'environment_uuid' => ['nullable', 'string'],
            'server_uuid' => ['nullable', 'string'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return ValidationPatterns::environmentVariableKeyMessages('key');
    }

    /**
     * @return array<string, mixed>
     */
    public function payload(): array
    {
        $validated = $this->validated();

        return [
            'key' => ValidationPatterns::normalizeEnvironmentVariableKey($validated['key']),
            'value' => $validated['value'] ?? null,
            'scope' => $validated['scope'],
            'comment' => $validated['comment'] ?? null,
            'is_multiline' => (bool) ($validated['is_multiline'] ?? false),
            'is_literal' => (bool) ($validated['is_literal'] ?? false),
            'is_shown_once' => (bool) ($validated['is_shown_once'] ?? false),
            'project_uuid' => $validated['project_uuid'] ?? null,
            'environment_uuid' => $validated['environment_uuid'] ?? null,
            'server_uuid' => $validated['server_uuid'] ?? null,
        ];
    }
}
