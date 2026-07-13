const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`cat /var/lib/casaos/apps/coolify/docker-compose.yml 2>/dev/null | head -80`, (e,s)=>{
    s.on('data',d=>process.stdout.write(d));
    s.on('close',()=>conn.end());
  });
}).connect({host:'10.1.0.58',username:'bobdivx',password:process.env.ZIMAOS_PASS});