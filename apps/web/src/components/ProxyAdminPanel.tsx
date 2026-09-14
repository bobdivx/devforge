import { useEffect, useState } from 'preact/hooks';
import { api, type ProxyStatus } from '../lib/api';
import { Alert, Badge, Button, Card, CardHeader, FadeIn, Modal, Spinner, useToast } from './ui';

export function ProxyAdminPanel() {
  const toast = useToast();
  const [status, setStatus] = useState<ProxyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [restarting, setRestarting] = useState(false);
  const [ensuring, setEnsuring] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.proxyStatus();
      setStatus(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function handleRestart() {
    if (!confirmRestart) {
      setConfirmRestart(true);
      return;
    }
    setRestarting(true);
    try {
      const result = await api.proxyRestart();
      toast.push({
        title: 'Traefik redémarré',
        detail: result.message,
        tone: 'ok',
      });
      setConfirmRestart(false);
      await loadStatus();
    } catch (e) {
      toast.push({
        title: 'Erreur redémarrage',
        detail: String(e),
        tone: 'danger',
      });
    } finally {
      setRestarting(false);
    }
  }

  async function handleEnsure() {
    setEnsuring(true);
    try {
      const result = await api.proxyEnsure();
      toast.push({
        title: result.status === 'created' ? 'Traefik créé' : 'Traefik vérifié',
        detail: result.message,
        tone: 'ok',
      });
      await loadStatus();
    } catch (e) {
      toast.push({
        title: 'Erreur vérification',
        detail: String(e),
        tone: 'danger',
      });
    } finally {
      setEnsuring(false);
    }
  }

  const statusTone = status?.running
    ? 'ok'
    : status?.status === 'missing'
      ? 'danger'
      : 'warn';

  return (
    <FadeIn>
      <div class="space-y-4">
        {error && (
          <Alert tone="warn" class="mb-4">
            {error}
          </Alert>
        )}

        <Card>
          <CardHeader
            title="Traefik Reverse Proxy"
            description="Gestionnaire de routage HTTP pour les applications déployées"
            action={
              <div class="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loading}
                  onClick={loadStatus}
                >
                  {loading ? <Spinner /> : null}
                  Actualiser
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!status || ensuring}
                  onClick={handleEnsure}
                >
                  {ensuring ? <Spinner /> : null}
                  Vérifier / Créer
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!status?.running || restarting}
                  onClick={handleRestart}
                >
                  {restarting ? <Spinner /> : null}
                  Redémarrer
                </Button>
              </div>
            }
          />

          {loading && !status ? (
            <p class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
              <Spinner /> Chargement...
            </p>
          ) : status ? (
            <div class="space-y-3">
              <div class="flex flex-wrap items-center gap-3">
                <div>
                  <span class="text-sm font-medium text-[var(--color-ink)]">Statut</span>
                  <div class="mt-1">
                    <Badge tone={statusTone}>
                      {status.status === 'missing'
                        ? 'Absent'
                        : status.running
                          ? 'En ligne'
                          : 'Arrêté'}
                    </Badge>
                  </div>
                </div>
                {status.image && (
                  <div>
                    <span class="text-sm font-medium text-[var(--color-ink)]">Image</span>
                    <div class="mt-1 font-mono text-xs text-[var(--color-ink-muted)]">
                      {status.image}
                    </div>
                  </div>
                )}
                {status.network && (
                  <div>
                    <span class="text-sm font-medium text-[var(--color-ink)]">Réseau</span>
                    <div class="mt-1 font-mono text-xs text-[var(--color-ink-muted)]">
                      {status.network}
                    </div>
                  </div>
                )}
                {status.started_at && (
                  <div>
                    <span class="text-sm font-medium text-[var(--color-ink)]">Démarré</span>
                    <div class="mt-1 text-xs text-[var(--color-ink-muted)]">
                      {new Date(status.started_at).toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                )}
              </div>

              {status.status === 'missing' && (
                <Alert tone="danger">
                  Le conteneur Traefik est absent. Les applications ne sont pas accessibles via
                  leur URL publique. Utilisez « Vérifier / Créer » pour le restaurer.
                </Alert>
              )}

              {status.status !== 'running' && status.status !== 'missing' && (
                <Alert tone="warn">
                  Le conteneur Traefik est arrêté. Redémarrez-le pour restaurer l'accès aux
                  applications.
                </Alert>
              )}
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader
            title="Informations"
            description="Détails sur le fonctionnement du reverse proxy"
          />
          <div class="prose prose-sm max-w-none text-[var(--color-ink-muted)]">
            <p>
              Traefik achemine automatiquement le trafic HTTP/HTTPS vers les applications déployées
              en utilisant les labels Docker.
            </p>
            <ul>
              <li>
                <strong>Réseau :</strong> Les conteneurs d'application doivent être sur le même
                réseau Docker que Traefik (typiquement <code>devforge</code>)
              </li>
              <li>
                <strong>Labels :</strong> Chaque application reçoit des labels Traefik automatiques
                lors du déploiement
              </li>
              <li>
                <strong>HTTPS :</strong> Let's Encrypt gère automatiquement les certificats SSL
              </li>
              <li>
                <strong>API :</strong> Dashboard Traefik accessible sur{' '}
                <code>http://traefik.local</code> (réseau interne)
              </li>
            </ul>
          </div>
        </Card>
      </div>

      <Modal
        open={confirmRestart}
        onClose={() => setConfirmRestart(false)}
        title="Redémarrer Traefik"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRestart(false)}>
              Annuler
            </Button>
            <Button variant="danger" disabled={restarting} onClick={handleRestart}>
              {restarting ? <Spinner /> : null}
              Confirmer le redémarrage
            </Button>
          </>
        }
      >
        <p class="text-sm text-[var(--color-ink-muted)]">
          Le redémarrage de Traefik interrompra brièvement l'accès à toutes les applications
          déployées (quelques secondes). Les connexions actives seront coupées.
        </p>
        <p class="mt-3 text-sm font-medium text-[var(--color-ink)]">Confirmer le redémarrage ?</p>
      </Modal>
    </FadeIn>
  );
}
