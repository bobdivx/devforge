<?php

namespace App\Services\DevForge\Agent;

use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\EnvironmentVariable;
use App\Services\DevForge\Database\LibsqlConnectionEnvSync;
use App\Services\DevForge\SecretRedactor;
use Throwable;

class ApplicationWorkspaceChatContext
{
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

    /**
     * @param  array<string, mixed>  $pack
     */
    public function formatPromptBlock(array $pack): string
    {
        $uuid = trim((string) ($pack['application_uuid'] ?? ''));
        if ($uuid === '') {
            return '';
        }

        $name = (string) ($pack['application_name'] ?? 'Application');
        $status = (string) ($pack['application_status'] ?? 'inconnu');
        $gitRepository = (string) ($pack['git_repository'] ?? 'inconnu');
        $gitBranch = (string) ($pack['git_branch'] ?? 'inconnu');
        $buildPack = (string) ($pack['build_pack'] ?? 'inconnu');
        $fqdn = (string) ($pack['fqdn'] ?? 'aucun');
        $healthEnabled = ! empty($pack['health_check_enabled']) ? 'oui' : 'non';
        $healthPath = (string) ($pack['health_check_path'] ?? '—');
        $healthPort = (string) ($pack['health_check_port'] ?? '—');
        $healthCode = (string) ($pack['health_check_return_code'] ?? '—');
        $ports = (string) ($pack['ports_exposes'] ?? 'inconnu');
        $start = (string) ($pack['start_command'] ?? 'défaut');
        $build = (string) ($pack['build_command'] ?? 'défaut');
        $framework = (string) ($pack['detected_framework'] ?? 'inconnu');
        $nginx = ! empty($pack['has_custom_nginx']) ? 'oui' : 'non';

        $envLines = $this->formatEnvHints($pack['env_var_hints'] ?? []);
        $dbLines = $this->formatLinkedDatabases($pack['linked_databases'] ?? []);
        $deployBlock = $this->formatLatestDeployment($pack['latest_deployment'] ?? null);

        $rules = self::statusReadingRules();

        return trim(<<<CONTEXT

        Champ d'application (scope obligatoire pour ce chat) :
        Tu es dans le workspace de CETTE application. Tu as déjà son statut, ses variables d'environnement (clés et formes, jamais les secrets), ses logs de déploiement et ses paramètres runtime. Si l'utilisateur dit « corrige » (ou équivalent), diagnostique à partir de CE contexte : ne redemande pas le status, n'appelle pas get_resource_status juste pour le connaître.

        {$rules}

        - Application : {$name} ({$uuid})
        - Statut ressource : {$status}
        - Dépôt : {$gitRepository}
        - Branche : {$gitBranch}
        - Build pack : {$buildPack}
        - Framework détecté : {$framework}
        - Domaines : {$fqdn}
        - Ports exposés : {$ports}
        - Start command : {$start}
        - Build command : {$build}
        - Healthcheck : enabled={$healthEnabled} path={$healthPath} port={$healthPort} return_code={$healthCode}
        - Nginx custom : {$nginx}
        {$deployBlock}
        - Variables d'environnement (clés seulement, jamais les valeurs secrètes) :
        {$envLines}
        - Bases liées :
        {$dbLines}

        Traite chaque demande comme portant sur CETTE application.
        Pour les outils (read_application_source, write_application_source, upsert_application_env_var, control_resource, get_deployment_logs, get_resource_status, etc.), utilise application_uuid={$uuid} sans redemander l'UUID.
        CONTEXT);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function rankTeamApplications(int $teamId, int $limit): array
    {
        try {
            $apps = Application::query()
                ->whereRelation('environment.project', 'team_id', $teamId)
                ->orderByDesc('updated_at')
                ->limit(80)
                ->get(['id', 'uuid', 'name', 'status', 'fqdn', 'updated_at']);
        } catch (Throwable) {
            return [];
        }

        if ($apps->isEmpty()) {
            return [];
        }

        $ids = $apps->pluck('id')->map(fn (mixed $id): string => (string) $id)->all();
        $latestByApp = [];
        try {
            $deployments = ApplicationDeploymentQueue::query()
                ->whereIn('application_id', $ids)
                ->orderByDesc('id')
                ->get([
                    'id',
                    'application_id',
                    'status',
                    'created_at',
                    'updated_at',
                    'finished_at',
                    'rollback',
                ]);
            foreach ($deployments as $deployment) {
                $key = (string) $deployment->application_id;
                if (! isset($latestByApp[$key])) {
                    $latestByApp[$key] = $deployment;
                }
            }
        } catch (Throwable) {
        }

        $rows = [];
        foreach ($apps as $application) {
            $status = $this->resourceStatus($application);
            $deployment = $latestByApp[(string) $application->id] ?? null;
            $deployStatus = $deployment !== null ? (string) $deployment->status : null;
            $deployAt = null;
            $rollback = false;
            if ($deployment !== null) {
                $deployAt = $deployment->finished_at?->toIso8601String()
                    ?? $deployment->updated_at?->toIso8601String()
                    ?? $deployment->created_at?->toIso8601String();
                $rollback = (bool) ($deployment->rollback ?? false);
            }

            $statusLower = strtolower($status);
            $severity = 3;
            $failedDeploy = $deployStatus !== null && strtolower($deployStatus) === 'failed';
            if (
                str_contains($statusLower, 'unhealthy')
                || str_contains($statusLower, 'failed')
                || str_contains($statusLower, 'error')
                || $failedDeploy
            ) {
                $severity = 0;
            } elseif (str_contains($statusLower, 'exited') || str_contains($statusLower, 'restarting')) {
                $severity = 1;
            }

            $rows[] = [
                'name' => (string) $application->name,
                'uuid' => (string) $application->uuid,
                'status' => $status,
                'fqdn' => is_string($application->fqdn) ? $application->fqdn : null,
                'last_deploy_status' => $deployStatus,
                'last_deploy_at' => $deployAt,
                'last_deploy_rollback' => $rollback,
                '_severity' => $severity,
                '_updated' => $application->updated_at?->getTimestamp() ?? 0,
            ];
        }

        usort($rows, function (array $a, array $b): int {
            if ($a['_severity'] !== $b['_severity']) {
                return $a['_severity'] <=> $b['_severity'];
            }

            return ($b['_updated'] <=> $a['_updated']);
        });

        $capped = array_slice($rows, 0, $limit);
        foreach ($capped as &$row) {
            unset($row['_severity'], $row['_updated']);
        }
        unset($row);

        return array_values($capped);
    }

    /**
     * @param  list<array<string, mixed>>  $fleet
     */
    public function formatFleetPromptBlock(array $fleet): string
    {
        $rules = self::statusReadingRules();
        if ($fleet === []) {
            return trim("Flotte équipe : aucune application.\n\n{$rules}");
        }

        $lines = [];
        foreach ($fleet as $app) {
            if (! is_array($app)) {
                continue;
            }
            $name = (string) ($app['name'] ?? 'app');
            $uuid = (string) ($app['uuid'] ?? '');
            $status = (string) ($app['status'] ?? 'inconnu');
            $fqdn = (string) ($app['fqdn'] ?? 'aucun');
            $deployStatus = $app['last_deploy_status'] ?? null;
            $deployAt = $app['last_deploy_at'] ?? null;
            $deployLabel = is_string($deployStatus) && $deployStatus !== ''
                ? $deployStatus
                : 'aucun';
            $atLabel = is_string($deployAt) && $deployAt !== '' ? $deployAt : 'n/a';
            $rollback = ! empty($app['last_deploy_rollback']) ? ' rollback=oui' : '';
            $lines[] = "- {$name} ({$uuid}) statut={$status} fqdn={$fqdn} dernier_déploiement={$deployLabel} at={$atLabel}{$rollback}";
        }

        $list = implode("\n", $lines);

        return trim(<<<CONTEXT
Flotte équipe (contexte live injecté par le backend, pas par l'utilisateur) :
Les apps unhealthy et celles dont le dernier déploiement a échoué sont listées en premier (max 20).

{$rules}

{$list}
CONTEXT);
    }
