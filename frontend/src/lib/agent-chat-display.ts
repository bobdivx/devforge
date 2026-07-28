import type { AgentChatStep } from './domain-api';

const TOOL_LABELS: Record<string, string> = {
    get_deployment_logs: 'Logs de déploiement',
    get_resource_status: 'État de la ressource',
    control_resource: 'Contrôle ressource',
    fix_application_host_permissions: 'Permissions host',
    fix_coolify_base_config_path: 'Config DevForge',
    update_application_git_branch: 'Branche Git',
    update_application_runtime_settings: 'Config build',
    get_application_runtime_settings: 'Lire config build',
    upsert_application_env_var: 'Variable DevForge',
    list_application_env_vars: 'Lister variables',
    write_application_source: 'Écrire le code',
    read_application_source: 'Lire le code',
    list_application_source: 'Explorer le code',
    get_application_source_info: 'Infos source',
    get_application_git_info: 'Infos Git',
    list_github_branches: 'Branches GitHub',
    spawn_task: 'Sous-tâche',
    delegate_task: 'Délégation',
    docker_logs: 'Logs Docker',
    exec_command: 'Commande serveur',
    send_notification: 'Notification',
    http_request: 'Requête HTTP',
    enable_tool_package: 'Activer paquet outils',
};

export function toolDisplayLabel(name: string): string {
    return TOOL_LABELS[name] ?? name.replaceAll('_', ' ');
}

export function isToolProseDump(content: string): boolean {
    const text = content.trim();
    if (text === '') {
        return false;
    }

    if (/"method"\s*:\s*"(?:spawn_task|control_resource|fix_application_host_permissions)"/i.test(text)) {
        return true;
    }

    if (/```(?:json)?\s*\{[\s\S]*"(?:spawn_task|control_resource|method)"/i.test(text)) {
        return true;
    }

    return /\b(?:spawn_task|fix_application_host_permissions|control_resource)\b/i.test(text)
        && /commande requise|voici la commande|tool_call|difficult[ée].*heavy|sous-t[aâ]che [ée]ph[ée]m[eè]re/i.test(text)
        || /commande requise|voici la commande requise/i.test(text);
}

/** Retire les blocs JSON / consignes d’outil destinés à l’UI, pas à l’utilisateur. */
export function sanitizeAssistantContent(content: string, steps: AgentChatStep[] = []): string {
    let text = content
        .replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/gi, '')
        .replace(/^\s*\{[^{}]*"method"\s*:\s*"[^"]+"[^{}]*\}\s*$/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    if (steps.length > 0 && (text === '' || isToolProseDump(text))) {
        return '';
    }

    if (steps.length === 0 && isToolProseDump(text)) {
        return 'Les actions n’ont pas été exécutées (description d’outil au lieu d’un appel réel). Réessayez.';
    }

    return text;
}

export function stepsCompletion(steps: AgentChatStep[]): { done: number; total: number } {
    const total = steps.length;
    const done = steps.filter((step) => step.status === 'done' || step.status === undefined).length;

    return { done, total };
}
