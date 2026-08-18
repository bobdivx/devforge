import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    firstIncompleteStep,
    initialWizardStep,
    applicationUrlSlug,
    isCustomInstanceUrl,
    normalizeAppsWildcardDomain,
    normalizeInstanceUrl,
    previewDefaultApplicationUrl,
    resolveOnboardingInstanceUrl,
    submitGithubManifest,
} from '../src/lib/onboarding-steps';

describe('onboarding-steps', () => {
    const originalSubmit = HTMLFormElement.prototype.submit;

    afterEach(() => {
        HTMLFormElement.prototype.submit = originalSubmit;
        document.body.replaceChildren();
    });

    it('ouvre le premier cran encore incomplet', () => {
        expect(firstIncompleteStep({
            account: true,
            domain: false,
            sso: false,
            github: false,
            s3: false,
            server: false,
        })).toBe('domain');

        expect(firstIncompleteStep({
            account: true,
            domain: true,
            sso: false,
            github: false,
            s3: false,
            server: false,
        })).toBe('sso');

        expect(firstIncompleteStep({
            account: true,
            domain: true,
            sso: true,
            github: false,
            s3: false,
            server: false,
        })).toBe('github');

        expect(firstIncompleteStep({
            account: true,
            domain: true,
            sso: true,
            github: true,
            s3: false,
            server: true,
        })).toBe('s3');

        expect(firstIncompleteStep({
            account: true,
            domain: true,
            sso: true,
            github: true,
            s3: true,
            server: false,
        })).toBe('server');

        expect(firstIncompleteStep({
            account: true,
            domain: true,
            sso: true,
            github: true,
            s3: true,
            server: true,
        })).toBe('finish');

        expect(firstIncompleteStep({
            account: true,
            domain: false,
            sso: false,
            github: true,
            s3: false,
            server: false,
        }, 'repos')).toBe('github');
    });

    it('démarre le wizard à l’accueil, sauf retour GitHub ou fin', () => {
        const fresh = {
            account: true,
            domain: false,
            sso: false,
            github: false,
            s3: false,
            server: false,
        };

        expect(initialWizardStep(true, null, fresh)).toBe('domain');
        expect(initialWizardStep(true, 'repos', fresh)).toBe('github');
        expect(initialWizardStep(true, 'domain', {
            account: true,
            domain: true,
            sso: true,
            github: true,
            s3: true,
            server: true,
        })).toBe('domain');
        expect(initialWizardStep(true, null, {
            account: true,
            domain: true,
            sso: true,
            github: true,
            s3: true,
            server: true,
        })).toBe('finish');
        expect(initialWizardStep(false, null, fresh)).toBe('domain');
        expect(initialWizardStep(false, null, {
            account: true,
            domain: true,
            sso: true,
            github: true,
            s3: true,
            server: true,
        })).toBe('finish');
    });

    it('distingue l’URL locale d’une URL personnalisée', () => {
        expect(isCustomInstanceUrl('http://zimacube.local:8080', 'http://zimacube.local:8080')).toBe(false);
        expect(isCustomInstanceUrl('https://forge.exemple.com', 'http://zimacube.local:8080')).toBe(true);
        expect(resolveOnboardingInstanceUrl('local', '', 'http://zimacube.local:8080/')).toBe('http://zimacube.local:8080');
        expect(resolveOnboardingInstanceUrl('custom', 'forge.exemple.com', 'http://zimacube.local:8080')).toBe('http://forge.exemple.com');
        expect(resolveOnboardingInstanceUrl(null, 'https://x.test', 'http://zimacube.local:8080')).toBe('');
    });

    it('prépare le domaine partagé et l’URL par défaut nomdelapp.domaine', () => {
        expect(normalizeAppsWildcardDomain('exemple.com')).toBe('https://exemple.com');
        expect(normalizeAppsWildcardDomain('*.apps.maison.local')).toBe('http://apps.maison.local');
        expect(normalizeAppsWildcardDomain('pas-un-domaine')).toBe('');
        expect(applicationUrlSlug('Star Base FR')).toBe('star-base-fr');
        expect(previewDefaultApplicationUrl('starbasefr', 'exemple.com')).toBe('https://starbasefr.exemple.com');
    });

    it('normalise l’URL d’instance pour GitHub et le proxy', () => {
        expect(normalizeInstanceUrl('http://zimacube.local:8080/')).toBe('http://zimacube.local:8080');
        expect(normalizeInstanceUrl('zimacube.local:8080')).toBe('http://zimacube.local:8080');
        expect(normalizeInstanceUrl('', 'https://forge.example.com/')).toBe('https://forge.example.com');
        expect(normalizeInstanceUrl('')).toBe('');
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
