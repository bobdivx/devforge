<?php

use App\Services\DevForge\Database\DatabaseContainerLogs;
use Illuminate\Database\Eloquent\Model;

it('returns unavailable payload when the destination server is missing', function () {
    $database = new class extends Model
    {
        public $uuid = 'dbcontainerlogs1234567890';

        public $destination = null;
    };

    $payload = app(DatabaseContainerLogs::class)->fetch($database, 50);

    expect($payload['available'])->toBeFalse()
        ->and($payload['reason'])->toBe('server_unavailable')
        ->and($payload['items'])->toBe([]);
});
