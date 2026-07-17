<?php

namespace App\Http\Requests\DevForge\Core;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ResourceActionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return [
            'action' => ['required', 'string', Rule::in(['start', 'stop', 'restart', 'deploy'])],
            'force' => ['sometimes', 'boolean'],
            'instant_deploy' => ['sometimes', 'boolean'],
            'docker_cleanup' => ['sometimes', 'boolean'],
            'latest' => ['sometimes', 'boolean'],
        ];
    }

    protected function prepareForValidation(): void
    {
        $this->merge([
            'action' => $this->route('action'),
        ]);
    }
}
