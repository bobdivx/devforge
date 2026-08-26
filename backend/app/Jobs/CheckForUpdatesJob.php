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
            
            // Try GitHub raw URL first
            $versions = $this->fetchVersionsFromGitHub();
            
            // Fallback to Docker Hub if GitHub fetch failed
            if ($versions === null) {
                Log::warning('GitHub versions URL failed, falling back to Docker Hub');
                $versions = $this->fetchVersionsFromDockerHub();
            }

            // If both sources failed, abort
            if ($versions === null) {
                Log::error('Both GitHub and Docker Hub version checks failed');
                return;
            }

            $latest_version = data_get($versions, 'coolify.v4.version') ?? data_get($versions, 'devforge.version');
            $current_version = config('constants.coolify.version');

            // Read existing cached version
            $existingVersions = null;
            $existingCoolifyVersion = null;
            if (File::exists(base_path('versions.json'))) {
                $existingVersions = json_decode(File::get(base_path('versions.json')), true);
                $existingCoolifyVersion = data_get($existingVersions, 'coolify.v4.version') ?? data_get($existingVersions, 'devforge.version');
            }

            // Determine the BEST version to use (CDN, cache, or current)
            $bestVersion = $latest_version;

            // Check if cache has newer version than CDN
            if ($existingCoolifyVersion && version_compare($existingCoolifyVersion, $bestVersion, '>')) {
                Log::warning('CDN served older DevForge version than cache', [
                    'cdn_version' => $latest_version,
                    'cached_version' => $existingCoolifyVersion,
                    'current_version' => $current_version,
                ]);
                $bestVersion = $existingCoolifyVersion;
            }

            // CRITICAL: Never allow bestVersion to be older than currently running version
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

            // Use data_set() for safe mutation (fixes #3)
            data_set($versions, 'coolify.v4.version', $bestVersion);
            $latest_version = $bestVersion;

            // ALWAYS write versions.json (for Sentinel, Helper, Traefik updates)
            File::put(base_path('versions.json'), json_encode($versions, JSON_PRETTY_PRINT));

            // Invalidate cache to ensure fresh data is loaded
            invalidate_versions_cache();

            // Only mark new version available if DevForge version actually increased
            if (version_compare($latest_version, $current_version, '>')) {
                // New version available
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

            // Validate that we have at least a version field
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

            // Filter to plain semver tags (e.g., 4.1.4, not api-4.1.4 or sha-*)
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

            // Sort and pick highest version
            usort($semverTags, function ($a, $b) {
                return version_compare($b, $a); // Descending
            });
            
            $latestVersion = $semverTags[0];
            
            Log::info('Docker Hub fallback found version', [
                'version' => $latestVersion,
                'image' => $image,
            ]);

            // Build minimal versions array
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
