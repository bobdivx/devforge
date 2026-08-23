import { Copy, LoaderCircle, MoveRight } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DataState } from '../ui/DataState';
import { domainApi, type ApplicationResourceOperations } from '../../lib/domain-api';
import { applicationPath } from '../../lib/routes';
import { useApiQuery } from '../../lib/use-api-query';
import { navigateTo } from '../../lib/use-navigate';

type Props = {
    applicationUuid: string;
    canAct: boolean;
};

export function ApplicationResourceOperationsPanel({ applicationUuid, canAct }: Props) {
    const query = useApiQuery(
        `application-resource-operations:${applicationUuid}`,
        () => domainApi.applicationResourceOperations(applicationUuid),
    );
    const data = query.data?.data as ApplicationResourceOperations | undefined;

    const [destinationUuid, setDestinationUuid] = useState('');
    const [cloneVolumeData, setCloneVolumeData] = useState(false);
    const [environmentUuid, setEnvironmentUuid] = useState('');
    const [cloning, setCloning] = useState(false);
    const [moving, setMoving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        if (!data) {
            return;
        }

        setDestinationUuid(data.current_destination_uuid ?? data.destinations[0]?.uuid ?? '');
        setEnvironmentUuid(data.current_environment_uuid ?? data.environments[0]?.uuid ?? '');
        setError(null);
    }, [data]);

    const cloneApplication = async () => {
        if (!canAct || !destinationUuid) {
            return;
        }

        setCloning(true);
        setError(null);
        setMessage(null);

        try {
            const response = await domainApi.cloneApplication(applicationUuid, {
                destination_uuid: destinationUuid,
                clone_volume_data: cloneVolumeData,
            });
            setMessage(response.data.message ?? 'Application clonée.');
            navigateTo(applicationPath(response.data.uuid, 'settings'));
        } catch (cloneError) {
            setError(cloneError instanceof Error ? cloneError.message : 'Échec du clonage.');
        } finally {
            setCloning(false);
        }
    };

    const moveApplication = async () => {
        if (!canAct || !environmentUuid) {
            return;
        }

        setMoving(true);
        setError(null);
        setMessage(null);

        try {
            const response = await domainApi.moveApplication(applicationUuid, {
                environment_uuid: environmentUuid,
            });
            setMessage(response.data.message ?? 'Application déplacée.');
            navigateTo(applicationPath(response.data.uuid, 'settings'));
        } catch (moveError) {
            setError(moveError instanceof Error ? moveError.message : 'Échec du déplacement.');
        } finally {
            setMoving(false);
        }
    };

    return (
        <section class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
            <div class="toolbar-row border-b border-base-300/70 px-3 sm:px-3 sm:px-4 md:px-5 py-3 sm:py-3 sm:py-4">
                <div>
                    <div class="flex items-center gap-2">
                        <Copy class="size-3.5 sm:size-4 text-base-content/45" aria-hidden />
                        <p class="text-xs sm:text-sm font-semibold">Opérations sur la ressource</p>
                    </div>
                    <p class="text-xs text-base-content/50">
                        Cloner vers une destination ou déplacer vers un autre environnement
                    </p>
                </div>
                <ActionToolbar>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                        Actualiser
                    </button>
                </ActionToolbar>
            </div>

            <div class="grid gap-3 sm:gap-2.5 sm:gap-3 md:gap-4 md:gap-5 p-5">
                <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                    {data && (
                        <>
                            {message && (
                                <p class="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                                    {message}
                                </p>
                            )}
                            {error && (
                                <p class="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                                    {error}
                                </p>
                            )}

                            <div class="grid gap-2 sm:gap-3 rounded-xl border border-base-300/60 bg-base-200/20 p-4">
                                <p class="text-xs sm:text-sm font-semibold">Cloner</p>
                                <label class="grid gap-1.5 text-sm">
                                    <span class="font-medium">Destination</span>
                                    <select
                                        class="select select-bordered select-sm"
                                        disabled={!canAct || cloning}
                                        value={destinationUuid}
                                        onChange={(event) => setDestinationUuid((event.target as HTMLSelectElement).value)}
                                    >
                                        {data.destinations.map((destination) => (
                                            <option key={destination.uuid} value={destination.uuid}>
                                                {destination.name} · {destination.server.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label class="flex items-center gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        class="checkbox checkbox-sm"
                                        checked={cloneVolumeData}
                                        disabled={!canAct || cloning}
                                        onChange={(event) => setCloneVolumeData((event.target as HTMLInputElement).checked)}
                                    />
                                    Copier aussi les données des volumes
                                </label>
                                {canAct && (
                                    <button
                                        class="btn btn-primary btn-sm w-fit"
                                        type="button"
                                        disabled={cloning || !destinationUuid}
                                        onClick={() => void cloneApplication()}
                                    >
                                        {cloning
                                            ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                                            : <Copy class="size-3.5" aria-hidden />}
                                        Cloner
                                    </button>
                                )}
                            </div>

                            <div class="grid gap-2 sm:gap-3 rounded-xl border border-base-300/60 bg-base-200/20 p-4">
                                <p class="text-xs sm:text-sm font-semibold">Déplacer</p>
                                <label class="grid gap-1.5 text-sm">
                                    <span class="font-medium">Environnement cible</span>
                                    <select
                                        class="select select-bordered select-sm"
                                        disabled={!canAct || moving}
                                        value={environmentUuid}
                                        onChange={(event) => setEnvironmentUuid((event.target as HTMLSelectElement).value)}
                                    >
                                        {data.environments.map((environment) => (
                                            <option key={environment.uuid} value={environment.uuid}>
                                                {environment.project_name} / {environment.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                {canAct && (
                                    <button
                                        class="btn btn-outline btn-sm w-fit"
                                        type="button"
                                        disabled={
                                            moving
                                            || !environmentUuid
                                            || environmentUuid === data.current_environment_uuid
                                        }
                                        onClick={() => void moveApplication()}
                                    >
                                        {moving
                                            ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                                            : <MoveRight class="size-3.5" aria-hidden />}
                                        Déplacer
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                </DataState>
            </div>
        </section>
    );
}
