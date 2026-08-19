<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('store_listings', function (Blueprint $table) {
            $table->id();
            $table->string('uuid')->unique();
            $table->string('slug')->unique();
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('category')->nullable()->index();
            $table->string('icon_url')->nullable();
            $table->string('website_url')->nullable();
            $table->foreignId('team_id')->constrained()->cascadeOnDelete();
            $table->foreignId('source_application_id')->nullable()->unique()->constrained('applications')->nullOnDelete();
            $table->string('git_repository');
            $table->string('git_branch');
            $table->string('git_commit_sha')->nullable();
            $table->json('runtime_defaults');
            $table->json('env_schema');
            $table->string('status')->default('published')->index();
            $table->unsignedInteger('install_count')->default(0);
            $table->timestamps();

            $table->index(['status', 'created_at']);
        });

        Schema::create('store_listing_installs', function (Blueprint $table) {
            $table->id();
            $table->string('uuid')->unique();
            $table->foreignId('store_listing_id')->constrained('store_listings')->cascadeOnDelete();
            $table->foreignId('team_id')->constrained()->cascadeOnDelete();
            $table->foreignId('application_id')->nullable()->constrained('applications')->nullOnDelete();
            $table->foreignId('installed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['team_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('store_listing_installs');
        Schema::dropIfExists('store_listings');
    }
};
