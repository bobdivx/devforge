<?php

namespace App\Http\Requests\DevForge;

use App\Services\DevForge\Notification\NotificationChannelRegistry;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateNotificationChannelRequest extends FormRequest
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
            'events' => ['sometimes', 'required', 'array'],
            'events.*' => ['boolean'],
            'enabled' => ['sometimes', 'boolean'],
            'channel' => ['required', 'string', Rule::in(array_keys(NotificationChannelRegistry::CHANNEL_RELATIONS))],
        ];
    }

    protected function prepareForValidation(): void
    {
        $this->merge([
            'channel' => $this->route('channel'),
        ]);
    }

    /**
     * @return array{events?: array<string, bool>, enabled?: bool}
     */
    public function payload(): array
    {
        $payload = [];

        if ($this->has('events')) {
            $payload['events'] = collect($this->validated('events'))
                ->map(fn (mixed $value): bool => (bool) $value)
                ->all();
        }

        if ($this->has('enabled')) {
            $payload['enabled'] = (bool) $this->validated('enabled');
        }

        return $payload;
    }
}
