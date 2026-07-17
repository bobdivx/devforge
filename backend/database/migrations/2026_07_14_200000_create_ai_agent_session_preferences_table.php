<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_agent_session_preferences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('agent_id')->constrained('ai_agents')->cascadeOnDelete();
            $table->foreignId('session_id')->constrained('ai_agent_sessions')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['user_id', 'agent_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_agent_session_preferences');
    }
};
