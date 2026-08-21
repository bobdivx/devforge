import type { Agent } from '../../lib/domain-api';
import { BotStudio } from './BotStudio';

type Props = {
    open: boolean;
    onClose: () => void;
    onCreated: (agent?: Agent) => void;
    parentAgent?: Agent | null;
    userName?: string;
};

export function CreateAgentModal({ open, onClose, onCreated, parentAgent = null, userName }: Props) {
    return (
        <BotStudio
            open={open}
            variant="overlay"
            parentAgent={parentAgent}
            userName={userName}
            onClose={onClose}
            onCreated={onCreated}
        />
    );
}
