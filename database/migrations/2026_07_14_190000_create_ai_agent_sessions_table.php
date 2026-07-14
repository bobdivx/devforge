<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_agent_sessions', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('agent_id')->constrained('ai_agents')->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->cascadeOnDelete();
            $table->string('title');
            $table->timestamp('last_message_at')->nullable();
            $table->timestamps();

            $table->index(['agent_id', 'user_id', 'last_message_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_agent_sessions');
    }
};
