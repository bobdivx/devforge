type SparklineProps = {
    values: number[];
    width?: number;
    height?: number;
    stroke?: string;
};

export function Sparkline({ values, width = 120, height = 32, stroke = 'currentColor' }: SparklineProps) {
    if (values.length === 0) {
        return null;
    }

    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = Math.max(max - min, 1);
    const points = values.map((value, index) => {
        const x = (index / Math.max(values.length - 1, 1)) * width;
        const y = height - ((value - min) / range) * height;
        return `${x},${y}`;
    }).join(' ');

    return (
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} class="text-primary" aria-hidden>
            <polyline fill="none" stroke={stroke} stroke-width="2" points={points} />
        </svg>
    );
}
