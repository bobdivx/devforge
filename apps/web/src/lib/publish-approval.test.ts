import { describe, expect, it, vi } from 'vitest';
import {
  approveThenSend,
  needsUserActionFrom,
  PUBLISH_APPROVAL_KIND,
  PUBLISH_APPROVED_MESSAGE,
} from './publish-approval';

describe('needsUserActionFrom', () => {
  it('détecte le blocage de publication renvoyé par le serveur', () => {
    const n = needsUserActionFrom([
      { name: 'run_workdir_command', arguments: {}, result: { ok: true } },
      {
        name: 'create_github_fix',
        arguments: {},
        result: {
          ok: false,
          code: 'publish_approval_required',
          needs_user_action: true,
          kind: 'publish_approval',
          message_fr: 'Je suis prêt à publier (pull request « Header »). Valide pour que je continue.',
        },
      },
    ]);
    expect(n?.kind).toBe(PUBLISH_APPROVAL_KIND);
    expect(n?.message_fr).toContain('Header');
  });

  it('accepte un ancien refus sans needs_user_action (publish_to_github)', () => {
    const n = needsUserActionFrom([
      { name: 'publish_to_github', arguments: {}, result: { ok: false, code: 'publish_approval_required' } },
    ]);
    expect(n?.kind).toBe(PUBLISH_APPROVAL_KIND);
  });

  it('garde les autres actions requises (GitHub non connecté)', () => {
    const n = needsUserActionFrom([
      {
        name: 'read_github_file',
        arguments: {},
        result: { ok: false, needs_user_action: true, kind: 'missing_github', message_fr: 'Connecte GitHub', settings_href: '/app/settings?tab=github' },
      },
    ]);
    expect(n).toEqual({ kind: 'missing_github', message_fr: 'Connecte GitHub', settings_href: '/app/settings?tab=github', resume_hint: undefined });
  });

  it('rien quand tout est ok', () => {
    expect(needsUserActionFrom([{ name: 'x', arguments: {}, result: { ok: true } }])).toBeUndefined();
    expect(needsUserActionFrom(undefined)).toBeUndefined();
  });
});

describe('approveThenSend', () => {
  it("pose l'accord AVANT d'envoyer le message", async () => {
    const order: string[] = [];
    const approve = vi.fn(async () => {
      order.push('approve');
    });
    const send = vi.fn((t: string) => order.push(`send:${t}`));
    await approveThenSend(approve, send, PUBLISH_APPROVED_MESSAGE);
    expect(order).toEqual(['approve', `send:${PUBLISH_APPROVED_MESSAGE}`]);
  });

  it("n'envoie rien si l'accord échoue", async () => {
    const send = vi.fn();
    await expect(
      approveThenSend(() => Promise.reject(new Error('403')), send, PUBLISH_APPROVED_MESSAGE),
    ).rejects.toThrow('403');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('plafond de pushes', () => {
  it('carte dédiée avec un bouton clair', async () => {
    const { needsUserActionFrom, userActionCopy, PUSH_LIMIT_KIND } = await import('./publish-approval');
    const card = needsUserActionFrom([
      {
        name: 'sync_workdir_to_github',
        result: {
          ok: false,
          needs_user_action: true,
          kind: 'push_limit',
          code: 'push_limit_reached',
          message_fr: 'J’ai déjà poussé 3 fois sur GitHub pendant ce travail.',
        },
      },
    ]);
    expect(card?.kind).toBe(PUSH_LIMIT_KIND);
    expect(card?.message_fr).toContain('3 fois');
    expect(userActionCopy(PUSH_LIMIT_KIND).button).toBe('Autoriser à continuer');
  });
});
