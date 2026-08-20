type SkeletonProps = {
    lines?: number;
    class?: string;
};

export function Skeleton({ lines = 3, class: className = '' }: SkeletonProps) {
    return (
        <div class={`grid gap-2 ${className}`} aria-hidden>
            {Array.from({ length: lines }).map((_, index) => (
                <div
                    class="skeleton h-3 rounded-sm"
                    style={{ width: `${Math.max(40, 100 - index * 12)}%` }}
                    key={index}
                />
            ))}
        </div>
    );
}

export function SkeletonCard() {
    return (
        <div class="devforge-card p-5" aria-hidden>
            <div class="skeleton mb-3 h-3 w-24 rounded-sm" />
            <div class="skeleton h-7 w-16 rounded-sm" />
        </div>
    );
}
