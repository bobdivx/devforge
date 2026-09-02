#!/usr/bin/env bash
# Plasma X11 + autostart AI stack sur Demeter
set -euo pipefail

PASS_FILE="${HOME}/.demeter_sudo_pass"
sudo_cmd() {
  if [[ -f "$PASS_FILE" ]]; then
    tr -d '\n' <"$PASS_FILE" | sudo -S "$@"
  else
    sudo "$@"
  fi
}

IA="/mnt/ia"
PINOKIO="$IA/pinokio"
REPO="${HOME}/Documents/devforge"
H="$REPO/scripts/demeter-bootstrap"
SERVE="$PINOKIO/api/uncensored-local-studio/app/scripts/server/serve.cjs"
MODEL="qwen3-coder-30b-a3b-instruct-q4_k_m.gguf"
CTX=49152

echo "=== setup-demeter-boot $(date -Iseconds) ==="

# Xorg requis pour Plasma X11
sudo_cmd pacman -S --noconfirm xorg-server xorg-xinit 2>&1 | tail -3 || true

# Session Plasma X11
PLASMA_X11_TMP="$(mktemp)"
cat >"$PLASMA_X11_TMP" <<'EOF'
[Desktop Entry]
Type=XSession
Exec=/usr/lib/plasma-dbus-run-session-if-needed /usr/bin/startplasma-x11
TryExec=/usr/bin/startplasma-x11
DesktopNames=KDE
Name=Plasma (X11)
Comment=Plasma by KDE
X-KDE-PluginInfo-Version=6.7.4
EOF
sudo_cmd cp "$PLASMA_X11_TMP" /usr/share/xsessions/plasma-x11.desktop
rm -f "$PLASMA_X11_TMP"

# Autologin sur X11 (plus Wayland)
PLASMA_LOGIN_TMP="$(mktemp)"
cat >"$PLASMA_LOGIN_TMP" <<'EOF'
[Autologin]
User=bobdivx
Session=plasma-x11
Relogin=true
EOF
sudo_cmd cp "$PLASMA_LOGIN_TMP" /etc/plasmalogin.conf
rm -f "$PLASMA_LOGIN_TMP"

echo "plasmalogin -> plasma-x11"

# Auto-load GGUF au démarrage de serve.cjs
if [[ -f "$SERVE" ]] && ! grep -q 'Demeter bootstrap auto-load' "$SERVE"; then
  # Retirer ancien bloc auto-load si présent
  perl -0777 -i -pe 's/\n\/\/ Auto-load LLM model on server startup.*?\}, 2000\);\n//s' "$SERVE" 2>/dev/null || true

  cat >>"$SERVE" <<'AUToload'

// Demeter bootstrap auto-load
setTimeout(async () => {
  try {
    const models = typeof getLlmModels === "function" ? getLlmModels() : [];
    const target = models.find(m => !m.isProjector && m.filename === "qwen3-coder-30b-a3b-instruct-q4_k_m.gguf");
    if (!target) {
      console.warn("  [llm] Auto-load skipped: qwen3-coder-30b-a3b-instruct-q4_k_m.gguf not found");
      return;
    }
    console.log("  [llm] Auto-loading " + target.filename + " (49152 context)...");
    await startLlm({
      model: target.filename,
      contextSize: 49152,
      gpuLayers: -1,
      flashAttn: true,
      cacheTypeK: "q8_0",
      cacheTypeV: "q8_0",
      batchSize: 2048,
      ubatchSize: 512
    });
    console.log("  [llm] Model " + target.filename + " is READY in VRAM!");
  } catch (e) {
    console.warn("  [llm] Auto-start failed:", e.message);
  }
}, 2000);
AUToload
  echo "serve.cjs auto-load configured"
fi

# Script de démarrage AI
chmod +x "$H/start-demeter-ai.sh"

# systemd user service
mkdir -p "${HOME}/.config/systemd/user"
tee "${HOME}/.config/systemd/user/demeter-ai.service" >/dev/null <<EOF
[Unit]
Description=Demeter AI stack (Homarr, Uncensored, LiteLLM)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
Environment=IA_ROOT=$IA
Environment=PINOKIO_HOME=$PINOKIO
ExecStart=$H/start-demeter-ai.sh
ExecStop=/bin/sh -c 'pkill -f "litellm --config" || true; pkill -f scripts/server/serve.cjs || true'

[Install]
WantedBy=default.target
EOF

# Linger : services user au boot sans session graphique
sudo_cmd loginctl enable-linger "${USER}"

systemctl --user daemon-reload
systemctl --user enable demeter-ai.service
systemctl --user enable docker 2>/dev/null || true

# Vérifications
echo ">> Vérifications pré-reboot"
[[ -f "$PINOKIO/api/uncensored-local-studio/app/app/llm-models/$MODEL" ]] && echo "GGUF: OK" || echo "GGUF: MISSING"
[[ -x "$PINOKIO/api/litellm-cursor-proxy/env/bin/litellm" ]] && echo "litellm: OK" || echo "litellm: MISSING"
docker inspect homarr-demeter --format 'homarr restart={{.HostConfig.RestartPolicy.Name}}' 2>/dev/null || echo "homarr: container absent"
systemctl is-enabled docker && echo "docker: enabled"
ls /usr/share/xsessions/plasma-x11.desktop && echo "plasma-x11 session: OK"
grep Session /etc/plasmalogin.conf

echo "=== setup-demeter-boot DONE ==="
