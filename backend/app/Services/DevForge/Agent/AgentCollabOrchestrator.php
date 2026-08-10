<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentRun;

/**
 * Collaboration multi-rôles bornée (P5.2) — natif, sans AutoGen/GroupChat.
 *
 * Mode pipeline (défaut) reste inchangé. Mode collab : tours séquentiels
 * round_robin | auto, stop sur [DEVFORGE_DONE] / consensus / max rounds.
 *
 * @phpstan-type TranscriptEntry array{
 *     round: int,
 *     role_slug: string,
 *     leaf_profile: string|null,
 *     run_uuid: string|null,
 *     status: string,
 *     summary: string|null,
 *     next_speaker: string|null
 * }
 */
class AgentCollabOrchestrator
{
    /** @var list<string> */
    public const BLOCKED_EVENTS = [
        'deployment_failed',
        'deployment_build_started',
        'deployment_build_completed',
        'application_readiness_failed',
        'github_workflow_run_failed',
    ];

    public const MODE_PIPELINE = 'pipeline';

    public const MODE_COLLAB = 'collab';

    public const SELECTION_AUTO = 'auto';

    public const SELECTION_ROUND_ROBIN = 'round_robin';

    public function __construct(
        private readonly AgentRoleFactory $roleFactory,
        private readonly AgentDelegator $delegator,
        private readonly AgentTeamReporter $teamReporter,
    ) {}

    public function enabled(): bool
    {
        return filter_var(config('devforge.agents_collab_enabled', true), FILTER_VALIDATE_BOOLEAN);
    }

    public function maxRounds(): int
    {
        return max(1, min(20, (int) config('devforge.agents_max_collab_rounds', 8)));
    }

    /**
     * @param  array<string, mixed>  $context
     */
    public function isAllowed(array $context): bool
    {
        $event = strtolower(trim((string) ($context['event'] ?? '')));
        if (in_array($event, self::BLOCKED_EVENTS, true)) {
            return false;
        }

        $orchestration = strtolower(trim((string) ($context['orchestration'] ?? self::MODE_PIPELINE)));
        if ($orchestration === self::MODE_COLLAB) {
            return true;
        }

        // Appel explicite via outil collab même si metadata parent est pipeline
        return ($context['force_collab'] ?? false) === true;
    }

    public function normalizeSelection(?string $selection): string
    {
        $selection = strtolower(trim((string) $selection));

        return match ($selection) {
            self::SELECTION_ROUND_ROBIN, 'round-robin', 'rr' => self::SELECTION_ROUND_ROBIN,
            default => self::SELECTION_AUTO,
        };
    }

    /**
     * @param  list<array{slug?: string}>  $roles
     * @param  list<TranscriptEntry>  $transcript
     */
    public function selectNextSpeaker(array $roles, array $transcript, string $selection, int $round): ?string
    {
        $slugs = array_values(array_filter(array_map(
            fn ($role): string => is_array($role) ? (string) ($role['slug'] ?? '') : '',
            $roles,
        )));

        if ($slugs === []) {
            return null;
        }

        $selection = $this->normalizeSelection($selection);

        if ($selection === self::SELECTION_ROUND_ROBIN) {
            return $slugs[$round % count($slugs)];
        }

        // auto : honorer [NEXT_SPEAKER:…] du dernier tour si valide
        if ($transcript !== []) {
            $last = $transcript[array_key_last($transcript)];
            $next = $this->normalizeKnownSlug($last['next_speaker'] ?? null, $slugs);
            if ($next !== null) {
                return $next;
            }
        }

        // Heuristique : premier tour = premier rôle ; sinon round-robin
        if ($round === 0) {
            return $slugs[0];
        }

        return $slugs[$round % count($slugs)];
    }

    public function parseNextSpeaker(?string $text): ?string
    {
        if ($text === null || trim($text) === '') {
            return null;
        }

        if (preg_match('/\[NEXT_SPEAKER\s*:\s*([a-z0-9_\-]+)\]/iu', $text, $matches) === 1) {
            return $this->roleFactory->normalizeSlug($matches[1]);
        }

        if (preg_match('/next[_\s-]?speaker\s*[:=]\s*([a-z0-9_\-]+)/iu', $text, $matches) === 1) {
            return $this->roleFactory->normalizeSlug($matches[1]);
        }

        return null;
    }

