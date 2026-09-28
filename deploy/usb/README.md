# Clé USB / appliance DevForge Node

Objectif : démarrer une machine **sans installer manuellement** Docker ni DevForge, puis :

1. Ouvrir **http://IP:8000** (écran **En attente**), **ou**
2. Depuis le **leader** : Cluster → **Trouver des nœuds** → **Ajouter**

Deux chemins, du plus simple au plus « image flashable ».

## Chemin A — Kit USB + Linux Live (recommandé aujourd’hui)

Fonctionne tout de suite, y compris hors-ligne si tu prépares le kit à l’avance.

### Préparer la clé (sur un PC avec Docker)

Linux / WSL2 :

```bash
cd deploy/usb
chmod +x prepare-kit.sh bootstrap.sh scripts/*.sh
# Monte ta clé, ex. /mnt/usb
./prepare-kit.sh /mnt/usb --version 2.0.162
```

La clé contient `devforge-usb/` : scripts + `devforge-image.tar` + `START-HERE.txt`.

Installe aussi **[Ventoy](https://www.ventoy.net/)** sur la clé et copie une ISO **Debian Live** ou **Ubuntu Desktop/Server**.

### Sur la machine cible

1. Boot sur la clé (USB first dans le BIOS/UEFI).
2. Choisis l’ISO Live dans Ventoy, branche le câble réseau (DHCP).
3. Monte la partition Ventoy / data, puis :

```bash
sudo bash /chemin/devforge-usb/bootstrap.sh
```

4. La console affiche `http://IP:8000`.
5. Navigateur sur cette IP, **ou** leader → **Trouver des nœuds**.

Persistance : un live sans disque perd `/var/lib/devforge` au reboot. Pour un nœud durable, installe Debian sur le disque interne puis relance `bootstrap.sh`.

## Chemin B — Une commande sur Debian/Ubuntu déjà installé

```bash
curl -fsSL https://raw.githubusercontent.com/bobdivx/devforge/main/deploy/usb/bootstrap.sh | sudo bash
```

Option hors-ligne :

```bash
sudo bash bootstrap.sh --version 2.0.162 --offline-tar ./devforge-image.tar
```

## Chemin C — Image `.img` flashable (bare-metal)

### Depuis les releases GitHub (recommandé)

Télécharge `DevForge-Node-<version>-amd64.img.xz` sur la [release](https://github.com/bobdivx/devforge/releases), décompresse, flashe avec [balenaEtcher](https://etcher.balena.io/) ou Rufus (mode DD).

1. Boot USB / SSD (UEFI).
2. Premier démarrage : DHCP + install Docker/DevForge (Internet requis pour le pull d’image).
3. Console : `http://IP:8000` — ou leader → **Trouver des nœuds**.

### Construire soi-même

Sur Linux / WSL2 avec `qemu-utils` + `libguestfs-tools` :

```bash
cd deploy/usb
chmod +x build-img.sh
./build-img.sh --version 2.0.162 --size 8G
# → dist/devforge-node-amd64.img[.xz]
# Option hors-ligne (embarque Docker) : ajoute --offline
```

Flasher :

- Windows : balenaEtcher / Rufus (mode DD)
- Linux : `sudo dd if=dist/devforge-node-amd64.img of=/dev/sdX bs=4M status=progress conv=fsync`

## Comportement une fois démarré

| Action | Résultat |
|--------|----------|
| Navigateur → `http://IP:8000` | Écran **En attente** (hostname + IPs LAN) |
| **Créer une instance** | Cette machine devient le **leader** |
| Laisser en attente + leader **Trouver des nœuds** | Adoption **worker** en 1 clic |
| **Rejoindre avec un jeton** | Secours manuel |

Hostname type : `devforge-a1b2` (dérivé de la MAC), visible dans le scan du leader.

Données : `/var/lib/devforge`.  
Ports : **8000** (UI), **5433** (réplication Postgres entre nœuds).  
Réseau conteneur : `network_mode: host` pour que l’IP LAN soit correcte (scan + navigateur).

## Fichiers

| Fichier | Rôle |
|---------|------|
| `bootstrap.sh` | Install one-shot Docker + DevForge + systemd |
| `prepare-kit.sh` | Remplit une clé avec kit + image Docker exportée |
| `build-img.sh` | Produit `dist/devforge-node-amd64.img` |
| `compose.yml` | Stack appliance |
| `scripts/firstboot.sh` | Démarre le compose, hostname, load offline |
| `scripts/show-ip.sh` | Affiche les URL sur la console (TTY1) |
| `systemd/*.service` | Auto-start au boot |

## Limites v1

- Image flashable : **amd64** (cloud Debian) ; ARM64 plus tard.
- Premier boot du `.img` : Internet utile (paquets + éventuellement pull si pas d’image seed).
- Pas de mDNS : le leader scanne le LAN HTTP (ports 8000 / 8080 / 80).
