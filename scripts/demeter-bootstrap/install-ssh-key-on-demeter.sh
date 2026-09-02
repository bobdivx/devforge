#!/usr/bin/env bash
# Ajoute une cle publique SSH dans authorized_keys sur Demeter (Linux).
# Usage sur Demeter (Remote SSH) :
#   bash install-ssh-key-on-demeter.sh "ssh-ed25519 AAAA... comment"
# Ou depuis le repo devforge :
#   bash scripts/demeter-bootstrap/install-ssh-key-on-demeter.sh "$(cat cle.pub)"
set -euo pipefail

PUBKEY="${1:-}"
if [[ -z "$PUBKEY" ]]; then
  echo "Usage: $0 \"ssh-ed25519 AAAA... comment\"" >&2
  exit 1
fi

umask 077
mkdir -p "$HOME/.ssh"
AUTH="$HOME/.ssh/authorized_keys"
touch "$AUTH"
chmod 700 "$HOME/.ssh"
chmod 600 "$AUTH"

if grep -qF "$PUBKEY" "$AUTH" 2>/dev/null; then
  echo "Cle deja presente dans $AUTH"
else
  echo "$PUBKEY" >> "$AUTH"
  echo "Cle ajoutee a $AUTH"
fi

# Permettre auth par cle (Arch sshd par defaut : PubkeyAuthentication yes)
echo "Test : ssh bobdivx@10.1.0.88 hostname"
