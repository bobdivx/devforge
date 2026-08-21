import { useId } from 'preact/hooks';
import type { CSSProperties } from 'preact';
import {
    BOT_SIZE_PX,
    botHasTuft,
    resolveBotColor,
    resolveBotShape,
    type BotMood,
    type BotShape,
    type BotSize,
} from '../../lib/bot-character';

type Props = {
    name: string;
    color?: string | null;
    shape?: string | null;
    type?: string | null;
    size?: BotSize;
    mood?: BotMood;
    tuft?: boolean;
    animate?: boolean;
    delay?: string;
    class?: string;
    decorative?: boolean;
};

function Body({ shape, fill }: { shape: BotShape; fill: string }) {
    switch (shape) {
        case 'squircle':
            return <rect x="14" y="20" width="52" height="52" rx="16" fill={fill} />;
        case 'oval':
            return <ellipse cx="40" cy="46" rx="28" ry="22" fill={fill} />;
        case 'rectangle':
            return <rect x="10" y="26" width="60" height="40" rx="12" fill={fill} />;
        case 'pill':
            return <rect x="8" y="32" width="64" height="28" rx="14" fill={fill} />;
        case 'triangle':
            return <path d="M40 16 C42 16 64 62 64 64 C64 68 58 70 40 70 C22 70 16 68 16 64 C16 62 38 16 40 16Z" fill={fill} />;
        case 'hexagon':
            return <path d="M40 16 L64 30 V54 L40 68 L16 54 V30 Z" fill={fill} />;
        case 'cloud':
            return (
                <path
                    d="M24 58c-8 0-12-6-12-12 0-6 4-11 10-12 2-8 10-14 18-14 9 0 16 6 18 14 7 0 12 6 12 12 0 7-6 12-14 12H24Z"
                    fill={fill}
                />
            );
        case 'teardrop':
            return (
                <path
                    d="M40 14C40 14 66 40 66 54c0 14-12 20-26 20S14 68 14 54C14 40 40 14 40 14Z"
                    fill={fill}
                />
            );
        default:
            return <circle cx="40" cy="46" r="26" fill={fill} />;
    }
}

export function BotCharacter({
    name,
    color,
    shape,
    type,
    size = 'md',
    mood = 'idle',
    tuft,
    animate = true,
    delay = '0s',
    class: className = '',
    decorative = false,
}: Props) {
    const reactId = useId().replace(/:/g, '');
    const clipId = `bot-body-${reactId}`;
    const resolvedShape = resolveBotShape(shape, type);
    const fill = resolveBotColor(color);
    const px = BOT_SIZE_PX[size];
    const showTuft = tuft ?? (size !== 'xs' && size !== 'sm' && botHasTuft(name));
    const tilt = mood === 'sleep' ? '-8deg' : size === 'hero' || size === 'xl' ? '-6deg' : '-3deg';

    return (
        <span
            class={`bot-character bot-character--${mood} ${animate ? 'bot-character--live' : ''} ${className}`.trim()}
            style={{
                width: `${px}px`,
                height: `${px}px`,
                '--bot-delay': delay,
                '--bot-tilt': tilt,
            } as CSSProperties}
            aria-hidden={decorative ? true : undefined}
            aria-label={decorative ? undefined : `Avatar de ${name}`}
            data-shape={resolvedShape}
            data-mood={mood}
            role={decorative ? undefined : 'img'}
        >
            <svg viewBox="0 0 80 80" class="bot-character__svg" aria-hidden="true">
                <defs>
                    <clipPath id={clipId}>
                        <Body shape={resolvedShape} fill="#fff" />
                    </clipPath>
                </defs>
                <g class="bot-character__body">
                    <Body shape={resolvedShape} fill={fill} />
                    <g class="bot-character__face" clip-path={`url(#${clipId})`}>
                        <g class="bot-character__eyes">
                            <rect x="29.5" y="49" width="5.2" height="13" rx="2.6" transform="rotate(-16 32.1 55.5)" fill="#111" />
                            <rect x="45.3" y="49" width="5.2" height="13" rx="2.6" transform="rotate(16 47.9 55.5)" fill="#111" />
                        </g>
                    </g>
                </g>
                {showTuft && (
                    <g class="bot-character__tuft" aria-hidden="true">
                        <path d="M18 22c8-14 22-16 28-8" fill="none" stroke="#4ade80" stroke-width="5" stroke-linecap="round" />
                        <path d="M20 20c7-12 20-14 26-7" fill="none" stroke="#facc15" stroke-width="3.4" stroke-linecap="round" />
                        <path d="M22 19c6-10 17-12 23-6" fill="none" stroke="#fb7185" stroke-width="2.2" stroke-linecap="round" />
                    </g>
                )}
            </svg>
        </span>
    );
}
