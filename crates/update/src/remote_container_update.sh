#!/bin/sh
# Mise à jour d’un worker Docker/compose, exécutée dans le conteneur.
# Aucune consultation GitHub : pull d’image, ou repli hôte (Windows / Flatpak).
set -u
target=@@TARGET@@
if ! command -v docker >/dev/null 2>&1 || ! docker version >/dev/null 2>&1; then
  echo DEVFORGE_UPDATE_HOST
  exit 0
fi
file="${DEVFORGE_UPDATE_COMPOSE_FILE:-}"
image="${DEVFORGE_UPDATE_IMAGE:-bobdivx/devforge}"
name="${DEVFORGE_SELF_CONTAINER:-devforge}"
svc="${DEVFORGE_UPDATE_COMPOSE_SERVICE:-devforge}"
if ! docker inspect "$name" >/dev/null 2>&1; then
  if [ -r /etc/hostname ]; then
    h=$(tr -d ' \t\n\r' < /etc/hostname)
    alt=$(docker inspect -f '{{.Name}}' "$h" 2>/dev/null || true)
    alt=${alt#/}
    if [ -n "$alt" ]; then
      name="$alt"
    fi
  fi
fi
running=$(docker inspect -f '{{.Config.Image}}' "$name" 2>/dev/null || true)
case "$running" in
  *":$target")
    echo "DEVFORGE_UPDATE_ALREADY $running"
    exit 0
    ;;
esac
if [ -z "$file" ] && [ -f /opt/devforge/docker-compose.yml ]; then
  file=/opt/devforge/docker-compose.yml
fi

# $1 image du helper, $2 args docker run supplémentaires. Script sur stdin.
schedule_helper() {
  helper_image=$1
  extra=$2
  payload=$(base64 | tr -d '\n') || true
  if [ -z "$payload" ]; then
    return 1
  fi
  updater="${name}-updater"
  docker rm -f "$updater" >/dev/null 2>&1 || true
  # shellcheck disable=SC2086
  docker run -d --rm --name "$updater" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    $extra \
    --entrypoint sh "$helper_image" \
    -c "echo $payload | base64 -d | sh"
}

helper_image_for() {
  candidate=$1
  if docker image inspect "$candidate" >/dev/null 2>&1; then
    printf '%s' "$candidate"
  elif [ -n "$running" ]; then
    printf '%s' "$running"
  else
    printf '%s' "$candidate"
  fi
}

if [ -n "$file" ] && [ -f "$file" ]; then
  if ! DEVFORGE_VERSION="$target" docker compose -f "$file" pull "$svc"; then
    echo "DEVFORGE_UPDATE_FAIL échec du pull compose"
    exit 1
  fi
  hostfile=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "'"$file"'"}}{{.Source}}{{end}}{{end}}' "$name" 2>/dev/null || true)
  mount=""
  if [ -n "$hostfile" ]; then
    mount="-v ${hostfile}:${file}:ro"
  fi
  helper_image=$(helper_image_for "${image}:${target}")
  if ! printf '%s\n' "set -e
sleep 2
DEVFORGE_VERSION=$target docker compose -f $file up -d --no-deps --force-recreate $svc" | schedule_helper "$helper_image" "$mount"; then
    echo "DEVFORGE_UPDATE_FAIL impossible de planifier la recréation compose"
    exit 1
  fi
  echo DEVFORGE_UPDATE_STARTED
  exit 0
fi

image_ref="${image}:${target}"
if ! docker pull "$image_ref"; then
  echo "DEVFORGE_UPDATE_FAIL échec du pull Docker"
  exit 1
fi
if ! docker inspect "$name" >/dev/null 2>&1; then
  echo "DEVFORGE_UPDATE_FAIL conteneur introuvable"
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "DEVFORGE_UPDATE_FAIL node absent pour reconstruire le conteneur"
  exit 1
