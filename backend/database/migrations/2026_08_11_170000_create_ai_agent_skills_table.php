<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_agent_skills', function (Blueprint $table) {
            $table->id();
            $table->foreignId('team_id')->constrained()->cascadeOnDelete();
            $table->foreignId('agent_id')->nullable()->constrained('ai_agents')->nullOnDelete();
            $table->string('slug', 120);
            $table->string('name', 200);
            $table->string('description', 500);
            $table->longText('body');
            $table->json('tags')->nullable();
            $table->boolean('is_active')->default(true);
            $table->boolean('is_builtin')->default(false);
            $table->unsignedInteger('priority')->default(0);
            $table->timestamps();

            $table->unique(['team_id', 'slug']);
            $table->index(['team_id', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_agent_skills');
    }
};
