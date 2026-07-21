<?php

use App\Models\Application;
use App\Services\DevForge\Application\ApplicationWebhookService;
use Illuminate\Validation\ValidationException;

it('presents deploy webhook and manual secrets flags without leaking secrets', function () {
    $application = new Application([
        'uuid' => 'appwebhook123456789012345',
        'source_id' => 0,
        'manual_webhook_secret_github' => 'super-secret',
        'manual_webhook_secret_gitlab' => null,
        'manual_webhook_secret_bitbucket' => null,
        'manual_webhook_secret_gitea' => null,
        'git_repository' => 'acme/demo',
    ]);

    $payload = app(ApplicationWebhookService::class)->show($application);

    expect($payload['deploy_webhook_url'])->toContain('uuid=appwebhook123456789012345')
        ->and($payload['manual_webhooks_available'])->toBeTrue()
        ->and($payload['uses_git_app'])->toBeFalse()
        ->and($payload['manual']['github']['secret_set'])->toBeTrue()
        ->and($payload['manual']['gitlab']['secret_set'])->toBeFalse()
        ->and($payload)->not->toHaveKey('manual_webhook_secret_github');
});

it('marks git app applications as not needing manual webhooks', function () {
    $application = new Application([
        'uuid' => 'appwebhookgitapp123456789',
        'source_id' => 42,
    ]);

    $payload = app(ApplicationWebhookService::class)->show($application);

    expect($payload['manual_webhooks_available'])->toBeFalse()
        ->and($payload['uses_git_app'])->toBeTrue()
        ->and($payload['manual'])->toBeNull();
});

it('rejects secret updates for git app applications', function () {
    $application = new Application([
        'uuid' => 'appwebhookgitapp123456789',
        'source_id' => 12,
    ]);

    expect(fn () => app(ApplicationWebhookService::class)->update($application, [
        'manual_webhook_secret_github' => 'new-secret',
    ]))->toThrow(ValidationException::class);
});
