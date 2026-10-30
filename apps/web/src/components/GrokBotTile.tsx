import { useEffect, useState } from 'preact/hooks';
import { api, type GrokBotSettings } from '../lib/api';
import { cn } from '../lib/cn';
import { Alert, Button, HubIcon, HubTile, Input, Modal, Spinner, useToast } from './ui';

/** Même règle que le serveur : https uniquement (le serveur refuse aussi les adresses internes). */
export function isValidWebhookUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

/**
 * Tuile « Bot Grok » : état (configuré / dernier réveil) dans la tuile, réglage dans une Modal.
 * L'URL complète et la clé d'envoi ne reviennent jamais de l'API : champs en écriture seule.
 */
export function GrokBotTile({ index = 0 }: { index?: number }) {
  const toast = useToast();
  const [data, setData] = useState<GrokBotSettings | null>(null);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | 'clear' | null>(null);
  const [testRes, setTestRes] = useState<{ ok: boolean; message: string } | null>(null);

  async function load() {
    try {
      setData((await api.grokBotSettings()).data);
    } catch {
      /* tuile affichée « non configuré » */
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openModal() {
    setUrl('');
    setKey('');
    setError(null);
    setTestRes(null);
    setOpen(true);
  }

  async function save(e: Event) {
    e.preventDefault();
    const body: { url?: string; key?: string } = {};
    if (url.trim()) {
      if (!isValidWebhookUrl(url)) {
        setError('Adresse invalide : https://… public uniquement.');
        return;
      }
      body.url = url.trim();
    }
    if (key.trim()) body.key = key.trim();
    if (!body.url && !body.key) {
      setError(data?.configured ? 'Rien à modifier.' : 'Collez l’URL du webhook et la clé d’envoi.');
      return;
    }
    setBusy('save');
    setError(null);
    try {
      setData((await api.saveGrokBotSettings(body)).data);
      setUrl('');
      setKey('');
      toast.push({ title: 'Bot Grok enregistré', tone: 'ok' });
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setBusy('clear');
    try {
      setData((await api.saveGrokBotSettings({ url: '', key: '' })).data);
      toast.push({ title: 'Bot Grok déconnecté', tone: 'ok' });
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy('test');
    setTestRes(null);
    try {
      const r = (await api.testGrokBot()).data;
      setTestRes({ ok: r.ok, message: r.message });
    } catch (err) {
      setTestRes({ ok: false, message: String((err as Error).message || err) });
    } finally {
      setBusy(null);
      void load();
    }
  }

  const last = data?.last;
  const subtitle = (
    <div class="mt-1 line-clamp-2 text-[11px] leading-snug">
      {data?.configured ? (
        <>
          <span class={last?.ok === false ? 'text-[var(--color-danger)]' : 'text-[var(--color-ok)]'}>
            {last?.ok === false ? 'Dernier réveil en échec' : 'Configuré'}
          </span>
          {data.url_hint && <span class="text-[var(--color-ink-muted)]"> · {data.url_hint}</span>}
        </>
      ) : (
        <span class="text-[var(--color-ink-muted)]">Non configuré</span>
      )}
    </div>
  );

  return (
    <>
      <HubTile index={index} title="Bot Grok" description="Webhook de réveil" icon={<HubIcon name="brain" />} subtitle={subtitle} onClick={openModal} />
      <Modal open={open} onClose={() => busy === null && setOpen(false)} title="Bot Grok" description="Réveiller votre bot quand un run ou un déploiement échoue" size="sm">
        <form class="space-y-4" onSubmit={save}>
          <div class="rounded-xl border border-[var(--color-line)] px-3 py-2 text-sm">
            <div class="text-[var(--color-ink-muted)]">État</div>
            <div class="mt-0.5 font-medium text-[var(--color-ink)]">
              {data?.configured ? `Configuré${data.url_hint ? ` · ${data.url_hint}` : ''}` : 'Non configuré'}
            </div>
            {last && (
              <div class={cn('mt-0.5 text-xs', last.ok ? 'text-[var(--color-ok)]' : 'text-[var(--color-danger)]')}>
                Dernier envoi : {last.message || (last.ok ? 'OK' : 'Échec')} · {new Date(last.at).toLocaleString('fr-FR')}
              </div>
            )}
          </div>
          <Input
            label="URL du webhook"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder={data?.url_set ? 'Enregistrée — laisser vide pour garder' : 'https://…'}
            value={url}
            onInput={(e) => {
              setUrl((e.target as HTMLInputElement).value);
              setError(null);
            }}
          />
          <Input
            label="Clé d’envoi"
            type="password"
            autoComplete="new-password"
            placeholder={data?.key_set ? 'Définie — laisser vide pour garder' : 'Collez la clé'}
            value={key}
            onInput={(e) => {
              setKey((e.target as HTMLInputElement).value);
              setError(null);
            }}
            hint="Stockée chiffrée, jamais réaffichée."
          />
          {error && <Alert tone="danger">{error}</Alert>}
          {testRes && <Alert tone={testRes.ok ? 'ok' : 'danger'}>{testRes.message}</Alert>}
          <div class="flex flex-wrap justify-end gap-2">
            {data?.configured && (
              <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => void clear()}>
                {busy === 'clear' ? <Spinner /> : null}
                Déconnecter
              </Button>
            )}
            {data?.configured && (
              <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void test()}>
                {busy === 'test' ? <Spinner /> : null}
                Tester
              </Button>
            )}
            <Button type="submit" disabled={busy !== null}>
              {busy === 'save' ? <Spinner /> : null}
              Enregistrer
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
