<?php

namespace App\Services\DevForge\Agent\Tool;

/**
 * Génère un diff texte unifié minimal (sans dépendance externe).
 */
class TextUnifiedDiff
{
    private const MAX_DIFF_CHARS = 12000;

    /**
     * @return array{
     *     path: string,
     *     is_new_file: bool,
     *     lines_added: int,
     *     lines_removed: int,
     *     diff: string
     * }
     */
    public static function preview(string $path, ?string $oldContent, string $newContent): array
    {
        $oldLines = self::normalizeLines($oldContent);
        $newLines = self::normalizeLines($newContent);
        $isNewFile = $oldContent === null;

        $ops = self::diffLines($oldLines, $newLines);
        $added = 0;
        $removed = 0;

        foreach ($ops as $op) {
            if ($op['op'] === '+') {
                $added++;
            } elseif ($op['op'] === '-') {
                $removed++;
            }
        }

        $diffBody = self::formatUnified($path, $ops);
        if (mb_strlen($diffBody) > self::MAX_DIFF_CHARS) {
            $diffBody = mb_substr($diffBody, 0, self::MAX_DIFF_CHARS)."\n… (diff tronqué)";
        }

        return [
            'path' => $path,
            'is_new_file' => $isNewFile,
            'lines_added' => $added,
            'lines_removed' => $removed,
            'diff' => $diffBody,
        ];
    }

    /**
     * @return list<string>
     */
    private static function normalizeLines(?string $content): array
    {
        if ($content === null || $content === '') {
            return [];
        }

        return explode("\n", str_replace(["\r\n", "\r"], "\n", $content));
    }

    /**
     * @param  list<string>  $oldLines
     * @param  list<string>  $newLines
     * @return list<array{op: string, line: string}>
     */
    private static function diffLines(array $oldLines, array $newLines): array
    {
        if ($oldLines === $newLines) {
            return [];
        }

        $ops = [];
        $oldCount = count($oldLines);
        $newCount = count($newLines);
        $i = 0;
        $j = 0;

        while ($i < $oldCount || $j < $newCount) {
            $oldLine = $oldLines[$i] ?? null;
            $newLine = $newLines[$j] ?? null;

            if ($oldLine !== null && $newLine !== null && $oldLine === $newLine) {
                $ops[] = ['op' => ' ', 'line' => $oldLine];
                $i++;
                $j++;

                continue;
            }

            $oldInNew = $newLine !== null
                ? array_search($newLine, array_slice($oldLines, $i + 1, 8), true)
                : false;
            $newInOld = $oldLine !== null
                ? array_search($oldLine, array_slice($newLines, $j + 1, 8), true)
                : false;

            if ($oldLine !== null && ($newLine === null || ($newInOld !== false && ($oldInNew === false || $newInOld <= $oldInNew)))) {
                $ops[] = ['op' => '-', 'line' => $oldLine];
                $i++;

                continue;
            }

            if ($newLine !== null) {
                $ops[] = ['op' => '+', 'line' => $newLine];
                $j++;
            }
        }

        return $ops;
    }

    /**
     * @param  list<array{op: string, line: string}>  $ops
     */
    private static function formatUnified(string $path, array $ops): string
    {
        if ($ops === []) {
            return '(aucun changement de contenu)';
        }

        $safePath = str_replace(["\n", "\r"], '', $path);
        $lines = ["--- a/{$safePath}", "+++ b/{$safePath}"];

        foreach ($ops as $op) {
            $lines[] = $op['op'].$op['line'];
        }

        return implode("\n", $lines);
    }
}
