<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentSession;
use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\GithubApp;
use App\Models\User;
use Illuminate\Support\Collection;

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
    public function compose(
        AiAgent $agent,
        User $user,
        ?AiAgentSession $session = null,
        ?Application $application = null,
    ): array {
        if ($application instanceof Application) {
            return $this->composeWorkspace($agent, $user, $session, $application);
        }

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
    private function composeWorkspace(
        AiAgent $agent,
        User $user,
        ?AiAgentSession $session,
        Application $application,
    ): array {
        $firstName = $this->firstName($user->name);
        $greeting = $firstName !== ''
            ? "Salut {$firstName}."
            : 'Salut.';
        $status = $this->applicationStatus($application);
        $statusBit = $status !== '' ? " ({$status})" : '';

        $content = "{$greeting} On est sur {$application->name}{$statusBit} — je vois déjà son statut, ses logs et ses variables. Dis-moi ce que tu veux corriger.";

        return [
            'uuid' => 'welcome',
            'role' => 'assistant',
            'content' => $content,
            'metadata' => array_filter([
                'welcome' => true,
                'application_uuid' => $application->uuid,
                'application_name' => (string) $application->name,
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
        if (is_string($agent->resource_uuid) && trim($agent->resource_uuid) !== '') {
            return null;
        }

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

        $ranked = $this->rankTeamApplications((int) $agent->team_id);
        if ($ranked->isEmpty()) {
            return null;
        }

        $quick = $ranked->take(5)->values();
        $catalog = $ranked->take(20)->values();

        $options = $quick->values()->map(function (Application $application, int $index): array {
            return $this->appChoiceOption($application, chr(65 + $index));
        })->all();

        $catalogOptions = $catalog->values()->map(function (Application $application, int $index): array {
            return $this->appChoiceOption($application, 'app-'.$index);
        })->all();

        return [
            'id' => 'pick_app',
            'title' => 'Sur quelle app je commence ?',
            'body' => 'Les apps en mauvais état d’abord. Tape les premières lettres du nom pour filtrer.',
            'searchable' => true,
            'options' => $options,
            'catalog' => $catalogOptions,
        ];
    }

    /**
     * @return array{id: string, label: string, hint: string, prompt: string}
     */
    private function appChoiceOption(Application $application, string $id): array
    {
        $status = $this->applicationStatus($application);
        $hint = $status !== '' ? $status : (string) $application->uuid;

        return [
            'id' => $id,
            'label' => (string) $application->name,
            'hint' => $hint,
            'prompt' => "Commence par inspecter l’application « {$application->name} » ({$application->uuid}).",
        ];
    }

    /**
     * @return Collection<int, Application>
     */
    private function rankTeamApplications(int $teamId): Collection
    {
        $degraded = Application::query()
            ->whereRelation('environment.project', 'team_id', $teamId)
            ->where(function ($query): void {
                $query->where('status', 'like', '%unhealthy%')
                    ->orWhere('status', 'like', '%exited%')
                    ->orWhere('status', 'like', '%failed%')
                    ->orWhere('status', 'like', '%restarting%')
                    ->orWhere('status', 'like', '%error%');
            })
            ->orderByDesc('updated_at')
            ->limit(20)
            ->get(['id', 'uuid', 'name', 'status', 'updated_at']);

        $recent = Application::query()
            ->whereRelation('environment.project', 'team_id', $teamId)
            ->orderByDesc('updated_at')
            ->limit(20)
            ->get(['id', 'uuid', 'name', 'status', 'updated_at']);

        $apps = $degraded->concat($recent)->unique('id')->values();
        if ($apps->isEmpty()) {
            return $apps;
        }

        $failedDeployIds = ApplicationDeploymentQueue::query()
            ->whereIn('application_id', $apps->pluck('id')->map(fn (mixed $id): string => (string) $id)->all())
            ->where('status', 'failed')
            ->orderByDesc('id')
            ->limit(80)
            ->pluck('application_id')
            ->map(fn (mixed $id): string => (string) $id)
            ->unique()
            ->flip();

        return $apps
            ->sortBy(function (Application $application) use ($failedDeployIds): string {
                $status = strtolower($this->applicationStatus($application));
                $severity = 3;
                if (
                    str_contains($status, 'unhealthy')
                    || str_contains($status, 'failed')
                    || str_contains($status, 'error')
                ) {
                    $severity = 0;
                } elseif (str_contains($status, 'exited') || str_contains($status, 'restarting')) {
                    $severity = 1;
                } elseif ($failedDeployIds->has((string) $application->id)) {
                    $severity = 2;
                }

                $updated = $application->updated_at?->getTimestamp() ?? 0;

                return sprintf('%d-%010d', $severity, 2_147_483_647 - $updated);
            })
            ->values();
    }

    private function applicationStatus(Application $application): string
    {
        $raw = $application->getAttributes()['status'] ?? null;
        if (is_string($raw) && $raw !== '') {
            return $raw;
        }

        try {
            $status = $application->status;
            if (is_string($status) && $status !== '') {
                return $status;
            }
        } catch (\Throwable) {
        }

        return '';
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
