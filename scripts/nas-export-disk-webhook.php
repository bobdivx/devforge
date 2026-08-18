<?php

require '/var/www/html/vendor/autoload.php';

$app = require '/var/www/html/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use App\Models\DiscordNotificationSettings;
use App\Models\TelegramNotificationSettings;

$discord = DiscordNotificationSettings::query()
    ->whereNotNull('discord_webhook_url')
    ->orderBy('id')
    ->get()
    ->first(fn (DiscordNotificationSettings $row): bool => filled($row->discord_webhook_url));

$telegram = TelegramNotificationSettings::query()
    ->orderBy('id')
    ->get()
    ->first(function (TelegramNotificationSettings $row): bool {
        return filled($row->telegram_token) && filled($row->telegram_chat_id);
    });

$lines = [];

if ($discord !== null) {
    $url = (string) $discord->discord_webhook_url;
    if (preg_match('#^https://(?:canary\.|ptb\.)?discord(?:app)?\.com/api/webhooks/#', $url) !== 1) {
        fwrite(STDERR, "discord webhook url rejected\n");
        exit(1);
    }
    $lines[] = 'DEVFORGE_DISK_WEBHOOK_URL='.escapeshellarg($url);
}

if ($telegram !== null) {
    $lines[] = 'DEVFORGE_DISK_TELEGRAM_BOT_TOKEN='.escapeshellarg((string) $telegram->telegram_token);
    $lines[] = 'DEVFORGE_DISK_TELEGRAM_CHAT_ID='.escapeshellarg((string) $telegram->telegram_chat_id);
}

if ($lines === []) {
    fwrite(STDERR, "no discord/telegram credentials configured in DevForge\n");
    exit(2);
}

fwrite(STDOUT, implode("\n", $lines)."\n");
