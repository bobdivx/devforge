<?php

namespace App\Http\Requests\DevForge;

use Illuminate\Foundation\Http\FormRequest;

class SwitchTeamRequest extends FormRequest
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
            'team_id' => ['required', 'integer', 'min:0'],
        ];
    }
}
