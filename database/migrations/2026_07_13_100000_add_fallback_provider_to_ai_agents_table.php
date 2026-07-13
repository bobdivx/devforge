<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ai_agents', function (Blueprint $table) {
            $table->foreignId('fallback_provider_config_id')
                ->nullable()
                ->after('provider_config_id')
                ->constrained('ai_provider_configs')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('ai_agents', function (Blueprint $table) {
            $table->dropConstrainedForeignId('fallback_provider_config_id');
        });
    }
};
