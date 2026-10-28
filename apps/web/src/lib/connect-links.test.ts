import { describe, expect, it } from 'vitest';
import {
  cursorInstallLink,
  cursorWebInstallLink,
  grokBotConnectPrompt,
  mcpUrlFor,
} from './connect-links';

const MCP = 'https://web.jeser.app/api/v1/mcp';

function decodeConfig(link: string) {
  const config = new URL(link.replace(/^cursor:\/\//, 'https://')).searchParams.get('config')!;
  return JSON.parse(atob(config));
}

describe('connect-links', () => {
  it('dérive l’URL MCP de l’instance', () => {
    expect(mcpUrlFor('https://web.jeser.app/')).toBe(MCP);
    expect(mcpUrlFor('https://web.jeser.app')).toBe(MCP);
  });

  it('construit le deeplink Cursor officiel avec la config du seul serveur', () => {
    const link = cursorInstallLink(MCP);
    expect(link.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?name=devforge&config=')).toBe(true);
    expect(decodeConfig(link)).toEqual({ url: MCP });
  });

  it('ne met aucun en-tête ni jeton dans le lien', () => {
    const cfg = decodeConfig(cursorInstallLink(MCP));
    expect(Object.keys(cfg)).toEqual(['url']);
    expect(cursorInstallLink(MCP)).not.toMatch(/dfat_|dfoa_|Bearer/);
  });

  it('propose la variante web cursor.com', () => {
    const link = cursorWebInstallLink(MCP);
    expect(link.startsWith('https://cursor.com/install-mcp?name=devforge&config=')).toBe(true);
    expect(decodeConfig(link)).toEqual({ url: MCP });
  });

  it('prépare l’instruction Grok Bot avec l’URL MCP', () => {
    expect(grokBotConnectPrompt(MCP)).toContain(MCP);
  });
});
