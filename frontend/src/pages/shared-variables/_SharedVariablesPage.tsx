import { PageHeader } from '../../components/PageHeader';
import { SharedVariablesPanel } from '../../components/shared-variables/SharedVariablesPanel';
import type { BootstrapPermissions } from '../../lib/bootstrap';

type SharedVariablesPageProps = {
    path: string;
    permissions: BootstrapPermissions;
};

export function SharedVariablesPage({ path, permissions }: SharedVariablesPageProps) {
    return (
        <div class="grid gap-5">
            <PageHeader
                title="Variables partagées"
                description="Variables d’équipe, de projet, d’environnement et de serveur."
            />
            <SharedVariablesPanel path={path} canManage={permissions.manage_team} />
        </div>
    );
}