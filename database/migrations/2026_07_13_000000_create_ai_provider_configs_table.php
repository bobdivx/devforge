<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_provider_configs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('team_id')->constrained()->cascadeOnDelete();
            $table->string('provider'); // gemini|ollama
            $table->string('name');
            $table->text('api_key')->nullable();
            $table->string('base_url')->nullable();
            $table->string('model');
            $table->boolean('is_default')->default(false);
            $table->timestamps();

            $table->index(['team_id', 'provider']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_provider_configs');
    }
};
