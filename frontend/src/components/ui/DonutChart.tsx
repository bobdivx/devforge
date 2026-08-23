type DonutSegment = {
    label: string;
    value: number;
    color: string;
};

type DonutChartProps = {
    segments: DonutSegment[];
    size?: number;
    centerLabel?: string;
};

export function DonutChart({ segments, size = 120, centerLabel }: DonutChartProps) {
    const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1;
    const radius = 16;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;

    return (
        <div class="relative inline-grid place-items-center" style={{ width: size, height: size }}>
            <svg viewBox="0 0 36 36" class="size-full -rotate-90" aria-hidden>
                <circle cx="18" cy="18" r={radius} fill="none" stroke="currentColor" class="text-base-300" stroke-width="4" />
                {segments.map((segment) => {
                    const length = (segment.value / total) * circumference;
                    const circle = (
                        <circle
                            cx="18"
                            cy="18"
                            r={radius}
                            fill="none"
                            stroke={segment.color}
                            stroke-width="4"
                            stroke-dasharray={`${length} ${circumference - length}`}
                            stroke-dashoffset={-offset}
                            key={segment.label}
                        />
                    );
                    offset += length;
                    return circle;
                })}
            </svg>
            {centerLabel && (
                <span class="absolute text-xs sm:text-sm font-semibold tabular-nums">{centerLabel}</span>
            )}
        </div>
    );
}
