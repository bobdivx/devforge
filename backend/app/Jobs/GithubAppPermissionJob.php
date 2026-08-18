<?php

namespace App\Jobs;

use App\Models\GithubApp;
use App\Services\DevForge\Github\GithubAppHookUrlSynchronizer;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;

class GithubAppPermissionJob implements ShouldBeEncrypted, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $tries = 4;

    public function backoff(): int
    {
        return isDev() ? 1 : 3;
    }

    public function __construct(public GithubApp $github_app) {}

    public function handle()
    {
        try {
            $github_access_token = generateGithubJwt($this->github_app);

            $response = Http::withHeaders([
                'Authorization' => "Bearer $github_access_token",
                'Accept' => 'application/vnd.github+json',
            ])->get("{$this->github_app->api_url}/app");

            if (! $response->successful()) {
                throw new \RuntimeException('Failed to fetch GitHub app permissions: '.$response->body());
            }

            $response = $response->json();
            $permissions = data_get($response, 'permissions');

            $this->github_app->contents = data_get($permissions, 'contents');
            $this->github_app->metadata = data_get($permissions, 'metadata');
            $this->github_app->pull_requests = data_get($permissions, 'pull_requests');
            $this->github_app->administration = data_get($permissions, 'administration');

            $this->github_app->save();
            $this->github_app->makeVisible('client_secret')->makeVisible('webhook_secret');

            try {
                app(GithubAppHookUrlSynchronizer::class)->sync($this->github_app, $github_access_token);
            } catch (\Throwable $e) {
                send_internal_notification('GithubAppHookUrlSynchronizer failed with: '.$e->getMessage());
            }

        } catch (\Throwable $e) {
            send_internal_notification('GithubAppPermissionJob failed with: '.$e->getMessage());
            throw $e;
        }
    }
}
