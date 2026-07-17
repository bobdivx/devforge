import { describe, expect, it } from 'vitest';
import {
    isToolProseDump,
    sanitizeAssistantContent,
    stepsCompletion,
    toolDisplayLabel,
} from '../src/lib/agent-chat-display';

describe('agent-chat-display', () => {
    it('détecte un dump JSON spawn_task en prose', () => {
        const content = `Pour résoudre le problème, l'assistant doit déclencher un nouveau spawn_task.
\`\`\`json
{"method":"spawn_task","goal":"reparer_le_deploiement","difficulty":"heavy"}
\`\`\`
Cette commande déclenche une sous-tâche éphémère.`;

        expect(isToolProseDump(content)).toBe(true);
        expect(sanitizeAssistantContent(content)).toContain('pas été exécutées');
    });

    it('masque le prose outil quand des steps réels existent', () => {
        const content = 'Voici la commande requise :\n```json\n{"method":"spawn_task"}\n```';
        expect(sanitizeAssistantContent(content, [{
            type: 'tool',
            name: 'get_deployment_logs',
            status: 'done',
        }])).toBe('');
    });

    it('libellé outil et compteur de completion', () => {
        expect(toolDisplayLabel('fix_application_host_permissions')).toBe('Permissions host');
        expect(stepsCompletion([
            { type: 'tool', name: 'a', status: 'done' },
            { type: 'tool', name: 'b', status: 'error' },
            { type: 'tool', name: 'c', status: 'done' },
        ])).toEqual({ done: 2, total: 3 });
    });
});
