import { ResourceStatusIcon } from './ResourceStatusIcon';

type StatusDotProps = {
    status: string | {
        reachable: boolean;
        usable: boolean;
        validating: boolean;
    };
};

export function StatusDot({ status }: StatusDotProps) {
    return <ResourceStatusIcon status={status} showLabel size="md" />;
}
