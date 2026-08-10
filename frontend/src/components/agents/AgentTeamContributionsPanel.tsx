import type { AgentTeamReport } from '../../lib/domain-api';

type Props = {
    report: AgentTeamReport | null | undefined;
};

export function AgentTeamContributionsPanel({ report }: Props) {
    if (!report || (report.leaf_count ?? 0) === 0) {
        return null;
    }

    return (
        <div class="rounded-lg border border-base-300 bg-base-200/40 p-3">
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p class="text-[11px] font-semibold uppercase tracking-wide text-base-content/50">
                    Contributions
                </p>
                <p class="text-[11px] text-base-content/50">
                    {report.succeeded}/{report.leaf_count} OK
                    {report.failed > 0 ? ` · ${report.failed} échec(s)` : ''}
                </p>
            </div>

            {report.roles.length > 0 && (
                <p class="mb-3 text-xs text-base-content/60">
                    Rôles : {report.roles.join(', ')}
                </p>
            )}

            <ul class="space-y-3">
                {report.contributions.map((item, index) => {
                    const label = item.role_slug ?? item.leaf_profile ?? `leaf #${index + 1}`;
                    return (
                        <li key={item.run_uuid ?? `${label}-${index}`} class="text-xs">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="font-medium text-base-content">{label}</span>
                                <span class="text-base-content/50">{item.status}</span>
                                {item.model_label && (
                                    <span class="text-base-content/40">
                                        {item.model_label}
                                        {item.tier ? ` / ${item.tier}` : ''}
                                    </span>
                                )}
                            </div>
                            {item.contribution && (
                                <p class="mt-1 text-base-content/70">{item.contribution}</p>
                            )}
                            {item.tools_used.length > 0 && (
                                <p class="mt-1 text-base-content/45">
                                    Outils : {item.tools_used.join(', ')}
                                </p>
                            )}
                            {item.risks.length > 0 && (
                                <p class="mt-1 text-warning/80">
                                    Risques : {item.risks.join('; ')}
                                </p>
                            )}
                        </li>
                    );
                })}
            </ul>

            {report.risks.length > 0 && (
                <div class="mt-3 border-t border-base-300/80 pt-2">
                    <p class="text-[11px] font-semibold uppercase tracking-wide text-base-content/50">
                        Risques agrégés
                    </p>
                    <ul class="mt-1 list-inside list-disc text-xs text-warning/80">
                        {report.risks.map((risk) => (
                            <li key={risk}>{risk}</li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
