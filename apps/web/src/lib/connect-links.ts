/**
 * Liens « Connecter DevForge » vers les agents externes (Cursor, Grok Bot).
 *
 * Cursor : deeplink officiel `cursor://anysphere.cursor-deeplink/mcp/install?name=…&config=…`
 * où `config` = base64(JSON de la config d'UN serveur, sans l'enveloppe `mcpServers`).
 * Doc : https://cursor.com/docs/context/mcp/install-links
 * Le serveur n'a besoin que de son URL : Cursor découvre l'OAuth (RFC 9728 / 8414)
 * et s'enregistre tout seul (RFC 7591). Aucun jeton dans le lien.
 *
 * Grok Bot : pas de lien d'installation public pour un MCP personnalisé tant que le
 * plugin n'est pas listé au catalogue ; on prépare l'instruction à coller dans le chat.
 */

export const DEVFORGE_MCP_NAME = 'devforge';

/** Page du plugin dans le catalogue Grok Bot une fois publié (null tant que non listé). */
export const GROK_BOT_PLUGIN_URL: string | null = null;

/** URL MCP publique à partir de l'URL de l'instance (`https://hote` → `https://hote/api/v1/mcp`). */
export function mcpUrlFor(instanceUrl: string): string {
  return `${instanceUrl.trim().replace(/\/+$/, '')}/api/v1/mcp`;
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Config d'un serveur MCP distant (URL seule, OAuth découvert par le client). */
export function mcpServerConfig(mcpUrl: string): { url: string } {
  return { url: mcpUrl };
}

/** Deeplink d'installation Cursor (ouvre Cursor, qui propose d'installer puis « Connect »). */
export function cursorInstallLink(mcpUrl: string, name = DEVFORGE_MCP_NAME): string {
  const config = base64Utf8(JSON.stringify(mcpServerConfig(mcpUrl)));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(config)}`;
}

/** Variante web (cursor.com relaie vers l'app ; affiche la config si l'app ne s'ouvre pas). */
export function cursorWebInstallLink(mcpUrl: string, name = DEVFORGE_MCP_NAME): string {
  const config = base64Utf8(JSON.stringify(mcpServerConfig(mcpUrl)));
  return `https://cursor.com/install-mcp?name=${encodeURIComponent(name)}&config=${encodeURIComponent(config)}`;
}

/** Instruction à coller dans Grok Bot pour brancher le MCP (connexion OAuth ensuite). */
export function grokBotConnectPrompt(mcpUrl: string): string {
  return `Ajoute le serveur MCP DevForge : ${mcpUrl} (HTTPS distant, connexion OAuth avec mon compte DevForge, aucun jeton à saisir).`;
}
