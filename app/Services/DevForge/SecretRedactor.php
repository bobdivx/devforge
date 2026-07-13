<?php

namespace App\Services\DevForge;

use App\Models\Application;

class SecretRedactor
{
    public function redact(string $value, Application $application): string
    {
        $redacted = sanitizeLogsForExport($value);
        $secrets = $application->environment_variables()
            ->get()
            ->merge($application->environment_variables_preview()->get())
            ->map(fn ($variable): mixed => $variable->real_value)
            ->filter(fn ($secret): bool => is_string($secret) && $secret !== '')
            ->unique();

        foreach ($secrets as $secret) {
            $redacted = str_replace($secret, REDACTED, $redacted);
        }

        return $redacted;
    }
}