fi
inspect_file=$(mktemp)
docker inspect "$name" > "$inspect_file"
run_cmd=$(TARGET="$target" IMAGE_REF="$image_ref" NAME="$name" INSPECT="$inspect_file" node <<'NODE'
const fs = require("fs");
const c = JSON.parse(fs.readFileSync(process.env.INSPECT, "utf8"))[0];
const target = process.env.TARGET;
const image = process.env.IMAGE_REF;
const name = process.env.NAME;
const args = ["docker", "run", "-d", "--name", name];
const hc = c.HostConfig || {};
const restart = (hc.RestartPolicy && hc.RestartPolicy.Name) || "";
if (restart && restart !== "no") args.push("--restart", restart);
const netMode = hc.NetworkMode || "";
const binds = hc.Binds || [];
if (binds.length) {
  for (const b of binds) args.push("-v", b);
} else {
  for (const m of c.Mounts || []) {
    const typ = m.Type || "bind";
    if (typ !== "bind" && typ !== "volume") continue;
    const src = m.Source || "";
    const dst = m.Destination || m.Target || "";
    if (!src || !dst) continue;
    args.push("-v", m.RW === false ? src + ":" + dst + ":ro" : src + ":" + dst);
  }
}
if (netMode === "host") {
  args.push("--network", "host");
} else {
  const ports = hc.PortBindings || {};
  for (const [cp, hosts] of Object.entries(ports)) {
    const port = String(cp).replace(/\/(tcp|udp)$/, "");
    for (const h of hosts || []) {
      if (!h || !h.HostPort) continue;
      const ip = h.HostIp || "";
      args.push("-p", !ip || ip === "0.0.0.0" ? h.HostPort + ":" + port : ip + ":" + h.HostPort + ":" + port);
    }
  }
  const nets = Object.keys((c.NetworkSettings && c.NetworkSettings.Networks) || {});
  if (nets.length) args.push("--network", nets[0]);
}
let sawVersion = false;
let sawSelf = false;
for (const e of (c.Config && c.Config.Env) || []) {
  const s = String(e);
  if (s.startsWith("DEVFORGE_VERSION=")) {
    args.push("-e", "DEVFORGE_VERSION=" + target);
    sawVersion = true;
  } else if (s.startsWith("DEVFORGE_SELF_CONTAINER=")) {
    args.push("-e", "DEVFORGE_SELF_CONTAINER=" + name);
    sawSelf = true;
  } else {
    args.push("-e", s);
  }
}
if (!sawVersion) args.push("-e", "DEVFORGE_VERSION=" + target);
if (!sawSelf) args.push("-e", "DEVFORGE_SELF_CONTAINER=" + name);
const labels = (c.Config && c.Config.Labels) || {};
for (const [k, v] of Object.entries(labels)) {
  if (typeof v === "string") args.push("--label", k + "=" + v);
}
args.push(image);
function sh(a) {
  const s = String(a);
  if (/^[A-Za-z0-9_./:@%=+-]+$/.test(s)) return s;
  return "'" + s.split("'").join("'\\''") + "'";
}
process.stdout.write(args.map(sh).join(" "));
NODE
)
rm -f "$inspect_file"
if [ -z "$run_cmd" ]; then
  echo "DEVFORGE_UPDATE_FAIL inspect du conteneur illisible"
  exit 1
fi
old="${name}-old"
docker rm -f "${name}-updater" "$old" >/dev/null 2>&1 || true
if ! docker rename "$name" "$old"; then
  echo "DEVFORGE_UPDATE_FAIL rename du conteneur impossible"
  exit 1
fi
helper_image=$(helper_image_for "$image_ref")
if ! printf '%s\n' "set +e
sleep 2
docker stop $old >/dev/null 2>&1
docker rm -f $name >/dev/null 2>&1
if $run_cmd; then
  docker rm -f $old >/dev/null 2>&1
  exit 0
fi
docker rm -f $name >/dev/null 2>&1
docker rename $old $name >/dev/null 2>&1
docker start $name >/dev/null 2>&1
exit 1" | schedule_helper "$helper_image" ""; then
  docker rename "$old" "$name" >/dev/null 2>&1 || true
  echo "DEVFORGE_UPDATE_FAIL impossible de planifier la recréation Docker"
  exit 1
fi
echo DEVFORGE_UPDATE_STARTED
exit 0
