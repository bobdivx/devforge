import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

export type TeamContextValue = {
    teamId: number;
    revision: number;
    agentsEnabled: boolean;
};

export const TeamContext = createContext<TeamContextValue>({
    teamId: 0,
    revision: 0,
    agentsEnabled: false,
});

export function useTeamContext(): TeamContextValue {
    return useContext(TeamContext);
}
