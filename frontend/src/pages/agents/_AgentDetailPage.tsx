import { useNavigate } from '../../lib/use-navigate';
import { useApiQuery } from '../../lib/use-api-query';
import { domainApi } from '../../lib/domain-api';
import { DataState } from '../../components/ui/DataState';
import { AgentChatView } from '../../components/agents/AgentChatView';

type Props = {
    path: string;
    userName?: string;
};

function extractUuid(path: string): string {
    const parts = path.split('/').filter(Boolean);
    return parts[1] ?? '';
}

export function AgentDetailPage({ path, userName }: Props) {
    const onNavigate = useNavigate();
    const agentUuid = extractUuid(path);
    const agentQuery = useApiQuery(`agent-${agentUuid}`, () => domainApi.agent(agentUuid));
    const agent = agentQuery.data?.data;

    if (!agentUuid) {
        return <p class="text-sm text-error">UUID d'agent invalide.</p>;
    }

    return (
        <div class="flex h-full min-h-0 min-w-0 flex-col">
            <DataState loading={agentQuery.loading} error={agentQuery.error} onRetry={() => void agentQuery.reload()}>
                {agent && (
                    <AgentChatView
                        agent={agent}
                        userName={userName}
                        onBack={(e) => onNavigate(e, '/agents')}
                        onAgentUpdated={() => void agentQuery.reload({ silent: true })}
                    />
                )}
            </DataState>
        </div>
    );
}
