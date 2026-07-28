<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentMessage;
use App\Models\AiAgentRun;
use App\Models\AiAgentSession;
use App\Models\Application;
use Illuminate\Support\Facades\Log;

/**
 * Publie dans le chat « Vue d’ensemble » (session App · {name}) :
 * l’erreur claire, puis le rapport d’intervention agent.
 */
class ApplicationOverviewChatBridge
{
    public static function sessionTitle(string $applicationName): string
    {
        return 'App · '.$applicationName;
    }

    /**
     * @param  array<string, mixed>  $context
     */
    public function postFailureAnnouncement(
        AiAgent $agent,
        AiAgentRun $run,
        Application $application,
        array $context,
    ): ?AiAgentMessage {
        $session = $this->resolveOverviewSession($agent, $application->name);
        if ($session === null) {
            return null;
        }

        $deploymentUuid = is_string($context['deployment_uuid'] ?? null) ? $context['deployment_uuid'] : null;
        $event = is_string($context['event'] ?? null) ? $context['event'] : 'deployment_failed';
        $excerpt = $this->formatFailureExcerpt($context);

        $title = $event === 'application_readiness_failed'
            ? 'Probe HTTP en échec après déploiement'
            : 'Déploiement en échec';

        $content = "## {$title}\n\n"
            ."**État du problème :** `erreur`\n"
            .'**Application :** '.$application->name."\n"
            .($deploymentUuid ? '**Déploiement :** `'.$deploymentUuid."`\n" : '')
            ."\n### Erreur observée\n\n"
            ."```\n{$excerpt}\n```\n\n"
            .'Je lance une correction automatique. Le rapport détaillé suivra.';

        return $this->postAssistantMessage($agent, $session, $run, $content, [
            'kind' => 'deployment_failure_announcement',
            'event' => $event,
            'application_uuid' => $application->uuid,
            'deployment_uuid' => $deploymentUuid,
            'problem_status' => 'error',
            'source' => 'overview_bridge',
        ]);
    }

    /**
     * @param  array<string, mixed>  $context
     */
    public function postInterventionReport(
        AiAgent $agent,
        AiAgentRun $run,
        array $context = [],
    ): ?AiAgentMessage {
        $applicationUuid = is_string($context['application_uuid'] ?? null)
            ? $context['application_uuid']
            : (is_string($run->metadata['application_uuid'] ?? null) ? $run->metadata['application_uuid'] : null);

        $applicationName = is_string($context['application_name'] ?? null)
            ? $context['application_name']
            : (is_string($run->metadata['application_name'] ?? null) ? $run->metadata['application_name'] : null);

        if ($applicationName === null && $applicationUuid !== null) {
            $applicationName = Application::query()->where('uuid', $applicationUuid)->value('name');
        }

        if (! is_string($applicationName) || $applicationName === '') {
            Log::warning('DevForge overview chat: impossible de résoudre le nom d’application pour le rapport.', [
                'run_uuid' => $run->uuid,
                'application_uuid' => $applicationUuid,
            ]);

            return null;
        }

        $session = $this->resolveOverviewSession($agent, $applicationName);
        if ($session === null) {
            return null;
        }

        $run->refresh();
        $correction = is_array($run->metadata['correction'] ?? null) ? $run->metadata['correction'] : [];
        $actions = is_array($correction['actions'] ?? null)
            ? $correction['actions']
            : (is_array($run->metadata['correction_actions'] ?? null) ? $run->metadata['correction_actions'] : []);

        $outcome = is_string($correction['outcome'] ?? null) ? $correction['outcome'] : $this->outcomeFromRunStatus($run);
        $problemStatus = $this->problemStatusFromOutcome($outcome, (string) $run->status);
        $headline = is_string($correction['headline'] ?? null) && $correction['headline'] !== ''
            ? $correction['headline']
            : (trim((string) ($run->summary ?? '')) !== '' ? (string) $run->summary : 'Intervention terminée.');
        $diagnosis = is_string($correction['diagnosis'] ?? null) ? trim($correction['diagnosis']) : '';

        $doneLines = [];
        $failedLines = [];
        foreach ($actions as $action) {
            if (! is_array($action)) {
                continue;
            }
            $label = trim((string) ($action['label'] ?? $action['kind'] ?? 'Action'));
            $detail = trim((string) ($action['detail'] ?? ''));
            $line = $detail !== '' ? "{$label} — {$detail}" : $label;
            if (($action['ok'] ?? true) === false
                || ($action['kind'] ?? '') === 'needs_user'
                || ($action['kind'] ?? '') === 'attempt_failed'
            ) {
                $failedLines[] = '- ❌ '.$line;
            } else {
                $doneLines[] = '- ✅ '.$line;
            }
        }

        if ($doneLines === [] && $failedLines === [] && in_array($outcome, ['no_action', 'failed'], true)) {
            $failedLines[] = '- ❌ Aucune correction automatique applicable (cause hors scope, secret manquant, ou diagnostic seul).';
        }

        $content = "## Rapport d’intervention\n\n"
            .'**État du problème :** `'.$problemStatus."`\n"
            .'**Résultat agent :** '.$this->outcomeLabelFr($outcome)."\n"
            .'**Application :** '.$applicationName."\n\n"
            ."### Ce que j’ai fait\n\n"
            .($doneLines !== [] ? implode("\n", $doneLines) : '_Aucune action corrective réussie._')
            ."\n\n### Ce que je n’ai pas pu faire / reste à faire\n\n"
            .($failedLines !== [] ? implode("\n", $failedLines) : '_Rien de bloquant signalé._')
            ."\n\n### Synthèse\n\n"
            .$headline
            .($diagnosis !== '' && $diagnosis !== $headline ? "\n\n".$diagnosis : '');

        $pendingApproval = is_array($run->metadata['pending_approval'] ?? null)
            ? $run->metadata['pending_approval']
            : null;

        return $this->postAssistantMessage($agent, $session, $run, $content, [
            'kind' => 'deployment_intervention_report',
            'event' => $context['event'] ?? ($run->metadata['event'] ?? null),
            'application_uuid' => $applicationUuid,
            'deployment_uuid' => $context['deployment_uuid'] ?? ($run->metadata['deployment_uuid'] ?? null),
            'problem_status' => $problemStatus,
            'outcome' => $outcome,
            'correction' => $correction !== [] ? $correction : null,
            'pending_approval' => $pendingApproval,
            'source' => 'overview_bridge',
        ]);
    }

