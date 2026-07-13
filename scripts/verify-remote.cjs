const { Client } = require('ssh2');

const conn = new Client();
conn
    .on('ready', () => {
        const cmd = [
            "docker exec coolify php artisan route:list --name=devforge --except-vendor 2>&1 | head -25",
            'docker exec coolify test -f /var/www/html/public/devforge/index.html && echo INDEX_OK',
            'curl -sI http://127.0.0.1:8080/devforge/ 2>/dev/null | head -8',
            'docker exec coolify printenv | grep -E "APP_URL|SESSION_SECURE|DEVFORGE"',
        ].join(' ; echo "---" ; ');

        conn.exec(cmd, (err, stream) => {
            stream.on('data', (d) => process.stdout.write(d));
            stream.stderr.on('data', (d) => process.stderr.write(d));
            stream.on('close', () => conn.end());
        });
    })
    .connect({
        host: '10.1.0.58',
        username: 'bobdivx',
        password: process.env.ZIMAOS_PASS,
        readyTimeout: 15000,
    });
