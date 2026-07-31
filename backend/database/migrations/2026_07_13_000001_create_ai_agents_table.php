<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_agents', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('team_id')->constrained()->cascadeOnDelete();
            $table->foreignId('parent_agent_id')->nullable()->constrained('ai_agents')->nullOnDelete();
            $table->foreignId('provider_config_id')->nullable()->constrained('ai_provider_configs')->nullOnDelete();
            $table->string('resource_uuid')->nullable();
            $table->string('type'); // debug|tech-watch|github|github-actions|devforge|deployment|security
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('avatar_color')->default('#6366f1');
            $table->text('system_prompt')->nullable();
            $table->integer('schedule_minutes')->default(0); // 0 = manuel uniquement
            $table->boolean('is_active')->default(true);
            $table->string('status')->default('idle'); // idle|running|error|paused
            $table->timestamp('last_run_at')->nullable();
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->index(['team_id', 'type']);
            $table->index(['team_id', 'status']);
            $table->index(['is_active', 'schedule_minutes', 'last_run_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_agents');
    }
};
