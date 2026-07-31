import { Bug, Bot, GitBranch, Layers, Rocket, ShieldCheck, CirclePlay, type LucideIcon } from 'lucide-preact';
import type { AgentType } from '../../lib/domain-api';

const typeIcons: Record<AgentType, LucideIcon> = {
    debug: Bug,
    'tech-watch': Layers,
    github: GitBranch,
    'github-actions': CirclePlay,
    devforge: Bot,
    deployment: Rocket,
    security: ShieldCheck,
};

type Props = {
    type: AgentType;
    color: string;
    size?: 'sm' | 'md' | 'lg';
    name: string;
};

const sizeClasses = {
    sm: 'size-8 text-xs',
    md: 'size-10 text-sm',
    lg: 'size-14 text-base',
};

const iconSizes = { sm: 'size-3.5', md: 'size-4', lg: 'size-6' };

export function AgentAvatar({ type, color, size = 'md', name }: Props) {
    const Icon = typeIcons[type] ?? Bot;
    const sizeClass = sizeClasses[size];
    const iconClass = iconSizes[size];

    return (
        <div
            class={`grid shrink-0 place-items-center rounded-xl ${sizeClass} font-bold text-white`}
            style={{ backgroundColor: color }}
            aria-label={`Avatar de ${name}`}
        >
            <Icon class={iconClass} aria-hidden />
        </div>
    );
}
