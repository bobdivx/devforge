import { Plus, Trash2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import type { AgentSkill } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { ApiError } from '../../lib/api-client';

/** Skills équipe (sans agent_uuid) — catalogue partagé. */
export function TeamSkillsPanel() {
    const [rows, setRows] = useState<AgentSkill[]>([]);
    const [slug, setSlug] = useState('');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [body, setBody] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const refresh = () => {
        domainApi.agentSkills()
            .then((r) => setRows(r.data))
            .catch(() => setRows([]));
    };

    useEffect(() => {
        refresh();
    }, []);

    const handleCreate = async () => {
        if (!slug.trim() || !name.trim() || !description.trim() || !body.trim()) {
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await domainApi.createAgentSkill({
                slug: slug.trim(),
                name: name.trim(),
                description: description.trim(),
                body: body.trim(),
            });
            setSlug('');
            setName('');
            setDescription('');
            setBody('');
            refresh();
        } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Erreur skill');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number, isBuiltin: boolean) => {
        if (isBuiltin) {
            return;
        }
        await domainApi.deleteAgentSkill(id).catch(() => {});
        refresh();
    };

    return (
        <div class="grid gap-3">
            <p class="text-xs text-base-content/55">
                Procédures équipe (catalogue prompt + corps via skill_load). Les builtins Coolify sont inclus automatiquement.
            </p>
            {error && <p class="text-xs text-error">{error}</p>}
            <ul class="grid gap-2">
                {rows.map((row) => (
                    <li key={row.id} class="rounded-xl border border-base-300 bg-base-100 px-3 py-2.5">
                        <div class="flex items-start justify-between gap-2">
                            <div class="min-w-0">
                                <p class="truncate text-sm font-medium">
                                    <code class="text-[11px] text-base-content/70">{row.slug}</code>
                                    {' · '}
                                    {row.name}
                                    {row.is_builtin && (
                                        <span class="ms-1 text-[10px] uppercase tracking-wide text-base-content/45">builtin</span>
                                    )}
                                </p>
                                <p class="mt-0.5 line-clamp-2 text-[11px] text-base-content/65">{row.description}</p>
                            </div>
                            {!row.is_builtin && (
                                <button
                                    class="btn btn-ghost btn-xs text-error"
                                    type="button"
                                    onClick={() => void handleDelete(row.id, row.is_builtin)}
                                    aria-label="Supprimer"
                                >
                                    <Trash2 class="size-3.5" aria-hidden />
                                </button>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
            <div class="grid gap-2 rounded-xl border border-dashed border-base-300 p-3">
                <p class="text-xs font-semibold">Ajouter un skill équipe</p>
                <input class="input input-bordered input-sm" placeholder="slug" value={slug} onInput={(e) => setSlug((e.target as HTMLInputElement).value)} />
                <input class="input input-bordered input-sm" placeholder="Nom" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
                <input class="input input-bordered input-sm" placeholder="Description" value={description} onInput={(e) => setDescription((e.target as HTMLInputElement).value)} />
                <textarea class="textarea textarea-bordered textarea-sm" rows={3} placeholder="Corps markdown" value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} />
                <button class="btn btn-outline btn-sm w-fit gap-1" type="button" disabled={saving} onClick={() => void handleCreate()}>
                    <Plus class="size-3.5" aria-hidden />
                    Ajouter
                </button>
            </div>
        </div>
    );
}
