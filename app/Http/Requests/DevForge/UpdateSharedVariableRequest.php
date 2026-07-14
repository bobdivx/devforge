<?php

namespace App\Http\Requests\DevForge;

use App\Support\ValidationPatterns;
use Illuminate\Foundation\Http\FormRequest;

class UpdateSharedVariableRequest extends FormRequest
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
            'key' => ValidationPatterns::environmentVariableKeyRules(required: false),
            'value' => ['nullable', 'string'],
            'comment' => ['nullable', 'string', 'max:256'],
            'is_multiline' => ['sometimes', 'boolean'],
            'is_literal' => ['sometimes', 'boolean'],
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
        $payload = [];

        if (array_key_exists('key', $validated) && filled($validated['key'])) {
            $payload['key'] = ValidationPatterns::normalizeEnvironmentVariableKey($validated['key']);
        }

        if (array_key_exists('value', $validated)) {
            $payload['value'] = $validated['value'];
        }

        if (array_key_exists('comment', $validated)) {
            $payload['comment'] = $validated['comment'];
        }

        if (array_key_exists('is_multiline', $validated)) {
            $payload['is_multiline'] = (bool) $validated['is_multiline'];
        }

        if (array_key_exists('is_literal', $validated)) {
            $payload['is_literal'] = (bool) $validated['is_literal'];
        }

        return $payload;
    }
}
