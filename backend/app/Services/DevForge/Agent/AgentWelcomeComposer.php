<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentSession;
use App\Models\Application;
use App\Models\GithubApp;
use App\Models\User;

class AgentWelcomeComposer
{
    /**
     * @return array{
     *     uuid: string,
     *     role: string,
     *     content: string,
     *     metadata: array<string, mixed>,
     *     run_uuid: null,
     *     session_uuid: string|null,
     *     created_at: string
     * }
     */
    public function compose(AiAgent $agent, User $user, ?AiAgentSession $session = null): array
    {
        $firstName = $this->firstName($user->name);
        $greeting = $firstName !== ''
            ? "Salut {$firstName}."
            : 'Salut.';
        $description = $agent->description
            ? "\n\n{$agent->description}"
            : '';

        $content = "{$greeting} Je vais checker tes déploiements, tes logs et tes erreurs pour te dire ce qui cloche. Tu n’as rien à faire.{$description}";

        return [
            'uuid' => 'welcome',
            'role' => 'assistant',
            'content' => $content,
            'metadata' => array_filter([
                'welcome' => true,
                'choice_card' => $this->choiceCard($agent),
            ]),
            'run_uuid' => null,
            'session_uuid' => $session?->uuid,
            'created_at' => $agent->created_at?->toISOString() ?? now()->toISOString(),
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function choiceCard(AiAgent $agent): ?array
    {
        if (! $this->teamHasGithubApp((int) $agent->team_id)) {
            return [
                'id' => 'github_connect',
                'title' => 'Connecte GitHub pour que je puisse inspecter tes dépôts',
                'body' => 'Une GitHub App installée me donne accès aux PRs, aux Actions et au code.',
                'options' => [
                    [
                        'id' => 'A',
                        'label' => 'Connecter GitHub',
                        'hint' => 'Je t’accompagne pour installer une GitHub App sur cette équipe.',
                        'prompt' => 'Aide-moi à connecter une GitHub App à cette équipe DevForge.',
                    ],
                    [
                        'id' => 'B',
                        'label' => 'Plus tard',
                        'hint' => 'On continue sans GitHub pour l’instant.',
                        'prompt' => 'On verra GitHub plus tard, continue sans connecteur.',
                    ],
                ],
            ];
        }

        $apps = Application::query()
            ->whereRelation('environment.project', 'team_id', $agent->team_id)
            ->orderBy('name')
            ->limit(3)
            ->get(['uuid', 'name']);

        if ($apps->isEmpty()) {
            return null;
        }

        $options = $apps->values()->map(function (Application $application, int $index): array {
            $letter = chr(65 + $index);

            return [
                'id' => $letter,
                'label' => (string) $application->name,
                'hint' => $application->uuid,
                'prompt' => "Commence par inspecter l’application « {$application->name} » ({$application->uuid}).",
            ];
        })->all();

        if ($apps->count() > 1) {
            $names = $apps->pluck('name')->implode(', ');
            $options[] = [
                'id' => 'all',
                'label' => $apps->count() === 2 ? 'Les deux' : 'Les trois',
                'prompt' => "Inspecte ces applications : {$names}.",
            ];
        } else {
            $options[] = [
                'id' => 'later',
                'label' => 'Plus tard',
                'prompt' => 'Ne commence pas encore par une application.',
            ];
        }

        return [
            'id' => 'pick_app',
            'title' => 'Sur lequel je commence à cliquer ?',
            'body' => 'Je peux inspecter tes apps tout de suite : logs, déploiements, erreurs.',
            'options' => $options,
        ];
    }

    private function teamHasGithubApp(int $teamId): bool
    {
        return GithubApp::query()
            ->where(function ($query) use ($teamId): void {
                $query->where('team_id', $teamId)
                    ->orWhere('is_system_wide', true);
            })
            ->whereNotNull('installation_id')
            ->where('installation_id', '!=', 0)
            ->exists();
    }

    private function firstName(?string $fullName): string
    {
        $trimmed = trim((string) $fullName);
        if ($trimmed === '') {
            return '';
        }

        return explode(' ', $trimmed)[0] ?? $trimmed;
    }
}
