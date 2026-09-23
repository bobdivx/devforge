#!/bin/sh
# Relaye docker, git, npm, node et ssh vers la machine hôte.
# Le binaire Flatpak ne voit pas ces outils : le démon Docker et les dépôts
# restent ceux de l’utilisateur.
cmd=$(basename "$0")
exec flatpak-spawn --host "$cmd" "$@"
