<?php

namespace App\Http\Requests\DevForge;

use App\Enums\Role;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class TeamInvitationRequest extends FormRequest
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
            'email' => ['required', 'email'],
            'role' => ['required', 'string', Rule::in(array_column(Role::cases(), 'value'))],
            'via' => ['required', 'string', Rule::in(['email', 'link'])],
        ];
    }

    protected function prepareForValidation(): void
    {
        $this->merge([
            'email' => strtolower(trim((string) $this->input('email', ''))),
        ]);
    }
}
