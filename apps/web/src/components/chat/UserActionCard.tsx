import {
  PUBLISH_APPROVAL_KIND,
  PUBLISH_APPROVED_MESSAGE,
  PUSH_LIMIT_CONTINUE_MESSAGE,
  PUSH_LIMIT_KIND,
  userActionCopy,
  type NeedsUserAction,
} from '../../lib/publish-approval';
import { Button, Card } from '../ui';

/** Carte « action requise » (accord de publication, quota d'envois, réglage manquant). */
export function UserActionCard({
  action,
  busy,
  onSend,
  onApprovePublish,
}: {
  action: NeedsUserAction;
  busy: boolean;
  onSend(text: string): void;
  onApprovePublish(text: string): void;
}) {
  return (
    <Card class="max-w-[92%] border-l-4 border-l-[var(--color-warn)]">
      <div class="flex items-start gap-3">
        <span class="text-2xl" aria-hidden>
          !
        </span>
        <div class="flex-1">
          <p class="mb-2 text-sm font-medium">{userActionCopy(action.kind).title}</p>
          <p class="mb-3 text-sm text-[var(--color-ink-muted)]">{action.message_fr}</p>
          {action.settings_href && (
            <Button size="sm" variant="outline" href={action.settings_href} class="mb-2">
              Ouvrir les paramètres
            </Button>
          )}
          {action.resume_hint && <p class="mt-2 text-xs text-[var(--color-ink-faint)]">{action.resume_hint}</p>}
          {action.kind === PUBLISH_APPROVAL_KIND ? (
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => onApprovePublish(PUBLISH_APPROVED_MESSAGE)}
              class="mt-3"
              title="Autorise l’agent à publier (GitHub, déploiement) pendant 15 minutes."
            >
              Valider la publication
            </Button>
          ) : action.kind === PUSH_LIMIT_KIND ? (
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => onSend(PUSH_LIMIT_CONTINUE_MESSAGE)}
              class="mt-3"
              title="L’agent repart avec un nouveau quota de 3 envois sur GitHub."
            >
              {userActionCopy(PUSH_LIMIT_KIND).button}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSend('Continuer')} class="mt-3">
              Continuer
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
