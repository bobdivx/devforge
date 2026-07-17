<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentSession;
use App\Models\AiAgentSessionPreference;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class AgentSessionService
{
    /**
     * @return Collection<int, AiAgentSession>
     */
    public function listForUser(AiAgent $agent, User $user): Collection
    {
        return AiAgentSession::query()
            ->where('agent_id', $agent->id)
            ->where(function ($query) use ($user): void {
                $query->where('user_id', $user->id)
                    ->orWhereNull('user_id');
            })
            ->orderByDesc('last_message_at')
            ->orderByDesc('created_at')
            ->get();
    }

    public function rememberActive(AiAgent $agent, User $user, AiAgentSession $session): void
    {
        if ($session->agent_id !== $agent->id) {
            throw new \InvalidArgumentException('Session incompatible avec cet agent.');
        }

        if ($session->user_id !== null && $session->user_id !== $user->id) {
            throw new \InvalidArgumentException('Session inaccessible pour cet utilisateur.');
        }

        AiAgentSessionPreference::query()->updateOrCreate(
            [
                'user_id' => $user->id,
                'agent_id' => $agent->id,
            ],
            [
                'session_id' => $session->id,
            ],
        );
    }

    public function activeForUser(AiAgent $agent, User $user): ?AiAgentSession
    {
        if (! Schema::hasTable('ai_agent_session_preferences')) {
            return $this->latestForUser($agent, $user);
        }

        $preference = AiAgentSessionPreference::query()
            ->where('user_id', $user->id)
            ->where('agent_id', $agent->id)
            ->with('session')
            ->first();

        $session = $preference?->session;

        if ($session instanceof AiAgentSession && $this->userCanAccessSession($session, $user)) {
            return $session;
        }

        return $this->latestForUser($agent, $user);
    }

    public function create(AiAgent $agent, User $user, ?string $title = null): AiAgentSession
    {
        $session = AiAgentSession::query()->create([
            'uuid' => (string) Str::uuid(),
            'agent_id' => $agent->id,
            'user_id' => $user->id,
            'title' => $this->normalizeTitle($title) ?? 'Nouvelle conversation',
            'last_message_at' => null,
        ]);

        $this->rememberActive($agent, $user, $session);

        return $session;
    }

    public function findForUser(AiAgent $agent, User $user, string $sessionUuid): AiAgentSession
    {
        $session = AiAgentSession::query()
            ->where('uuid', $sessionUuid)
            ->where('agent_id', $agent->id)
            ->where(function ($query) use ($user): void {
                $query->where('user_id', $user->id)
                    ->orWhereNull('user_id');
            })
            ->first();

        if (! $session instanceof AiAgentSession) {
            throw new \InvalidArgumentException('Session introuvable.');
        }

        return $session;
    }

    public function latestForUser(AiAgent $agent, User $user): ?AiAgentSession
    {
        return AiAgentSession::query()
            ->where('agent_id', $agent->id)
            ->where(function ($query) use ($user): void {
                $query->where('user_id', $user->id)
                    ->orWhereNull('user_id');
            })
            ->orderByDesc('last_message_at')
            ->orderByDesc('created_at')
            ->first();
    }

    public function resolveDefault(AiAgent $agent, User $user): AiAgentSession
    {
        $existing = $this->activeForUser($agent, $user);

        if ($existing instanceof AiAgentSession) {
            return $existing;
        }

        return $this->create($agent, $user);
    }

    public function activate(AiAgent $agent, User $user, string $sessionUuid): AiAgentSession
    {
        $session = $this->findForUser($agent, $user, $sessionUuid);
        $this->rememberActive($agent, $user, $session);

        return $session;
    }

    private function userCanAccessSession(AiAgentSession $session, User $user): bool
    {
        return $session->user_id === null || $session->user_id === $user->id;
    }

    public function updateTitle(AiAgentSession $session, User $user, string $title): AiAgentSession
    {
        if ($session->user_id !== null && $session->user_id !== $user->id) {
            throw new \InvalidArgumentException('Vous ne pouvez pas renommer cette session.');
        }

        if ($session->isLegacyShared()) {
            throw new \InvalidArgumentException('La session historique partagée ne peut pas être renommée.');
        }

        $normalized = $this->normalizeTitle($title);
        if ($normalized === null) {
            throw new \InvalidArgumentException('Le titre de session est invalide.');
        }

        $session->update(['title' => $normalized]);

        return $session->fresh();
    }

    public function autoTitleFromMessage(AiAgentSession $session, string $content): void
    {
        if ($session->isLegacyShared()) {
            return;
        }

        if ($session->messages()->exists()) {
            return;
        }

        if (trim((string) $session->title) !== 'Nouvelle conversation') {
            return;
        }

        $title = $this->titleFromContent($content);
        if ($title !== null) {
            $session->update(['title' => $title]);
        }
    }

    private function normalizeTitle(?string $title): ?string
    {
        if ($title === null) {
            return null;
        }

        $trimmed = trim($title);
        if ($trimmed === '') {
            return null;
        }

        return Str::limit($trimmed, 120, '');
    }

    private function titleFromContent(string $content): ?string
    {
        $singleLine = preg_replace('/\s+/', ' ', trim($content)) ?? '';

        if ($singleLine === '') {
            return null;
        }

        return Str::limit($singleLine, 60, '…');
    }
}
