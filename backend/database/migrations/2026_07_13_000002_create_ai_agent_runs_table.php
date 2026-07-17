<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_agent_runs', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('agent_id')->constrained('ai_agents')->cascadeOnDelete();
            $table->string('status')->default('pending'); // pending|running|completed|failed
            $table->string('trigger')->default('manual'); // scheduled|manual|event
            $table->text('summary')->nullable();
            $table->json('actions_taken')->nullable();
            $table->longText('logs')->nullable();
            $table->integer('tokens_used')->default(0);
            $table->integer('iterations')->default(0);
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();

            $table->index(['agent_id', 'status']);
            $table->index(['agent_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_agent_runs');
    }
};
