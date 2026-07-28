<?php

namespace App\Services\DevForge\Agent;

/**
 * Captures / attachments chat → bloc texte injecté dans le message utilisateur.
 */
class AgentChatAttachments
{
    /**
     * @param  list<array<string, mixed>>|mixed  $raw
     */
    public function formatPromptBlock(mixed $raw): string
    {
        if (! is_array($raw) || $raw === []) {
            return '';
        }

        $blocks = [];
        foreach (array_slice($raw, 0, 8) as $index => $item) {
            if (! is_array($item)) {
                continue;
            }

            $type = strtolower(trim((string) ($item['type'] ?? 'capture')));
            $label = trim((string) ($item['label'] ?? $item['name'] ?? 'Capture '.($index + 1)));
            $url = trim((string) ($item['url'] ?? $item['src'] ?? ''));
            $text = trim((string) ($item['text'] ?? $item['annotation'] ?? $item['content'] ?? ''));
            $selector = trim((string) ($item['selector'] ?? $item['element'] ?? ''));

            $lines = ["### Capture ".($index + 1)." ({$type}) — {$label}"];
            if ($url !== '') {
                if (str_starts_with($url, 'data:image')) {
                    $lines[] = 'Image jointe (data URL, '.mb_strlen($url).' caractères) — analyse visuelle si le modèle le permet.';
                } else {
                    $lines[] = 'URL/media : '.mb_substr($url, 0, 2000);
                }
            }
            if ($selector !== '') {
                $lines[] = 'Élément : '.mb_substr($selector, 0, 500);
            }
            if ($text !== '') {
                $lines[] = 'Annotation : '.mb_substr($text, 0, 4000);
            }

            if (count($lines) > 1) {
                $blocks[] = implode("\n", $lines);
            }
        }

        if ($blocks === []) {
            return '';
        }

        return "CAPTURES UTILISATEUR (contexte visuel / UI) :\n\n".implode("\n\n", $blocks);
    }

    /**
     * @param  list<array<string, mixed>>|mixed  $raw
     */
    public function appendToContent(string $content, mixed $raw): string
    {
        $block = $this->formatPromptBlock($raw);
        if ($block === '') {
            return $content;
        }

        $trimmed = trim($content);

        return $trimmed === '' ? $block : $trimmed."\n\n".$block;
    }
}
