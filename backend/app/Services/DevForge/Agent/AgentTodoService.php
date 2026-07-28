<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgentRun;
use Illuminate\Support\Facades\Cache;

/**
 * Todo list par run — outils todo_read / todo_write (P2 DevForge).
 */
class AgentTodoService
{
    private const TTL_SECONDS = 86_400;

    /**
     * @return list<array{id: string, content: string, status: string}>
     */
    public function list(AiAgentRun $run): array
    {
        $items = Cache::get($this->key($run), []);

        return is_array($items) ? array_values($items) : [];
    }

    /**
     * @param  list<array{id?: string, content?: string, status?: string}>  $items
     * @return list<array{id: string, content: string, status: string}>
     */
    public function replace(AiAgentRun $run, array $items): array
    {
        $normalized = [];
        foreach (array_slice($items, 0, 40) as $index => $item) {
            if (! is_array($item)) {
                continue;
            }
            $content = trim((string) ($item['content'] ?? ''));
            if ($content === '') {
                continue;
            }
            $status = strtolower(trim((string) ($item['status'] ?? 'pending')));
            if (! in_array($status, ['pending', 'in_progress', 'completed', 'cancelled'], true)) {
                $status = 'pending';
            }
            $id = trim((string) ($item['id'] ?? ''));
            if ($id === '') {
                $id = 't'.($index + 1);
            }
            $normalized[] = [
                'id' => mb_substr($id, 0, 64),
                'content' => mb_substr($content, 0, 500),
                'status' => $status,
            ];
        }

        Cache::put($this->key($run), $normalized, self::TTL_SECONDS);
        $run->mergeMetadata(['todos' => $normalized]);

        return $normalized;
    }

    /**
     * @return array{id: string, content: string, status: string}|array{error: string}
     */
    public function upsert(AiAgentRun $run, string $content, string $status = 'pending', ?string $id = null): array
    {
        $content = trim($content);
        if ($content === '') {
            return ['error' => 'content requis'];
        }

        $items = $this->list($run);
        $status = strtolower(trim($status));
        if (! in_array($status, ['pending', 'in_progress', 'completed', 'cancelled'], true)) {
            $status = 'pending';
        }

        if ($id !== null && $id !== '') {
            $found = false;
            foreach ($items as $i => $item) {
                if ($item['id'] === $id) {
                    $items[$i]['content'] = mb_substr($content, 0, 500);
                    $items[$i]['status'] = $status;
                    $found = true;
                    break;
                }
            }
            if (! $found) {
                $items[] = ['id' => mb_substr($id, 0, 64), 'content' => mb_substr($content, 0, 500), 'status' => $status];
            }
        } else {
            $items[] = [
                'id' => 't'.(count($items) + 1),
                'content' => mb_substr($content, 0, 500),
                'status' => $status,
            ];
        }

        $items = $this->replace($run, $items);

        return $items[array_key_last($items)] ?? ['error' => 'échec écriture todo'];
    }

    private function key(AiAgentRun $run): string
    {
        return 'devforge:agent-todos:run:'.$run->id;
    }
}
