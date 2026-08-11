<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentSkill;
use App\Models\Team;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Skills procéduraux (inspiration Hermes / agentskills.io) — progressive disclosure.
 * Le prompt n'injecte que le catalogue (slug + description) ; le corps se charge via skill_load.
 */
class AgentSkillService
{
    public function available(): bool
    {
        try {
            return Schema::hasTable('ai_agent_skills');
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * @return Collection<int, AiAgentSkill>
     */
    public function catalog(Team $team, ?AiAgent $agent = null, ?string $query = null, int $limit = 40): Collection
    {
        if (! $this->available()) {
            return collect();
        }

        $this->ensureBuiltins($team);

        $rows = AiAgentSkill::query()
            ->where('team_id', $team->id)
            ->where('is_active', true)
            ->where(function ($q) use ($agent) {
                $q->whereNull('agent_id');
                if ($agent !== null) {
                    $q->orWhere('agent_id', $agent->id);
                }
            })
            ->orderByDesc('priority')
            ->orderBy('name')
            ->limit(max(1, min(100, $limit)))
            ->get();

        if ($query !== null && trim($query) !== '') {
            $needle = mb_strtolower(trim($query));
            $rows = $rows->filter(function (AiAgentSkill $row) use ($needle): bool {
                $hay = mb_strtolower($row->slug.' '.$row->name.' '.$row->description.' '.implode(' ', $row->tags ?? []));

                return str_contains($hay, $needle);
            })->values();
        }

        return $rows;
    }

    public function findBySlug(Team $team, string $slug, ?AiAgent $agent = null): ?AiAgentSkill
    {
        if (! $this->available()) {
            return null;
        }

        $this->ensureBuiltins($team);
        $slug = $this->normalizeSlug($slug);

        return AiAgentSkill::query()
            ->where('team_id', $team->id)
            ->where('slug', $slug)
            ->where('is_active', true)
            ->where(function ($q) use ($agent) {
                $q->whereNull('agent_id');
                if ($agent !== null) {
                    $q->orWhere('agent_id', $agent->id);
                }
            })
            ->orderByDesc('agent_id')
            ->first();
    }

    /**
     * @param  list<string>|null  $tags
     */
    public function write(
        Team $team,
        string $slug,
        string $name,
        string $description,
        string $body,
        ?AiAgent $agent = null,
        ?array $tags = null,
        bool $isActive = true,
        int $priority = 0,
    ): AiAgentSkill|array {
        if (! $this->available()) {
            return ['error' => 'table ai_agent_skills indisponible'];
        }

        $slug = $this->normalizeSlug($slug);
        $name = trim($name);
        $description = trim($description);
        $body = trim($body);

        if ($slug === '' || $name === '' || $description === '' || $body === '') {
            return ['error' => 'slug, name, description et body sont requis'];
        }
        if (mb_strlen($description) > 500) {
            return ['error' => 'description trop longue (max 500)'];
        }
        if (mb_strlen($body) > 40000) {
            return ['error' => 'body trop long (max 40000)'];
        }

        $tagList = is_array($tags)
            ? array_values(array_unique(array_filter(array_map(
                fn ($t): string => trim((string) $t),
                $tags,
            ))))
            : [];

        $existing = AiAgentSkill::query()
            ->where('team_id', $team->id)
            ->where('slug', $slug)
            ->when(
                $agent !== null,
                fn ($q) => $q->where(fn ($inner) => $inner->whereNull('agent_id')->orWhere('agent_id', $agent->id)),
                fn ($q) => $q->whereNull('agent_id'),
            )
            ->orderByDesc('agent_id')
            ->first();

        if ($existing) {
            if ($existing->is_builtin && $agent === null) {
                // Amélioration d'un builtin : créer/écraser une variante team (non builtin).
                $existing->fill([
                    'name' => $name,
                    'description' => $description,
                    'body' => $body,
                    'tags' => $tagList !== [] ? $tagList : $existing->tags,
                    'is_active' => $isActive,
                    'priority' => $priority,
                    'is_builtin' => false,
                ]);
                $existing->save();

                return $existing->fresh();
            }

            $existing->fill([
                'name' => $name,
                'description' => $description,
                'body' => $body,
                'tags' => $tagList !== [] ? $tagList : $existing->tags,
                'is_active' => $isActive,
                'priority' => $priority,
                'agent_id' => $agent?->id ?? $existing->agent_id,
            ]);
            $existing->save();

            return $existing->fresh();
        }

        return AiAgentSkill::query()->create([
            'team_id' => $team->id,
            'agent_id' => $agent?->id,
            'slug' => $slug,
            'name' => $name,
            'description' => $description,
            'body' => $body,
            'tags' => $tagList,
            'is_active' => $isActive,
            'is_builtin' => false,
            'priority' => $priority,
        ]);
    }

    /**
     * Catalogue compact pour le system prompt (progressive disclosure).
     *
     * @return Collection<int, AiAgentSkill>
     */
    public function listForPrompt(Team $team, ?AiAgent $agent = null, int $limit = 30): Collection
    {
        return $this->catalog($team, $agent, null, $limit);
    }

    /**
     * @param  Collection<int, AiAgentSkill>  $rows
     */
    public function formatPromptBlock(Collection $rows): string
    {
        if ($rows->isEmpty()) {
            return '';
        }

        $lines = [
            'SKILLS DISPONIBLES (procédures réutilisables — charge le corps avec skill_load avant d\'agir) :',
        ];
        foreach ($rows as $row) {
            $lines[] = "- `{$row->slug}` — {$row->name}: {$row->description}";
        }
        $lines[] = 'Utilise skill_list pour filtrer, skill_load(slug) pour le détail, skill_write pour mémoriser une procédure validée.';

        return implode("\n", $lines);
    }

    /**
     * @param  Collection<int, AiAgentSkill>  $rows
     * @return list<array<string, mixed>>
     */
    public function formatToolOutput(Collection $rows, bool $includeBody = false): array
    {
        return $rows->map(function (AiAgentSkill $row) use ($includeBody): array {
            $item = [
                'slug' => $row->slug,
                'name' => $row->name,
                'description' => $row->description,
                'tags' => $row->tags ?? [],
                'is_builtin' => (bool) $row->is_builtin,
                'priority' => (int) $row->priority,
            ];
            if ($includeBody) {
                $item['body'] = $row->body;
            }

            return $item;
        })->values()->all();
    }

    public function normalizeSlug(string $slug): string
    {
        $slug = Str::slug(trim($slug), '-');

        return mb_substr($slug, 0, 120);
    }

    public function ensureBuiltins(Team $team): void
    {
        if (! $this->available()) {
            return;
        }

        foreach ($this->builtinDefinitions() as $def) {
            $exists = AiAgentSkill::query()
                ->where('team_id', $team->id)
                ->where('slug', $def['slug'])
                ->exists();
            if ($exists) {
                continue;
            }

            AiAgentSkill::query()->create([
                'team_id' => $team->id,
                'agent_id' => null,
                'slug' => $def['slug'],
                'name' => $def['name'],
                'description' => $def['description'],
                'body' => $def['body'],
                'tags' => $def['tags'],
                'is_active' => true,
                'is_builtin' => true,
                'priority' => $def['priority'],
            ]);
        }
    }

    /**
     * @return list<array{slug: string, name: string, description: string, body: string, tags: list<string>, priority: int}>
     */
    public function builtinDefinitions(): array
    {
        return [
            [
                'slug' => 'fix-deploy-502',
                'name' => 'Corriger HTTP 502 / Bad Gateway',
                'description' => 'Conteneur healthy mais domaine en 502 — resync labels Traefik et ports.',
                'tags' => ['deploy', 'proxy', 'traefik'],
                'priority' => 100,
                'body' => implode("\n", [
                    '# Fix HTTP 502 / Bad Gateway',
                    '',
                    '1. `get_resource_status` — confirmer conteneur healthy.',
                    '2. `get_application_runtime_settings` — noter `ports_exposes` et `health_check_port`.',
                    '3. Si logs disent listening sur un autre port (ex. 4321 vs 3000) :',
                    '   `update_application_runtime_settings(ports_exposes=…, health_check_port=…, redeploy=true)`',
                    '   + `upsert_application_env_var PORT=…` si besoin.',
                    '4. `sync_application_proxy_labels` puis redeploy 1× max.',
                    '5. Vérifier avec `browser_fetch` / `http_request` sur le FQDN.',
                    '6. INTERDIT : variables dummy, 2e redeploy, inventer un PAT.',
                ]),
            ],
            [
                'slug' => 'fix-publish-directory',
                'name' => 'Corriger publish_directory (page nginx par défaut)',
                'description' => 'Site statique qui sert la page nginx — déduire le dossier de build.',
                'tags' => ['deploy', 'static', 'astro', 'vite'],
                'priority' => 90,
                'body' => implode("\n", [
                    '# Fix publish_directory',
                    '',
                    '1. `get_deployment_logs` — chercher `directory: /app/…`, dist/, out/, build/, .output/.',
                    '2. `get_application_runtime_settings` + `read_application_source` (astro.config, vite.config, package.json).',
                    '3. `update_application_runtime_settings(publish_directory=…, is_static=true, redeploy=true)`.',
                    '4. Vérifier readiness / `browser_fetch` sur le domaine.',
                ]),
            ],
            [
                'slug' => 'fix-host-permissions',
                'name' => 'Corriger Permission denied sur .env / applications',
                'description' => 'tee Permission denied à l\'écriture .env — chown/chmod ciblé.',
                'tags' => ['deploy', 'permissions', 'host'],
                'priority' => 95,
                'body' => implode("\n", [
                    '# Fix host permissions',
                    '',
                    '1. Confirmer l\'erreur « Permission denied » / tee dans les logs.',
                    '2. `fix_application_host_permissions(redeploy=true)` immédiatement.',
                    '3. INTERDIT : inventer DUMMY_*, *_TRIGGER, FORCE_REDEPLOY.',
                    '4. Si « Read-only file system » pendant mkdir Coolify : `fix_coolify_base_config_path`.',
                ]),
            ],
            [
                'slug' => 'readiness-probe-failed',
                'name' => 'Diagnostiquer readiness HTTP échouée',
                'description' => 'Deploy OK mais probe domaine en échec — diagnostic puis correction bornée.',
                'tags' => ['deploy', 'readiness', 'http'],
                'priority' => 85,
                'body' => implode("\n", [
                    '# Readiness probe failed',
                    '',
                    '1. `get_resource_status` + `docker_logs`.',
                    '2. `browser_fetch` ou `http_request` vers la probe URL.',
                    '3. Page nginx / publish vide → skill `fix-publish-directory`.',
                    '4. 502 + healthy → skill `fix-deploy-502`.',
                    '5. Env manquante → `upsert_application_env_var` puis redeploy 1×.',
                    '6. Terminer avec outcome JSON auto_fixed|needs_user|failed.',
                ]),
            ],
        ];
    }
}
