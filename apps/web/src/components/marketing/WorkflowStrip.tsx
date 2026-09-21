import { Container, Reveal, Section } from '../ui';
import { enterUp, interactiveLift, motion } from '../../lib/motion';

const STEPS = [
  { n: '01', title: 'Connecte le repo', body: 'Branche ton projet et c’est parti.' },
  { n: '02', title: 'Deploy', body: 'Build, start, logs — en un clic.' },
  { n: '03', title: 'Agent', body: 'Tes agents agissent dans le projet.' },
];

export function WorkflowStrip() {
  return (
    <Section id="workflow" class="pt-0">
      <Container>
        <Reveal class="rounded-2xl border border-[var(--color-line)] bg-[var(--color-bg-elevated)]/80 p-8 backdrop-blur-sm md:p-10">
          <h2 class="text-2xl font-semibold tracking-tight">Workflow</h2>
          <div class="mt-10 grid gap-10 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <div
                key={s.n}
                class="rounded-xl border border-transparent p-1"
                animate={motion(enterUp(0.08 + i * 0.08), interactiveLift())}
              >
                <div class="text-xs font-medium tracking-[0.18em] text-[var(--color-accent)]">
                  {s.n}
                </div>
                <div class="mt-3 text-lg font-medium tracking-tight">{s.title}</div>
                <p class="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">{s.body}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
