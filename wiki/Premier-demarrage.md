# Premier démarrage

Au premier lancement il n’y a **aucun utilisateur**. Bootstrap renvoie `needs_setup: true`. L’instance démarre en **leader** (SQLite local). Rien à passer en `DEVFORGE_ROLE` / `DEVFORGE_CLUSTER_*`.

## Écran « Bienvenue sur DevForge » (`/login`)

Deux chemins :

### Créer une instance (leader)

1. Remplis nom, email, mot de passe (8 caractères min). Nom d’instance optionnel.
2. Le premier compte est `instance_admin`.
3. Redirection vers le **wizard** `/app/onboarding`.

### Rejoindre un cluster (worker)

1. Clique **Rejoindre**.
2. Colle l’**URL du leader** et le **token** (page Cluster → Invitation sur le leader).
3. Nom de nœud optionnel (sinon hostname).
4. Redirection vers `/app/node` — UI réduite : cette machine n’est plus le control plane.

Tant qu’il n’y a aucun utilisateur, le join **ne demande pas** de compte admin. Dès qu’un admin existe, le join local exige d’être `instance_admin`.

## Wizard d’onboarding (`/app/onboarding`)

Étape **Accueil** : encore **Créer une instance** / **Rejoindre un cluster** (si tu as créé le compte avant de joindre).

Ensuite, pour un leader :

| Étape | Contenu |
|-------|---------|
| Instance | Nom + URL publique (`https://forge.example.com`) |
| Domaine | Wildcard apps (`apps.example.com`) — obligatoire pour l’atelier HTTPS |
| GitHub | PAT optionnel (tu pourras coller plus tard) |
| Terminé | Récap → **Ouvrir DevForge** |

SSH distant : **Settings → Serveur**, pas dans le wizard. Les déplois locaux passent par le socket Docker.

## Après join (worker)

- Heartbeat vers le leader (~15 s). Hors ligne si pas de heartbeat depuis 45 s.
- `POST /internal/exec` : le leader envoie les commandes de compute ici.
- Login / AuthGate redirigent vers `/app/node`.
- Pas d’UI produit (apps, settings, cluster) sur le worker.

## Comptes suivants

Si `DEVFORGE_ALLOW_REGISTER=1` (ou inscription ouverte dans l’UI), les comptes suivants sont `user` avec un workspace isolé forfait `free`. Voir [[Equipe]].