    /**
     * @param  TranscriptEntry  $entry
     * @param  list<TranscriptEntry>  $transcript
     */
    public function shouldStop(array $entry, array $transcript): bool
    {
        $summary = (string) ($entry['summary'] ?? '');
        if ($summary !== '' && preg_match('/\[DEVFORGE_DONE\]|<\/?DEVFORGE_DONE/iu', $summary) === 1) {
            return true;
        }

        if (($entry['next_speaker'] ?? null) === 'done' || ($entry['next_speaker'] ?? null) === 'none') {
            return true;
        }

        // Consensus : 2 derniers tours DONE-like ou même conclusion courte
        if (count($transcript) >= 2) {
            $a = mb_strtolower((string) ($transcript[count($transcript) - 2]['summary'] ?? ''));
            $b = mb_strtolower($summary);
            if ($a !== '' && $b !== '' && str_contains($a, 'consensus') && str_contains($b, 'consensus')) {
                return true;
            }
        }

        return false;
    }

    /**
     * Boucle collab synchrone (wait=true par tour).
     *
     * @param  list<string>|null  $roles
     * @param  array<string, mixed>  $hints
     * @return array<string, mixed>
     */
    public function run(
        AiAgent $parent,
        AiAgentRun $parentRun,
        string $goal,
        ?array $roles = null,
        string $speakerSelection = self::SELECTION_AUTO,
        array $hints = [],
    ): array {
        if (! $this->enabled()) {
            return ['error' => 'Mode collab désactivé (agents_collab_enabled).'];
        }

        $context = array_merge($parentRun->metadata ?? [], $hints, [
            'force_collab' => true,
            'orchestration' => self::MODE_COLLAB,
        ]);

        if (! $this->isAllowed($context)) {
            return [
                'error' => 'Mode collab interdit pour cet événement (pipeline deploy/CI obligatoire).',
                'blocked_events' => self::BLOCKED_EVENTS,
            ];
        }

        $goal = trim($goal);
        if ($goal === '') {
            return ['error' => 'Objectif collab vide.'];
        }

        if (! $this->roleFactory->enabled()) {
            return ['error' => 'Rôles dynamiques désactivés — requis pour le mode collab.'];
        }

        $proposed = $this->roleFactory->propose($goal, $roles, array_merge([
            'agent_type' => $parent->type,
            'event' => $parentRun->metadata['event'] ?? null,
            'mission_kind' => $parentRun->metadata['mission_kind'] ?? null,
        ], $hints));

        if ($proposed === []) {
            return ['error' => 'Aucun rôle proposé pour la collab.'];
        }

        $selection = $this->normalizeSelection($speakerSelection);
        $maxRounds = $this->maxRounds();
        $transcript = [];
        $stoppedReason = 'max_rounds';

        $parentRun->mergeMetadata([
            'orchestration' => self::MODE_COLLAB,
            'speaker_selection' => $selection,
            'collab_roles' => array_column($proposed, 'slug'),
        ]);
        $parentRun->appendLog("Collab démarrée ({$selection}, max {$maxRounds} tours) — rôles: ".implode(', ', array_column($proposed, 'slug')));

        for ($round = 0; $round < $maxRounds; $round++) {
            $speaker = $this->selectNextSpeaker($proposed, $transcript, $selection, $round);
            if ($speaker === null) {
                $stoppedReason = 'no_speaker';
                break;
            }

            $spec = null;
            foreach ($proposed as $role) {
                if (($role['slug'] ?? '') === $speaker) {
                    $spec = $role;
                    break;
                }
            }
            if ($spec === null) {
                $stoppedReason = 'unknown_speaker';
                break;
            }

            $turnGoal = $this->buildTurnGoal($goal, $spec, $transcript, $round, $selection);
            $parentRun->appendLog('  ↳ Collab round '.($round + 1)."/{$maxRounds} → {$speaker}");

            $result = $this->delegator->spawnEphemeral(
                $parent,
                $parentRun,
                $turnGoal,
                (string) ($spec['difficulty'] ?? 'auto'),
                true,
                (string) ($spec['leaf_profile'] ?? 'research'),
                [
                    'role_slug' => (string) $spec['slug'],
                    'role_system_prompt' => trim(
                        (string) ($spec['system_prompt'] ?? '')
                        ."\n\nMode COLLAB : tu parles à tour de rôle. "
                        .'Termine par [NEXT_SPEAKER:role] pour passer la parole, ou [DEVFORGE_DONE] si consensus.'
                    ),
                ],
            );

            $summary = (string) ($result['summary'] ?? $result['error'] ?? '');
            $entry = [
                'round' => $round + 1,
                'role_slug' => (string) $spec['slug'],
                'leaf_profile' => (string) ($spec['leaf_profile'] ?? ''),
                'run_uuid' => isset($result['ephemeral_run_uuid']) ? (string) $result['ephemeral_run_uuid'] : null,
                'status' => ($result['success'] ?? false) ? 'completed' : 'failed',
                'summary' => $summary !== '' ? mb_substr($summary, 0, 2000) : null,
                'next_speaker' => $this->parseNextSpeaker($summary),
            ];
            $transcript[] = $entry;

            $parentRun->mergeMetadata(['collab_transcript' => $transcript]);

            if ($this->shouldStop($entry, $transcript)) {
                $stoppedReason = 'done';
                break;
            }

            if (($result['success'] ?? false) !== true && $selection === self::SELECTION_AUTO) {
                // Échec leaf : laisser round_robin tenter le suivant sauf DONE
                continue;
            }
        }

        $completions = array_map(static fn (array $entry): array => [
            'run_uuid' => $entry['run_uuid'],
            'goal' => null,
            'status' => $entry['status'],
            'summary' => $entry['summary'],
            'contribution' => $entry['summary'],
            'role_slug' => $entry['role_slug'],
            'leaf_profile' => $entry['leaf_profile'],
        ], $transcript);

        $teamReport = $this->teamReporter->persist($parentRun, $completions);
        $parentRun->mergeMetadata([
            'collab_transcript' => $transcript,
            'collab_stopped_reason' => $stoppedReason,
            'orchestration' => self::MODE_COLLAB,
            'team_report' => $teamReport,
        ]);

        $ok = collect($transcript)->where('status', 'completed')->count();

        return [
            'success' => $ok > 0,
            'mode' => self::MODE_COLLAB,
            'speaker_selection' => $selection,
            'rounds' => count($transcript),
            'max_rounds' => $maxRounds,
            'stopped_reason' => $stoppedReason,
            'roles' => array_column($proposed, 'slug'),
            'transcript' => $transcript,
            'team_report' => $teamReport,
            'summary' => $teamReport['markdown'] ?? null,
        ];
    }

