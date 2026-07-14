<?php

namespace App\Services\DevForge\Agent\Tool;

use App\Models\AiAgent;

/**
 * Moteur de permissions agent — porté depuis forge-permission-engine.ts (Forge).
 */
class AgentPermissionEngine
{
    public const MODE_AUTONOMOUS = 'autonomous';

    public const MODE_TIERED = 'tiered';

    public const MODE_PLAN_FIRST = 'plan_first';

    public const DECISION_ALLOW = 'allow';

    public const DECISION_DENY = 'deny';

    public const DECISION_ASK = 'ask';

    /** @var array<int, array{id: string, pattern: string, reason: string}> */
    private const HARD_DENY_PATTERNS = [
        ['id' => 'rmrf-root', 'pattern' => '/rm\s+-rf?\s+\/(?![\w])/i', 'reason' => 'Suppression récursive de la racine système.'],
        ['id' => 'rmrf-home', 'pattern' => '/rm\s+-rf?\s+(\$HOME|~|\/home\/?$|\/Users\/?$)/i', 'reason' => 'Suppression récursive du home.'],
        ['id' => 'push-force-main', 'pattern' => '/git\s+push\s+(-{1,2}force\b|\-f\b)[^\n]*\b(main|master)\b/i', 'reason' => 'Push force sur la branche principale.'],
        ['id' => 'dd-of-dev', 'pattern' => '/\bdd\b[^\n]*\bof\s*=\s*\/dev\//i', 'reason' => 'Écriture brute sur un device.'],
        ['id' => 'mkfs', 'pattern' => '/\bmkfs\.(ext|xfs|btrfs|vfat|ntfs)/i', 'reason' => 'Reformatage de filesystem.'],
        ['id' => 'chmod-777-root', 'pattern' => '/chmod\s+-R\s+777\s+\/(?![\w])/i', 'reason' => 'Permissions ouvertes sur la racine.'],
        ['id' => 'curl-pipe-sh', 'pattern' => '/(curl|wget)[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i', 'reason' => 'Pipe shell d\'un téléchargement.'],
        ['id' => 'shutdown', 'pattern' => '/\b(shutdown|reboot|halt|poweroff)\b\s*(-\w+)?\s*(now|0)?/i', 'reason' => 'Arrêt système.'],
        ['id' => 'fork-bomb', 'pattern' => '/:\(\)\s*\{\s*:\|:&\s*\};:/', 'reason' => 'Fork bomb.'],
    ];

