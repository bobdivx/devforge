<?php

use App\Jobs\CheckHelperImageJob;
use App\Jobs\ServerConnectionCheckJob;
use App\Models\Server;

$server = Server::find(0);
if ($server === null) {
    fwrite(STDERR, "Server 0 missing\n");
    exit(1);
}

ServerConnectionCheckJob::dispatchSync($server);
CheckHelperImageJob::dispatchSync();

$server->refresh();
echo 'reachable='.($server->settings->is_reachable ? 'yes' : 'no').PHP_EOL;
echo 'usable='.($server->settings->is_usable ? 'yes' : 'no').PHP_EOL;
