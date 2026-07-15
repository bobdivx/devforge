import type { DeploymentLog } from './domain-api';

export function formatDeploymentLogsText(lines: DeploymentLog[]): string {
    return lines.map((line) => {
        const prefixes: string[] = [];

        if (line.hidden) {
            prefixes.push('[debug]');
        }

        if (line.command) {
            prefixes.push('[cmd]');
        }

        const prefix = prefixes.length > 0 ? `${prefixes.join(' ')} ` : '';

        return `${prefix}${line.message}`;
    }).join('\n');
}
