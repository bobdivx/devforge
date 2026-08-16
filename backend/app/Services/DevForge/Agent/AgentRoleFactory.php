<?php

namespace App\Services\DevForge\Agent;

use App\Services\DevForge\Agent\Tool\AgentSubagentCapabilities;

/**
 * Propose des rôles leaf dynamiques pour une tâche (P5.0 — natif, sans AutoGen/HERCULES).
 *
 * @phpstan-type RoleSpec array{
 *     slug: string,
 *     leaf_profile: string,
 *     label: string,
 *     system_prompt: string,
 *     goal: string,
 *     difficulty: string
 * }
 */
class AgentRoleFactory
{
    public const ROLE_RESEARCHER = 'researcher';

    public const ROLE_ANALYST = 'analyst';

    public const ROLE_WRITER = 'writer';

    public const ROLE_REVIEWER = 'reviewer';

    public const ROLE_IMPLEMENTER = 'implementer';

    public const ROLE_TESTER = 'tester';

    /** @var list<string> */
    public const CATALOG = [
        self::ROLE_RESEARCHER,
        self::ROLE_ANALYST,
        self::ROLE_WRITER,
        self::ROLE_REVIEWER,
        self::ROLE_IMPLEMENTER,
        self::ROLE_TESTER,
        AgentSubagentCapabilities::PROFILE_DIAGNOSE,
        AgentSubagentCapabilities::PROFILE_FIX,
        AgentSubagentCapabilities::PROFILE_REDEPLOY,
        AgentSubagentCapabilities::PROFILE_FIX_CI,
        AgentSubagentCapabilities::PROFILE_IMPLEMENT,
        AgentSubagentCapabilities::PROFILE_TEST,
        AgentSubagentCapabilities::PROFILE_RESEARCH,
    ];

    public function enabled(): bool
    {
        return app(AgentRuntimeSettings::class)->dynamicRolesEnabled();
    }

    public function maxRoles(): int
    {
        $configured = max(1, min(8, (int) config('devforge.agents_max_dynamic_roles', 4)));
        $concurrent = max(1, (int) config('devforge.agents_max_concurrent_subagents', 3));

        return min($configured, $concurrent);
    }

    /**
     * @param  list<string>|null  $explicitRoles
     * @param  array<string, mixed>  $hints  mission_kind, event, agent_type…
     * @return list<RoleSpec>
     */
    public function propose(string $task, ?array $explicitRoles = null, array $hints = []): array
    {
        $task = trim($task);
        if ($task === '') {
            return [];
        }

        $slugs = $explicitRoles !== null && $explicitRoles !== []
            ? $this->normalizeSlugs($explicitRoles)
            : $this->inferSlugs($task, $hints);

        $slugs = array_values(array_unique($slugs));
        $slugs = array_slice($slugs, 0, $this->maxRoles());

        $roles = [];
        foreach ($slugs as $slug) {
            $roles[] = $this->buildRoleSpec($slug, $task);
        }

        return $roles;
    }

    /**
     * Convertit des rôles en tâches spawnMany.
     *
     * @param  list<RoleSpec>  $roles
     * @return list<array{goal: string, difficulty: string, leaf_profile: string, role_slug: string, role_system_prompt: string, wait: bool}>
     */
    public function toSpawnTasks(array $roles, bool $wait = false): array
    {
        $tasks = [];
        foreach ($roles as $role) {
            if (! is_array($role) || empty($role['slug'])) {
                continue;
            }

            $tasks[] = [
                'goal' => (string) ($role['goal'] ?? ''),
                'difficulty' => (string) ($role['difficulty'] ?? 'auto'),
                'leaf_profile' => (string) ($role['leaf_profile'] ?? AgentSubagentCapabilities::PROFILE_RESEARCH),
                'role_slug' => (string) $role['slug'],
                'role_system_prompt' => (string) ($role['system_prompt'] ?? ''),
                'wait' => $wait,
            ];
        }

        return $tasks;
    }

    public function resolveLeafProfile(string $slugOrProfile): string
    {
        $slug = $this->normalizeSlug($slugOrProfile);

        return match ($slug) {
            self::ROLE_RESEARCHER,
            self::ROLE_ANALYST,
            self::ROLE_WRITER,
            AgentSubagentCapabilities::PROFILE_RESEARCH => AgentSubagentCapabilities::PROFILE_RESEARCH,
            self::ROLE_REVIEWER,
            AgentSubagentCapabilities::PROFILE_DIAGNOSE => AgentSubagentCapabilities::PROFILE_DIAGNOSE,
            self::ROLE_IMPLEMENTER,
            AgentSubagentCapabilities::PROFILE_IMPLEMENT => AgentSubagentCapabilities::PROFILE_IMPLEMENT,
            AgentSubagentCapabilities::PROFILE_FIX => AgentSubagentCapabilities::PROFILE_FIX,
            self::ROLE_TESTER,
            AgentSubagentCapabilities::PROFILE_TEST => AgentSubagentCapabilities::PROFILE_TEST,
            AgentSubagentCapabilities::PROFILE_REDEPLOY => AgentSubagentCapabilities::PROFILE_REDEPLOY,
            AgentSubagentCapabilities::PROFILE_FIX_CI => AgentSubagentCapabilities::PROFILE_FIX_CI,
            default => AgentSubagentCapabilities::PROFILE_RESEARCH,
        };
    }