    /**
     * @param  array<string, mixed>  $args
     * @return array{decision: string, reason: string, rule_id: string}
     */
    public function decide(
        AiAgent $agent,
        string $toolName,
        array $args = [],
        ?AgentToolClassification $classification = null,
    ): array {
        $classification ??= AgentToolClassification::forTool($toolName);

        $hardDeny = $this->matchHardDeny($toolName, $args);
        if ($hardDeny !== null) {
            return [
                'decision' => self::DECISION_DENY,
                'reason' => $hardDeny['reason'],
                'rule_id' => 'hard_deny:'.$hardDeny['id'],
            ];
        }

        $agentPermissions = $this->agentPermissionConfig($agent);

        if (in_array($toolName, $agentPermissions['denied_tools'], true)) {
            return [
                'decision' => self::DECISION_DENY,
                'reason' => "Outil refusé pour l'agent {$agent->name}.",
                'rule_id' => 'agent_override:deny',
            ];
        }

        if (in_array($toolName, $agentPermissions['allowed_tools'], true)) {
            return [
                'decision' => self::DECISION_ALLOW,
                'reason' => "Outil explicitement autorisé pour l'agent {$agent->name}.",
                'rule_id' => 'agent_override:allow',
            ];
        }

        $globalDenied = $this->parseToolList(config('devforge.agents_permission_denied_tools', ''));
        if (in_array($toolName, $globalDenied, true)) {
            return [
                'decision' => self::DECISION_DENY,
                'reason' => 'Outil refusé globalement.',
                'rule_id' => 'global:deny',
            ];
        }

        $globalAllowed = $this->parseToolList(config('devforge.agents_permission_allowed_tools', ''));
        if (in_array($toolName, $globalAllowed, true)) {
            return [
                'decision' => self::DECISION_ALLOW,
                'reason' => 'Outil explicitement autorisé globalement.',
                'rule_id' => 'global:allow',
            ];
        }

        $effectiveMode = $agentPermissions['mode'] ?? $this->globalMode();

        return match ($effectiveMode) {
            self::MODE_AUTONOMOUS => [
                'decision' => self::DECISION_ALLOW,
                'reason' => 'Mode autonome — accès total.',
                'rule_id' => 'mode:autonomous',
            ],
            self::MODE_TIERED => $this->decideTiered($classification),
            self::MODE_PLAN_FIRST => [
                'decision' => self::DECISION_ASK,
                'reason' => 'Mode plan-first — chaque outil demande validation.',
                'rule_id' => 'mode:plan_first',
            ],
            default => [
                'decision' => self::DECISION_ALLOW,
                'reason' => 'Mode autonome — accès total.',
                'rule_id' => 'mode:autonomous',
            ],
        };
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array{id: string, reason: string}|null
     */
    private function matchHardDeny(string $toolName, array $args): ?array
    {
        $haystack = $toolName.' '.json_encode($args, JSON_UNESCAPED_UNICODE);

        foreach (self::HARD_DENY_PATTERNS as $rule) {
            if (preg_match($rule['pattern'], $haystack)) {
                return ['id' => $rule['id'], 'reason' => $rule['reason']];
            }
        }

        return null;
    }

    /** @return array{mode: ?string, allowed_tools: string[], denied_tools: string[]} */
    private function agentPermissionConfig(AiAgent $agent): array
    {
        $metadata = is_array($agent->metadata) ? $agent->metadata : [];
        $permissions = is_array($metadata['permissions'] ?? null) ? $metadata['permissions'] : [];

        return [
            'mode' => is_string($permissions['mode'] ?? null) ? $this->normalizeMode($permissions['mode']) : null,
            'allowed_tools' => $this->parseToolList($permissions['allowed_tools'] ?? ''),
            'denied_tools' => $this->parseToolList($permissions['denied_tools'] ?? ''),
        ];
    }

    private function globalMode(): string
    {
        return $this->normalizeMode((string) config('devforge.agents_permission_mode', self::MODE_AUTONOMOUS));
    }

    private function normalizeMode(string $mode): string
    {
        $mode = strtolower(trim($mode));

        return in_array($mode, [self::MODE_TIERED, self::MODE_PLAN_FIRST, self::MODE_AUTONOMOUS], true)
            ? $mode
            : self::MODE_AUTONOMOUS;
    }

    /**
     * @return string[]
     */
    private function parseToolList(mixed $raw): array
    {
        if (is_array($raw)) {
            return array_values(array_filter(array_map('strval', $raw)));
        }

        if (! is_string($raw) || trim($raw) === '') {
            return [];
        }

        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            return array_values(array_filter(array_map('strval', $decoded)));
        }

        return array_values(array_filter(preg_split('/[\n,;]/', $raw) ?: []));
    }

    /** @return array{decision: string, reason: string, rule_id: string} */
    private function decideTiered(AgentToolClassification $classification): array
    {
        if ($classification->isReadOnly) {
            return [
                'decision' => self::DECISION_ALLOW,
                'reason' => 'Outil lecture seule.',
                'rule_id' => 'mode:tiered:read',
            ];
        }

        if ($classification->isDestructive) {
            return [
                'decision' => self::DECISION_ASK,
                'reason' => 'Outil destructif — approbation requise (mode tiered).',
                'rule_id' => 'mode:tiered:destructive',
            ];
        }

        return [
            'decision' => self::DECISION_ALLOW,
            'reason' => 'Outil neutre (mode tiered).',
            'rule_id' => 'mode:tiered:neutral',
        ];
    }
}
