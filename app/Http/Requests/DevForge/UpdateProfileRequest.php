<?php

namespace App\Http\Requests\DevForge;

use App\Support\ValidationPatterns;
use Illuminate\Foundation\Http\FormRequest;

class UpdateProfileRequest extends FormRequest
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
            'name' => ValidationPatterns::nameRules(),
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return ValidationPatterns::nameMessages();
    }
}
