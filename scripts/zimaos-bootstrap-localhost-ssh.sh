#!/bin/sh
set -eu

KEY_DIR="${DEVFORGE_SSH_KEYS_DIR:-/media/Docker/AppData/devforge/ssh/keys}"
KEY_PATH="$KEY_DIR/id.bobdivx@host.docker.internal"
AUTH_KEYS="${DEVFORGE_AUTHORIZED_KEYS:-/DATA/.ssh/authorized_keys}"

mkdir -p "$KEY_DIR" "$(dirname "$AUTH_KEYS")"
chmod 700 "$(dirname "$AUTH_KEYS")"

if [ ! -f "$KEY_PATH" ]; then
    ssh-keygen -t ed25519 -a 100 -f "$KEY_PATH" -q -N "" -C devforge
fi

chown 9999:9999 "$KEY_PATH"
chmod 600 "$KEY_PATH"

if [ -f "$AUTH_KEYS" ]; then
    grep -v ' devforge$' "$AUTH_KEYS" > "${AUTH_KEYS}.tmp" || true
    mv "${AUTH_KEYS}.tmp" "$AUTH_KEYS"
fi

if [ -f "${KEY_PATH}.pub" ]; then
    cat "${KEY_PATH}.pub" >> "$AUTH_KEYS"
    rm -f "${KEY_PATH}.pub"
fi

chmod 600 "$AUTH_KEYS"
chown 999:1000 "$(dirname "$AUTH_KEYS")" "$AUTH_KEYS"

echo "SSH key ready: $KEY_PATH"
