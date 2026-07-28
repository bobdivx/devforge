<?php

namespace App\Services\DevForge\Agent;

/**
 * Compaction / enrichissement du contexte chat pour les agents DevForge.
 */
class AgentContextCompactor
{
    /**
     * Enrichit un message assistant avec un résumé des steps (outils).
     *
     * @param  array<string, mixed>|null  $metadata
     */
    public function enrichAssistantContent(string $content, ?array $metadata): string
    {
        $steps = is_array($metadata['steps'] ?? null) ? $metadata['steps'] : [];
        if ($steps === []) {
            return $content;
        }

        $lines = [];
        foreach (array_slice($steps, -12) as $step) {
            if (! is_array($step)) {
                continue;
            }
            $status = (string) ($step['status'] ?? '?');
            $name = (string) ($step['name'] ?? $step['label'] ?? 'step');
            $summary = (string) ($step['result_summary'] ?? $step['args_summary'] ?? '');
            $summary = mb_substr($summary, 0, 180);
            $lines[] = "- [{$status}] {$name}".($summary !== '' ? ": {$summary}" : '');
        }

        if ($lines === []) {
            return $content;
        }

        return trim($content)."\n\n[Actions / outils de ce tour]\n".implode("\n", $lines);
    }

    /**
     * Compacte une liste de messages OpenAI-like pour rester sous un budget de caractères.
     *
     * @param  list<array<string, mixed>>  $messages
     * @return list<array<string, mixed>>
     */
    public function compact(array $messages, int $maxChars = 48_000): array
    {
        $total = $this->estimateChars($messages);
        if ($total <= $maxChars) {
            return $messages;
        }

        // Garde system (index 0) + derniers messages ; tronque le milieu.
        if (count($messages) <= 4) {
            return $this->truncateContents($messages, $maxChars);
        }

        $system = array_shift($messages);
        $keepTail = (int) max(6, floor(count($messages) * 0.55));
        $head = array_slice($messages, 0, 2);
        $tail = array_slice($messages, -$keepTail);
        $omitted = max(0, count($messages) - count($head) - count($tail));

        $compressed = [
            $system,
            ...$head,
            [
                'role' => 'user',
                'content' => "[Contexte compacté : {$omitted} messages intermédiaires omis pour limiter la taille.]",
            ],
            ...$tail,
        ];

        if ($this->estimateChars($compressed) > $maxChars) {
            return $this->truncateContents($compressed, $maxChars);
        }

        return $compressed;
    }

    /**
     * @param  list<array<string, mixed>>  $messages
     */
    private function estimateChars(array $messages): int
    {
        $n = 0;
        foreach ($messages as $message) {
            $n += mb_strlen((string) ($message['content'] ?? ''));
            if (isset($message['tool_calls']) && is_array($message['tool_calls'])) {
                $n += mb_strlen(json_encode($message['tool_calls']) ?: '');
            }
        }

        return $n;
    }

    /**
     * @param  list<array<string, mixed>>  $messages
     * @return list<array<string, mixed>>
     */
    private function truncateContents(array $messages, int $maxChars): array
    {
        $budget = (int) max(2000, floor($maxChars / max(1, count($messages))));
        foreach ($messages as $i => $message) {
            $content = (string) ($message['content'] ?? '');
            if (mb_strlen($content) > $budget) {
                $messages[$i]['content'] = mb_substr($content, 0, $budget - 1).'…';
            }
        }

        return $messages;
    }
}
