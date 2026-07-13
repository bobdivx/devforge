export type BootstrapUser = {
    id: number;
    name: string;
    email: string;
    email_verified: boolean;
    force_password_reset: boolean;
    two_factor_enabled: boolean;
};

export type BootstrapTeam = {
    id: number;
    name: string;
    personal_team: boolean;
    role: string;
    is_current: boolean;
};

export type BootstrapPermissions = {
    role: string;
    create_resources: boolean;
    manage_team: boolean;
    manage_members: boolean;
    access_terminal: boolean;
    instance_admin: boolean;
};

export type BootstrapData = {
    user: BootstrapUser;
    current_team: BootstrapTeam;
    teams: BootstrapTeam[];
    permissions: BootstrapPermissions;
    realtime: {
        enabled: boolean;
        key: string;
        host: string;
        port: number | string;
        scheme: 'ws' | 'wss';
        auth_endpoint: string;
        channels: {
            team: string;
            user: string;
        };
    };
    onboarding: {
        required: boolean;
        user_enabled: boolean;
        team_enabled: boolean;
    };
    cloud: {
        enabled: boolean;
        subscription_active: boolean;
        subscription_grace_period: boolean;
    };
    migration: {
        enabled: boolean;
        legacy_base_url: string;
        domains: Record<string, boolean>;
    };
    features?: {
        agents_enabled: boolean;
    };
};

export type BootstrapResponse = {
    data: BootstrapData;
};
