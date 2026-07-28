<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ai_agent_sessions', function (Blueprint $table) {
            $table->string('chat_mode', 16)->default('build')->after('title');
        });

        Schema::create('ai_agent_instruction_layers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('team_id')->constrained('teams')->cascadeOnDelete();
            $table->string('scope', 32); // org | personal | project
            $table->string('user_email')->nullable();
            $table->string('resource_uuid')->nullable();
            $table->longText('content')->nullable();
            $table->timestamps();

            $table->index(['team_id', 'scope']);
            $table->index(['team_id', 'user_email']);
            $table->index(['team_id', 'resource_uuid']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_agent_instruction_layers');

        Schema::table('ai_agent_sessions', function (Blueprint $table) {
            $table->dropColumn('chat_mode');
        });
    }
};
