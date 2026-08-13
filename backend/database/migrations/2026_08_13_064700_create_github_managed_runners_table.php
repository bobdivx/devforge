<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Visus\Cuid2\Cuid2;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('github_managed_runners', function (Blueprint $table) {
            $table->id();
            $table->string('uuid')->unique();
            $table->foreignId('team_id')->constrained('teams')->cascadeOnDelete();
            $table->string('server_uuid', 64);
            $table->string('container_name', 255);
            $table->string('runner_name', 255);
            $table->string('owner', 100);
            $table->string('repo', 100);
            $table->string('repo_url', 512);
            $table->string('image', 255);
            $table->string('labels', 255)->nullable();
            $table->string('network_mode', 16)->default('bridge');
            $table->string('timezone', 64)->default('UTC');
            $table->boolean('replace_existing')->default(true);
            $table->boolean('pull_image')->default(true);
            $table->json('volumes')->nullable();
            $table->json('extra_env')->nullable();
            $table->string('auth_mode', 32)->default('registration');
            $table->unsignedBigInteger('github_app_id')->nullable();
            $table->boolean('enabled')->default(true);
            $table->timestamp('last_reconciled_at')->nullable();
            $table->text('last_reconcile_error')->nullable();
            $table->timestamps();

            $table->unique(['team_id', 'server_uuid', 'container_name'], 'github_managed_runners_unique');
            $table->index(['enabled', 'team_id']);
            $table->index(['server_uuid', 'container_name']);
        });

        $this->backfillKnownRunners();
    }

    public function down(): void
    {
        Schema::dropIfExists('github_managed_runners');
    }

    private function backfillKnownRunners(): void
    {
        if (! Schema::hasTable('github_runner_application_links')) {
            return;
        }

        $links = DB::table('github_runner_application_links')
            ->select('team_id', 'server_uuid', 'container_name')
            ->distinct()
            ->get();

        // Prefer an app that has a saved packages_token (encrypted length > 0).
        $githubAppId = DB::table('github_apps')
            ->whereNotNull('packages_token')
            ->where('packages_token', '!=', '')
            ->orderByDesc('id')
            ->value('id')
            ?? DB::table('github_apps')->orderBy('id')->value('id');

        $defaults = [
            'github-runner-popcorn-client' => [
                'owner' => 'bobdivx',
                'repo' => 'popcorn-client',
                'image' => 'ghcr.io/bobdivx/popcorn-github-runner-client:latest',
                'network_mode' => 'bridge',
                'runner_name' => 'casaos-runner-popcorn-client',
                'volumes' => [
                    '/media/Docker/AppData/runner/client:/shared-data',
                    '/media/Docker/AppData/runner/npm:/home/runner/.npm',
                    '/media/Docker/AppData/runner/registry:/opt/cargo/registry',
                ],
            ],
            'github-runner-popcorn-server' => [
                'owner' => 'bobdivx',
                'repo' => 'popcorn-server',
                'image' => 'ghcr.io/bobdivx/popcorn-github-runner-server:latest',
                'network_mode' => 'host',
                'runner_name' => 'casaos-runner-popcorn-server',
                'volumes' => [
                    '/media/Docker/AppData/runner/server:/shared-data',
                    '/media/Docker/AppData/runner/buildx:/home/runner/.docker/buildx',
                    '/media/Docker/AppData/runner/npm:/home/runner/.npm',
                    '/media/Docker/AppData/runner/registry:/opt/cargo/registry',
                ],
            ],
            'github-runner-popcorn-tauri' => [
                'owner' => 'bobdivx',
                'repo' => 'popcorn-tauri',
                'image' => 'ghcr.io/bobdivx/popcorn-github-runner-server:latest',
                'network_mode' => 'bridge',
                'runner_name' => 'casaos-runner-popcorn-tauri',
                'volumes' => [
                    '/media/Docker/AppData/runner/tauri:/shared-data',
                    '/media/Docker/AppData/runner/npm:/home/runner/.npm',
                    '/media/Docker/AppData/runner/registry:/opt/cargo/registry',
                ],
            ],
            'github-runner-popcorn-web' => [
                'owner' => 'bobdivx',
                'repo' => 'popcorn-web',
                'image' => 'ghcr.io/bobdivx/popcorn-github-runner-client:latest',
                'network_mode' => 'bridge',
                'runner_name' => 'casaos-runner-popcorn-web',
                'volumes' => [
                    '/media/Docker/AppData/runner/npm:/home/runner/.npm',
                ],
            ],
        ];

        $now = now();

        foreach ($links as $link) {
            $spec = $defaults[$link->container_name] ?? null;
            if ($spec === null) {
                continue;
            }

            $exists = DB::table('github_managed_runners')
                ->where('team_id', $link->team_id)
                ->where('server_uuid', $link->server_uuid)
                ->where('container_name', $link->container_name)
                ->exists();

            if ($exists) {
                continue;
            }

            DB::table('github_managed_runners')->insert([
                'uuid' => (string) new Cuid2,
                'team_id' => $link->team_id,
                'server_uuid' => $link->server_uuid,
                'container_name' => $link->container_name,
                'runner_name' => $spec['runner_name'],
                'owner' => $spec['owner'],
                'repo' => $spec['repo'],
                'repo_url' => 'https://github.com/'.$spec['owner'].'/'.$spec['repo'],
                'image' => $spec['image'],
                'labels' => 'self-hosted,devforge',
                'network_mode' => $spec['network_mode'],
                'timezone' => 'Europe/Paris',
                'replace_existing' => true,
                'pull_image' => true,
                'volumes' => json_encode($spec['volumes']),
                'extra_env' => null,
                'auth_mode' => 'pat',
                'github_app_id' => $githubAppId,
                'enabled' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }
};