    /**
     * @param  array{slug: string, label?: string, system_prompt?: string}  $spec
     * @param  list<TranscriptEntry>  $transcript
     */
    private function buildTurnGoal(string $parentGoal, array $spec, array $transcript, int $round, string $selection): string
    {
        $label = (string) ($spec['label'] ?? $spec['slug']);
        $history = '';
        foreach (array_slice($transcript, -4) as $entry) {
            $history .= '- '.$entry['role_slug'].' : '.mb_substr((string) ($entry['summary'] ?? '—'), 0, 400)."\n";
        }

        return trim(<<<GOAL
        [COLLAB round {$round} / rôle {$label}]
        Objectif d’équipe : {$parentGoal}

        Transcription récente :
        {$history}

        Apporte ta contribution de {$label}. Sélection: {$selection}.
        Si un autre rôle doit parler ensuite : [NEXT_SPEAKER:slug]
        Si l’équipe a terminé : [DEVFORGE_DONE]
        GOAL);
    }

    /**
     * @param  list<string>  $allowed
     */
    private function normalizeKnownSlug(mixed $slug, array $allowed): ?string
    {
        if (! is_string($slug) || trim($slug) === '') {
            return null;
        }

        $normalized = $this->roleFactory->normalizeSlug($slug);
        if (in_array($normalized, ['done', 'none', 'stop'], true)) {
            return null;
        }

        return in_array($normalized, $allowed, true) ? $normalized : null;
    }
}
