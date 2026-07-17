import { useEffect, useState } from 'preact/hooks';
import { resolveApplicationLogoUrl } from '../../lib/application-logo';

type ApplicationLogoProps = {
    name: string;
    configuration?: Record<string, unknown> | null;
    class?: string;
};

export function ApplicationLogo({ name, configuration, class: className = '' }: ApplicationLogoProps) {
    const resolvedUrl = resolveApplicationLogoUrl(configuration);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        setFailed(false);
    }, [resolvedUrl]);

    if (!resolvedUrl || failed) {
        return null;
    }

    return (
        <img
            src={resolvedUrl}
            alt=""
            width={32}
            height={32}
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            class={`size-8 shrink-0 rounded-lg bg-base-200 object-contain p-0.5 ${className}`.trim()}
            onError={() => setFailed(true)}
            title={name}
        />
    );
}
