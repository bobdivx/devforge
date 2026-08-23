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
                'slug' => 'tech-watch-research',
                'name' => 'Recherche veille technique (tech watch)',
                'description' => 'Agent de veille : scanner apps → détecter bugs/responsive/design/features → créer tâches.',
                'tags' => ['tech-watch', 'research', 'qa', 'bugs'],
                'priority' => 160,
                'body' => implode("\n", [
                    '# Tech Watch Research',
                    '',
                    'Autonomous research agent workflow for scanning apps and creating improvement tasks.',
                    '',
                    '## Mission',
                    'Identify bugs, responsive issues, design problems, and missing features. Create ONE task per finding.',
                    '',
                    '## Workflow',
                    '1. List team applications via `list_applications`.',
                    '2. For each app with a public FQDN:',
                    '   - HTTP smoke test on `/` (200? error page? broken CSS?).',
                    '   - Browse 2-3 key pages (if documented or discoverable).',
                    '   - Check responsive: mobile (375px), tablet (768px), desktop (1440px).',
                    '   - Spot visual issues: broken layout, missing images, bad contrast, inaccessible forms.',
                    '3. For each finding:',
                    '   - Create ONE task via `POST /api/v1/devforge/tasks`.',
                    '   - Set `kind=bug` for functional errors, `kind=tech_watch` for design/responsive.',
                    '   - Set `title` (1 sentence), `description` (2-3 sentences), `resource_uuid` (app uuid).',
                    '   - Set `source=tech_watch_agent`.',
                    '4. Dedupe: if a similar task exists (same title pattern), skip creation.',
                    '5. End: report count of tasks created.',
                    '',
                    '## Do NOT',
                    '- Invent UUIDs. Always use tool responses.',
                    '- Create duplicate tasks. Check existing tasks first.',
                    '- Fix issues directly. Only create tasks.',
                    '- Create vague tasks ("improve UX"). Be specific ("Login button not visible on mobile 375px").',
                    '',
                    '## Example task',
                    '```json',
                    '{',
                    '  "kind": "bug",',
                    '  "title": "Homepage hero image missing on mobile",',
                    '  "description": "The hero section on / shows no image on 375px viewport. Desktop works.",',
                    '  "priority": "normal",',
                    '  "resource_uuid": "app-uuid-from-list-applications",',
                    '  "source": "tech_watch_agent"',
                    '}',
                    '```',
                ]),
            ],
            [
                'slug' => 'user-feature-request',
                'name' => 'Traiter demande feature utilisateur',
                'description' => 'User feature workflow : clarifier → créer tâche → implémenter via operator loop.',
                'tags' => ['feature', 'user-request', 'operator'],
                'priority' => 155,
                'body' => implode("\n", [
                    '# User Feature Request',
                    '',
                    'Handle user feature requests from chat: clarify → create task → implement.',
                    '',
                    '## Workflow',
                    '1. User asks for a feature in chat.',
                    '2. Clarify if needed (1-2 questions max):',
                    '   - Which application? (if multiple exist)',
                    '   - Scope: frontend, backend, both?',
                    '   - Constraints: deadline, design, dependencies?',
                    '3. Create task via `POST /api/v1/devforge/tasks`:',
                    '   - `kind=feature`',
                    '   - `title`: 1 sentence summary',
                    '   - `description`: what + why + acceptance criteria (3-5 sentences)',
                    '   - `resource_uuid`: target app uuid',
                    '   - `source=user_chat`',
                    '   - `assignee_agent_id`: your agent id (self-assign)',
                    '4. Implement via operator loop:',
                    '   - One change → verify → next.',
                    '   - Use existing tools: `write_application_source`, `upsert_application_env_var`, `control_resource(deploy)`.',
                    '   - After each change: smoke test via HTTP or `browser_smoke`.',
                    '5. Mark done via `PATCH /api/v1/devforge/tasks/{uuid}` with `status=done`.',
                    '',
                    '## Do NOT',
                    '- Implement without creating a task first.',
                    '- Make 3 changes without verification.',
                    '- Invent UUIDs or resource names.',
                    '- Deploy without testing.',
                    '',
                    '## Example task',
                    '```json',
                    '{',
                    '  "kind": "feature",',
                    '  "title": "Add dark mode toggle to settings",',
                    '  "description": "User wants a dark mode option in /settings. Toggle should persist via localStorage. Apply dark class to body on load.",',
                    '  "priority": "normal",',
                    '  "resource_uuid": "app-uuid",',
                    '  "source": "user_chat",',
                    '  "assignee_agent_id": 123',
                    '}',
                    '```',
                ]),
            ],
            [
                'slug' => 'graft-context-engine',
                'name' => 'Graft Context Engine (graphe codebase)',
                'description' => 'Graph-based codebase navigation: find symbols, trace calls, analyze blast radius. 3× faster, 70% less tokens.',
                'tags' => ['graft', 'context', 'codebase', 'search', 'navigation', 'performance'],
                'priority' => 165,
                'body' => file_get_contents(base_path('.claude/skills/graft-context/SKILL.md')),
            ],
            [
                'slug' => 'fix-deploy-failed',
                'name' => 'Corriger un déploiement échoué (opérateur)',
                'description' => 'Boucle opérateur : observe état réel → une hypothèse → plus petite action → remesure.',
                'tags' => ['deploy', 'operator', 'failed', 'diagnosis'],
                'priority' => 150,
                'body' => implode("\n", [
                    '# Fix a failed deploy',
                    '',
                    'Operator loop. Do not invent a status, UUID, commit, or log line. Every fact comes from a tool. One cause → one change → one check.',
                    '',
                    '## When',
                    '- The live site is up but not on the latest commit.',
                    '- A DevForge/Coolify deployment is `failed` or rolled back.',
                    '- Healthcheck fails and the old image stays live.',
                    '- Nixpacks / Dockerfile / `npm run build` errors.',
                    '',
                    '## Guardrails',
                    '- `running:healthy` does not mean up to date. The old image can be healthy.',
                    '- Docker `SecretsUsedInArgOrEnv` / ARG warnings are almost never the cause.',
                    '- Laravel `DeploymentException` only means the remote step failed. Find the app error above it.',
                    '- If healthcheck fails, read the **new** container stdout before removing the check or adding curl.',
                    '- `wget: connection refused` usually means the process crashed, not "missing curl".',
                    '- Do not stack three fixes. If the symptom changes, re-read logs.',
                    '- Never put secrets in a commit, a skill, or chat.',
                    '',
                    '## Steps',
                    '1. List team applications. Match name / FQDN / repo. Note uuid, status, fqdn, git_repository.',
                    '2. List recent deployments (metadata first). Failed newest + older `finished` → live is stale. Say so.',
                    '3. Read git info (repo, branch, sha) and runtime settings (build_pack, ports, publish_directory, healthcheck). Compare to the repo (Dockerfile? standalone? real port?).',
                    '4. Read logs of the latest `failed` deploy. Ignore ARG warnings, nix GC, PHP stack. Keep: `failed to build` + command, first TS/Next error, runtime `MODULE_NOT_FOUND` / native addon, healthcheck **and** app crash lines. If the tail is noise, fetch more lines.',
                    '5. Pick **one** family and the smallest fix:',
                    '   - **Wrong pack**: Dockerfile in repo but settings say nixpacks → set `build_pack=dockerfile`, keep port + health, redeploy. No code change.',
                    '   - **App build**: file cited by tsc/Next → minimal patch, commit on the deployed branch, redeploy.',
                    '   - **Crash on boot**: standalone omitted native modules (e.g. libsql musl) → copy needed `node_modules` into the runner (or use glibc). Redeploy.',
                    '   - **Healthcheck only** (app actually serves): add wget/curl **or** fix path/port. Do not disable healthcheck by default.',
                    '   - **502 while container healthy**: sync proxy labels from `ports_exposes`, redeploy.',
                    '   Prefer settings updates for DevForge config; commit only for code/Dockerfile.',
                    '6. Queue deploy with a short `reason` (the cause). Wait on **that** deployment uuid.',
                    '   - `in_progress` → wait, do not queue another.',
                    '   - `failed` → go back to step 4 with the **new** log.',
                    '   - `finished` → HTTP smoke on the FQDN (`/` and health). Not a default nginx page.',
                    '7. Done only when deploy is `finished`, health is OK, and the site responds. Tell the user which commit is live.',
                    '',
                    '## Anti-patterns',
                    '- Redeploy in a loop without reading logs.',
                    '- Turning healthcheck off to "make it green".',
                    '- Force-push / merge to fix a build-pack mismatch.',
                    '- Changing Nixpacks, the Dockerfile, and app code in one go.',
                ]),
            ],
            [
                'slug' => 'diagnose-build-failure',
                'name' => 'Diagnostiquer échec de build (opérateur)',
                'description' => 'Opérateur : lire logs build → isoler première erreur réelle → une cause.',
                'tags' => ['deploy', 'operator', 'diagnosis', 'build'],
                'priority' => 140,
                'body' => implode("\n", [
                    '# Diagnose build failure',
                    '',
                    'Operator: read deployment logs → isolate first real error → one root cause.',
                    '',
                    '## Steps',
                    '1. `get_deployment_logs` for the failed deployment (latest 100-200 lines).',
                    '2. Filter noise: ignore Docker ARG warnings, Nix GC, npm WARN, PHP stack traces without app frame.',
                    '3. Find **first** real error: `npm ERR!`, `tsc error TS`, `MODULE_NOT_FOUND`, `ENOENT`, `Permission denied`.',
                    '4. **One cause**: file path? missing dependency? wrong command? port mismatch? Dockerfile vs nixpacks?',
                    '5. Report: error snippet (max 10 lines), diagnosis (2 sentences), suggested fix (tool + args).',
                    '6. NEVER propose 3 hypotheses. One cause. If unsure: read more logs or source.',
                    '',
                    '## Output format',
                    '```json',
                    '{',
                    '  "error_type": "build_command_failed|module_not_found|permission_denied|wrong_buildpack",',
                    '  "first_error_line": "...",',
                    '  "diagnosis": "One sentence: what broke.",',
                    '  "suggested_fix": {',
                    '    "tool": "update_application_runtime_settings|write_application_source|upsert_application_env_var",',
                    '    "arguments": {...}',
                    '  }',
                    '}',
                    '```',
                ]),
            ],
            [
                'slug' => 'fix-one-thing',
                'name' => 'Appliquer UN fix et remesurer (opérateur)',
                'description' => 'Opérateur : appliquer le plus petit fix → queue deploy → attendre status.',
                'tags' => ['deploy', 'operator', 'fix'],
                'priority' => 135,
                'body' => implode("\n", [
                    '# Fix one thing and remeasure',
                    '',
                    'Operator: apply smallest fix → queue deploy → wait for status.',
                    '',
                    '## Steps',
                    '1. Receive diagnosis with suggested_fix (tool + arguments).',
                    '2. Execute **exactly one** tool call with the suggested arguments.',
                    '3. If the tool includes `redeploy=true` → done. Otherwise: `control_resource(action=deploy)`.',
                    '4. Wait for deployment status (use `get_deployment_metadata` to poll).',
                    '5. Once `status=finished` or `failed`: return new status + deployment_uuid.',
                    '6. NEVER apply 2 fixes in one turn. One cause → one fix → remeasure.',
                    '',
                    '## Output format',
                    '```json',
                    '{',
                    '  "fix_applied": "update_application_runtime_settings|write_application_source|...",',
                    '  "deployment_uuid": "...",',
                    '  "new_status": "finished|failed|in_progress",',
                    '  "next_step": "smoke_test|re_diagnose|done"',
                    '}',
                    '```',
                ]),
            ],
            [
                'slug' => 'smoke-test-deploy',
                'name' => 'Smoke test post-deploy (opérateur)',
                'description' => 'Opérateur : vérifier status → HTTP smoke → latest commit live.',
                'tags' => ['deploy', 'operator', 'test', 'verification'],
                'priority' => 130,
                'body' => implode("\n", [
                    '# Smoke test deployment',
                    '',
                    'Operator: verify deployment status → HTTP smoke → confirm latest commit live.',
                    '',
                    '## Steps',
                    '1. `get_resource_status` → confirm `running:healthy`.',
                    '2. `get_application_git_info` → note latest commit SHA.',
                    '3. `browser_fetch` on FQDN `/` → not nginx default page, not 502.',
                    '4. `browser_fetch` on healthcheck path (if configured) → 200 OK.',
                    '5. Compare: does the response mention the latest commit/version? Any JS errors in console?',
                    '6. Result: `ok` (healthy + responds + up to date) or `partial` (healthy but stale) or `failed` (unhealthy/502).',
                    '',
                    '## Output format',
                    '```json',
                    '{',
                    '  "container_status": "running:healthy|unhealthy",',
                    '  "http_status": 200,',
                    '  "latest_commit": "abc123...",',
                    '  "response_ok": true,',
                    '  "result": "ok|partial|failed",',
                    '  "summary": "One sentence about what works or remains broken."',
                    '}',
                    '```',
                ]),
            ],
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
                'slug' => 'create-new-feature',
                'name' => 'Créer une nouvelle fonctionnalité (opérateur)',
                'description' => 'Opérateur : spec utilisateur → code minimal → test → commit.',
                'tags' => ['feature', 'operator', 'development'],
                'priority' => 120,
                'body' => implode("\n", [
                    '# Create new feature',
                    '',
                    'Operator: user spec → minimal code → test → commit.',
                    '',
                    '## Steps',
                    '1. `list_applications` → match by name/repo. Note uuid, git_branch.',
                    '2. `read_application_source` for context (package.json, main files, structure).',
                    '3. Write **one** file at a time: `write_application_source(mode=commit, message=...)`.',
                    '4. If multiple files: commit each separately with clear message.',
                    '5. `control_resource(action=deploy, reason="feat: ...")` after commits.',
                    '6. Wait for deployment status. If `failed`: diagnose with skill.',
                    '7. `browser_fetch` smoke test on FQDN → verify feature visible.',
                    '',
                    '## Guardrails',
                    '- Never commit secrets/tokens.',
                    '- One feature = one clear purpose. No mega-commit.',
                    '- Test locally first if `run_application_tests` available.',
                    '- User-facing changes require UI smoke test.',
                    '- Never `git push --force` or rewrite history.',
                ]),
            ],
            [
                'slug' => 'improve-ui',
                'name' => 'Améliorer UI existante (opérateur)',
                'description' => 'Opérateur : identifier composant → patch minimal → deploy → visual check.',
                'tags' => ['ui', 'operator', 'improvement'],
                'priority' => 115,
                'body' => implode("\n", [
                    '# Improve existing UI',
                    '',
                    'Operator: identify component → minimal patch → deploy → visual check.',
                    '',
                    '## Steps',
                    '1. `list_application_source` to find component file (React, Astro, Blade, Vue).',
                    '2. `read_application_source` on the file → understand current implementation.',
                    '3. Apply **smallest** UI change: fix CSS, adjust layout, update text.',
                    '4. `write_application_source(mode=commit, message="ui: ...")` → one commit.',
                    '5. `control_resource(action=deploy)` → wait for `finished`.',
                    '6. `browser_fetch` on affected page → verify change visible.',
                    '7. Check browser console for JS errors (UI should not break).',
                    '',
                    '## Anti-patterns',
                    '- Changing framework (React → Vue) instead of fixing layout.',
                    '- Breaking existing functionality while improving.',
                    '- No visual verification after deploy.',
                ]),
            ],
            [
                'slug' => 'run-tests',
                'name' => 'Exécuter tests (opérateur)',
                'description' => 'Opérateur : déclencher tests → attendre résultat → rapport clair.',
                'tags' => ['test', 'operator', 'verification'],
                'priority' => 125,
                'body' => implode("\n", [
                    '# Run application tests',
                    '',
                    'Operator: trigger tests → wait for result → clear report.',
                    '',
                    '## Steps',
                    '1. `get_application_runtime_settings` → check if tests configured (test_command).',
                    '2. `run_application_tests(application_uuid)` → wait for completion.',
                    '3. Read test output: passed/failed counts, first failing test.',
                    '4. If failed: isolate **one** failing test, read related source.',
                    '5. Report: "X passed, Y failed. First failure: [test name] - [reason]".',
                    '6. Never say "tests probably work" without running them.',
                    '',
                    '## Output format',
                    '```json',
                    '{',
                    '  "status": "passed|failed",',
                    '  "passed": 0,',
                    '  "failed": 0,',
                    '  "first_failure": "test name",',
                    '  "failure_reason": "one sentence",',
                    '  "next_step": "fix_test|fix_code|all_ok"',
                    '}',
                    '```',
                ]),
            ],
            [
                'slug' => 'diagnose-502-unhealthy',
                'name' => 'Diagnostiquer 502 ou unhealthy (opérateur)',
                'description' => 'Opérateur : status conteneur → logs → ports → proxy → une cause.',
                'tags' => ['diagnosis', 'operator', '502', 'unhealthy'],
                'priority' => 110,
                'body' => implode("\n", [
                    '# Diagnose 502 or unhealthy container',
                    '',
                    'Operator: container status → logs → ports → proxy → one cause.',
                    '',
                    '## Steps',
                    '1. `get_resource_status` → note exact status: `running:healthy|unhealthy|exited`.',
                    '2. `docker_logs(lines=100)` → find crash/error in **new** container.',
                    '3. `get_application_runtime_settings` → ports_exposes vs actual listening port.',
                    '4. If 502 + healthy: proxy mismatch (skill `fix-deploy-502`).',
                    '5. If unhealthy: healthcheck wrong path/port OR app crash.',
                    '6. If crash: find error line (MODULE_NOT_FOUND, port in use, env missing).',
                    '7. Output: **one** diagnosis with suggested fix tool.',
                    '',
                    '## Output format',
                    '```json',
                    '{',
                    '  "container_status": "running:unhealthy|exited",',
                    '  "diagnosis": "Port mismatch|App crash on boot|Healthcheck wrong",',
                    '  "error_snippet": "...",',
                    '  "suggested_fix": "update_application_runtime_settings|fix_deploy_502|upsert_application_env_var"',
                    '}',
                    '```',
                ]),
            ],
            [
                'slug' => 'check-turso-vs-local',
                'name' => 'Vérifier Turso vs database locale (opérateur)',
                'description' => 'Opérateur : lire envs → identifier type DB → vérifier connexion.',
                'tags' => ['database', 'operator', 'turso', 'diagnosis'],
                'priority' => 105,
                'body' => implode("\n", [
                    '# Check Turso vs local database',
                    '',
                    'Operator: read envs → identify DB type → verify connection.',
                    '',
                    '## Steps',
                    '1. `list_application_env_vars` → find DB_* / DATABASE_URL / TURSO_* / ASTRO_DB_*.',
                    '2. Turso indicators: `TURSO_DATABASE_URL`, `libsql://`, `ASTRO_DB_REMOTE_URL`.',
                    '3. Local indicators: `DATABASE_URL=file:`, standalone postgres/mysql attached.',
                    '4. If Turso: check URL format, auth token present (TURSO_AUTH_TOKEN).',
                    '5. If local: `docker_logs` on DB container → ready or crash.',
                    '6. Report: "Using Turso (libsql://...)" or "Using local Postgres (db-xyz)".',
                    '',
                    '## Output format',
                    '```json',
                    '{',
                    '  "db_type": "turso|postgres|mysql|sqlite_local|unknown",',
                    '  "connection_string_masked": "libsql://***|postgres://***",',
                    '  "has_auth_token": true,',
                    '  "status": "configured|missing_token|db_container_down"',
                    '}',
                    '```',
                ]),
            ],
            [
                'slug' => 'restart-vs-redeploy',
                'name' => 'Choisir restart ou redeploy (opérateur)',
                'description' => 'Opérateur : symptôme → cause → action minimale (restart ≠ redeploy).',
                'tags' => ['operator', 'control', 'decision'],
                'priority' => 108,
                'body' => implode("\n", [
                    '# Restart vs redeploy decision',
                    '',
                    'Operator: symptom → cause → minimal action (restart ≠ redeploy).',
                    '',
                    '## Decision tree',
                    '**Restart** (`control_resource(action=restart)`) when:',
                    '- Container crash / OOM / temporary network issue.',
                    '- No code change, no settings change.',
                    '- Just want to restart the running container.',
                    '',
                    '**Redeploy** (`control_resource(action=deploy)`) when:',
                    '- Code changed (commit pushed).',
                    '- Settings changed (ports, env vars, build_pack).',
                    '- Build pack mismatch (Dockerfile vs nixpacks).',
                    '- Image needs rebuild from source.',
                    '',
                    '## Anti-pattern',
                    '- Never redeploy in a loop without fixing the cause.',
                    '- Restart does NOT pull new code or rebuild.',
                    '',
                    '## Output format',
                    '```json',
                    '{',
                    '  "action": "restart|redeploy",',
                    '  "reason": "Container crash|Code changed|Settings updated",',
                    '  "execute_now": true',
                    '}',
                    '```',
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
                    '4. Si « Read-only file system » pendant mkdir DevForge : `fix_coolify_base_config_path`.',
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
