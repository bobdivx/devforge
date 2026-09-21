import { ChartCanvas, Container, Reveal, Section } from '../ui';

export function MetricsStrip() {
  return (
    <Section id="metrics" class="pt-0">
      <Container>
        <Reveal class="mb-10 max-w-xl">
          <h2 class="text-3xl font-semibold tracking-tight">Metrics</h2>
          <p class="mt-3 text-[var(--color-ink-muted)]">
            Deploys, builds et activité — en un coup d’œil.
          </p>
        </Reveal>
        <div class="grid gap-4 lg:grid-cols-3">
          <Reveal
            delay={80}
            class="rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-5 transition duration-300 hover:border-[var(--color-line-strong)] lg:col-span-2"
          >
            <div class="mb-4 text-sm font-medium">Builds réussis</div>
            <ChartCanvas
              type="bar"
              height={220}
              labels={['W1', 'W2', 'W3', 'W4', 'W5', 'W6']}
              datasets={[{ label: 'OK', data: [12, 18, 15, 22, 19, 27] }]}
            />
          </Reveal>
          <Reveal
            delay={160}
            class="rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-5 transition duration-300 hover:border-[var(--color-line-strong)]"
          >
            <div class="mb-4 text-sm font-medium">Répartition</div>
            <ChartCanvas
              type="doughnut"
              height={220}
              legend
              labels={['Deploys', 'Tests', 'PRs', 'Idle']}
              datasets={[{ label: 'Share', data: [42, 28, 18, 12] }]}
            />
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
