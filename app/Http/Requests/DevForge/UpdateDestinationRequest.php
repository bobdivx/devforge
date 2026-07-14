<?php

namespace App\Http\Requests\DevForge;

use App\Support\ValidationPatterns;
use Illuminate\Foundation\Http\FormRequest;

class UpdateDestinationRequest extends FormRequest
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
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'network' => array_merge(['sometimes'], ValidationPatterns::dockerNetworkRules()),
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
     * @return array{name?: string, network?: string}
     */
    public function payload(): array
    {
        return $this->validated();
    }
}
