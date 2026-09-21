import { Container, Reveal, Section } from '../ui';

const FEATURES = [
  {
    title: 'Projects',
    body: 'Repo, deploys, domaines et variables au même endroit.',
  },
  {
    title: 'Agents',
    body: 'Chaque app a ses agents. Ils testent, déploient, review.',
  },
  {
    title: 'Infra',
    body: 'Proxy, certificats, VPN et stockage sans friction.',
  },
  {
    title: 'GitHub',
    body: 'PRs, Actions et versions branchés sur ton workflow.',
  },
];

export function FeatureBento() {
  return (
    <Section id="features">
      <Container>
        <Reveal class="mx-auto max-w-2xl text-center">
          <h2 class="text-3xl font-semibold tracking-tight md:text-4xl">Tout pour shipper</h2>
          <p class="mt-3 text-[var(--color-ink-muted)]">Clair, modulaire, sans surcharge.</p>
        </Reveal>
        <div class="mt-14 grid gap-px overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2">
          {FEATURES.map((f, i) => (
            <Reveal
              key={f.title}
              delay={i * 80}
              class="group bg-[var(--color-bg-elevated)] p-8 transition-colors duration-200 hover:bg-[var(--color-surface)]"
            >
              <h3 class="text-base font-medium tracking-tight transition-colors duration-200 group-hover:text-[var(--color-accent)]">
                {f.title}
              </h3>
              <p class="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">{f.body}</p>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
