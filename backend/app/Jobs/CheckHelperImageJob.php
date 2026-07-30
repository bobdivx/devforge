<?php

namespace App\Jobs;

use App\Models\Server;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class CheckHelperImageJob implements ShouldBeEncrypted, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $timeout = 1000;

    public function __construct() {}

    public function handle(): void
    {
        try {
            $server = Server::find(0);
            if (! $server) {
                return;
            }

            $helperTag = getHelperVersion();
            $helperImage = config('constants.coolify.helper_image').':'.$helperTag;

            // Pull DevForge helper from our registry (no Coolify CDN / coolify-helper).
            instant_remote_process(["docker pull {$helperImage}"], $server);

            instanceSettings()->update(['helper_version' => $helperTag]);
        } catch (\Throwable $e) {
            send_internal_notification('CheckHelperImageJob failed with: '.$e->getMessage());
            throw $e;
        }
    }
}
