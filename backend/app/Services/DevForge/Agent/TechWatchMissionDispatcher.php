<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\Application;
use App\Models\InstanceSettings;
use App\Models\Team;
use Illuminate\Support\Facades\Log;

/**
 * Agents type tech-watch → créent des missions (demandes) sur le board.
 */
class TechWatchMissionDispatcher
{
    public function __construct(
        private readonly AgentMissionBoard $missionBoard,
        private readonly AgentRunLauncher $agentRunLauncher,
    ) {}

    /**
     * @return array{checked: int, missions: int, runs: int}
     */
    public function dispatchDue(): array
    {
        if (! config('devforge.agents_enabled') || ! config('devforge.agents_tech_watch', true)) {
            return ['checked' => 0, 'missions' => 0, 'runs' => 0];
        }

        if (! $this->missionBoard->available()) {
            return ['checked' => 0, 'missions' => 0, 'runs' => 0];
        }

        $agents = AiAgent::query()
            ->where('is_active', true)
            ->where('type', 'tech-watch')
            ->with(['team', 'providerConfig'])
            ->get();

        $checked = 0;
        $missions = 0;
        $runs = 0;

        foreach ($agents as $agent) {
            $team = $agent->team;
            if (! $team instanceof Team) {
                continue;
            }

            $checked++;
            $created = $this->scanAgent($agent, $team);
            $missions += $created;

            if ($created > 0 && $agent->status !== 'running' && $agent->hasLlmProvider()) {
                $run = $this->agentRunLauncher->queue($agent, 'event', [
                    'event' => 'tech_watch_missions',
                    'missions_created' => $created,
                ]);
                if ($run !== null) {
                    $runs++;
                }
            }
        }

        return compact('checked', 'missions', 'runs');
    }

    private function scanAgent(AiAgent $agent, Team $team): int
    {
        $created = 0;

        $created += $this->maybeCreateCoolifyUpdateMission($agent, $team) ? 1 : 0;
        $created += $this->scanApplicationPhpVersions($agent, $team);
        $created += $this->scanStaleDockerTags($agent, $team);
        $created += $this->scanNodeLegacyHints($agent, $team);

        return $created;
    }

    private function maybeCreateCoolifyUpdateMission(AiAgent $agent, Team $team): bool
    {
        $current = trim((string) config('constants.coolify.version', ''));
        $latest = '';

        try {
            $latest = trim((string) get_latest_version_of_coolify());
        } catch (\Throwable) {
            $latest = '';
        }

        try {
            $settings = InstanceSettings::get();
            if ($latest === '' && ! empty($settings->new_version_available)) {
                // Flag connu sans numéro précis.
                $latest = 'newer';
            }
        } catch (\Throwable) {
            // ignore
        }

        if ($current === '' || $latest === '' || $current === $latest) {
            return false;
        }

        if ($latest !== 'newer'
            && version_compare($this->normalizeVersion($latest), $this->normalizeVersion($current), '<=')) {
            return false;
        }

        $mission = $this->missionBoard->upsertTechWatch(
            $team,
            $agent,
            $latest === 'newer'
                ? 'Mise à jour Coolify disponible'
                : "Mise à jour Coolify disponible ({$latest})",
            $latest === 'newer'
                ? "La version actuelle est {$current}. Une mise à jour est signalée. Vérifier les notes de version et planifier."
                : "La version actuelle est {$current}. Une mise à jour vers {$latest} est disponible. Vérifier les notes de version et planifier la mise à jour.",
            'tech-watch:coolify-update:'.($latest === 'newer' ? 'flag' : $latest),
            [
                'current_version' => $current,
                'latest_version' => $latest,
            ],
        );

        if ($mission !== null) {
            Log::info('DevForge: mission tech-watch Coolify update.', [
                'mission_uuid' => $mission->uuid,
                'agent_uuid' => $agent->uuid,
            ]);

            return true;
        }

        return false;
    }

