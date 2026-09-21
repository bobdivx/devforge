import { useEffect, useState } from 'preact/hooks';
import { FileText, Save, Check, AlertCircle, X, Sparkles, RefreshCw } from 'lucide-preact';
import { api } from '../../lib/api';
import { Badge, Button, Spinner } from '../ui';
import { cn } from '../../lib/cn';

type Props = {
  open: boolean;
  onClose: () => void;
  projectUuid: string;
  projectName?: string;
  variant?: 'sheet' | 'modal';
};

export function ProjectRulesModal({
  open,
  onClose,
  projectUuid,
  projectName = 'Projet',
  variant = 'modal',
}: Props) {
  const [rules, setRules] = useState('');
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    loadRules();
  }, [open, projectUuid]);

  async function loadRules() {
    setLoading(true);
    setError(null);
    setStatusMessage(null);
    try {
      const res = await api.projectRules(projectUuid);
      setRules(res.data.rules || '');
      setExists(res.data.exists);
    } catch (err: any) {
      setError(err?.message || 'Erreur lors du chargement des règles');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setStatusMessage(null);
    try {
      await api.updateProjectRules(projectUuid, rules);
      setExists(true);
      setStatusMessage('Directives AGENTS.md enregistrées avec succès !');
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err: any) {
      setError(err?.message || 'Erreur lors de l’enregistrement');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fermer"
        class="df-modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div class="df-modal-panel relative flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] shadow-2xl max-h-[90vh]">
        {/* Header */}
        <div class="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-4">
          <div class="flex items-center gap-3">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              <FileText size={18} />
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="font-semibold text-sm sm:text-base text-[var(--color-ink)]">
                  Règles & Directives Agent
                </h3>
                <Badge tone={exists ? 'ok' : 'neutral'}>
                  {exists ? 'AGENTS.md existant' : 'Modèle par défaut'}
                </Badge>
              </div>
              <p class="text-xs text-[var(--color-ink-muted)] mt-0.5">
                Injecté automatiquement dans le contexte et les prompts des agents ({projectName})
              </p>
            </div>
          </div>
          <button
            type="button"
            class="rounded-lg p-1.5 text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]"
            onClick={onClose}
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div class="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div class="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-400">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {statusMessage && (
            <div class="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-400">
              <Check size={16} />
              <span>{statusMessage}</span>
            </div>
          )}

          {loading ? (
            <div class="flex h-64 items-center justify-center gap-2 text-sm text-[var(--color-ink-muted)]">
              <Spinner /> Chargement du fichier AGENTS.md…
            </div>
          ) : (
            <div class="space-y-2">
              <div class="flex items-center justify-between text-xs text-[var(--color-ink-muted)]">
                <span class="flex items-center gap-1.5 font-mono">
                  <Sparkles size={13} class="text-[var(--color-accent)]" />
                  workdir/AGENTS.md
                </span>
                <span>Supporte le markdown standard</span>
              </div>
              <textarea
                value={rules}
                onInput={(e) => setRules((e.target as HTMLTextAreaElement).value)}
                placeholder="# Directives du projet..."
                class="w-full h-80 rounded-xl border border-[var(--color-line)] bg-black/40 p-3.5 font-mono text-xs text-[var(--color-ink)] placeholder-[var(--color-ink-faint)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] resize-y"
              />
              <p class="text-[11px] text-[var(--color-ink-muted)] leading-relaxed">
                💡 <strong>Conseil :</strong> Spécifiez le mode de démarrage du serveur de dev (ex: <code>astro dev --background</code>), la stack (Astro + Preact) et les liens de documentation pour garantir un code conforme sans hallucination de l'agent.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div class="flex items-center justify-between border-t border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-3">
          <Button variant="ghost" onClick={loadRules} disabled={loading || saving} class="gap-1.5 text-xs">
            <RefreshCw size={13} class={loading ? 'animate-spin' : ''} />
            Recharger
          </Button>

          <div class="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={loading || saving}
              class="gap-1.5 min-w-28"
            >
              {saving ? <Spinner /> : <Save size={14} />}
              <span>{saving ? 'Enregistrement…' : 'Enregistrer'}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
