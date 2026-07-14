<?php

namespace App\Http\Requests\DevForge;

use App\Support\ValidationPatterns;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class DestinationRequest extends FormRequest
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
            'server_uuid' => ['required', 'string'],
            'network' => ValidationPatterns::dockerNetworkRules(),
            'name' => ['nullable', 'string', 'max:255'],
            'type' => ['nullable', 'string', Rule::in(['standalone', 'swarm'])],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return ValidationPatterns::dockerNetworkMessages('network');
    }

    /**
     * @return array{
     *     server_uuid: string,
     *     network: string,
     *     name?: string|null,
     *     type?: string|null,
     * }
     */
    public function payload(): array
    {
        $validated = $this->validated();

        return [
            'server_uuid' => $validated['server_uuid'],
            'network' => $validated['network'],
            'name' => $validated['name'] ?? null,
            'type' => $validated['type'] ?? null,
        ];
    }
}