    public function defaultSystemPrompt(string $slug): string
    {
        $slug = $this->normalizeSlug($slug);

        return match ($slug) {
            self::ROLE_RESEARCHER, AgentSubagentCapabilities::PROFILE_RESEARCH => <<<'PROMPT'
            Tu es RESEARCHER : collecte des faits vérifiables (web_search, sources app/GitHub, mémoire).
            Structure : constats → sources → lacunes. Pas d’implémentation ni de deploy.
            PROMPT,
            self::ROLE_ANALYST => <<<'PROMPT'
            Tu es ANALYST : synthétise, priorise risques/opportunités, compare options.
            Produis des recommandations actionnables pour l’orchestrateur. Pas de mutations infra.
            PROMPT,
            self::ROLE_WRITER => <<<'PROMPT'
            Tu es WRITER : rédige un rapport clair (résumé exécutif + détail) à partir des faits fournis dans l’objectif.
            Utilise memory_write(scope=shared) si un livrable durable est utile. Pas de code mutatif.
            PROMPT,
            self::ROLE_REVIEWER, AgentSubagentCapabilities::PROFILE_DIAGNOSE => <<<'PROMPT'
            Tu es REVIEWER / DIAGNOSE : vérifie preuves, contradictions, risques. Lecture seule.
            Signale ce qui manque avant une mutation. Pas de spawn.
            PROMPT,
            self::ROLE_IMPLEMENTER, AgentSubagentCapabilities::PROFILE_IMPLEMENT => <<<'PROMPT'
            Tu es IMPLEMENTER : applique les changements code/config nécessaires à l’objectif.
            Prefère write_application_source / GitHub write ciblés. Demande les secrets via request_user_input.
            PROMPT,
            self::ROLE_TESTER, AgentSubagentCapabilities::PROFILE_TEST => <<<'PROMPT'
            Tu es TESTER : lance run_application_tests (ou équivalent), rapporte succès/échecs avec preuves.
            Pas de refactor hors correction minimale pour faire passer les tests.
            PROMPT,
            AgentSubagentCapabilities::PROFILE_FIX => <<<'PROMPT'
            Tu es FIX : corrige la cause racine (env, runtime DevForge, patch code). Pas de redeploy ici.
            PROMPT,
            AgentSubagentCapabilities::PROFILE_REDEPLOY => <<<'PROMPT'
            Tu es REDEPLOY : un seul redeploy/contrôle ressource max, puis statut. Pas de diagnostic long.
            PROMPT,
            AgentSubagentCapabilities::PROFILE_FIX_CI => <<<'PROMPT'
            Tu es FIX-CI : diagnostique et corrige le workflow GitHub Actions (logs → patch YAML → rerun borné).
            PROMPT,
            default => 'Tu es un leaf spécialisé. Concentre-toi sur l’objectif. Pas d’orchestration.',
        };
    }

    /**
     * @param  list<mixed>  $roles
     * @return list<string>
     */
    public function normalizeSlugs(array $roles): array
    {
        $out = [];
        foreach ($roles as $role) {
            if (! is_string($role) && ! is_numeric($role)) {
                continue;
            }
            $slug = $this->normalizeSlug((string) $role);
            if ($slug === '' || ! $this->isKnownSlug($slug)) {
                continue;
            }
            $out[] = $slug;
        }

        return $out;
    }

    public function normalizeSlug(string $value): string
    {
        $value = strtolower(trim($value));
        $value = str_replace([' ', '_'], '-', $value);

        return match ($value) {
            'research' => self::ROLE_RESEARCHER,
            'analyse', 'analysis' => self::ROLE_ANALYST,
            'write', 'reporter' => self::ROLE_WRITER,
            'review', 'critique' => self::ROLE_REVIEWER,
            'implement', 'developer', 'coder', 'dev' => self::ROLE_IMPLEMENTER,
            'test', 'qa' => self::ROLE_TESTER,
            'fix-ci', 'fix_ci', 'fixci' => AgentSubagentCapabilities::PROFILE_FIX_CI,
            default => $value,
        };
    }

    public function isKnownSlug(string $slug): bool
    {
        return in_array($this->normalizeSlug($slug), self::CATALOG, true)
            || in_array($slug, self::CATALOG, true);
    }

