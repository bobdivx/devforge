import { Cloud } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { domainApi, type S3StorageInput } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';

const emptyForm = (): S3StorageInput => ({
    name: '',
    description: '',
    region: 'us-east-1',
    key: '',
    secret: '',
    bucket: '',
    endpoint: 'https://s3.amazonaws.com',
});

type OnboardingS3StepProps = {
    canManage: boolean;
    onSkip: () => void;
    onConnected: () => void;
};

export function OnboardingS3Step({ canManage, onSkip, onConnected }: OnboardingS3StepProps) {
    const query = useApiQuery('onboarding-s3', () => domainApi.s3Storages());
    const [form, setForm] = useState<S3StorageInput>(emptyForm);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const storages = query.data?.data ?? [];

    const submit = async () => {
        setSubmitting(true);
        setError(null);
        try {
            await domainApi.createS3Storage(form);
            await query.reload();
            onConnected();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Échec de l’enregistrement S3.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Card title="Connecter un stockage S3" eyebrow="Sauvegardes">
            <p class="text-sm text-base-content/65">
                Un bucket compatible S3 (AWS, MinIO, Cloudflare R2, etc.) sert aux sauvegardes de bases et d’instance.
            </p>
            <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                {storages.length > 0 && (
                    <ul class="mt-3 divide-y divide-base-300/70">
                        {storages.map((storage) => (
                            <li class="flex items-center justify-between gap-3 py-3" key={storage.uuid}>
                                <div class="min-w-0">
                                    <div class="flex items-center gap-2">
                                        <Cloud class="size-4 text-primary" aria-hidden />
                                        <p class="truncate text-sm font-semibold">{storage.name}</p>
                                        <StatusBadge
                                            label={storage.is_usable ? 'Validé' : 'Enregistré'}
                                            tone={storage.is_usable ? 'success' : 'neutral'}
                                        />
                                    </div>
                                    <p class="mt-1 truncate font-mono text-[11px] text-base-content/45">
                                        {storage.endpoint}/{storage.bucket}
                                    </p>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </DataState>
            {canManage && storages.length === 0 && (
                <form
                    class="mt-4 grid gap-3"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                    }}
                >
                    <label class="grid gap-1 text-sm">
                        <span class="font-medium">Nom</span>
                        <input
                            class="input input-bordered rounded-xl"
                            required
                            value={form.name}
                            onInput={(event) => setForm({ ...form, name: event.currentTarget.value })}
                        />
                    </label>
                    <div class="grid gap-3 sm:grid-cols-2">
                        <label class="grid gap-1 text-sm">
                            <span class="font-medium">Région</span>
                            <input
                                class="input input-bordered rounded-xl"
                                required
                                value={form.region}
                                onInput={(event) => setForm({ ...form, region: event.currentTarget.value })}
                            />
                        </label>
                        <label class="grid gap-1 text-sm">
                            <span class="font-medium">Bucket</span>
                            <input
                                class="input input-bordered rounded-xl"
                                required
                                value={form.bucket}
                                onInput={(event) => setForm({ ...form, bucket: event.currentTarget.value })}
                            />
                        </label>
                    </div>
                    <label class="grid gap-1 text-sm">
                        <span class="font-medium">Endpoint</span>
                        <input
                            class="input input-bordered rounded-xl font-mono text-xs"
                            required
                            value={form.endpoint}
                            onInput={(event) => setForm({ ...form, endpoint: event.currentTarget.value })}
                        />
                    </label>
                    <div class="grid gap-3 sm:grid-cols-2">
                        <label class="grid gap-1 text-sm">
                            <span class="font-medium">Access Key</span>
                            <input
                                class="input input-bordered rounded-xl font-mono text-xs"
                                required
                                value={form.key}
                                onInput={(event) => setForm({ ...form, key: event.currentTarget.value })}
                            />
                        </label>
                        <label class="grid gap-1 text-sm">
                            <span class="font-medium">Secret Key</span>
                            <input
                                class="input input-bordered rounded-xl font-mono text-xs"
                                type="password"
                                required
                                value={form.secret}
                                onInput={(event) => setForm({ ...form, secret: event.currentTarget.value })}
                            />
                        </label>
                    </div>
                    {error && <p class="text-xs text-error" role="alert">{error}</p>}
                    <div class="flex flex-wrap gap-2">
                        <Button type="submit" disabled={submitting}>
                            {submitting ? 'Enregistrement…' : 'Enregistrer S3'}
                        </Button>
                        <Button variant="ghost" onClick={onSkip}>Passer</Button>
                    </div>
                </form>
            )}
            {(storages.length > 0 || !canManage) && (
                <div class="mt-4 flex flex-wrap gap-2">
                    {storages.length > 0 && <Button onClick={onConnected}>Continuer</Button>}
                    {storages.length === 0 && <Button variant="ghost" onClick={onSkip}>Passer</Button>}
                </div>
            )}
        </Card>
    );
}
