import { Button, ChartCanvas, Container } from '../ui';
import { enterUp, motion, productShowcase } from '../../lib/motion';

export function Hero() {
  return (
    <section class="relative overflow-hidden pb-10 pt-16 md:pb-16 md:pt-28">
      <div class="pointer-events-none absolute inset-x-0 top-0 h-[32rem]" aria-hidden>
        <div class="absolute left-1/2 top-6 h-72 w-[40rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgb(167_139_250/0.24),transparent_68%)] blur-3xl" />
        <div class="absolute right-[10%] top-28 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgb(232_121_249/0.14),transparent_70%)] blur-2xl" />
      </div>

      <Container>
        <div class="relative mx-auto max-w-3xl text-center">
          <p
            class="mb-5 text-sm font-medium tracking-[0.2em] uppercase text-[var(--color-accent)]"
            animate={enterUp(0)}
          >
            DevForge
          </p>
          <h1
            class="text-4xl font-semibold leading-[1.06] tracking-tight md:text-6xl lg:text-[4.25rem]"
            animate={enterUp(0.08)}
          >
            Deploy with agents
            <br />
            <span class="df-gradient-text">built for shipping</span>
          </h1>
          <p
            class="mx-auto mt-6 max-w-xl text-base leading-relaxed text-[var(--color-ink-muted)] md:text-lg"
            animate={enterUp(0.16)}
          >
            Plateforme claire pour déployer vos apps. Agents attachés à chaque project — tests, PRs,
            Actions.
          </p>
          <div class="mt-9 flex flex-wrap items-center justify-center gap-3" animate={enterUp(0.24)}>
            <Button href="/login" size="lg">
              Commencer
            </Button>
            <Button href="/#metrics" variant="outline" size="lg">
              Voir les metrics
            </Button>
          </div>
        </div>

        <div class="relative mx-auto mt-16 max-w-5xl" animate={productShowcase()}>
          <div
            class="pointer-events-none absolute -inset-px rounded-2xl opacity-50 df-shimmer-border"
            aria-hidden
          />
          <div class="df-glow-ring relative overflow-hidden rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm">
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
                    class={`mb-1 rounded-lg px-3 py-2 text-sm transition-colors duration-200 ${
                      i === 0
                        ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                        : 'text-[var(--color-ink-muted)]'
                    }`}
                    animate={
                      i === 0
                        ? motion({
                            whileHover: {
                              transform: 'translateX(2px)',
                              duration: 0.18,
                            },
                          })
                        : undefined
                    }
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
