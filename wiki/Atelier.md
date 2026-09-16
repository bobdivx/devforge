# Atelier (preview)

Le **workspace** est le poste de travail : chat agent à gauche, preview + logs à droite (tabs sur mobile).

## Preview atelier

Ce n’est **pas** un conteneur `df-dev-*`. C’est un process local (`npm run dev` / commande projet) dans le workdir.

- URL publique : `https://dev-{8chars}.{wildcard_domain}` via Traefik (file provider)
- Sans wildcard configuré : l’atelier refuse de publier une URL
- Variables projet injectées (sauf clés réservées OS / Vite)
- Premier start : `npm install` si `node_modules` manquant
- `force=true` ou bouton Redémarrer pour relancer après des edits

Outils agent : `start_local_preview`, stop, status.

## Preview production

L’iframe peut aussi pointer `production_url` une fois l’app `live` (déploiement Docker).

## Git local

Éditions atelier dans le workdir : onglet Git (diff, discard). Sync vers GitHub via tools / PR selon le flux agent.

## Limites actuelles

- Preview atelier = process sur le nœud qui exécute (souvent le leader)
- Logs deploy : historique + refresh, pas une console interactive
- Wildcard DNS + Traefik indispensables pour l’URL HTTPS atelier
