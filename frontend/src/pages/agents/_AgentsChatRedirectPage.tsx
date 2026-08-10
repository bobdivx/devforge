import { useEffect } from 'preact/hooks';
import { Bot, MessageSquare } from 'lucide-preact';
import { DataState } from '../../components/ui/DataState';
import { PageHeader } from '../../components/PageHeader';
import { domainApi } from '../../lib/domain-api';
import { resolvePrimaryAgentChatPath } from '../../lib/agent-routes';
import { normalizeRoutePath, routeHref } from '../../lib/routes';
import { useApiQuery } from '../../lib/use-api-query';
import { useNavigate } from '../../lib/use-navigate';
import { useTeamContext } from '../../lib/team-context';

/**
 * /agents/chat — redirige vers l’agent principal / dernier / premier.
 */
export function AgentsChatRedirectPage() {
    const onNavigate = useNavigate();
    const { agentsEnabled } = useTeamContext();
    const query = useApiQuery(agentsEnabled ? 'agents-chat-redirect' : null, () => domainApi.agents());
    const agents = query.data?.data ?? [];

    useEffect(() => {
        if (!agentsEnabled || query.loading || query.error || !query.data) {
            return;
        }

        const list = query.data.data;
        const target = resolvePrimaryAgentChatPath(list) ?? '/agents';
        const current = normalizeRoutePath(window.location.pathname);
        const next = normalizeRoutePath(target);
        if (current === next) {
            return;
        }

        window.history.replaceState({}, '', routeHref(target));
        window.dispatchEvent(new PopStateEvent('popstate'));
    }, [agentsEnabled, query.loading, query.error, query.data]);

    if (!agentsEnabled) {
        return (
            <PageHeader title="Chat" description="Agents désactivés sur cette instance." eyebrow="Indisponible" />
        );
    }

    return (
        <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
            {agents.length === 0 && !query.loading ? (
                <div class="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-base-300 p-12 text-center">
                    <div class="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                        <MessageSquare class="size-7" aria-hidden />
                    </div>
                    <div>
                        <h3 class="text-sm font-semibold">Aucun agent pour chatter</h3>
                        <p class="mt-1 max-w-sm text-xs text-base-content/60">
                            Créez un agent dans Équipe, puis revenez ici pour ouvrir le chat en un clic.
                        </p>
                    </div>
                    <a class="btn btn-primary btn-sm gap-1.5" href={routeHref('/agents')} onClick={(e) => onNavigate(e, '/agents')}>
                        <Bot class="size-3.5" aria-hidden />
                        Voir l&apos;équipe
                    </a>
                </div>
            ) : (
                <p class="text-sm text-base-content/60" role="status">Ouverture du chat…</p>
            )}
        </DataState>
    );
}
