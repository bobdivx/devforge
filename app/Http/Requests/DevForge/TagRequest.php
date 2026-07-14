<?php

namespace App\Http\Requests\DevForge;

use Illuminate\Foundation\Http\FormRequest;

class TagRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string>>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:2', 'max:255'],
        ];
    }

    protected function prepareForValidation(): void
    {
        $this->merge([
            'name' => strtolower(strip_tags(trim((string) $this->input('name', '')))),
        ]);
    }

    public function normalizedName(): string
    {
        return $this->validated('name');
    }
}
