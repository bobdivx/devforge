import { Container, Section } from '../ui';

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
        <div class="mx-auto max-w-2xl text-center">
          <h2 class="text-3xl font-semibold tracking-tight md:text-4xl">Tout pour shipper</h2>
          <p class="mt-3 text-[var(--color-ink-muted)]">Clair, modulaire, sans surcharge.</p>
        </div>
        <div class="mt-14 grid gap-px overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} class="bg-[var(--color-bg-elevated)] p-8">
              <h3 class="text-base font-medium tracking-tight">{f.title}</h3>
              <p class="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">{f.body}</p>
            </div>
          ))}
        </div>
      </Container>
    </Section>
  );
}
