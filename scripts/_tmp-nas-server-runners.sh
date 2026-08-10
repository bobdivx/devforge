#!/bin/bash
set -e
echo "== popcorn-server runners =="
docker ps -a --filter name=github-runner --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' | grep -iE 'server|tauri|NAME' || true
echo
echo "== labels / env repo =="
for c in github-runner-server github-runner-tauri github-runner-devforge-runner-popcorn-client github-runner-client; do
  if docker inspect "$c" >/dev/null 2>&1; then
    echo "-- $c --"
    docker inspect "$c" --format 'status={{.State.Status}} running={{.State.Running}} exit={{.State.ExitCode}}'
    docker inspect "$c" --format '{{range $k,$v := .Config.Labels}}{{println $k "=" $v}}{{end}}' | grep -E 'devforge.runner|casaos.app_id' || true
    docker inspect "$c" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E 'REPO_URL|RUNNER_NAME|LABELS|RUNNER_LABELS' || true
    echo "logs:"
    docker logs --tail 25 "$c" 2>&1 | tail -25
    echo
  fi
done
