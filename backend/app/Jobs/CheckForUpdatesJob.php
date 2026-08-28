<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class CheckForUpdatesJob implements ShouldBeEncrypted, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function handle(): void
    {
        try {
            if (isDev() || isCloud()) {
                return;
            }
            $settings = instanceSettings();

            $github = $this->fetchVersionsFromGitHub();
            $hub = $this->fetchVersionsFromDockerHub();

            $versions = $github ?? $hub;

            if ($versions === null) {
                Log::error('Both GitHub and Docker Hub version checks failed');

                return;
            }

            $githubVersion = data_get($github, 'coolify.v4.version') ?? data_get($github, 'devforge.version');
            $hubVersion = data_get($hub, 'coolify.v4.version') ?? data_get($hub, 'devforge.version');
            $latest_version = is_string($githubVersion) && $githubVersion !== '' ? $githubVersion : null;

            if (is_string($hubVersion) && $hubVersion !== '') {
                if ($latest_version === null || version_compare($hubVersion, $latest_version, '>')) {
                    $latest_version = $hubVersion;
                    Log::info('Using newer Docker Hub version over versions.json', [
                        'store' => $githubVersion,
                        'hub' => $hubVersion,
                    ]);
                }
            }

            if ($latest_version === null) {
                Log::error('No usable version from GitHub or Docker Hub');

                return;
            }

            $current_version = config('constants.coolify.version');

            $existingVersions = null;
            $existingCoolifyVersion = null;
            if (File::exists(base_path('versions.json'))) {
                $existingVersions = json_decode(File::get(base_path('versions.json')), true);
                $existingCoolifyVersion = data_get($existingVersions, 'coolify.v4.version') ?? data_get($existingVersions, 'devforge.version');
            }

            $bestVersion = $latest_version;

            if ($existingCoolifyVersion && version_compare($existingCoolifyVersion, $bestVersion, '>')) {
                Log::warning('CDN served older DevForge version than cache', [
                    'cdn_version' => $latest_version,
                    'cached_version' => $existingCoolifyVersion,
                    'current_version' => $current_version,
                ]);
                $bestVersion = $existingCoolifyVersion;
            }

            if (version_compare($bestVersion, $current_version, '<')) {
                Log::warning('Version downgrade prevented in CheckForUpdatesJob', [
                    'cdn_version' => $latest_version,
                    'cached_version' => $existingCoolifyVersion,
                    'current_version' => $current_version,
                    'attempted_best' => $bestVersion,
                    'using' => $current_version,
                ]);
                $bestVersion = $current_version;
            }

            data_set($versions, 'coolify.v4.version', $bestVersion);
            data_set($versions, 'devforge.version', $bestVersion);
            $latest_version = $bestVersion;

            File::put(base_path('versions.json'), json_encode($versions, JSON_PRETTY_PRINT));

            invalidate_versions_cache();

            if (version_compare($latest_version, $current_version, '>')) {
                $settings->update(['new_version_available' => true]);
            } else {
                $settings->update(['new_version_available' => false]);
            }
        } catch (\Throwable $e) {
            Log::error('CheckForUpdatesJob failed', [
                'exception' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
        }
    }

    /**
     * Fetch versions from GitHub raw URL.
     *
     * @return array|null Versions array or null if failed
     */
    private function fetchVersionsFromGitHub(): ?array
    {
        try {
            $response = Http::retry(3, 1000)->get(config('constants.coolify.versions_url'));

            if (! $response->successful()) {
                Log::warning('GitHub versions URL returned non-2xx status', [
                    'url' => config('constants.coolify.versions_url'),
                    'status' => $response->status(),
                ]);

                return null;
            }

            $versions = $response->json();

            if (empty($versions)) {
                Log::warning('GitHub versions URL returned empty JSON');

                return null;
            }

            $version = data_get($versions, 'coolify.v4.version') ?? data_get($versions, 'devforge.version');
            if (empty($version)) {
                Log::warning('GitHub versions JSON missing version field');

                return null;
            }

            return $versions;
        } catch (\Throwable $e) {
            Log::warning('GitHub versions fetch failed', [
                'url' => config('constants.coolify.versions_url'),
                'exception' => $e->getMessage(),
            ]);

            return null;
        }
    }

    /**
     * Fetch latest version from Docker Hub public API.
     *
     * @return array|null Versions array with devforge.version and coolify.v4.version set
     */
    private function fetchVersionsFromDockerHub(): ?array
    {
        try {
            $image = config('constants.coolify.helper_image', 'bobdivx/devforge');
            $url = "https://hub.docker.com/v2/repositories/{$image}/tags?page_size=100";

            $response = Http::retry(3, 1000)->get($url);

            if (! $response->successful()) {
                Log::error('Docker Hub API returned non-2xx status', [
                    'url' => $url,
                    'status' => $response->status(),
                ]);

                return null;
            }

            $data = $response->json();
            $tags = data_get($data, 'results', []);

            if (empty($tags)) {
                Log::error('Docker Hub returned no tags');

                return null;
            }

            $semverTags = [];
            foreach ($tags as $tag) {
                $name = data_get($tag, 'name', '');
                if (preg_match('/^[0-9]+\.[0-9]+\.[0-9]+$/', $name)) {
                    $semverTags[] = $name;
                }
            }

            if (empty($semverTags)) {
                Log::error('Docker Hub has no plain semver tags');

                return null;
            }

            usort($semverTags, function ($a, $b) {
                return version_compare($b, $a);
            });

            $latestVersion = $semverTags[0];

            Log::info('Docker Hub fallback found version', [
                'version' => $latestVersion,
                'image' => $image,
            ]);

            return [
                'devforge' => [
                    'version' => $latestVersion,
                ],
                'coolify' => [
                    'v4' => [
                        'version' => $latestVersion,
                    ],
                ],
            ];
        } catch (\Throwable $e) {
            Log::error('Docker Hub fallback failed', [
                'exception' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);

            return null;
        }
    }
}
