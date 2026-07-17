import { describe, expect, it } from 'vitest';
import { applicationTabs } from '../src/lib/application-tabs';

describe('application-tabs', () => {
    it('expose les onglets de détail application', () => {
        expect(applicationTabs.map(({ id }) => id)).toEqual([
            'overview',
            'settings',
            'domains',
            'deployments',
            'databases',
            'logs',
            'variables',
            'files',
            'danger',
        ]);
    });
});
