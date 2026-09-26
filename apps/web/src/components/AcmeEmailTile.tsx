import { useEffect, useState } from 'preact/hooks';
import { api, type AcmeSettings, type AcmeSource } from '../lib/api';
import { Alert, Button, HubIcon, HubTile, Input, Modal, Spinner, useToast } from './ui';

const SOURCE_LABEL: Record<AcmeSource, string> = {
  env: 'variable d’environnement',
  setting: 'réglage',
  admin_user: 'email admin',
  none: 'aucune',
};

const RESERVED_TLDS = [
  'local',
  'localhost',
  'internal',
  'lan',
  'home',
  'test',
  'example',
  'invalid',
  'localdomain',
];

/** Même règle que le serveur (`is_valid_acme_email`) : Let's Encrypt refuse le reste. */
export function isValidAcmeEmail(value: string): boolean {
  const e = value.trim();
  const at = e.indexOf('@');
  if (at <= 0 || e.indexOf('@', at + 1) !== -1) return false;
  if (!/^[A-Za-z0-9@.+_-]+$/.test(e)) return false;
  const domain = e.slice(at + 1).toLowerCase();
  if (!domain.includes('.')) return false;
  const tld = domain.split('.').pop() || '';
  if (tld.length < 2 || RESERVED_TLDS.includes(tld)) return false;
  return domain !== 'example.com' && !domain.endsWith('.example.com');
}

/**
 * Tuile admin « Email des certificats » : statut (adresse effective + source) dans la
 * tuile, formulaire dans une Modal. Rien n’est rendu si l’API refuse (non-admin).
 */
export function AcmeEmailTile({ index = 0 }: { index?: number }) {
  const toast = useToast();
  const [data, setData] = useState<AcmeSettings | null>(null);
  const [denied, setDenied] = useState(false);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.acmeSettings());
    } catch {
      setDenied(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (denied) return null;

  const locked = !!data?.env_locked;
  const effective = data?.effective || '';

  function openModal() {
    setValue(data?.acme_email || '');
    setError(null);
    setConfirm(false);
    setOpen(true);
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setConfirm(false);
  }

  async function save() {
    setBusy(true);
    try {
      const r = await api.saveAcmeSettings(value.trim());
      setData((d) => ({ ...(d as AcmeSettings), ...r }));
      setOpen(false);
      setConfirm(false);
      toast.push({
        title: 'Email des certificats enregistré',
        detail: r.proxy_restarted
          ? `${r.effective || 'Aucune adresse'} · proxy redémarré`
          : `${r.effective || 'Aucune adresse'} · proxy inchangé`,
        tone: 'ok',
      });
      void load();
    } catch (err) {
      toast.push({
        title: 'Échec',
        detail: String((err as Error).message || err),
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

  function submit(e: Event) {
    e.preventDefault();
    if (locked) return;
    const v = value.trim();
    if (v && !isValidAcmeEmail(v)) {
      setError('Adresse invalide : il faut un domaine public (pas .local, .lan, example.com…).');
      return;
    }
    setError(null);
    const next = v || data?.admin_email || '';
    // Adresse effective inchangée : pas de redémarrage du proxy, pas de confirmation.
    if (next === effective) {
      void save();
      return;
    }
    setConfirm(true);
  }

  const subtitle = data ? (
    <div class="mt-1 line-clamp-2 text-[11px] leading-snug">
      <span class={effective ? 'text-[var(--color-ok)]' : 'text-[var(--color-warn)]'}>
        {effective || 'Aucune adresse'}
      </span>
      <span class="text-[var(--color-ink-muted)]"> · {SOURCE_LABEL[data.source]}</span>
    </div>
  ) : undefined;

  return (
    <>
      <HubTile
        index={index}
        title="Email des certificats"
        description="Let's Encrypt"
        icon={<HubIcon name="key" />}
        subtitle={subtitle}
        onClick={openModal}
      />
      <Modal
        open={open}
        onClose={close}
        title={confirm ? 'Redémarrer le proxy ?' : 'Email des certificats'}
        description={confirm ? undefined : 'Contact Let’s Encrypt de l’instance'}
        size="sm"
      >
        {confirm ? (
          <div class="space-y-4">
            <Alert tone="warn">
              Le proxy va redémarrer pour appliquer la nouvelle adresse : tous les sites seront
              coupés 1 à 2 secondes.
            </Alert>
            <p class="text-sm text-[var(--color-ink-muted)]">
              Nouvelle adresse :{' '}
              <span class="font-medium text-[var(--color-ink)]">
                {value.trim() || data?.admin_email || 'aucune'}
              </span>
            </p>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>
                Retour
              </Button>
              <Button type="button" variant="danger" disabled={busy} onClick={() => void save()}>
                {busy ? <Spinner /> : null}
                Enregistrer et redémarrer
              </Button>
            </div>
          </div>
        ) : (
          <form class="space-y-4" onSubmit={submit}>
            <div class="rounded-xl border border-[var(--color-line)] px-3 py-2 text-sm">
              <div class="text-[var(--color-ink-muted)]">Adresse utilisée</div>
              <div class="mt-0.5 break-all font-medium text-[var(--color-ink)]">
                {effective || 'Aucune adresse'}
              </div>
              <div class="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                Source : {data ? SOURCE_LABEL[data.source] : '…'}
              </div>
            </div>
            {locked ? (
              <>
                <Input label="Email des certificats" value={effective} readOnly disabled />
                <Alert tone="info">
                  Cette adresse est imposée par la variable d’environnement DEVFORGE_ACME_EMAIL
                  du serveur. Pour la changer, modifiez cette variable puis redémarrez DevForge.
                </Alert>
              </>
            ) : (
              <Input
                label="Email des certificats"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder={data?.admin_email || 'vous@exemple.fr'}
                value={value}
                onInput={(e) => {
                  setValue((e.target as HTMLInputElement).value);
                  setError(null);
                }}
                hint={
                  data?.admin_email
                    ? `Laisser vide pour utiliser l’email admin (${data.admin_email}).`
                    : undefined
                }
              />
            )}
            {error && <Alert tone="danger">{error}</Alert>}
            <p class="text-xs text-[var(--color-ink-muted)]">
              Utilisée uniquement par Let’s Encrypt pour les alertes sur les certificats
              (expiration, échec de renouvellement). Jamais affichée aux visiteurs. Une seule
              adresse pour toute l’instance.
            </p>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={close}>
                {locked ? 'Fermer' : 'Annuler'}
              </Button>
              {!locked && (
                <Button type="submit" disabled={busy || !data}>
                  {busy ? <Spinner /> : null}
                  Enregistrer
                </Button>
              )}
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