    public function resolveOverviewSession(AiAgent $agent, string $applicationName): ?AiAgentSession
    {
        $title = self::sessionTitle($applicationName);

        $existing = AiAgentSession::query()
            ->where('agent_id', $agent->id)
            ->where('title', $title)
            ->orderByRaw('case when user_id is null then 0 else 1 end')
            ->orderByDesc('last_message_at')
            ->orderByDesc('id')
            ->first();

        if ($existing instanceof AiAgentSession) {
            return $existing;
        }

        try {
            return AiAgentSession::query()->create([
                'agent_id' => $agent->id,
                'user_id' => null,
                'title' => $title,
                'chat_mode' => 'build',
                'last_message_at' => null,
            ]);
        } catch (\Throwable $e) {
            Log::warning('DevForge overview chat: création session impossible.', [
                'agent_uuid' => $agent->uuid,
                'title' => $title,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    /**
     * @param  array<string, mixed>  $metadata
     */
    private function postAssistantMessage(
        AiAgent $agent,
        AiAgentSession $session,
        AiAgentRun $run,
        string $content,
        array $metadata,
    ): AiAgentMessage {
        $message = AiAgentMessage::query()->create([
            'agent_id' => $agent->id,
            'session_id' => $session->id,
            'run_id' => $run->id,
            'role' => 'assistant',
            'content' => $content,
            'metadata' => $metadata,
        ]);

        $session->touchLastMessage();

        return $message;
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function formatFailureExcerpt(array $context): string
    {
        if (is_string($context['probe_error'] ?? null) && trim((string) $context['probe_error']) !== '') {
            $status = $context['probe_status'] ?? null;
            $url = is_string($context['probe_url'] ?? null) ? $context['probe_url'] : '';

            return trim(($url !== '' ? "URL: {$url}\n" : '')
                .(is_scalar($status) ? "HTTP: {$status}\n" : '')
                .(string) $context['probe_error']);
        }

        $excerpt = is_array($context['failure_excerpt'] ?? null) ? $context['failure_excerpt'] : [];
        $lines = collect($excerpt)
            ->map(function ($line): string {
                if (is_array($line)) {
                    return trim((string) ($line['message'] ?? ''));
                }

                return trim((string) $line);
            })
            ->filter()
            ->take(-12)
            ->values();

        if ($lines->isEmpty()) {
            return 'Aucune ligne d’erreur extractible des logs. Ouvrez l’onglet Déploiements pour le détail.';
        }

        return $lines->implode("\n");
    }

    private function outcomeFromRunStatus(AiAgentRun $run): string
    {
        return match ((string) $run->status) {
            'failed' => 'failed',
            'awaiting_approval', 'waiting_for_input' => 'needs_user',
            'pending', 'running' => 'running',
            default => 'no_action',
        };
    }

    private function problemStatusFromOutcome(string $outcome, string $runStatus): string
    {
        if (in_array($runStatus, ['awaiting_approval', 'waiting_for_input'], true)) {
            return 'awaiting_user';
        }

        return match ($outcome) {
            'fixed' => 'resolved',
            'partial', 'redeploy_only' => 'partial',
            'needs_user' => 'awaiting_user',
            'running' => 'investigating',
            'failed' => 'error',
            default => 'unresolved',
        };
    }

    private function outcomeLabelFr(string $outcome): string
    {
        return match ($outcome) {
            'fixed' => 'Corrigé',
            'partial' => 'Partiel',
            'failed' => 'Échec',
            'no_action' => 'Aucune action',
            'redeploy_only' => 'Redeploy seul',
            'running' => 'En cours',
            'needs_user' => 'Action requise',
            default => $outcome,
        };
    }
}
