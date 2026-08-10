<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('github_runner_application_links', function (Blueprint $table) {
            $table->id();
            $table->foreignId('team_id')->constrained('teams')->cascadeOnDelete();
            $table->foreignId('application_id')->constrained('applications')->cascadeOnDelete();
            $table->string('server_uuid', 64);
            $table->string('container_name', 255);
            /** frontend | backend | desktop | ci | other */
            $table->string('role', 32)->nullable();
            $table->timestamps();

            $table->unique(
                ['team_id', 'server_uuid', 'container_name', 'application_id'],
                'github_runner_app_links_unique'
            );
            $table->index(['team_id', 'application_id']);
            $table->index(['team_id', 'server_uuid', 'container_name'], 'github_runner_app_links_runner_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('github_runner_application_links');
    }
};
