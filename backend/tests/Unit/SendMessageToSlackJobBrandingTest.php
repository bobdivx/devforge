<?php

use App\Jobs\SendMessageToSlackJob;
use App\Notifications\Dto\SlackMessage;
use Illuminate\Support\Facades\Http;

it('labels slack notifications with the product name', function () {
    config(['app.name' => 'DevForge']);
    Http::fake();

    $job = new SendMessageToSlackJob(
        new SlackMessage(title: 'Deployed', description: 'App is live', color: '#00ff00'),
        'https://hooks.slack.com/services/T/B/X'
    );

    $job->handle();

    Http::assertSent(function ($request) {
        $payload = $request->data();

        return ($payload['blocks'][0]['text']['text'] ?? null) === 'DevForge Notification';
    });
});
