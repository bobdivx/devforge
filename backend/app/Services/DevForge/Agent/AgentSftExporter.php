<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentMessage;
use App\Models\AiAgentRun;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

class AgentSftExporter
{
    /** @var list<string> */
    public const PREFERRED_TYPES = ['deployment', 'devforge', 'debug'];

    public const PREFERRED_ROLE = 'deploy_operator';

    /**
     * Export completed agent traces as ChatML JSONL.
     *
     * Default: Relanceur / deploy / repair traces matching DefaultAgentProvisioner
     * (name LIKE %Relanceur% OR type IN (deployment, devforge, debug) OR metadata.role = deploy_operator).
     * --all: every team and every agent type.
     *
     * @return array{path: string, conversations: int, skipped: int, teams: int}
     */
    public function export(string $path, ?int $teamId = null, ?int $limit = null, bool $all = false): array
    {
        $query = AiAgentRun::query()
            ->with(['agent'])
            ->where('status', 'completed')
            ->orderByDesc('finished_at')
            ->orderByDesc('id');

        $query->whereHas('agent', function (Builder $agents) use ($teamId, $all) {
            if ($teamId !== null) {
                $agents->where('team_id', $teamId);
            }

            if (! $all) {
                $this->constrainToRelanceurAgents($agents);
            }
        });

        $written = 0;
        $skipped = 0;
        $teamIds = [];

        $directory = dirname($path);
        if ($directory !== '' && $directory !== '.' && ! is_dir($directory)) {
            mkdir($directory, 0755, true);
        }

        $handle = fopen($path, 'w');
        if ($handle === false) {
            throw new \RuntimeException("Impossible d'écrire le fichier JSONL : {$path}");
        }

        try {
            foreach ($query->cursor() as $run) {
                if ($limit !== null && $written >= $limit) {
                    break;
                }

                $conversation = $this->conversationForRun($run);
                if ($conversation === null) {
                    $skipped++;

                    continue;
                }

                $line = json_encode($conversation, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                if ($line === false) {
                    $skipped++;

                    continue;
                }

                fwrite($handle, $line."\n");
                $written++;
                if ($run->agent?->team_id) {
                    $teamIds[$run->agent->team_id] = true;
                }
            }
        } finally {
            fclose($handle);
        }

        return [
            'path' => $path,
            'conversations' => $written,
            'skipped' => $skipped,
            'teams' => count($teamIds),
        ];
    }

    public function constrainToRelanceurAgents(Builder $agents): Builder
    {
        return $agents->where(function (Builder $q) {
            $q->where('name', 'like', '%Relanceur%')
                ->orWhereIn('type', self::PREFERRED_TYPES)
                ->orWhere('metadata->role', self::PREFERRED_ROLE);
        });
    }

    public function isPreferredAgent(AiAgent $agent): bool
    {
        if (str_contains(mb_strtolower((string) $agent->name), 'relanceur')) {
            return true;
        }

        if (in_array((string) $agent->type, self::PREFERRED_TYPES, true)) {
            return true;
        }

        $metadata = is_array($agent->metadata) ? $agent->metadata : [];

        return ($metadata['role'] ?? null) === self::PREFERRED_ROLE;
    }

    /**
     * @return array{messages: list<array{role: string, content: string}>}|null
     */
    public function conversationForRun(AiAgentRun $run): ?array
    {
        if ($run->status !== 'completed') {
            return null;
        }

        $messages = $this->messagesForRun($run);
        if ($messages->isEmpty()) {
            return null;
        }

        $turns = [];
        $systemChunks = [];

        $prompt = trim((string) ($run->agent?->system_prompt ?? ''));
        if ($prompt !== '') {
            $systemChunks[] = $prompt;
        }

        $isFirstContent = true;
        foreach ($messages as $message) {
            $role = strtolower(trim((string) $message->role));
            $content = trim((string) $message->content);
            if ($content === '') {
                continue;
            }

            if (! in_array($role, ['system', 'user', 'assistant'], true)) {
                continue;
            }

            if ($isFirstContent && ($role === 'system' || $this->isSystemishContext($message))) {
                $systemChunks[] = $content;
                $isFirstContent = false;

                continue;
            }

            $isFirstContent = false;

            if (! in_array($role, ['user', 'assistant'], true)) {
                continue;
            }

            $turns[] = [
                'role' => $role,
                'content' => $content,
            ];
        }

        $hasUser = false;
        $hasAssistant = false;
        foreach ($turns as $turn) {
            if ($turn['role'] === 'user') {
                $hasUser = true;
            }
            if ($turn['role'] === 'assistant') {
                $hasAssistant = true;
            }
        }

        if (! $hasUser || ! $hasAssistant) {
            return null;
        }

        $out = [];
        if ($systemChunks !== []) {
            $out[] = [
                'role' => 'system',
                'content' => implode("\n\n", array_values(array_unique($systemChunks))),
            ];
        }

        return ['messages' => array_merge($out, $turns)];
    }

    /** @return Collection<int, AiAgentMessage> */
    private function messagesForRun(AiAgentRun $run): Collection
    {
        $messages = AiAgentMessage::query()
            ->where('run_id', $run->id)
            ->whereIn('role', ['system', 'user', 'assistant'])
            ->orderBy('id')
            ->get();

        if ($messages->isNotEmpty() || ! $run->session_id) {
            return $messages;
        }

        return AiAgentMessage::query()
            ->where('session_id', $run->session_id)
            ->whereIn('role', ['system', 'user', 'assistant'])
            ->orderBy('id')
            ->get();
    }

    private function isSystemishContext(AiAgentMessage $message): bool
    {
        $role = strtolower((string) $message->role);
        if ($role === 'system') {
            return true;
        }

        $meta = is_array($message->metadata) ? $message->metadata : [];
        $kind = strtolower((string) ($meta['kind'] ?? $meta['role'] ?? ''));
        if (in_array($kind, ['system', 'context', 'system_prompt', 'systemish'], true)) {
            return true;
        }
        if (($meta['system'] ?? false) === true || ($meta['is_system'] ?? false) === true) {
            return true;
        }

        if ($role !== 'user') {
            return false;
        }

        $content = ltrim((string) $message->content);
        foreach (['Contexte:', 'Context:', 'System:', 'System prompt', "Tu es l'agent", 'You are the'] as $prefix) {
            if (str_starts_with($content, $prefix)) {
                return true;
            }
        }

        return false;
    }
}
