<?php

namespace App\Services\DevForge\Readiness;

/**
 * Extracts structured readiness outcomes from an agent summary / metadata.
 *
 * Expected JSON (anywhere in the summary, or under metadata.readiness_outcome):
 * {
 *   "outcome": "auto_fixed|needs_user|failed",
 *   "title": "...",
 *   "summary": "...",
 *   "steps": ["...", ...] | [{"rank":1,"text":"..."}]
 * }
 */
class ReadinessAgentOutcomeParser
{
    /**
     * @param  array<string, mixed>|null  $metadata
     * @return array{
     *     outcome: string,
     *     title: string,
     *     summary: string|null,
     *     steps: list<array{rank: int, text: string, done: bool}>
     * }
     */
    public function parse(?string $summary, ?array $metadata = null): array
    {
        $fromMeta = $metadata['readiness_outcome'] ?? null;
        if (is_array($fromMeta)) {
            return $this->normalize($fromMeta, $summary);
        }

        $fromSummary = $this->extractJsonObject($summary ?? '');
        if ($fromSummary !== null) {
            return $this->normalize($fromSummary, $summary);
        }

        return $this->normalize([
            'outcome' => 'needs_user',
            // Titre générique volontaire : enrichi ensuite avec le contexte probe (HTTP/status).
            'title' => 'Intervention requise',
            'summary' => $summary,
            'steps' => [
                'Identifier la cause à partir de l\'erreur de probe / des logs applicatifs.',
                'Corriger le problème (variables d\'environnement, domaine, base de données, publish_directory…).',
                'Cliquer sur « C’est fait » pour relancer la vérification du domaine.',
            ],
        ], $summary);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array{
     *     outcome: string,
     *     title: string,
     *     summary: string|null,
     *     steps: list<array{rank: int, text: string, done: bool}>
     * }
     */
    private function normalize(array $payload, ?string $fallbackSummary): array
    {
        $outcome = strtolower(trim((string) ($payload['outcome'] ?? 'needs_user')));
        if (! in_array($outcome, ['auto_fixed', 'needs_user', 'failed'], true)) {
            $outcome = 'needs_user';
        }

        $title = trim((string) ($payload['title'] ?? ''));
        if ($title === '') {
            $title = match ($outcome) {
                'auto_fixed' => 'Correction automatique appliquée',
                'failed' => 'Surveillance en échec',
                default => 'Intervention utilisateur requise',
            };
        }

        $summary = isset($payload['summary'])
            ? trim((string) $payload['summary'])
            : null;
        if ($summary === null || $summary === '') {
            $summary = filled($fallbackSummary) ? mb_substr(trim($fallbackSummary), 0, 2000) : null;
        }

        return [
            'outcome' => $outcome,
            'title' => mb_substr($title, 0, 255),
            'summary' => $summary,
            'steps' => $this->normalizeSteps($payload['steps'] ?? []),
        ];
    }

    /**
     * @return list<array{rank: int, text: string, done: bool}>
     */
    private function normalizeSteps(mixed $steps): array
    {
        if (! is_array($steps) || $steps === []) {
            return [[
                'rank' => 1,
                'text' => 'Corriger le problème signalé puis cliquer sur « C’est fait ».',
                'done' => false,
            ]];
        }

        $normalized = [];
        $rank = 1;
        foreach ($steps as $step) {
            if (is_string($step)) {
                $text = trim($step);
                if ($text === '') {
                    continue;
                }
                $normalized[] = ['rank' => $rank, 'text' => $text, 'done' => false];
                $rank++;

                continue;
            }

            if (! is_array($step)) {
                continue;
            }

            $text = trim((string) ($step['text'] ?? $step['label'] ?? ''));
            if ($text === '') {
                continue;
            }

            $normalized[] = [
                'rank' => (int) ($step['rank'] ?? $rank),
                'text' => $text,
                'done' => (bool) ($step['done'] ?? false),
            ];
            $rank++;
        }

        if ($normalized === []) {
            return [[
                'rank' => 1,
                'text' => 'Corriger le problème signalé puis cliquer sur « C’est fait ».',
                'done' => false,
            ]];
        }

        usort($normalized, fn (array $a, array $b): int => $a['rank'] <=> $b['rank']);

        return array_values(array_map(
            fn (array $step, int $index): array => [
                'rank' => $index + 1,
                'text' => $step['text'],
                'done' => (bool) $step['done'],
            ],
            $normalized,
            array_keys($normalized),
        ));
    }

    /**
     * @return array<string, mixed>|null
     */
    private function extractJsonObject(string $text): ?array
    {
        if ($text === '') {
            return null;
        }

        $start = strpos($text, '{');
        $end = strrpos($text, '}');
        if ($start === false || $end === false || $end <= $start) {
            return null;
        }

        $candidate = substr($text, $start, $end - $start + 1);
        $decoded = json_decode($candidate, true);
        if (! is_array($decoded) || ! isset($decoded['outcome'])) {
            return null;
        }

        return $decoded;
    }
}
