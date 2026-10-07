import { useEffect, useState } from 'preact/hooks';
import { api, publicApiUrl } from '../lib/api';
import { AppShell } from './AppShell';
import { PersonaAvatar } from './personas/PersonaAvatar';
import { Alert, Button, Card, FadeIn, Skeleton } from './ui';

type Info = Awaited<ReturnType<typeof api.androidInfo>>['data'];

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  const mo = bytes / (1024 * 1024);
  return `${mo.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
}

function platform(): 'android' | 'ios' | 'desktop' {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  return 'desktop';
}

const STEPS = [
  {
    title: 'Autorise l’installation',
    text: 'Android demande d’autoriser ton navigateur à installer une app. Accepte : c’est l’app officielle de ton DevForge.',
  },
  {
    title: 'Ouvre le fichier',
    text: 'Touche le fichier téléchargé (DevForge-Android…apk), puis « Installer ».',
  },
  {
    title: 'Se connecter',
    text: 'Ouvre DevForge et touche « Se connecter ». Ton compte habituel suffit, rien d’autre à régler.',
  },
];

/** Page « App Android » : télécharger l'APK servi par l'instance elle-même. */
export function AndroidAppPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const where = platform();
  const apkUrl = publicApiUrl('/android/apk');

  useEffect(() => {
    setError(null);
    api
      .androidInfo()
      .then((r) => setInfo(r.data))
      .catch((e) => setError(String((e as Error).message || e)));
  }, [reload]);

  const meta = info?.available
    ? [`Version ${info.version}`, formatSize(info.size_bytes), `Android ${info.min_android} ou plus`]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <AppShell active="settings" title="App Android">
      <FadeIn>
        <div class="df-tap mx-auto grid max-w-4xl gap-4 lg:grid-cols-[1fr_auto]">
          <Card class="space-y-5">
            <div class="flex items-center gap-4">
              <PersonaAvatar persona="braise" size={64} />
              <div class="min-w-0">
                <h1 class="text-xl font-semibold tracking-tight sm:text-2xl">DevForge sur Android</h1>
                <p class="mt-1 text-sm text-[var(--color-ink-muted)]">
                  Tes apps, Braise 🔥 et les alertes de Phare 🗼 dans ta poche.
                </p>
              </div>
            </div>

            {error ? (
              <Alert tone="danger">{error}</Alert>
            ) : !info ? (
              <Skeleton class="h-12" />
            ) : info.available ? (
              <div class="space-y-2">
                <a
                  href={apkUrl}
                  download={info.file_name || 'DevForge-Android.apk'}
                  class="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] px-5 text-base font-semibold text-zinc-950 transition hover:brightness-110 active:brightness-95 sm:w-auto"
                >
                  📱 Télécharger l’app
                </a>
                <p class="text-xs text-[var(--color-ink-faint)]">{meta}</p>
                {!info.matches_server && (
                  <p class="text-xs text-[var(--color-ink-faint)]">
                    La version {info.server_version} de l’app arrive dans quelques minutes : celle-ci fonctionne déjà.
                  </p>
                )}
              </div>
            ) : (
              <div class="space-y-3">
                <Alert tone="info">
                  L’app Android de cette version se prépare. Réessaie dans quelques minutes.
                </Alert>
                <Button variant="secondary" class="max-lg:h-11" onClick={() => setReload((n) => n + 1)}>
                  Réessayer
                </Button>
              </div>
            )}

            {where === 'ios' && (
              <p class="text-sm text-[var(--color-ink-muted)]">
                Cette app est pour Android. Sur iPhone, ouvre DevForge dans Safari puis « Sur l’écran d’accueil ».
              </p>
            )}

            <ol class="grid gap-3 sm:grid-cols-3">
              {STEPS.map((s, i) => (
                <li
                  key={s.title}
                  class="rounded-xl border border-[var(--color-line)] bg-white/[0.02] p-4"
                >
                  <div class="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-sm font-semibold text-[var(--color-accent)]">
                    {i + 1}
                  </div>
                  <p class="text-sm font-medium">{s.title}</p>
                  <p class="mt-1 text-[13px] leading-snug text-[var(--color-ink-muted)]">{s.text}</p>
                </li>
              ))}
            </ol>

            <p class="text-xs text-[var(--color-ink-faint)]">
              Les alertes marchent toutes seules : mise en ligne échouée, app qui ne répond plus, Braise qui attend
              ton OK. Pour mettre l’app à jour, reviens ici et télécharge la nouvelle version.
            </p>
          </Card>

          {where === 'desktop' && info?.available && (
            <Card class="hidden w-64 flex-col items-center gap-3 text-center lg:flex">
              <img
                src={publicApiUrl('/android/qr.svg')}
                width={200}
                height={200}
                alt="QR code du lien de téléchargement"
                class="rounded-xl bg-white p-1"
              />
              <p class="text-sm font-medium">Scanne avec ton téléphone</p>
              <p class="text-xs text-[var(--color-ink-muted)]">Le téléchargement démarre directement.</p>
            </Card>
          )}
        </div>
      </FadeIn>
    </AppShell>
  );
}
