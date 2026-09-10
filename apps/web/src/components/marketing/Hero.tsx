import { Button, ChartCanvas, Container } from '../ui';

export function Hero() {
  return (
    <section class="relative overflow-hidden pb-8 pt-16 md:pb-12 md:pt-24">
      <Container>
        <div class="mx-auto max-w-3xl text-center">
          <p class="df-fade-up mb-5 text-sm font-medium tracking-wide text-[var(--color-accent)]">
            DevForge
          </p>
          <h1 class="df-fade-up-delay text-4xl font-semibold leading-[1.08] tracking-tight md:text-6xl">
            Deploy with agents
            <br />
            <span class="df-gradient-text">built for shipping</span>
          </h1>
          <p class="df-fade-up-delay-2 mx-auto mt-5 max-w-xl text-base leading-relaxed text-[var(--color-ink-muted)] md:text-lg">
            Plateforme claire pour déployer vos apps. Agents attachés à chaque project — tests, PRs,
            Actions.
          </p>
            <div class="df-fade-up-delay-2 mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button href="/login" size="lg">
              Commencer
            </Button>
            <Button href="/#metrics" variant="outline" size="lg">
              Voir les metrics
            </Button>
          </div>
        </div>

        <div class="df-fade-up-delay-2 relative mx-auto mt-14 max-w-5xl">
          <div class="df-glow-ring overflow-hidden rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-bg-elevated)]">
            <div class="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
              <span class="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span class="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span class="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span class="ml-3 text-xs text-[var(--color-ink-faint)]">app.devforge · overview</span>
            </div>
            <div class="grid md:grid-cols-[200px_1fr]">
              <aside class="hidden border-r border-[var(--color-line)] p-4 md:block">
                <div class="mb-4 text-xs font-medium text-[var(--color-ink-faint)]">Workspace</div>
                {['Projects', 'Team', 'Settings'].map((item, i) => (
                  <div
                    key={item}
                    class={`mb-1 rounded-lg px-3 py-2 text-sm ${
                      i === 0
                        ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                        : 'text-[var(--color-ink-muted)]'
                    }`}
                  >
                    {item}
                  </div>
                ))}
              </aside>
              <div class="df-dot-grid p-5 md:p-6">
                <div class="mb-4 flex items-end justify-between gap-3">
                  <div>
                    <div class="text-sm font-medium">Deployments / 7j</div>
                    <div class="mt-1 text-xs text-[var(--color-ink-faint)]">7 derniers jours</div>
                  </div>
                  <div class="flex items-center gap-2 text-xs text-[var(--color-ok)]">
                    <span
                      class="h-1.5 w-1.5 rounded-full bg-[var(--color-ok)]"
                      style={{ animation: 'df-pulse-soft 1.6s ease infinite' }}
                    />
                    healthy
                  </div>
                </div>
                <ChartCanvas
                  type="line"
                  height={200}
                  labels={['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']}
                  datasets={[{ label: 'Deploys', data: [4, 6, 5, 9, 7, 3, 8], fill: true }]}
                />
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
