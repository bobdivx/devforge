type GithubAppMissingRightsHelpProps = {
    app?: {
        permissions_url?: string | null;
        installation_settings_url?: string | null;
        name?: string;
    } | null;
};

export function GithubAppMissingRightsHelp({ app = null }: GithubAppMissingRightsHelpProps) {
    const permissionsUrl = app?.permissions_url ?? null;
    const installationSettingsUrl = app?.installation_settings_url ?? null;

    return (
        <div class="grid gap-1.5 text-xs">
            <p class="font-medium">Comment accorder les droits</p>
            <ol class="list-decimal space-y-1 ps-4">
                <li>
                    {permissionsUrl ? (
                        <a
                            class="link link-primary"
                            href={permissionsUrl}
                            target="_blank"
                            rel="noreferrer"
                        >
                            Ouvrir les permissions de l’app GitHub
                        </a>
                    ) : (
                        'Ouvrir GitHub → Settings → Developer settings → GitHub Apps → Permissions.'
                    )}
                </li>
                <li>
                    Passer Administration, Contents, Actions et Workflows sur Read and write, puis enregistrer.
                </li>
                <li>
                    {installationSettingsUrl ? (
                        <a
                            class="link link-primary"
                            href={installationSettingsUrl}
                            target="_blank"
                            rel="noreferrer"
                        >
                            Accepter les nouvelles permissions
                        </a>
                    ) : (
                        'Accepter les nouvelles permissions sur l’installation GitHub (Settings → Applications).'
                    )}
                </li>
            </ol>
        </div>
    );
}
