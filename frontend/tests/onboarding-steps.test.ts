import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstIncompleteStep, submitGithubManifest } from '../src/lib/onboarding-steps';

describe('onboarding-steps', () => {
    const originalSubmit = HTMLFormElement.prototype.submit;

    afterEach(() => {
        HTMLFormElement.prototype.submit = originalSubmit;
        document.body.replaceChildren();
    });

    it('ouvre le premier cran encore incomplet', () => {
        expect(firstIncompleteStep({
            account: true,
            github: false,
            s3: false,
            server: false,
        })).toBe('github');

        expect(firstIncompleteStep({
            account: true,
            github: true,
            s3: false,
            server: true,
        })).toBe('s3');

        expect(firstIncompleteStep({
            account: true,
            github: true,
            s3: true,
            server: false,
        })).toBe('server');

        expect(firstIncompleteStep({
            account: true,
            github: true,
            s3: true,
            server: true,
        })).toBe('finish');

        expect(firstIncompleteStep({
            account: true,
            github: true,
            s3: false,
            server: false,
        }, 'repos')).toBe('github');
    });

    it('prépare le formulaire manifest GitHub', () => {
        const submit = vi.fn();
        HTMLFormElement.prototype.submit = submit;

        submitGithubManifest('https://github.com/settings/apps/new?state=abc', {
            name: 'DevForge',
            public: false,
        });

        const form = document.querySelector('form');
        const input = document.querySelector('input[name="manifest"]');

        expect(form?.getAttribute('action')).toBe('https://github.com/settings/apps/new?state=abc');
        expect(form?.getAttribute('method')).toBe('POST');
        expect(input?.getAttribute('value')).toBe(JSON.stringify({ name: 'DevForge', public: false }));
        expect(submit).toHaveBeenCalled();
    });
});
