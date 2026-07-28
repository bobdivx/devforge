<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_agent_missions', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('team_id')->constrained('teams')->cascadeOnDelete();
            $table->foreignId('agent_id')->nullable()->constrained('ai_agents')->nullOnDelete();
            $table->foreignId('assignee_agent_id')->nullable()->constrained('ai_agents')->nullOnDelete();
            $table->string('resource_uuid')->nullable();
            /** bug | feature | tech_watch | github_pr | ops | other */
            $table->string('kind', 32)->default('other');
            /** open | in_progress | blocked | done | cancelled */
            $table->string('status', 32)->default('open');
            $table->string('priority', 16)->default('normal');
            $table->string('title');
            $table->text('description')->nullable();
            $table->string('source', 64)->nullable();
            $table->string('dedupe_key')->nullable();
            $table->json('metadata')->nullable();
            $table->timestamp('due_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->index(['team_id', 'status']);
            $table->index(['team_id', 'kind']);
            $table->index(['team_id', 'agent_id']);
            $table->unique(['team_id', 'dedupe_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_agent_missions');
    }
};
