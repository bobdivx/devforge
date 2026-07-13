#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const host = process.env.NAS_HOST || '10.1.0.58';
const user = process.env.NAS_USER || 'bobdivx';
const password = process.env.ZIMAOS_PASS;
const artifact = process.argv[2] || 'devforge-rollout-manual.tar.gz';
const enableAgents = process.argv[3] !== 'false';
const remoteScript = path.join(__dirname, 'devforge-rollout-remote.sh');

if (!password) {
    console.error('ZIMAOS_PASS requis');
    process.exit(1);
}
if (!fs.existsSync(artifact)) {
    console.error(`Artefact introuvable: ${artifact}`);
    process.exit(1);
}

const staging = `/tmp/devforge-deploy-${Date.now()}`;
const conn = new Client();

function exec(cmd) {
    return new Promise((resolve, reject) => {
        conn.exec(cmd, (err, stream) => {
            if (err) {
                reject(err);
                return;
            }
            let stdout = '';
            let stderr = '';
            stream.on('data', (d) => {
                stdout += d;
                process.stdout.write(d);
            });
            stream.stderr.on('data', (d) => {
                stderr += d;
                process.stderr.write(d);
            });
            stream.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Command failed (${code}): ${stderr || stdout}`));
                }
            });
        });
    });
}

function upload(localPath, remotePath) {
    return new Promise((resolve, reject) => {
        conn.sftp((err, sftp) => {
            if (err) {
                reject(err);
                return;
            }
            const read = fs.createReadStream(localPath);
            const write = sftp.createWriteStream(remotePath);
            write.on('close', () => resolve());
            write.on('error', reject);
            read.on('error', reject);
            read.pipe(write);
        });
    });
}

conn
    .on('ready', async () => {
        try {
            console.log(`==> Staging ${staging}`);
            await exec(`mkdir -p ${staging}`);
            console.log('==> Upload artefact');
            await upload(path.resolve(artifact), `${staging}/rollout.tar.gz`);
            console.log('==> Upload script');
            await upload(remoteScript, `${staging}/remote.sh`);
            const agentsFlag = enableAgents ? 'true' : 'false';
            await exec(
                `cd ${staging} && sed -i 's/\\r$//' remote.sh && chmod +x remote.sh && bash remote.sh rollout.tar.gz coolify - ${agentsFlag}`,
            );
            await exec(`rm -rf ${staging}`);
            conn.end();
        } catch (error) {
            console.error('ERREUR:', error.message);
            conn.end();
            process.exit(1);
        }
    })
    .on('error', (error) => {
        console.error('SSH:', error.message);
        process.exit(1);
    })
    .connect({
        host,
        port: 22,
        username: user,
        password,
        readyTimeout: 30000,
    });
