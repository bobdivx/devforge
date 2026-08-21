import { BOT_SIZE_PX, botMoodFromStatus, type BotMood, type BotSize } from '../../lib/bot-character';
import { BotCharacter } from './BotCharacter';

type Props = {
    type: string;
    color: string;
    shape?: string | null;
    size?: BotSize;
    name: string;
    mood?: BotMood;
    status?: string | null;
    animate?: boolean;
    delay?: string;
};

export function AgentAvatar({
    type,
    color,
    shape,
    size = 'md',
    name,
    mood,
    status,
    animate = true,
    delay,
}: Props) {
    const resolvedMood = mood ?? botMoodFromStatus(status);
    const px = BOT_SIZE_PX[size];

    return (
        <span class="inline-flex shrink-0 items-center justify-center" style={{ width: `${px}px`, height: `${px}px` }}>
            <BotCharacter
                name={name}
                color={color}
                shape={shape}
                type={type}
                size={size}
                mood={resolvedMood}
                animate={animate}
                delay={delay}
            />
        </span>
    );
}
