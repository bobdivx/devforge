<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_agent_memories', function (Blueprint $table) {
            $table->id();
            $table->foreignId('team_id')->constrained('teams')->cascadeOnDelete();
            $table->foreignId('agent_id')->nullable()->constrained('ai_agents')->nullOnDelete();
            /** agent | shared | project */
            $table->string('scope', 32)->default('agent');
            /** UUID ressource Coolify pour scope=project (optionnel). */
            $table->string('resource_uuid')->nullable();
            $table->text('content');
            $table->json('tags')->nullable();
            $table->timestamps();

            $table->index(['team_id', 'scope']);
            $table->index(['team_id', 'agent_id']);
            $table->index(['team_id', 'resource_uuid']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_agent_memories');
    }
};
