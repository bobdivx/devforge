import { Plus, RefreshCw, Save, Trash2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { TeamSwitcher } from '../TeamSwitcher';
import { ActionToolbar } from '../ui/ActionToolbar';
import { Card } from '../ui/Card';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';
import { InviteMemberModal } from './InviteMemberModal';
import type { BootstrapTeam } from '../../lib/bootstrap';
import { domainApi, type TeamInvitation, type TeamMember } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

const roleLabels: Record<string, string> = {
    member: 'Membre',
    admin: 'Admin',
    owner: 'Propriétaire',
};

type TeamSettingsPanelProps = {
    teams: BootstrapTeam[];
    currentTeam: BootstrapTeam;
    canManage: boolean;
    onSwitchTeam: (teamId: number) => Promise<void>;
};

function MemberRow({
    member,
    canManage,
    onRoleChange,
    onRemove,
}: {
    member: TeamMember;
    canManage: boolean;
    onRoleChange: (role: string) => Promise<void>;
    onRemove: () => Promise<void>;
}) {
    const [role, setRole] = useState(member.role);
    const [saving, setSaving] = useState(false);
    const [removeOpen, setRemoveOpen] = useState(false);

    return (
        <>
            <li class="flex flex-col gap-3 border-b border-base-300/50 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                <div class="min-w-0">
                    <p class="truncate text-sm font-medium">{member.name}</p>
                    <p class="truncate text-xs text-base-content/55">{member.email}</p>
                </div>
                <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    {canManage ? (
                        <select
                            class="select select-bordered select-xs min-w-[8.5rem]"
                            value={role}
                            disabled={saving}
                            onChange={async (event) => {
                                const nextRole = (event.currentTarget as HTMLSelectElement).value;
                                setSaving(true);
                                try {
                                    await onRoleChange(nextRole);
                                    setRole(nextRole);
                                } catch {
                                    setRole(member.role);
                                } finally {
                                    setSaving(false);
                                }
                            }}
                        >
                            {Object.entries(roleLabels).map(([value, label]) => (
                                <option value={value} key={value}>{label}</option>
                            ))}
                        </select>
                    ) : (
                        <StatusBadge label={roleLabels[member.role] ?? member.role} />
                    )}
                    {canManage && (
                        <button class="btn btn-ghost btn-xs text-error" type="button" onClick={() => setRemoveOpen(true)}>
                            <Trash2 class="size-3.5" aria-hidden />
                            Retirer
                        </button>
                    )}
                </div>
            </li>
            <ConfirmDialog
                open={removeOpen}
                title="Retirer ce membre ?"
                message={`Retirer ${member.name} de l’équipe active ?`}
                confirmLabel="Retirer"
                tone="danger"
                onCancel={() => setRemoveOpen(false)}
                onConfirm={async () => {
                    await onRemove();
                    setRemoveOpen(false);
                }}
            />
        </>
    );
}

function InvitationRow({
    invitation,
    onRevoke,
}: {
    invitation: TeamInvitation;
    onRevoke: () => Promise<void>;
}) {
    const [removeOpen, setRemoveOpen] = useState(false);

    return (
        <>
            <li class="flex flex-col gap-2 border-b border-base-300/50 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                <div class="min-w-0">
                    <p class="truncate text-sm">{invitation.email}</p>
                    <p class="text-xs text-base-content/55">
                        {roleLabels[invitation.role] ?? invitation.role}
                        {' · '}
                        {invitation.via === 'email' ? 'E-mail envoyé' : 'Lien généré'}
                    </p>
                </div>
                <button class="btn btn-ghost btn-xs text-error w-fit" type="button" onClick={() => setRemoveOpen(true)}>
                    Révoquer
                </button>
            </li>
            <ConfirmDialog
                open={removeOpen}
                title="Révoquer l’invitation ?"
                message={`L’invitation pour ${invitation.email} sera annulée.`}
                confirmLabel="Révoquer"
                tone="danger"
                onCancel={() => setRemoveOpen(false)}
                onConfirm={async () => {
                    await onRevoke();
                    setRemoveOpen(false);
                }}
            />
        </>
    );
}

export function TeamSettingsPanel({
    teams,
    currentTeam,
    canManage,
    onSwitchTeam,
}: TeamSettingsPanelProps) {
    const team = useApiQuery('current-team', () => domainApi.currentTeam());
    const members = useApiQuery('members', () => domainApi.members());
    const invitations = useApiQuery(
        canManage ? 'team-invitations' : null,
        () => domainApi.teamInvitations(),
    );
    const [inviteOpen, setInviteOpen] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [savingTeam, setSavingTeam] = useState(false);
    const [mutationError, setMutationError] = useState<string | null>(null);

    const teamData = team.data?.data;

    useEffect(() => {
        if (!teamData) {
            return;
        }

        setName(teamData.name);
        setDescription(teamData.description ?? '');
    }, [teamData?.id, teamData?.name, teamData?.description]);

    const dirtyTeam = teamData
        ? name !== teamData.name || description !== (teamData.description ?? '')
        : false;

    const reloadAll = async () => {
        setMutationError(null);
        await Promise.all([
            team.reload(),
            members.reload(),
            canManage ? invitations.reload?.() : Promise.resolve(),
        ]);
    };

    return (
        <div class="grid gap-4">
            <Card title="Équipe active">
                <TeamSwitcher
                    teams={teams}
                    currentTeam={currentTeam}
                    variant="settings"
                    onSwitch={onSwitchTeam}
                />
            </Card>

            {canManage && (
                <Card title="Informations de l’équipe">
                    <DataState loading={team.loading} error={team.error} onRetry={() => void team.reload()}>
                        {teamData && (
                            <form
                                class="grid gap-3"
                                onSubmit={async (event) => {
                                    event.preventDefault();
                                    if (!dirtyTeam) {
                                        return;
                                    }
                                    setSavingTeam(true);
                                    setMutationError(null);
                                    try {
                                        await domainApi.updateCurrentTeam({ name, description: description || null });
                                        await reloadAll();
                                    } catch {
                                        setMutationError('La mise à jour de l’équipe a échoué.');
                                    } finally {
                                        setSavingTeam(false);
                                    }
                                }}
                            >
                                <label class="form-control w-full">
                                    <span class="label-text text-xs font-medium">Nom</span>
                                    <input
                                        class="input input-bordered input-sm w-full"
                                        type="text"
                                        value={name}
                                        onInput={(event) => setName((event.currentTarget as HTMLInputElement).value)}
                                    />
                                </label>
                                <label class="form-control w-full">
                                    <span class="label-text text-xs font-medium">Description</span>
                                    <textarea
                                        class="textarea textarea-bordered textarea-sm w-full min-h-20"
                                        value={description}
                                        onInput={(event) => setDescription((event.currentTarget as HTMLTextAreaElement).value)}
                                    />
                                </label>
                                <button class="btn btn-primary btn-sm w-fit" type="submit" disabled={!dirtyTeam || savingTeam}>
                                    <Save class="size-3.5" aria-hidden />
                                    {savingTeam ? 'Enregistrement…' : 'Enregistrer'}
                                </button>
                            </form>
                        )}
                    </DataState>
                </Card>
            )}

            {mutationError && <div class="alert alert-error min-h-8 py-1 text-xs" role="alert">{mutationError}</div>}

            <Card title="Membres">
                <div class="toolbar-row mb-3">
                    {canManage && (
                        <button class="btn btn-primary btn-sm w-fit" type="button" onClick={() => setInviteOpen(true)}>
                            <Plus class="size-3.5" aria-hidden />
                            Inviter
                        </button>
                    )}
                    <ActionToolbar class="sm:ms-auto">
                        <button class="btn btn-ghost btn-sm" type="button" onClick={() => void reloadAll()}>
                            <RefreshCw class="size-3.5" aria-hidden />
                            Actualiser
                        </button>
                    </ActionToolbar>
                </div>
                <DataState
                    loading={members.loading}
                    error={members.error}
                    empty={(members.data?.data.length ?? 0) === 0}
                    emptyMessage="Aucun membre dans cette équipe."
                    onRetry={() => void members.reload()}
                >
                    <ul>
                        {(members.data?.data ?? []).map((member) => (
                            <MemberRow
                                key={member.id}
                                member={member}
                                canManage={canManage}
                                onRoleChange={async (role) => {
                                    await domainApi.updateTeamMember(member.id, role);
                                    await members.reload();
                                }}
                                onRemove={async () => {
                                    await domainApi.removeTeamMember(member.id);
                                    await reloadAll();
                                }}
                            />
                        ))}
                    </ul>
                </DataState>
            </Card>

            {canManage && (
                <Card title="Invitations en attente">
                    <DataState
                        loading={invitations.loading}
                        error={invitations.error}
                        empty={(invitations.data?.data.length ?? 0) === 0}
                        emptyMessage="Aucune invitation en cours."
                        onRetry={() => void invitations.reload?.()}
                    >
                        <ul>
                            {(invitations.data?.data ?? []).map((invitation) => (
                                <InvitationRow
                                    key={invitation.id}
                                    invitation={invitation}
                                    onRevoke={async () => {
                                        await domainApi.revokeTeamInvitation(invitation.id);
                                        await invitations.reload?.();
                                    }}
                                />
                            ))}
                        </ul>
                    </DataState>
                </Card>
            )}

            {canManage && (
                <InviteMemberModal
                    open={inviteOpen}
                    onClose={() => setInviteOpen(false)}
                    onSubmit={async (input) => {
                        const response = await domainApi.createTeamInvitation(input);
                        await invitations.reload?.();
                        return { link: response.data.link };
                    }}
                />
            )}
        </div>
    );
}
