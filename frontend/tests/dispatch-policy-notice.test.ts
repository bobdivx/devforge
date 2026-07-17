import { describe, expect, it } from 'vitest';
import { buildMonitoringQuotaNotice } from '../src/lib/dispatch-policy-notice';

describe('buildMonitoringQuotaNotice', () => {
    const agentsOn = {
        enabled: true,
        auto_fix_deployments: true,
        monitor_build: true,
        webhook_build: true,
    };

    it('explique le quota quand monitor_build est on mais ineffectif', () => {
        const notice = buildMonitoringQuotaNotice(agentsOn, {
            max_runs_per_deployment: 1,
            monitor_build_enabled: true,
            auto_fix_deployments: true,
            allowed_events: ['deployment_failed'],
            skipped_events: [
                { event: 'deployment_build_started', reason: 'quota_max_runs' },
            ],
            build_monitoring_effective: false,
            summary: 'Quota bloque les builds.',
        });

        expect(notice).toBe('Quota bloque les builds.');
    });

    it('ne dit rien si le monitoring build est effectivement actif', () => {
        expect(buildMonitoringQuotaNotice(agentsOn, {
            max_runs_per_deployment: 3,
            monitor_build_enabled: true,
            auto_fix_deployments: true,
            allowed_events: ['deployment_failed', 'deployment_build_started', 'deployment_build_completed'],
            skipped_events: [],
            build_monitoring_effective: true,
            summary: null,
        })).toBeNull();
    });

    it('ne dit rien si monitor_build est désactivé (autre bandeau)', () => {
        expect(buildMonitoringQuotaNotice({
            ...agentsOn,
            monitor_build: false,
        }, {
            max_runs_per_deployment: 1,
            monitor_build_enabled: false,
            auto_fix_deployments: true,
            allowed_events: ['deployment_failed'],
            skipped_events: [],
            build_monitoring_effective: false,
            summary: 'ignored',
        })).toBeNull();
    });
});
