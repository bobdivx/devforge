import type { Agent } from '../../lib/domain-api';
import { BotStudio } from './BotStudio';

type Props = {
    open: boolean;
    onClose: () => void;
    onCreated: (agent?: Agent) => void;
    parentAgent?: Agent | null;
    resourceUuid?: string | null;
    userName?: string;
};

export function CreateAgentModal({ open, onClose, onCreated, parentAgent = null, resourceUuid = null, userName }: Props) {
    return (
        <BotStudio
            open={open}
            variant="overlay"
            parentAgent={parentAgent}
            resourceUuid={resourceUuid}
            userName={userName}
            onClose={onClose}
            onCreated={onCreated}
        />
    );
}
