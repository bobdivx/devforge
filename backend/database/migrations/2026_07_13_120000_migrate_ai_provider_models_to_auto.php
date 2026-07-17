<?php

use App\Services\DevForge\Agent\LlmModelResolver;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('ai_provider_configs')) {
            return;
        }

        DB::table('ai_provider_configs')
            ->where('model', '!=', LlmModelResolver::AUTO)
            ->update(['model' => LlmModelResolver::AUTO]);
    }

    public function down(): void
    {
        // Irréversible : les modèles explicites précédents ne sont pas conservés.
    }
};
