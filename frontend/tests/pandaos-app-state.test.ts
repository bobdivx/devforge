import { describe, expect, it } from 'vitest';
import { pandaAppActions, pandaAppState, pandaAppStateLabel } from '../src/lib/pandaos-app-state';

describe('pandaAppState', () => {
    it('mappe les statuts Docker vers les actions PandaOS', () => {
        expect(pandaAppState('exited')).toBe('stopped');
        expect(pandaAppActions('stopped')).toEqual(['start']);

        expect(pandaAppState('starting:unknown')).toBe('starting');
        expect(pandaAppActions('starting')).toEqual(['stop']);

        expect(pandaAppState('running:healthy')).toBe('running');
        expect(pandaAppActions('running')).toEqual(['stop', 'restart']);

        expect(pandaAppState('error')).toBe('error');
        expect(pandaAppActions('error')).toEqual(['restart']);
        expect(pandaAppStateLabel('idle')).toBe('Inactif');
    });
});
