#!/usr/bin/env bash
# Stop reboot loop — block accidental sudo reboot from automation
set -euo pipefail
PASS_FILE="${HOME}/.demeter_sudo_pass"
sudo_cmd() {
  if [[ -f "$PASS_FILE" ]]; then
    tr -d '\n' <"$PASS_FILE" | sudo -S "$@"
  else
    sudo "$@"
  fi
}

echo "=== stabilize-demeter $(date -Iseconds) ==="

# Bloquer reboot/shutdown via sudo (boucle agent / scripts)
TMP="$(mktemp)"
cat >"$TMP" <<'EOF'
# Demeter — bloque reboot automatique (retirer ce fichier pour reboot manuel)
bobdivx ALL=(ALL) !/usr/bin/reboot, !/sbin/reboot, !/usr/sbin/reboot, !/usr/bin/systemctl reboot, !/usr/bin/systemctl poweroff
EOF
sudo_cmd cp "$TMP" /etc/sudoers.d/demeter-no-auto-reboot
sudo_cmd chmod 440 /etc/sudoers.d/demeter-no-auto-reboot
rm -f "$TMP"
sudo_cmd visudo -c -f /etc/sudoers.d/demeter-no-auto-reboot

# Désactiver autostart AI (réactiver après CUDA)
systemctl --user disable demeter-ai.service 2>/dev/null || true
systemctl --user stop demeter-ai.service 2>/dev/null || true
pkill -f 'litellm --config' 2>/dev/null || true
pkill -f 'scripts/server/serve.cjs' 2>/dev/null || true
pkill -f llama-server 2>/dev/null || true

# Retirer auto-load GGUF (30B CPU au boot = charge massive)
SERVE="/mnt/ia/pinokio/api/uncensored-local-studio/app/scripts/server/serve.cjs"
if [[ -f "$SERVE" ]]; then
  perl -0777 -i -pe 's/\n\/\/ Demeter bootstrap auto-load.*?\}, 2000\);\n//s' "$SERVE" 2>/dev/null || true
fi

echo "demeter-ai: disabled, autoload removed, reboot blocked for bobdivx via sudo"
echo "=== DONE ==="
