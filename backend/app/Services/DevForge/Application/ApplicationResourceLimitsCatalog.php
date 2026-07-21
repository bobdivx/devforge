<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use Illuminate\Validation\ValidationException;

class ApplicationResourceLimitsCatalog
{
    private const MEMORY_PATTERN = '/^(0|\d+[bBkKmMgG])$/';

    private const CPUS_PATTERN = '/^\d*\.?\d+$/';

    private const CPUSET_PATTERN = '/^\d+([,-]\d+)*$/';

    /**
     * @return array{
     *     limits_cpus: string|null,
     *     limits_cpuset: string|null,
     *     limits_cpu_shares: int,
     *     limits_memory: string,
     *     limits_memory_swap: string,
     *     limits_memory_reservation: string,
     *     limits_memory_swappiness: int
     * }
     */
    public function show(Application $application): array
    {
        return $this->present($application);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     limits_cpus: string|null,
     *     limits_cpuset: string|null,
     *     limits_cpu_shares: int,
     *     limits_memory: string,
     *     limits_memory_swap: string,
     *     limits_memory_reservation: string,
     *     limits_memory_swappiness: int,
     *     message: string
     * }
     */
    public function update(Application $application, array $input): array
    {
        $normalized = $this->normalizeInput($input);

        $validated = validator($normalized, [
            'limits_cpus' => ['sometimes', 'nullable', 'regex:'.self::CPUS_PATTERN],
            'limits_cpuset' => ['sometimes', 'nullable', 'regex:'.self::CPUSET_PATTERN],
            'limits_cpu_shares' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'limits_memory' => ['sometimes', 'string', 'regex:'.self::MEMORY_PATTERN],
            'limits_memory_swap' => ['sometimes', 'string', 'regex:'.self::MEMORY_PATTERN],
            'limits_memory_reservation' => ['sometimes', 'string', 'regex:'.self::MEMORY_PATTERN],
            'limits_memory_swappiness' => ['sometimes', 'integer', 'min:0', 'max:100'],
        ], [
            'limits_memory.regex' => 'La mémoire max doit être un nombre suivi d’une unité (b, k, m, g), ou 0.',
            'limits_memory_swap.regex' => 'Le swap max doit être un nombre suivi d’une unité (b, k, m, g), ou 0.',
            'limits_memory_reservation.regex' => 'La réservation mémoire doit être un nombre suivi d’une unité (b, k, m, g), ou 0.',
            'limits_cpus.regex' => 'Le nombre de CPUs doit être un nombre (ex. 0.5, 2).',
            'limits_cpuset.regex' => 'Le cpuset doit être une liste ou plage (ex. 0-2 ou 0,1,3).',
        ])->validate();

        if ($validated === []) {
            throw ValidationException::withMessages([
                'input' => 'Au moins un champ doit être fourni.',
            ]);
        }

        if (array_key_exists('limits_cpus', $validated)) {
            $application->limits_cpus = $validated['limits_cpus'];
        }
        if (array_key_exists('limits_cpuset', $validated)) {
            $application->limits_cpuset = $validated['limits_cpuset'];
        }
        if (array_key_exists('limits_cpu_shares', $validated)) {
            $application->limits_cpu_shares = (int) ($validated['limits_cpu_shares'] ?? 1024);
        }
        if (array_key_exists('limits_memory', $validated)) {
            $application->limits_memory = $validated['limits_memory'];
        }
        if (array_key_exists('limits_memory_swap', $validated)) {
            $application->limits_memory_swap = $validated['limits_memory_swap'];
        }
        if (array_key_exists('limits_memory_reservation', $validated)) {
            $application->limits_memory_reservation = $validated['limits_memory_reservation'];
        }
        if (array_key_exists('limits_memory_swappiness', $validated)) {
            $application->limits_memory_swappiness = (int) $validated['limits_memory_swappiness'];
        }

        $application->save();

        return [
            ...$this->present($application->fresh()),
            'message' => 'Limites de ressources mises à jour. Redéployez pour appliquer.',
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    private function normalizeInput(array $input): array
    {
        $normalized = [];

        foreach ([
            'limits_cpus',
            'limits_cpuset',
            'limits_cpu_shares',
            'limits_memory',
            'limits_memory_swap',
            'limits_memory_reservation',
            'limits_memory_swappiness',
        ] as $field) {
            if (! array_key_exists($field, $input)) {
                continue;
            }

            $value = $input[$field];

            if ($field === 'limits_memory' || $field === 'limits_memory_swap' || $field === 'limits_memory_reservation') {
                $normalized[$field] = filled($value) ? (string) $value : '0';

                continue;
            }

            if ($field === 'limits_cpus') {
                $normalized[$field] = filled($value) ? (string) $value : '0';

                continue;
            }

            if ($field === 'limits_cpuset') {
                $normalized[$field] = $value === '' || $value === null ? null : (string) $value;

                continue;
            }

            if ($field === 'limits_cpu_shares') {
                $normalized[$field] = $value === '' || $value === null ? 1024 : (int) $value;

                continue;
            }

            if ($field === 'limits_memory_swappiness') {
                $normalized[$field] = $value === '' || $value === null ? 60 : (int) $value;
            }
        }

        return $normalized;
    }

    /**
     * @return array{
     *     limits_cpus: string|null,
     *     limits_cpuset: string|null,
     *     limits_cpu_shares: int,
     *     limits_memory: string,
     *     limits_memory_swap: string,
     *     limits_memory_reservation: string,
     *     limits_memory_swappiness: int
     * }
     */
    private function present(Application $application): array
    {
        return [
            'limits_cpus' => $application->limits_cpus !== null ? (string) $application->limits_cpus : '0',
            'limits_cpuset' => $application->limits_cpuset !== null && $application->limits_cpuset !== ''
                ? (string) $application->limits_cpuset
                : null,
            'limits_cpu_shares' => (int) ($application->limits_cpu_shares ?? 1024),
            'limits_memory' => (string) ($application->limits_memory ?: '0'),
            'limits_memory_swap' => (string) ($application->limits_memory_swap ?: '0'),
            'limits_memory_reservation' => (string) ($application->limits_memory_reservation ?: '0'),
            'limits_memory_swappiness' => (int) ($application->limits_memory_swappiness ?? 60),
        ];
    }
}
