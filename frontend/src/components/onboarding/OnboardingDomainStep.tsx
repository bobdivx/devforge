import { Globe } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { domainApi } from '../../lib/domain-api';
import {
    normalizeAppsWildcardDomain,
    normalizeInstanceUrl,
    previewDefaultApplicationUrl,
    type AppsDomainMode,
} from '../../lib/onboarding-steps';
import { useApiQuery } from '../../lib/use-api-query';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { DataState } from '../ui/DataState';

type OnboardingDomainStepProps = {
    canEdit: boolean;
    onBack: () => void;
    onSaved: () => void;
};

export function OnboardingDomainStep({ canEdit, onBack, onSaved }: OnboardingDomainStepProps) {
    const query = useApiQuery('onboarding-domain', () => domainApi.settings());
    const [mode, setMode] = useState<AppsDomainMode>('custom');
    const [customDomain, setCustomDomain] = useState('');
    const [initialized, setInitialized] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const localUrl = typeof window === 'undefined' ? '' : window.location.origin;
    const previewUrl = previewDefaultApplicationUrl('starbasefr', customDomain);

    useEffect(() => {
        if (initialized) {
            return;
        }

        if (query.loading) {
            return;
        }

        const current = query.data?.data.instance.apps_wildcard_domain ?? '';
        if (current) {
            setMode('custom');
            setCustomDomain(current.replace(/^https?:\/\//i, ''));
        }

        setInitialized(true);
    }, [initialized, query.data, query.loading]);

    const save = async () => {
        const wildcard = mode === 'custom' ? normalizeAppsWildcardDomain(customDomain) : null;
        if (mode === 'custom' && wildcard === '') {
            setError('Indiquez le domaine, par exemple exemple.com');

            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            const currentFqdn = query.data?.data.instance.fqdn ?? '';
            await domainApi.updateInstanceSettings({
                fqdn: currentFqdn || normalizeInstanceUrl(localUrl),
                apps_wildcard_domain: wildcard,
                force_save_domains: true,
            });
            onSaved();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Impossible d’enregistrer le domaine.');
            setSubmitting(false);
        }
    };

    return (
        <Card title="Domaine des applications" eyebrow="Instance">
            <p class="text-sm text-base-content/65">
                Ce domaine sert à toutes les applications. DevForge créera par défaut
                {' '}
                <code>nomdelapp.votredomaine.tld</code>
                , par exemple
                {' '}
                <code>starbasefr.exemple.com</code>
                .
            </p>
            <DataState loading={query.loading && !initialized} error={query.error} onRetry={() => void query.reload()}>
                <fieldset class="mt-4 grid gap-2">
                    <legend class="mb-1 text-sm font-medium">Avez-vous un domaine pour toutes vos applications ?</legend>
                    <label class={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition ${
                        mode === 'none' ? 'border-primary/40 bg-primary/5' : 'border-base-300/70'
                    }`}
                    >
                        <input
                            class="radio radio-sm mt-0.5"
                            type="radio"
                            name="apps-domain-mode"
                            checked={mode === 'none'}
                            disabled={!canEdit || submitting}
                            onChange={() => setMode('none')}
                        />
                        <span class="grid min-w-0 gap-1">
                            <span class="text-sm font-semibold">Non, pas pour le moment</span>
                            <span class="text-xs text-base-content/55">
                                Les apps recevront une adresse temporaire (sslip.io) tant qu’aucun domaine n’est configuré.
                            </span>
                        </span>
                    </label>
                    <label class={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition ${
                        mode === 'custom' ? 'border-primary/40 bg-primary/5' : 'border-base-300/70'
                    }`}
                    >
                        <input
                            class="radio radio-sm mt-0.5"
                            type="radio"
                            name="apps-domain-mode"
                            checked={mode === 'custom'}
                            disabled={!canEdit || submitting}
                            onChange={() => setMode('custom')}
                        />
                        <span class="grid min-w-0 gap-1">
                            <span class="text-sm font-semibold">Oui, j’ai un nom de domaine</span>
                            <span class="text-xs text-base-content/55">
                                Exemple : exemple.com ou apps.maison.local
                            </span>
                        </span>
                    </label>
                </fieldset>
                {mode === 'custom' && (
                    <label class="mt-3 grid gap-1.5">
                        <span class="flex items-center gap-2 text-sm font-medium">
                            <Globe class="size-4 text-primary" aria-hidden />
                            Domaine des applications
                        </span>
                        <input
                            class="input input-bordered input-sm w-full rounded-xl"
                            value={customDomain}
                            disabled={!canEdit || submitting}
                            placeholder="exemple.com"
                            inputMode="url"
                            onInput={(event) => setCustomDomain(event.currentTarget.value)}
                        />
                        {previewUrl !== '' && (
                            <span class="text-xs text-base-content/55">
                                Aperçu :
                                {' '}
                                <code>{previewUrl}</code>
                            </span>
                        )}
                    </label>
                )}
            </DataState>
            {error && <p class="mt-3 text-xs text-error" role="alert">{error}</p>}
            <div class="mt-4 flex flex-wrap gap-2">
                <Button variant="ghost" disabled={submitting} onClick={onBack}>
                    Retour
                </Button>
                {canEdit ? (
                    <Button disabled={submitting || !initialized} onClick={() => void save()}>
                        {submitting ? 'Enregistrement…' : 'Continuer'}
                    </Button>
                ) : (
                    <p class="text-sm text-base-content/55">
                        Seul un administrateur d’instance peut enregistrer ce domaine.
                    </p>
                )}
            </div>
        </Card>
    );
}