    private function scanApplicationPhpVersions(AiAgent $agent, Team $team): int
    {
        $resourceUuid = is_string($agent->resource_uuid) && $agent->resource_uuid !== ''
            ? $agent->resource_uuid
            : null;

        $query = Application::query()->limit(30);
        if ($resourceUuid !== null) {
            $query->where('uuid', $resourceUuid);
        } else {
            $query->whereHas('environment.project', fn ($q) => $q->where('team_id', $team->id));
        }

        $count = 0;

        foreach ($query->get() as $application) {
            $hint = strtolower(implode(' ', array_filter([
                (string) ($application->build_pack ?? ''),
                (string) ($application->dockerfile_location ?? ''),
                (string) ($application->dockerfile ?? ''),
                (string) ($application->docker_registry_image_name ?? ''),
                (string) ($application->docker_registry_image_tag ?? ''),
            ])));

            if (! str_contains($hint, 'php') && ! str_contains($hint, 'laravel')) {
                continue;
            }

            if (! preg_match('/php[:\s-]*(7\.|8\.0|8\.1)/i', $hint)) {
                continue;
            }

            $mission = $this->missionBoard->upsertTechWatch(
                $team,
                $agent,
                "Runtime PHP potentiellement obsolète — {$application->name}",
                "L'application {$application->name} ({$application->uuid}) semble utiliser une version PHP ancienne (7.x / 8.0 / 8.1). Vérifier le Dockerfile / image et proposer une montée de version.",
                'tech-watch:php-outdated:'.$application->uuid,
                [
                    'application_uuid' => $application->uuid,
                    'build_pack' => (string) ($application->build_pack ?? ''),
                    'hint' => mb_substr($hint, 0, 200),
                ],
                $application->uuid,
            );

            if ($mission !== null) {
                $count++;
            }
        }

        return $count;
    }

    private function scanStaleDockerTags(AiAgent $agent, Team $team): int
    {
        $query = Application::query()
            ->whereHas('environment.project', fn ($q) => $q->where('team_id', $team->id))
            ->limit(30);

        $count = 0;
        $stale = ['latest', 'alpine', 'node:14', 'node:16', 'node:18', 'php:7', 'php:8.0', 'php:8.1'];

        foreach ($query->get() as $application) {
            $tag = strtolower(trim((string) ($application->docker_registry_image_tag ?? '')));
            $image = strtolower(trim((string) ($application->docker_registry_image_name ?? '')));
            $hint = $image.':'.$tag;

            $matched = null;
            foreach ($stale as $needle) {
                if ($tag === $needle || str_contains($hint, $needle)) {
                    $matched = $needle;
                    break;
                }
            }

            if ($matched === null) {
                continue;
            }

            $mission = $this->missionBoard->upsertTechWatch(
                $team,
                $agent,
                "Image Docker potentiellement obsolète — {$application->name}",
                "L'application {$application->name} utilise une image/tag à risque ({$matched}). Vérifier une montée de version et créer une PR si pertinent.",
                'tech-watch:docker-stale:'.$application->uuid.':'.$matched,
                [
                    'application_uuid' => $application->uuid,
                    'image' => $image,
                    'tag' => $tag,
                    'matched' => $matched,
                ],
                $application->uuid,
            );

            if ($mission !== null) {
                $count++;
            }
        }

        return $count;
    }

    private function scanNodeLegacyHints(AiAgent $agent, Team $team): int
    {
        $query = Application::query()
            ->whereHas('environment.project', fn ($q) => $q->where('team_id', $team->id))
            ->limit(30);

        $count = 0;

        foreach ($query->get() as $application) {
            $hint = strtolower(implode(' ', array_filter([
                (string) ($application->build_pack ?? ''),
                (string) ($application->dockerfile ?? ''),
                (string) ($application->docker_registry_image_name ?? ''),
                (string) ($application->docker_registry_image_tag ?? ''),
                (string) ($application->install_command ?? ''),
            ])));

            if (! preg_match('/node[:\s-]*(14|16|18)\b|nodejs[:\s-]*(14|16|18)\b/i', $hint)) {
                continue;
            }

            $mission = $this->missionBoard->create($team, [
                'title' => "Runtime Node potentiellement obsolète — {$application->name}",
                'description' => "L'application {$application->name} semble cibler Node 14/16/18. Proposer une montée vers Node 20/22 LTS et adapter les scripts de build.",
                'kind' => 'feature',
                'priority' => 'normal',
                'source' => 'tech-watch',
                'dedupe_key' => 'tech-watch:node-outdated:'.$application->uuid,
                'resource_uuid' => $application->uuid,
                'assignee_type' => 'devforge',
                'metadata' => [
                    'application_uuid' => $application->uuid,
                    'hint' => mb_substr($hint, 0, 200),
                ],
            ], $agent);

            if ($mission instanceof \App\Models\AiAgentMission) {
                $count++;
            }
        }

        return $count;
    }

    private function normalizeVersion(string $version): string
    {
        $clean = ltrim(trim($version), 'vV');

        return $clean !== '' ? $clean : '0.0.0';
    }
}
