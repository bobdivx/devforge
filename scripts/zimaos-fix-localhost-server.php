<?php

use App\Models\PrivateKey;
use App\Models\Server;

$key = PrivateKey::find(0);
$server = Server::find(0);

if ($key === null) {
    fwrite(STDERR, "PrivateKey 0 missing\n");
    exit(1);
}

if ($server === null) {
    fwrite(STDERR, "Server 0 missing\n");
    exit(1);
}

$server->user = 'bobdivx';
$server->ip = 'host.docker.internal';
$server->private_key_id = 0;
$server->save();

echo 'private_key='.$key->id.PHP_EOL;
echo 'server_user='.$server->user.PHP_EOL;
echo 'server_ip='.$server->ip.PHP_EOL;
