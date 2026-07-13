const { Client } = require('ssh2');
const { execSync } = require('child_process');
const path = require('path');

const password = process.env.ZIMAOS_PASS;
const artifact = path.resolve('devforge-rollout-manual.tar.gz');

const conn = new Client();

const remoteScript = `set -e
COMPOSE="/var/lib/casaos/apps/coolify/docker-compose.yml"
cd /var/lib/casaos/apps/coolify

echo "==> Mise a jour APP_URL / SESSION_SECURE_COOKIE"
sudo sed -i 's|APP_URL:.*|APP_URL: https://web.briseteia.me|' "$COMPOSE"
sudo sed -i 's|SESSION_SECURE_COOKIE:.*|SESSION_SECURE_COOKIE: "true"|' "$COMPOSE"

echo "==> Recreate conteneur coolify (nouvelles variables)"
sudo docker compose up -d coolify

echo "==> Attente demarrage"
sleep 8
docker exec coolify printenv APP_URL SESSION_SECURE_COOKIE
`;

conn.on('ready', () => {
    conn.exec(remoteScript, (err, stream) => {
        let out = '';
        stream.on('data', (d) => {
            out += d;
            process.stdout.write(d);
        });
        stream.stderr.on('data', (d) => process.stderr.write(d));
        stream.on('close', (code) => {
            conn.end();
            if (code !== 0) {
                process.exit(code);
            }
            console.log('\n==> Redeploiement DevForge apres recreate...');
            execSync(`node scripts/deploy-via-ssh.cjs "${artifact}" true`, {
                stdio: 'inherit',
                env: { ...process.env, ZIMAOS_PASS: password },
            });
        });
    });
}).connect({ host: '10.1.0.58', username: 'bobdivx', password, readyTimeout: 30000 });
