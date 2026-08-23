import { PageHeader } from '../../components/PageHeader';
import { TerminalConsole } from '../../components/terminal/TerminalConsole';

type TerminalPageProps = {
    legacyBaseUrl?: string;
    canAccess: boolean;
};

export function TerminalPage({ canAccess }: TerminalPageProps) {
    return (
        <div class="grid gap-3 sm:gap-4 md:gap-5">
            <PageHeader
                title="Terminal"
                description="Connexion SSH interactive aux serveurs de l’équipe active."
            />
            <TerminalConsole canAccess={canAccess} />
        </div>
    );
}
