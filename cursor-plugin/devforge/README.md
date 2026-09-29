# DevForge MCP (Cursor)

Plugin Cursor pour le serveur MCP d’une instance **DevForge auto-hébergée**.

Il n’existe pas d’URL unique : chaque installation expose la sienne.

## Installer

1. Installer le plugin **devforge-mcp** depuis le marketplace Cursor, ou importer le dépôt `https://github.com/bobdivx/devforge`.
2. Dans **Plugins → Configurer**, renseigner **URL MCP** :
   `https://<hôte>/api/v1/mcp`
   (Compte → Tokens affiche l’URL exacte de l’instance.)
3. Activer le serveur **devforge**, puis **Connect**.
4. Autoriser l’application sur la page `/oauth/consent/` de DevForge (compte DevForge ou Pocket ID).

Aucun Client ID ni Client Secret : l’instance enregistre Cursor toute seule (OAuth 2.1, PKCE). Les jetons se révoquent dans **Compte → Tokens**.

## Jeton API à la place d’OAuth

Créer un jeton `dfat_…` (Compte → Tokens) et coller dans `.cursor/mcp.json` :

```json
{
  "mcpServers": {
    "devforge": {
      "url": "https://<hôte>/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer dfat_…"
      }
    }
  }
}
```

## Publication sur le marketplace

Le formulaire officiel demande une session Cursor : [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish).  
Le catalogue communautaire : [cursor.directory/plugins/new](https://cursor.directory/plugins/new) (compte GitHub ou Google). Coller l’URL du dépôt ; le manifeste `.cursor-plugin/marketplace.json` est détecté à la racine.
