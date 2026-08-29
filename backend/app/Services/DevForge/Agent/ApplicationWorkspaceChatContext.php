<?php

namespace App\Services\DevForge\Agent;

use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use Throwable;

class ApplicationWorkspaceChatContext
{
    use ApplicationWorkspaceChatContextSupport;

    public const FAILED_LOG_LINES = 15;

    /**
     * Live pack injected into agent chat (system prompt), never shown as a user bubble.
     * Secret values are never included — keys + shape hints only.
     *
     * @return array<string, mixed>
     */
    public function build(Application $application): array
    {
        $status = $this->resourceStatus($application);
        $pack = array_filter([
            'application_uuid' => (string) $application->uuid,
            'application_name' => (string) $application->name,
            'application_status' => $status,
            'git_repository' => is_string($application->git_repository) ? $application->git_repository : null,
            'git_branch' => is_string($application->git_branch) ? $application->git_branch : null,
            'build_pack' => is_string($application->build_pack) ? $application->build_pack : null,
            'fqdn' => is_string($application->fqdn) ? $application->fqdn : null,
            'health_check_enabled' => (bool) $application->health_check_enabled,
            'health_check_path' => filled($application->health_check_path) ? (string) $application->health_check_path : null,
            'health_check_port' => filled($application->health_check_port) ? (string) $application->health_check_port : null,
            'health_check_return_code' => filled($application->health_check_return_code) ? (string) $application->health_check_return_code : null,
            'ports_exposes' => filled($application->ports_exposes) ? (string) $application->ports_exposes : null,
            'start_command' => filled($application->start_command) ? (string) $application->start_command : null,
            'build_command' => filled($application->build_command) ? (string) $application->build_command : null,
            'detected_framework' => filled($application->detected_framework) ? (string) $application->detected_framework : null,
            'has_custom_nginx' => filled($application->custom_nginx_configuration),
        ], fn (mixed $value): bool => $value !== null && $value !== '');

        $pack['latest_deployment'] = $this->latestDeployment($application);
        $pack['env_var_hints'] = $this->envVarHints($application);
        $pack['linked_databases'] = $this->linkedDatabases($application);
        $pack['workspace_brief'] = $this->formatPromptBlock($pack);

        return $pack;
    }

    /**
     * Live pack from UUID only — do not rely on a frontend-sent workspace pack.
     *
     * @return array<string, mixed>|null
     */
    public function buildFromUuid(string $uuid): ?array
    {
        $uuid = trim($uuid);
        if ($uuid === '') {
            return null;
        }

        try {
            $application = Application::query()->where('uuid', $uuid)->first();
        } catch (Throwable) {
            return null;
        }

        if (! $application instanceof Application) {
            return null;
        }

        return $this->build($application);
    }

    /**
     * Compact team fleet for chat without application_uuid.
     * Unhealthy and last-deploy-failed apps first, cap 20.
     *
     * @return array<string, mixed>
     */
    public function buildTeamFleet(int $teamId, int $limit = 20): array
    {
        $limit = max(1, min(20, $limit));
        $fleet = $this->rankTeamApplications($teamId, $limit);
        $brief = $this->formatFleetPromptBlock($fleet);

        return [
            'fleet' => $fleet,
            'fleet_brief' => $brief,
            'workspace_brief' => $brief,
        ];
    }

    public static function statusReadingRules(): string
    {
        return <<<'RULES'
Règles de lecture du statut (obligatoires) :
- Dernier déploiement failed + conteneur running/healthy ≠ application non déployée. Dis : « déploiement échoué, rollback, l'app tourne encore ». Le badge UI « Déploiement · Échec » n'est PAS l'absence de conteneur.
- Dernier déploiement none (aucun) + statut exited = vraiment pas déployée.
- INTERDIT de demander plus de contexte à l'utilisateur pour « non déployé », santé ou statut. Outils d'abord : list_resources, get_resource_status, get_deployment_logs.
- Réponds toujours en français.
RULES;
    }
