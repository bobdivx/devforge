export const BOT_SHAPES = [
    'circle',
    'squircle',
    'oval',
    'rectangle',
    'pill',
    'triangle',
    'hexagon',
    'cloud',
    'teardrop',
] as const;

export type BotShape = (typeof BOT_SHAPES)[number];

export type BotMood = 'idle' | 'working' | 'sleep' | 'sad';

export type BotSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'hero';

export const BOT_AVATAR_COLORS = [
    '#8b5a2b',
    '#ef4444',
    '#f97316',
    '#f59e0b',
    '#22c55e',
    '#14b8a6',
    '#3b82f6',
    '#8b5cf6',
    '#ec4899',
    '#6b7280',
] as const;

const DEFAULT_SHAPES: Record<string, BotShape> = {
    deployment: 'circle',
    debug: 'squircle',
    'tech-watch': 'hexagon',
    github: 'oval',
    'github-actions': 'triangle',
    devforge: 'cloud',
    security: 'teardrop',
};

export function isBotShape(value: string | null | undefined): value is BotShape {
    return typeof value === 'string' && (BOT_SHAPES as readonly string[]).includes(value);
}

export function resolveBotShape(shape: string | null | undefined, type?: string | null): BotShape {
    if (isBotShape(shape)) {
        return shape;
    }

    if (type && DEFAULT_SHAPES[type]) {
        return DEFAULT_SHAPES[type];
    }

    return 'circle';
}

export function resolveBotColor(color: string | null | undefined): string {
    if (typeof color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(color.trim())) {
        return color.trim();
    }

    return BOT_AVATAR_COLORS[6];
}

export function botHasTuft(name: string): boolean {
    if (name.trim() === '') {
        return true;
    }

    const sum = [...name].reduce((total, char) => total + char.charCodeAt(0), 0);

    return sum % 3 !== 0;
}

export function botMoodFromStatus(status: string | null | undefined): BotMood {
    if (status === 'running') {
        return 'working';
    }

    if (status === 'paused') {
        return 'sleep';
    }

    if (status === 'error') {
        return 'sad';
    }

    return 'idle';
}

export const BOT_SIZE_PX: Record<BotSize, number> = {
    xs: 24,
    sm: 32,
    md: 40,
    lg: 56,
    xl: 88,
    hero: 168,
};
