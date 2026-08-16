import type { BootstrapData } from '../src/lib/bootstrap';

export const overviewFixture = {
    counts: { projects: 1, environments: 1, shared_variables: 0, private_keys: 0, members: 1 },
    recent_projects: [],
    health: { score: 100, total_resources: 0, running: 0, degraded: 0, stopped: 0 },
    resource_statuses: { applications: [], services: [], databases: [], servers: [] },
    recent_deployments: [],
    agent_activity: [],
    agents_summary: null,
};

export const bootstrapData: BootstrapData = {
    user: {
        id: 1,
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        email_verified: true,
        force_password_reset: false,
        two_factor_enabled: true,
    },
    current_team: {
        id: 10,
        name: 'Équipe Alpha',
        personal_team: false,
        role: 'owner',
        is_current: true,
    },
    teams: [
        {
            id: 10,
            name: 'Équipe Alpha',
            personal_team: false,
            role: 'owner',
            is_current: true,
        },
        {
            id: 20,
            name: 'Équipe Beta',
            personal_team: false,
            role: 'member',
            is_current: false,
        },
    ],
    permissions: {
        role: 'owner',
        create_resources: true,
        manage_team: true,
        manage_members: true,
        access_terminal: true,
        instance_admin: false,
    },
    realtime: {
        enabled: true,
        key: 'coolify',
        host: 'localhost',
        port: 6001,
        scheme: 'ws',
        auth_endpoint: '/broadcasting/auth',
        channels: {
            team: 'team.10',
            user: 'user.1',
        },
    },
    onboarding: {
        required: false,
        user_enabled: true,
        team_enabled: true,
        steps: {
            account: true,
            domain: false,
            github: false,
            s3: false,
            server: false,
        },
    },
    cloud: {
        enabled: false,
        subscription_active: false,
        subscription_grace_period: false,
    },
    migration: {
        enabled: true,
        legacy_base_url: 'http://localhost',
        domains: {
            applications: true,
            projects: true,
        },
    },
    features: {
        agents_enabled: false,
    },
};
