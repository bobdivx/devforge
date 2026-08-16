#!/bin/sh
# Install a standalone keeper (not managed by the ZimaOS app update).
# It starts DevForge containers left in created/exited and reloads nginx.
set -eu

IMAGE="${DEVFORGE_KEEPER_IMAGE:-docker:27.5.1-cli}"

sudo docker rm -f devforge-keeper >/dev/null 2>&1 || true
sudo docker pull "$IMAGE"
sudo docker run -d \
    --name devforge-keeper \
    --restart always \
    --label devforge.role=keeper \
    -v /var/run/docker.sock:/var/run/docker.sock \
    "$IMAGE" \
    /bin/sh -c 'INTERVAL="${DEVFORGE_KEEPER_INTERVAL:-15}"; while true; do need_reload=0; for c in devforge-api devforge-web devforge-proxy devforge-db devforge-redis devforge-realtime; do s=$(docker inspect -f "{{.State.Status}}" "$c" 2>/dev/null || true); if [ "$s" = created ] || [ "$s" = exited ]; then docker start "$c" >/dev/null 2>&1 || true; need_reload=1; fi; done; if [ "$need_reload" = 1 ]; then docker exec devforge-proxy nginx -s reload >/dev/null 2>&1 || true; fi; if docker inspect -f "{{.State.Status}}" devforge-api 2>/dev/null | grep -q running; then if ! docker exec devforge-api getent hosts host.docker.internal >/dev/null 2>&1; then gw=$(docker exec devforge-api ip route 2>/dev/null | awk "/default/ {print \$3; exit}"); if [ -n "$gw" ]; then docker exec -u root devforge-api sh -c "echo $gw host.docker.internal >> /etc/hosts" >/dev/null 2>&1 || true; fi; fi; fi; sleep "$INTERVAL"; done'

echo "devforge-keeper is running (restart=always)."
