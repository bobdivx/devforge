const { Client } = require('ssh2');

const password = process.env.ZIMAOS_PASS;
const conn = new Client();

const script = `set -e
COMPOSE="/var/lib/casaos/apps/coolify/docker-compose.yml"
if [ -f "$COMPOSE" ]; then
  echo "==> Mise a jour docker-compose CasaOS"
  for kv in "APP_URL=https://web.briseteia.me" "SESSION_SECURE_COOKIE=true"; do
    key="\${kv%%=*}"
    val="\${kv#*=}"
    if grep -q "^\${key}=" "$COMPOSE" 2>/dev/null; then
      sudo sed -i "s|^\${key}=.*|\${key}=\${val}|" "$COMPOSE"
    else
      echo "    \${key}=\${val} (ajouter manuellement si absent du compose)"
    fi
  done
fi

echo "==> Mise a jour .env conteneur"
docker exec coolify sh -c '
  for kv in "APP_URL=https://web.briseteia.me" "SESSION_SECURE_COOKIE=true"; do
    key="\${kv%%=*}"
    val="\${kv#*=}"
    if grep -q "^\${key}=" /var/www/html/.env; then
      sed -i "s|^\${key}=.*|\${key}=\${val}|" /var/www/html/.env
    else
      echo "\${key}=\${val}" >> /var/www/html/.env
    fi
  done
'

echo "==> FQDN instance_settings"
docker exec coolify php artisan tinker --execute="\\\\App\\\\Models\\\\InstanceSettings::first()?->update(['fqdn' => 'https://web.briseteia.me']); echo 'FQDN_OK';" 2>/dev/null || true

docker exec -w /var/www/html coolify php artisan config:clear
docker exec coolify printenv APP_URL SESSION_SECURE_COOKIE 2>/dev/null || true
docker exec -w /var/www/html coolify php artisan config:show session.secure app.url 2>/dev/null | head -10

echo "==> Test HTTPS /devforge (sans auth)"
curl -sI https://web.briseteia.me/devforge/ 2>/dev/null | head -5 || curl -sI http://127.0.0.1:8080/devforge/ | head -5
`;

conn
    .on('ready', () => {
        conn.exec(script, (err, stream) => {
            stream.on('data', (d) => process.stdout.write(d));
            stream.stderr.on('data', (d) => process.stderr.write(d));
            stream.on('close', () => conn.end());
        });
    })
    .connect({ host: '10.1.0.58', username: 'bobdivx', password, readyTimeout: 15000 });
