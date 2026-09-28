# USB / appliance Node

Transforme une machine (PC, mini-PC, vieux portable) en **nœud DevForge** en bootant depuis une clé USB.

## Ce que tu obtiens

- DevForge démarre tout seul (Docker + compose).
- Écran **En attente** sur `http://IP:8000`.
- Ou ajout en **worker** depuis le leader : Cluster → **Trouver des nœuds**.

## Comment faire

Voir le kit complet : [`deploy/usb/README.md`](../deploy/usb/README.md).

Résumé du chemin le plus simple :

1. Sur un PC avec Docker : `deploy/usb/prepare-kit.sh /mnt/usb`
2. Ventoy + ISO Debian/Ubuntu Live sur la même clé
3. Boot live sur la machine cible → `sudo bash …/devforge-usb/bootstrap.sh`
4. Ouvre l’IP affichée, ou adopte depuis le leader

Image `.img` flashable (Etcher) : télécharge `DevForge-Node-*-amd64.img.xz` sur les releases, ou construis avec `deploy/usb/build-img.sh` (Linux / WSL2 + libguestfs).

## Lien cluster

Le mode **en attente** + découverte LAN est documenté dans [[Cluster]].
