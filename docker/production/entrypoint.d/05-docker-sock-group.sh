#!/bin/sh
# Before php-fpm/horizon start: give www-data access to a mounted docker.sock.
# Container USER is www-data, so we escalate with sudo when needed.

GRANT="/usr/local/bin/devforge-docker-sock-grant"

if [ ! -x "$GRANT" ]; then
    exit 0
fi

if [ "$(id -u)" -eq 0 ]; then
    "$GRANT" || true
    exit 0
fi

if command -v sudo >/dev/null 2>&1; then
    sudo -n "$GRANT" || true
fi

exit 0
