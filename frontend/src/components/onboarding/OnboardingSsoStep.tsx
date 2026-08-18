import { ExternalLink, KeyRound } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { domainApi, instanceSsoSettings } from '../../lib/domain-api';
import { previewDefaultApplicationUrl } from '../../lib/onboarding-steps';
import { useApiQuery } from '../../lib/use-api-query';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { DataState } from '../ui/DataState';

type OnboardingSsoStepProps = {
    canEdit: boolean;
    onSkip: () => void;
    onContinue: () => void;
    onBack: () => void;
};

export function OnboardingSsoStep({ canEdit, onSkip, onContinue, onBack }: OnboardingSsoStepProps) {
    const settingsQuery = useApiQuery('onboarding-sso-settings', () => domainApi.settings());
    const wildcard = settingsQuery.data?.data.instance.apps_wildcard_domain ?? '';
    const settings = settingsQuery.data?.data;
    const sso = instanceSsoSettings(settings);
    const pocketIdUrl = sso.pocket_id_url || previewDefaultApplicationUrl('id', wildcard);

    return (
        <Card title="SSO Pocket ID" eyebrow="Identité">
            <div class="mb-3 flex items-center gap-2 text-sm text-base-content/65">
                <KeyRound class="size-4 text-primary" aria-hidden />
                <span>DevForge démarre Pocket ID tout seul — rien à installer.</span>
            </div>
            <DataState
                loading={settingsQuery.loading}
                error={settingsQuery.error}
                onRetry={() => void settingsQuery.reload()}
            >
                {settings && (
                    <OnboardingSsoForm
                        canEdit={canEdit}
                        pocketIdUrl={pocketIdUrl}
                        protectApps={sso.sso_protect_apps_by_default}
                        hideLocalLogin={sso.sso_hide_local_login}
                        canStart={sso.can_start}
                        onSkip={onSkip}
                        onContinue={onContinue}
                        onBack={onBack}
                    />
                )}
            </DataState>
        </Card>
    );
}

function OnboardingSsoForm({
    canEdit,
    pocketIdUrl,
    protectApps: initialProtectApps,
    hideLocalLogin: initialHideLocalLogin,
    canStart,
    onSkip,
    onContinue,
    onBack,
}: {
    canEdit: boolean;
    pocketIdUrl: string;
    protectApps: boolean;
    hideLocalLogin: boolean;
    canStart: boolean;
    onSkip: () => void;
    onContinue: () => void;
    onBack: () => void;
}) {
    const [protectApps, setProtectApps] = useState(initialProtectApps);
    const [hideLocalLogin, setHideLocalLogin] = useState(initialHideLocalLogin);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const save = async () => {
        setSubmitting(true);
        setError(null);
        try {
            if (canEdit) {
                await domainApi.updateSsoSettings({
                    sso_protect_apps_by_default: protectApps,
                    sso_hide_local_login: hideLocalLogin,
                });
                if (canStart) {
                    await domainApi.startSsoStack();
                }
            }
            onContinue();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Impossible de démarrer le SSO.');
            setSubmitting(false);
        }
    };

    return (
        <form
            class="mt-4 grid gap-3"
            onSubmit={(event) => {
                event.preventDefault();
                if (!submitting) {
                    void save();
                }
            }}
        >
            <p class="text-sm text-base-content/65">
                Les apps déployées pourront s’authentifier via Pocket ID (variables OIDC injectées automatiquement).
                Après le démarrage, ouvrez{' '}
                {pocketIdUrl ? (
                    <a class="link link-primary" href={`${pocketIdUrl.replace(/\/$/, '')}/setup`} target="_blank" rel="noreferrer">
                        {pocketIdUrl.replace(/\/$/, '')}/setup
                    </a>
                ) : (
                    'id.…/setup'
                )}
                {' '}pour créer le compte admin et enregistrer votre passkey. N’utilisez pas « Sign in » tant que cette étape n’est pas faite.
            </p>
            {pocketIdUrl && (
                <p class="text-sm">
                    <a class="link link-primary inline-flex items-center gap-1" href={pocketIdUrl} target="_blank" rel="noreferrer">
                        Ouvrir Pocket ID
                        <ExternalLink class="size-3.5" aria-hidden />
                    </a>
                    <span class="ml-2 font-mono text-xs text-base-content/55">{pocketIdUrl}</span>
                </p>
            )}
            {!canStart && (
                <p class="text-sm text-warning">
                    Indiquez d’abord un domaine (étape précédente) pour que DevForge publie Pocket ID en HTTPS.
                </p>
            )}
            <label class="flex items-center justify-between gap-3 rounded-xl border border-base-300/70 px-3 py-2 text-sm">
                <span>Protéger les applications par défaut</span>
                <input
                    class="toggle toggle-sm"
                    type="checkbox"
                    checked={protectApps}
                    disabled={!canEdit || submitting}
                    onChange={(event) => setProtectApps(event.currentTarget.checked)}
                />
            </label>
            <label class="flex items-center justify-between gap-3 rounded-xl border border-base-300/70 px-3 py-2 text-sm">
                <span>Masquer la connexion locale</span>
                <input
                    class="toggle toggle-sm"
                    type="checkbox"
                    checked={hideLocalLogin}
                    disabled={!canEdit || submitting}
                    onChange={(event) => setHideLocalLogin(event.currentTarget.checked)}
                />
            </label>
            {error && <p class="text-sm text-error" role="alert">{error}</p>}
            <div class="mt-2 flex flex-wrap items-center gap-2">
                <Button variant="ghost" type="button" onClick={onBack}>Retour</Button>
                <Button variant="ghost" type="button" onClick={onSkip}>Plus tard</Button>
                <Button type="submit" disabled={submitting}>
                    {submitting ? 'Démarrage…' : 'Démarrer le SSO'}
                </Button>
            </div>
        </form>
    );
}
