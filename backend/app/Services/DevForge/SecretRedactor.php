<?php

namespace App\Services\DevForge;

use App\Models\Application;
use Illuminate\Support\Collection;

class SecretRedactor
{
    /** @var array<int|string, Collection<int, string>> */
    private array $secretCache = [];

    public function redact(string $value, Application $application): string
    {
        $redacted = sanitizeLogsForExport($value);

        foreach ($this->secretsFor($application) as $secret) {
            $redacted = str_replace($secret, REDACTED, $redacted);
        }

        return $redacted;
    }

    /**
     * @return Collection<int, string>
     */
    private function secretsFor(Application $application): Collection
    {
        $cacheKey = $application->getKey() ?? spl_object_id($application);

        if (! isset($this->secretCache[$cacheKey])) {
            $this->secretCache[$cacheKey] = $application->environment_variables()
                ->get()
                ->merge($application->environment_variables_preview()->get())
                ->map(fn ($variable): mixed => $variable->real_value)
                ->filter(fn ($secret): bool => is_string($secret) && $secret !== '')
                ->unique()
                ->values();
        }

        return $this->secretCache[$cacheKey];
    }
}
