<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_agent_messages', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('agent_id')->constrained('ai_agents')->cascadeOnDelete();
            $table->foreignId('run_id')->nullable()->constrained('ai_agent_runs')->nullOnDelete();
            $table->string('role'); // user|assistant
            $table->text('content');
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->index(['agent_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_agent_messages');
    }
};
