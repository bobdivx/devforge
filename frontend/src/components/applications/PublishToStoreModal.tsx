import { useEffect, useState } from 'preact/hooks';
import { Modal } from '../ui/Modal';
import { STORE_CATEGORIES } from '../../lib/store-categories';
import { domainApi, type StoreEnvSchemaItem, type StorePublishPreview, type StoreRuntimeDefaults } from '../../lib/domain-api';
import { ApiError } from '../../lib/api-client';
import { storePath } from '../../lib/routes';
import { navigateTo } from '../../lib/use-navigate';

type EnvDraft = StoreEnvSchemaItem & { included: boolean; default: string };

type Props = {
    open: boolean;
    applicationUuid: string;
    applicationName: string;
    onClose: () => void;
    onPublished: (slug: string) => void;
};

export function PublishToStoreModal({ open, applicationUuid, applicationName, onClose, onPublished }: Props) {
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [preview, setPreview] = useState<StorePublishPreview | null>(null);
    const [name, setName] = useState(applicationName);
    const [slug, setSlug] = useState('');
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState('web');
    const [envDrafts, setEnvDrafts] = useState<EnvDraft[]>([]);
    const [runtime, setRuntime] = useState<StoreRuntimeDefaults>({});

    useEffect(() => {
        if (!open) {
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);

        void (async () => {
            try {
                const response = await domainApi.applicationStorePublishPreview(applicationUuid);
                if (cancelled) {
                    return;
                }

                const data = response.data;
                setPreview(data);
                setName(data.listing?.name ?? data.suggested_name);
                setSlug(data.listing?.slug ?? data.suggested_slug);
                setDescription(data.listing?.description ?? '');
                setCategory(data.listing?.category ?? 'web');
                setRuntime(data.listing?.runtime_defaults ?? data.runtime_defaults);
                const existing = new Map((data.listing?.env_schema ?? []).map((item) => [item.key, item]));
                setEnvDrafts(
                    data.environment_variables.map((item) => {
                        const published = existing.get(item.key);

                        return {
                            ...item,
                            included: published ? true : Boolean(item.included),
                            is_secret: published?.is_secret ?? item.is_secret,
                            required: published?.required ?? item.required,
                            default: published?.default ?? item.default ?? '',
                            description: published?.description ?? item.description,
                        };
                    }),
                );
            } catch (loadError) {
                if (!cancelled) {
                    setError(loadError instanceof ApiError ? loadError.message : 'Impossible de préparer la publication.');
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [open, applicationUuid]);

    const updateEnv = (key: string, patch: Partial<EnvDraft>) => {
        setEnvDrafts((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
    };

    const submit = async () => {
        if (!preview?.publishable) {
            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            const response = await domainApi.publishApplicationToStore(applicationUuid, {
                name,
                slug,
                description,
                category,
                runtime_defaults: runtime,
                env_schema: envDrafts.map((item) => ({
                    key: item.key,
                    included: item.included,
                    is_secret: item.is_secret,
                    required: item.required,
                    default: item.is_secret ? null : item.default,
                    description: item.description,
                    is_runtime: item.is_runtime,
                    is_buildtime: item.is_buildtime,
                })),
            });
            onPublished(response.data.slug);
            onClose();
            navigateTo(storePath(response.data.slug));
        } catch (submitError) {
            setError(submitError instanceof ApiError ? submitError.message : 'La publication a échoué.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            open={open}
            title="Publier sur le Store"
            size="xl"
            onClose={onClose}
            footer={(
                <>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={onClose}>Annuler</button>
                    <button
                        class="btn btn-primary btn-sm"
                        type="button"
                        disabled={loading || submitting || !preview?.publishable}
                        onClick={() => void submit()}
                    >
                        {submitting ? 'Publication…' : preview?.listing ? 'Mettre à jour' : 'Publier'}
                    </button>
                </>
            )}
        >
            {loading && <p class="text-sm text-base-content/55">Préparation de la fiche…</p>}
            {error && <p class="text-sm text-error">{error}</p>}
            {preview && !preview.publishable && (
                <p class="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                    {preview.reason}
                </p>
            )}
            {preview?.publishable && (
                <div class="grid gap-4">
                    <p class="text-sm text-base-content/65">
                        Les secrets ne sont jamais copiés. Cochez les variables à publier, oubliez le reste, et définissez les valeurs par défaut.
                    </p>
                    <label class="grid gap-1 text-sm">
                        Nom
                        <input class="input input-bordered input-sm" value={name} onInput={(event) => setName(event.currentTarget.value)} />
                    </label>
                    <label class="grid gap-1 text-sm">
                        Slug
                        <input class="input input-bordered input-sm font-mono" value={slug} onInput={(event) => setSlug(event.currentTarget.value)} />
                    </label>
                    <label class="grid gap-1 text-sm">
                        Description
                        <textarea class="textarea textarea-bordered textarea-sm" rows={3} value={description} onInput={(event) => setDescription(event.currentTarget.value)} />
                    </label>
                    <label class="grid gap-1 text-sm">
                        Catégorie
                        <select class="select select-bordered select-sm" value={category} onChange={(event) => setCategory(event.currentTarget.value)}>
                            {STORE_CATEGORIES.map((item) => (
                                <option key={item.id} value={item.id}>{item.label}</option>
                            ))}
                        </select>
                    </label>
                    <div class="grid gap-2 sm:grid-cols-2">
                        <label class="grid gap-1 text-sm">
                            Build pack
                            <input class="input input-bordered input-sm" value={runtime.build_pack ?? ''} onInput={(event) => setRuntime((current) => ({ ...current, build_pack: event.currentTarget.value }))} />
                        </label>
                        <label class="grid gap-1 text-sm">
                            Ports
                            <input class="input input-bordered input-sm" value={runtime.ports_exposes ?? ''} onInput={(event) => setRuntime((current) => ({ ...current, ports_exposes: event.currentTarget.value }))} />
                        </label>
                        <label class="grid gap-1 text-sm">
                            Commande de démarrage
                            <input class="input input-bordered input-sm" value={runtime.start_command ?? ''} onInput={(event) => setRuntime((current) => ({ ...current, start_command: event.currentTarget.value || null }))} />
                        </label>
                        <label class="grid gap-1 text-sm">
                            Répertoire publié
                            <input class="input input-bordered input-sm" value={runtime.publish_directory ?? ''} onInput={(event) => setRuntime((current) => ({ ...current, publish_directory: event.currentTarget.value }))} />
                        </label>
                    </div>
                    <div class="overflow-x-auto rounded-xl border border-base-300/70">
                        <table class="table table-sm">
                            <thead>
                                <tr>
                                    <th>Publier</th>
                                    <th>Variable</th>
                                    <th>Secret</th>
                                    <th>Obligatoire</th>
                                    <th>Valeur par défaut</th>
                                </tr>
                            </thead>
                            <tbody>
                                {envDrafts.length === 0 && (
                                    <tr>
                                        <td class="text-base-content/50" colSpan={5}>Aucune variable utilisateur à publier.</td>
                                    </tr>
                                )}
                                {envDrafts.map((item) => (
                                    <tr key={item.key}>
                                        <td>
                                            <input
                                                class="checkbox checkbox-sm"
                                                type="checkbox"
                                                checked={item.included}
                                                onChange={(event) => updateEnv(item.key, { included: event.currentTarget.checked })}
                                            />
                                        </td>
                                        <td class="font-mono text-xs">{item.key}</td>
                                        <td>
                                            <input
                                                class="checkbox checkbox-sm"
                                                type="checkbox"
                                                checked={item.is_secret}
                                                onChange={(event) => updateEnv(item.key, {
                                                    is_secret: event.currentTarget.checked,
                                                    required: event.currentTarget.checked ? true : item.required,
                                                    default: event.currentTarget.checked ? '' : item.default,
                                                })}
                                            />
                                        </td>
                                        <td>
                                            <input
                                                class="checkbox checkbox-sm"
                                                type="checkbox"
                                                checked={item.required}
                                                onChange={(event) => updateEnv(item.key, { required: event.currentTarget.checked })}
                                            />
                                        </td>
                                        <td>
                                            <input
                                                class="input input-bordered input-xs w-full"
                                                disabled={!item.included || item.is_secret}
                                                placeholder={item.is_secret ? 'Saisi à l’installation' : 'Optionnel'}
                                                value={item.is_secret ? '' : item.default}
                                                onInput={(event) => updateEnv(item.key, { default: event.currentTarget.value })}
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </Modal>
    );
}
