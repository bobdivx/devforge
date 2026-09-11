import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  FadeIn,
  Input,
  Skeleton,
  useToast,
} from './ui';

type S3ConfigView = {
  enabled: boolean;
  name: string;
  key_set: boolean;
  key_masked?: string | null;
  secret_set: boolean;
  bucket: string;
  region: string;
  endpoint: string;
  ready: boolean;
};

type BackupRow = {
  id: string;
  storage_key: string;
  size_bytes: number;
  status: string;
  message: string;
  created_at: string;
};

type RemoteObj = {
  key: string;
  size_bytes: number;
  updated_at?: string;
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

export function BackupSettingsPanel({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<S3ConfigView | null>(null);
  const [mode, setMode] = useState('memory');

  const [enabled, setEnabled] = useState(false);
  const [name, setName] = useState('Scaleway backups');
  const [endpoint, setEndpoint] = useState('https://s3.fr-par.scw.cloud');
  const [region, setRegion] = useState('fr-par');
  const [bucket, setBucket] = useState('devforge');
  const [key, setKey] = useState('');
  const [secret, setSecret] = useState('');

  const [autoEnabled, setAutoEnabled] = useState(true);
  const [autoIntervalHours, setAutoIntervalHours] = useState(24);
  const [autoRetentionCount, setAutoRetentionCount] = useState(7);

  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [localBackups, setLocalBackups] = useState<BackupRow[]>([]);
  const [remote, setRemote] = useState<RemoteObj[]>([]);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [s, b, a, l] = await Promise.all([
        api.backupS3Get(),
        api.instanceBackups(),
        api.backupAutoGet(),
        api.instanceBackupsLocal(),
      ]);
      setCfg(s.config);
      setMode(s.mode || 'memory');
      setEnabled(!!s.config.enabled);
      setName(s.config.name || 'S3 backups');
      setEndpoint(s.config.endpoint || 'https://s3.fr-par.scw.cloud');
      setRegion(s.config.region || 'fr-par');
      setBucket(s.config.bucket || '');
      setBackups(b.backups ?? []);
      setAutoEnabled(!!a.config.enabled);
      setAutoIntervalHours(a.config.interval_hours || 24);
      setAutoRetentionCount(a.config.retention_count || 7);
      setLocalBackups(l.backups ?? []);
    } catch (e) {
      toast.push({ title: 'Chargement KO', detail: String(e), tone: 'danger' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isAdmin) load();
    else setLoading(false);
  }, [isAdmin]);

  function payload(includeSecrets: boolean) {
    return {
      enabled,
      name: name.trim(),
      endpoint: endpoint.trim(),
      region: region.trim(),
      bucket: bucket.trim(),
      ...(includeSecrets && key.trim() ? { key: key.trim() } : {}),
      ...(includeSecrets && secret.trim() ? { secret: secret.trim() } : {}),
    };
  }

  async function save(test = true) {
    setBusy(true);
    try {
      const r = await api.backupS3Save({ ...payload(true), test });
      setCfg(r.config);
      setMode(r.mode || 's3');
      setKey('');
      setSecret('');
      toast.push({
        title: 'S3 enregistré',
        detail: r.config.ready ? 'Prêt pour les backups' : 'Config sauvegardée',
        tone: 'ok',
      });
      await load();
    } catch (e) {
      toast.push({ title: 'Enregistrement KO', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function testOnly() {
    setBusy(true);
    try {
      const r = await api.backupS3Test(payload(true));
      toast.push({ title: 'Connexion OK', detail: r.message, tone: 'ok' });
    } catch (e) {
      toast.push({ title: 'Test S3 KO', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function runBackup() {
    setBusy(true);
    try {
      const r = await api.instanceBackupCreate();
      toast.push({
        title: 'Backup créé',
        detail: r.backup?.storage_key || r.backup?.message,
        tone: 'ok',
      });
      await load();
    } catch (e) {
      toast.push({ title: 'Backup KO', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function listRemote(inline = false) {
    setBusy(true);
    try {
      const r = await api.instanceBackupsRemote(
        inline
          ? {
              use_inline: true,
              key: key.trim(),
              secret: secret.trim(),
              bucket: bucket.trim(),
              region: region.trim(),
              endpoint: endpoint.trim(),
            }
          : {},
      );
      setRemote(r.objects ?? []);
      toast.push({
        title: 'Objets S3',
        detail: `${(r.objects ?? []).length} backup(s)`,
        tone: 'info',
      });
    } catch (e) {
      toast.push({ title: 'Liste remote KO', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function restore(storageKey: string, inline = false) {
    if (
      !confirm(
        'Restaurer cette sauvegarde ? Le serveur devra être redémarré pour appliquer la base.',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const r = await api.instanceBackupRestore({
        storage_key: storageKey,
        ...(inline
          ? {
              use_inline: true,
              key: key.trim(),
              secret: secret.trim(),
              bucket: bucket.trim(),
              region: region.trim(),
              endpoint: endpoint.trim(),
            }
          : {}),
      });
      toast.push({
        title: 'Restauration préparée',
        detail: r.message || 'Redémarre le serveur DevForge',
        tone: 'warn',
      });
    } catch (e) {
      toast.push({ title: 'Restore KO', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function saveAutoConfig() {
    setBusy(true);
    try {
      const r = await api.backupAutoSave({
        enabled: autoEnabled,
        interval_hours: autoIntervalHours,
        retention_count: autoRetentionCount,
      });
      setAutoEnabled(r.config.enabled);
      setAutoIntervalHours(r.config.interval_hours);
      setAutoRetentionCount(r.config.retention_count);
      toast.push({
        title: 'Config auto-backup enregistrée',
        detail: r.config.enabled ? 'Backups automatiques activés' : 'Désactivés',
        tone: 'ok',
      });
    } catch (e) {
      toast.push({ title: 'Enregistrement KO', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return <Alert tone="warn">Réservé à l’admin instance.</Alert>;
  }

  if (loading) {
    return <Skeleton class="h-40" />;
  }

  return (
    <FadeIn>
      <div class="space-y-4">
        <Card>
          <CardHeader title="Backups automatiques" />
          <p class="mb-3 text-sm text-[var(--color-ink-muted)]">
            Sauvegarde automatique de la base DevForge selon un planning. Les backups sont envoyés
            vers S3 si configuré, sinon sauvegardés localement.
          </p>
          <div class="space-y-3">
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoEnabled}
                onChange={(e) => setAutoEnabled((e.target as HTMLInputElement).checked)}
              />
              Activer les backups automatiques
            </label>
            <div class="grid gap-3 sm:grid-cols-2">
              <Input
                label="Intervalle (heures)"
                type="number"
                min="1"
                value={String(autoIntervalHours)}
                onInput={(e) =>
                  setAutoIntervalHours(Number((e.target as HTMLInputElement).value) || 24)
                }
              />
              <Input
                label="Rétention (nombre)"
                type="number"
                min="1"
                value={String(autoRetentionCount)}
                onInput={(e) =>
                  setAutoRetentionCount(Number((e.target as HTMLInputElement).value) || 7)
                }
              />
            </div>
            <Button size="sm" disabled={busy} onClick={saveAutoConfig}>
              Enregistrer
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Stockage S3"
            action={
              cfg?.ready ? (
                <Badge tone="ok">{mode}</Badge>
              ) : (
                <Badge tone="warn">non configuré</Badge>
              )
            }
          />
          <p class="mb-3 text-sm text-[var(--color-ink-muted)]">
            Destination pour les sauvegardes de la base DevForge (Scaleway, MinIO, AWS…). Les
            identifiants sont stockés en base, pas dans le `.env`.
          </p>
          <div class="space-y-3">
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
              />
              Activer les backups S3
            </label>
            <Input
              label="Nom"
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
            <Input
              label="Endpoint (path-style)"
              placeholder="https://s3.fr-par.scw.cloud"
              value={endpoint}
              onInput={(e) => setEndpoint((e.target as HTMLInputElement).value)}
            />
            <div class="grid gap-3 sm:grid-cols-2">
              <Input
                label="Région"
                value={region}
                onInput={(e) => setRegion((e.target as HTMLInputElement).value)}
              />
              <Input
                label="Bucket"
                value={bucket}
                onInput={(e) => setBucket((e.target as HTMLInputElement).value)}
              />
            </div>
            <Input
              label={cfg?.key_set ? `Access key (${cfg.key_masked})` : 'Access key'}
              type="password"
              placeholder={cfg?.key_set ? 'Laisser vide pour conserver' : 'SCW…'}
              value={key}
              autocomplete="off"
              onInput={(e) => setKey((e.target as HTMLInputElement).value)}
            />
            <Input
              label={cfg?.secret_set ? 'Secret key (déjà enregistré)' : 'Secret key'}
              type="password"
              placeholder={cfg?.secret_set ? 'Laisser vide pour conserver' : '•••'}
              value={secret}
              autocomplete="off"
              onInput={(e) => setSecret((e.target as HTMLInputElement).value)}
            />
            <div class="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => save(true)}>
                Enregistrer
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={testOnly}>
                Tester
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => save(false)}
              >
                Sauver sans test
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Backups instance"
            action={
              <Button size="sm" disabled={busy} onClick={runBackup}>
                Lancer un backup
              </Button>
            }
          />
          <p class="mb-3 text-sm text-[var(--color-ink-muted)]">
            Copie manuelle de <code>devforge.db</code>. Destination : S3 si configuré, sinon
            local.
          </p>
          <div class="mb-3 flex flex-wrap gap-2">
            {cfg?.ready && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => listRemote(false)}
              >
                Lister sur S3
              </Button>
            )}
          </div>

          {localBackups.length > 0 && (
            <div class="mb-4">
              <h4 class="mb-2 text-sm font-medium">Backups locaux</h4>
              <ul class="space-y-2">
                {localBackups.map((b) => (
                  <li
                    key={b.id}
                    class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-line)] px-3 py-2"
                  >
                    <div class="min-w-0">
                      <p class="truncate text-sm font-medium">{b.storage_key}</p>
                      <p class="text-xs text-[var(--color-ink-faint)]">
                        {formatBytes(b.size_bytes)} · {b.created_at}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => restore(b.storage_key, false)}
                    >
                      Restaurer
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {backups.length === 0 && remote.length === 0 && localBackups.length === 0 ? (
            <p class="text-sm text-[var(--color-ink-muted)]">Aucun backup pour l’instant.</p>
          ) : (
            remote.length > 0 && (
              <div>
                <h4 class="mb-2 text-sm font-medium">Backups S3</h4>
                <ul class="space-y-2">
                  {remote.map((o) => (
                    <li
                      key={o.key}
                      class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-line)] px-3 py-2"
                    >
                      <div class="min-w-0">
                        <p class="truncate text-sm font-medium">{o.key}</p>
                        <p class="text-xs text-[var(--color-ink-faint)]">
                          {formatBytes(o.size_bytes || 0)}
                          {o.updated_at ? ` · ${o.updated_at}` : ''}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => restore(o.key, false)}
                      >
                        Restaurer
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}
        </Card>

        <Card>
          <CardHeader
            title="Récupération d’urgence"
            action={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRecoveryOpen((v) => !v)}
              >
                {recoveryOpen ? 'Masquer' : 'Afficher'}
              </Button>
            }
          />
          <p class="mb-2 text-sm text-[var(--color-ink-muted)]">
            Si la config en base est perdue, saisis temporairement les identifiants S3 pour lister
            et restaurer un dump.
          </p>
          {recoveryOpen && (
            <div class="space-y-3">
              <Alert tone="warn">
                Ces champs one-shot ne sont pas sauvegardés sauf si tu cliques Enregistrer
                ci-dessus.
              </Alert>
              <div class="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => listRemote(true)}>
                  Lister (inline)
                </Button>
              </div>
              {remote.length > 0 && (
                <ul class="space-y-2">
                  {remote.map((o) => (
                    <li
                      key={`rec-${o.key}`}
                      class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-line)] px-3 py-2"
                    >
                      <span class="truncate text-sm">{o.key}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => restore(o.key, true)}
                      >
                        Restaurer
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      </div>
    </FadeIn>
  );
}
