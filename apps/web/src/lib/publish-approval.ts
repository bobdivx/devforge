import type { AgentToolCall } from './agent-stream';

/** Carte « Action requise » déduite des outils d'un tour. */
export type NeedsUserAction = {
  kind: string;
  message_fr: string;
  settings_href?: string;
  resume_hint?: string;
};

export const PUBLISH_APPROVAL_KIND = 'publish_approval';
/** Message envoyé à l'agent après le clic « Valider la publication ». */
export const PUBLISH_APPROVED_MESSAGE = 'Publication validée, continue.';
export const OPEN_PR_MESSAGE = 'Valide les changements locaux et ouvre une pull request.';

export function needsUserActionFrom(tools: AgentToolCall[] | undefined): NeedsUserAction | undefined {
  for (const tool of tools ?? []) {
    const r = tool.result;
    if (!r) continue;
    const blocked = r.needs_user_action === true || r.code === 'publish_approval_required';
    if (!blocked) continue;
    const kind = String(r.kind || (r.code === 'publish_approval_required' ? PUBLISH_APPROVAL_KIND : 'unknown'));
    return {
      kind,
      message_fr: String(
        r.message_fr ||
          (kind === PUBLISH_APPROVAL_KIND
            ? 'L’agent est prêt à publier. Valide pour qu’il continue.'
            : 'Action utilisateur requise'),
      ),
      settings_href: r.settings_href ? String(r.settings_href) : undefined,
      resume_hint: r.resume_hint ? String(r.resume_hint) : undefined,
    };
  }
  return undefined;
}

/**
 * Accord de publication (15 min côté serveur) PUIS message à l'agent.
 * Sans accord, le serveur refuse toute action distante : on n'envoie rien si l'accord échoue.
 */
export async function approveThenSend(
  approve: () => Promise<unknown>,
  send: (text: string) => void,
  text: string,
): Promise<boolean> {
  await approve();
  send(text);
  return true;
}