    public function labelFor(string $slug): string
    {
        $slug = $this->normalizeSlug($slug);

        return match ($slug) {
            self::ROLE_RESEARCHER => 'Researcher',
            self::ROLE_ANALYST => 'Analyst',
            self::ROLE_WRITER => 'Writer',
            self::ROLE_REVIEWER => 'Reviewer',
            self::ROLE_IMPLEMENTER => 'Implementer',
            self::ROLE_TESTER => 'Tester',
            AgentSubagentCapabilities::PROFILE_DIAGNOSE => 'Diagnose',
            AgentSubagentCapabilities::PROFILE_FIX => 'Fix',
            AgentSubagentCapabilities::PROFILE_REDEPLOY => 'Redeploy',
            AgentSubagentCapabilities::PROFILE_FIX_CI => 'Fix CI',
            AgentSubagentCapabilities::PROFILE_IMPLEMENT => 'Implement',
            AgentSubagentCapabilities::PROFILE_TEST => 'Test',
            AgentSubagentCapabilities::PROFILE_RESEARCH => 'Research',
            default => ucfirst($slug),
        };
    }

    /**
     * @param  array<string, mixed>  $hints
     * @return list<string>
     */
    private function inferSlugs(string $task, array $hints): array
    {
        $lower = mb_strtolower($task);
        $kind = strtolower((string) ($hints['mission_kind'] ?? $hints['kind'] ?? ''));
        $event = strtolower((string) ($hints['event'] ?? ''));

        if (in_array($kind, ['tech_watch', 'feature'], true) || $this->matches($lower, ['veille', 'tech.?watch', 'tendance', 'trend', 'research', 'rapport', 'report'])) {
            $roles = [self::ROLE_RESEARCHER, self::ROLE_ANALYST];
            if ($this->matches($lower, ['rapport', 'report', 'synth[eè]se', 'summary', 'r[eé]dig', 'document'])) {
                $roles[] = self::ROLE_WRITER;
            }
            if ($kind === 'feature' || $this->matches($lower, ['impl[eé]ment', 'feature', 'code', 'pr\b', 'pull request'])) {
                $roles[] = self::ROLE_IMPLEMENTER;
                $roles[] = self::ROLE_TESTER;
            }

            return $roles;
        }

        if (in_array($kind, ['bug'], true) || $event === 'deployment_failed' || $this->matches($lower, ['bug', 'fix', 'd[eé]ploi', 'deploy', 'crash', 'erreur', 'error', 'ci\b', 'workflow'])) {
            if ($this->matches($lower, ['ci\b', 'workflow', 'github.?actions'])) {
                return [AgentSubagentCapabilities::PROFILE_FIX_CI, self::ROLE_REVIEWER];
            }

            return [
                AgentSubagentCapabilities::PROFILE_DIAGNOSE,
                AgentSubagentCapabilities::PROFILE_FIX,
                self::ROLE_REVIEWER,
            ];
        }

        if ($this->matches($lower, ['test', 'qa', 'pest', 'phpunit', 'vitest'])) {
            return [self::ROLE_IMPLEMENTER, self::ROLE_TESTER, self::ROLE_REVIEWER];
        }

        if ($this->matches($lower, ['impl[eé]ment', 'd[eé]velopp', 'coder', 'feature', 'refactor'])) {
            return [self::ROLE_IMPLEMENTER, self::ROLE_TESTER, self::ROLE_REVIEWER];
        }

        return [self::ROLE_RESEARCHER, self::ROLE_ANALYST];
    }

    /**
     * @return RoleSpec
     */
    private function buildRoleSpec(string $slug, string $parentTask): array
    {
        $slug = $this->normalizeSlug($slug);
        $label = $this->labelFor($slug);
        $leafProfile = $this->resolveLeafProfile($slug);
        $difficulty = match ($slug) {
            self::ROLE_RESEARCHER,
            self::ROLE_ANALYST,
            AgentSubagentCapabilities::PROFILE_FIX_CI => 'heavy',
            self::ROLE_WRITER,
            self::ROLE_REVIEWER,
            self::ROLE_IMPLEMENTER,
            AgentSubagentCapabilities::PROFILE_DIAGNOSE,
            AgentSubagentCapabilities::PROFILE_IMPLEMENT,
            AgentSubagentCapabilities::PROFILE_FIX => 'standard',
            self::ROLE_TESTER,
            AgentSubagentCapabilities::PROFILE_TEST,
            AgentSubagentCapabilities::PROFILE_REDEPLOY => 'light',
            default => 'auto',
        };

        $goal = trim(<<<GOAL
        [Rôle: {$label} / {$slug}]
        Contexte parent : {$parentTask}

        Ta mission leaf : accomplir uniquement la part « {$label} ».
        Remets un résumé actionnable (preuves, risques, suite suggérée) pour l’orchestrateur.
        GOAL);

        return [
            'slug' => $slug,
            'leaf_profile' => $leafProfile,
            'label' => $label,
            'system_prompt' => trim($this->defaultSystemPrompt($slug)),
            'goal' => $goal,
            'difficulty' => $difficulty,
        ];
    }

    /**
     * @param  list<string>  $patterns
     */
    private function matches(string $haystack, array $patterns): bool
    {
        foreach ($patterns as $pattern) {
            if (@preg_match('/'.$pattern.'/iu', $haystack) === 1) {
                return true;
            }
        }

        return false;
    }
}
