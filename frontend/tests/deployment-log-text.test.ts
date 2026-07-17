import { describe, expect, it } from 'vitest';
import { formatDeploymentLogsText } from '../src/lib/deployment-log-text';

describe('formatDeploymentLogsText', () => {
    it('formate les lignes avec préfixes debug et commande', () => {
        const text = formatDeploymentLogsText([
            {
                cursor: 1,
                timestamp: null,
                stream: 'stdout',
                message: 'Starting deployment',
                command: false,
                hidden: false,
            },
            {
                cursor: 2,
                timestamp: null,
                stream: 'stdout',
                message: 'sudo docker run …',
                command: true,
                hidden: true,
            },
        ]);

        expect(text).toBe("Starting deployment\n[debug] [cmd] sudo docker run …");
    });
});
