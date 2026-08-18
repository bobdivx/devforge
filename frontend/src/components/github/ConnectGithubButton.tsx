import { FolderGit2 } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { domainApi, type GithubAppSummary } from '../../lib/domain-api';
import { submitGithubManifest } from '../../lib/onboarding-steps';
import { Button } from '../ui/Button';

export async function redirectToGithubAppSetup(options: {
    fromOnboarding?: boolean;
    returnTo?: 'applications' | 'onboarding';
    organization?: string;
}): Promise<void> {
    const result = await domainApi.startGithubApp({
        name: 'DevForge',
        organization: options.organization,
        preview_deployments: true,
        administration: true,
        from_onboarding: options.fromOnboarding,
        return_to: options.returnTo ?? (options.fromOnboarding ? 'onboarding' : undefined),
    });
    submitGithubManifest(result.data.launch.action_url, result.data.launch.manifest);
}

type ConnectGithubButtonProps = {
    fromOnboarding?: boolean;
    returnTo?: 'applications' | 'onboarding';
    label?: string;
    busyLabel?: string;
    size?: 'sm' | 'md';
    onError?: (message: string) => void;
};

export function ConnectGithubButton({
    fromOnboarding = false,
    returnTo,
    label = 'Continuer avec GitHub',
    busyLabel = 'Redirection vers GitHub…',
    size = 'md',
    onError,
}: ConnectGithubButtonProps) {
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [organization, setOrganization] = useState('');
    const [showOrg, setShowOrg] = useState(false);

    const connect = async () => {
        setSubmitting(true);
        setError(null);
        try {
            await redirectToGithubAppSetup({
                fromOnboarding,
                returnTo,
                organization: organization.trim() || undefined,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Impossible de démarrer la connexion GitHub.';
            setError(message);
            onError?.(message);
            setSubmitting(false);
        }
    };

    return (
        <div class="grid gap-3">
            <Button
                size={size}
                disabled={submitting}
                aria-label={submitting ? busyLabel : label}
                onClick={() => void connect()}
            >
                <FolderGit2 class="size-4" aria-hidden />
                {submitting ? busyLabel : label}
            </Button>
            <button
                class="text-left text-xs text-base-content/50 underline-offset-2 hover:underline"
                type="button"
                onClick={() => setShowOrg((current) => !current)}
            >
                {showOrg ? 'Masquer les options' : 'Organisation GitHub (optionnel)'}
            </button>
            {showOrg && (
                <label class="grid gap-1 text-sm">
                    <span class="font-medium">Organisation</span>
                    <input
                        class="input input-bordered rounded-xl"
                        placeholder="laisser vide pour un compte personnel"
                        value={organization}
                        onInput={(event) => setOrganization(event.currentTarget.value)}
                    />
                </label>
            )}
            {error && <p class="text-xs text-error" role="alert">{error}</p>}
        </div>
    );
}

type FinishGithubInstallButtonProps = {
    app: GithubAppSummary;
    returnTo?: 'applications' | 'onboarding';
    label?: string;
    size?: 'sm' | 'md';
    onError?: (message: string) => void;
};

export function FinishGithubInstallButton({
    app,
    returnTo,
    label = 'Terminer l’installation GitHub',
    size = 'md',
    onError,
}: FinishGithubInstallButtonProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const install = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await domainApi.githubAppInstallUrl(app.uuid, returnTo);
            window.location.assign(result.data.url);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Impossible d’ouvrir l’installation GitHub.';
            setError(message);
            onError?.(message);
            setLoading(false);
        }
    };

    return (
        <div class="grid gap-1">
            <Button size={size} disabled={loading} aria-label={loading ? 'Ouverture…' : label} onClick={() => void install()}>
                <FolderGit2 class="size-4" aria-hidden />
                {loading ? 'Ouverture…' : label}
            </Button>
            {error && <p class="text-xs text-error" role="alert">{error}</p>}
        </div>
    );
}
