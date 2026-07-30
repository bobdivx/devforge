<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_agent_subagent_runs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('parent_agent_id')->constrained('ai_agents')->cascadeOnDelete();
            $table->foreignId('child_agent_id')->constrained('ai_agents')->cascadeOnDelete();
            $table->foreignId('parent_run_id')->nullable()->constrained('ai_agent_runs')->nullOnDelete();
            $table->foreignId('child_run_id')->nullable()->constrained('ai_agent_runs')->nullOnDelete();
            $table->string('status')->default('pending');
            $table->text('reason')->nullable();
            $table->text('output')->nullable();
            $table->text('error')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();

            $table->index(['parent_agent_id', 'status']);
            $table->index(['child_agent_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_agent_subagent_runs');
    }
};
