import { describe, expect, it } from 'vitest';
import { chatDayStamp, escapeChatHtml, firstNameFrom, isNewChatDay, renderChatHtml } from '../src/lib/agent-chat-richtext';

describe('agent-chat-richtext', () => {
    it('échappe le HTML et met en forme code, gras, liens et statuts', () => {
        const html = renderChatHtml('Voir **prod** `healthy` vs 502 <script> https://example.com/status');

        expect(html).toContain('<strong>prod</strong>');
        expect(html).toContain('chat-inline-code');
        expect(html).toContain('chat-status-ok');
        expect(html).toContain('chat-status-bad');
        expect(html).toContain('chat-link');
        expect(html).not.toContain('<script>');
        expect(escapeChatHtml('<b>')).toBe('&lt;b&gt;');
    });

    it('affiche un tampon « Aujourd’hui » le même jour', () => {
        const now = new Date('2026-08-21T15:00:00.000Z');
        expect(chatDayStamp('2026-08-21T10:05:00.000Z', now)).toMatch(/^Aujourd/);
        expect(isNewChatDay(null, '2026-08-21T10:05:00.000Z')).toBe(true);
        expect(isNewChatDay('2026-08-21T09:00:00.000Z', '2026-08-21T10:05:00.000Z')).toBe(false);
        expect(firstNameFrom('Mathieu Aubert')).toBe('Mathieu');
    });
});
